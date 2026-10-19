-- PeopleCore · Expense suite (Kredily's Expense Admin): settings (receipt reading, multi-level approval with a
-- threshold, auto-finalize, finance-only approval, skip, escalation), sub-categories, claims on hold for more
-- information, expenses recorded by finance, payouts outside payroll (bank or cash) with a bank file, and the
-- payout stamp for claims paid with payroll.
--
-- Approval routing uses the approvals engine: besides the two-step flow ('expense_claim': manager, then finance)
-- there are one-step flows for manager-only ('expense_claim_manager') and finance-only ('expense_claim_finance').
-- submit_expense_claim picks the flow from the organization's settings. A claim is never paid twice: payouts
-- outside payroll refuse claims already included in a payroll run that is being processed.

-- ─── Settings ───────────────────────────────────────────────────────────────

create table public.expense_settings (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  receipt_reading  boolean not null default true,
  multi_level      boolean not null default true,
  threshold        numeric(12,2) check (threshold > 0),
  auto_finalize    boolean not null default false,
  finance_only     boolean not null default false,
  allow_skip       boolean not null default false,
  escalation_days  smallint not null default 3 check (escalation_days between 1 and 90),
  updated_at       timestamptz not null default now()
);
create trigger expense_settings_touch before update on public.expense_settings for each row execute function app.touch_updated_at();
create trigger expense_settings_audit after insert or update on public.expense_settings for each row execute function app.audit_row();
insert into public.expense_settings (organization_id) select id from public.organizations on conflict do nothing;

alter table public.expense_settings enable row level security;
create policy expense_settings_select on public.expense_settings for select to authenticated using (app.is_member(organization_id));
create policy expense_settings_write on public.expense_settings for all to authenticated
  using (app.has_permission(organization_id, 'expense.manage')) with check (app.has_permission(organization_id, 'expense.manage'));
grant select, insert, update on public.expense_settings to authenticated;
grant all on public.expense_settings to service_role;

-- ─── Categories, items, claims ──────────────────────────────────────────────

alter table public.expense_categories
  add column description   text check (char_length(description) <= 200),
  add column subcategories text[] not null default '{}' check (cardinality(subcategories) <= 30);
alter table public.expense_items add column subcategory text check (char_length(subcategory) between 1 and 60);
alter table public.expense_claims
  add column payout_mode       text check (payout_mode in ('payroll', 'bank', 'cash')),
  add column payout_reference  text check (char_length(payout_reference) <= 80),
  add column paid_at           timestamptz,
  add column paid_by           uuid,
  add column held_at           timestamptz,
  add column hold_note         text check (char_length(hold_note) <= 500),
  add column hold_reply        text check (char_length(hold_reply) <= 500),
  add column recorded_by_finance boolean not null default false;

-- Claims paid with payroll get the same payout stamp as claims paid by finance; a decided claim is no longer on hold.
create function app.expense_paid_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_at := coalesce(new.paid_at, now());
    new.payout_mode := coalesce(new.payout_mode, case when new.paid_run_id is not null then 'payroll' end);
  end if;
  if old.status = 'pending' and new.status <> 'pending' then
    new.held_at := null;   -- decided, so no longer waiting for information
  end if;
  return new;
end $$;
revoke all on function app.expense_paid_stamp() from public;
create trigger expense_claims_paid_stamp before update on public.expense_claims for each row execute function app.expense_paid_stamp();

-- ─── Approval flows ─────────────────────────────────────────────────────────

insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label, escalate_after_hours) values
  ('expense_claim_manager', 1, 'reporting_manager', 'expense.approve', 'Reporting manager', 72),
  ('expense_claim_finance', 1, 'permission', 'expense.manage', 'Finance', 72);
insert into app.approval_handlers (subject_type, handler) values
  ('expense_claim_manager', 'app.on_expense_decided(uuid,text)'),
  ('expense_claim_finance', 'app.on_expense_decided(uuid,text)');
select app.seed_org_flows(o.id, t) from public.organizations o, unnest(array['expense_claim_manager', 'expense_claim_finance']) t;

-- Escalation days apply to every expense approval step of the organization.
create function app.expense_settings_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.approval_flow_steps s set escalate_after_hours = new.escalation_days * 24
    from public.approval_flows f
   where f.id = s.flow_id and f.organization_id = new.organization_id and f.is_active
     and f.subject_type in ('expense_claim', 'expense_claim_manager', 'expense_claim_finance');
  return null;
end $$;
revoke all on function app.expense_settings_sync() from public;
create trigger expense_settings_sync after insert or update of escalation_days on public.expense_settings for each row execute function app.expense_settings_sync();

create function app.expense_settings_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.expense_settings (organization_id) values (new.id) on conflict do nothing;
  return null;
end $$;
revoke all on function app.expense_settings_default() from public;
-- After the flows exist (trigger names fire in alphabetical order: organizations_seed_flows < organizations_zz_…).
create trigger organizations_zz_expense_settings after insert on public.organizations for each row execute function app.expense_settings_default();

-- The flow a claim follows, from the settings: finance only; manager only (single level, auto-finalize, or at/below
-- the threshold); otherwise manager then finance.
create function app.expense_flow_for(p_org uuid, p_total numeric) returns text
language sql stable security definer set search_path = '' as $$
  select case
           when coalesce(s.finance_only, false) then 'expense_claim_finance'
           when not coalesce(s.multi_level, true) or coalesce(s.auto_finalize, false)
                or (s.threshold is not null and p_total <= s.threshold) then 'expense_claim_manager'
           else 'expense_claim' end
    from (select 1) one left join public.expense_settings s on s.organization_id = p_org;
$$;
revoke all on function app.expense_flow_for(uuid, numeric) from public;

create or replace function public.submit_expense_claim(p_claim uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_claim public.expense_claims := app.own_draft_claim(p_claim);
  v_name  text;
  v_req   uuid;
begin
  if not exists (select 1 from public.expense_items where claim_id = p_claim) then
    raise exception 'Add at least one expense before submitting.' using errcode = '22023';
  end if;
  update public.expense_items i set duplicate_note = coalesce(
    (select 'Same receipt file as an item on “' || c.title || '”.' from public.expense_items o join public.expense_claims c on c.id = o.claim_id
      where o.organization_id = i.organization_id and o.receipt_hash = i.receipt_hash and o.id <> i.id and c.status <> 'cancelled' limit 1),
    (select 'Same date, category and amount as an item on “' || c.title || '”.' from public.expense_items o join public.expense_claims c on c.id = o.claim_id
      where c.employee_id = v_claim.employee_id and o.claim_id <> i.claim_id and o.expense_date = i.expense_date
        and o.category_id = i.category_id and o.amount = i.amount and c.status not in ('cancelled', 'rejected') limit 1))
   where i.claim_id = p_claim;
  select trim(concat_ws(' ', first_name, last_name)) into v_name from public.employees where id = v_claim.employee_id;
  v_req := app.request_approval(v_claim.organization_id, app.expense_flow_for(v_claim.organization_id, v_claim.total), p_claim, v_claim.employee_id,
    format('%s: %s (₹%s)%s', v_name, v_claim.title, trim_scale(v_claim.total),
           case when exists (select 1 from public.expense_items where claim_id = p_claim and duplicate_note is not null) then ' — possible duplicate' else '' end),
    '/expenses/' || p_claim);
  update public.expense_claims set status = 'pending', submitted_at = now(), approval_request_id = v_req, held_at = null, hold_note = null, hold_reply = null
   where id = p_claim;
end $$;

-- Items may name a sub-category of their category.
drop function public.add_expense_item(uuid, uuid, uuid, date, numeric, text, text, text, text);
create function public.add_expense_item(
  p_claim uuid, p_id uuid, p_category uuid, p_date date, p_amount numeric,
  p_merchant text default null, p_description text default null,
  p_receipt_name text default null, p_receipt_hash text default null, p_subcategory text default null
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_claim public.expense_claims := app.own_draft_claim(p_claim);
  v_cat   public.expense_categories;
  v_path  text;
begin
  select * into v_cat from public.expense_categories where id = p_category and organization_id = v_claim.organization_id and is_active;
  if v_cat.id is null then
    raise exception 'Choose a category.' using errcode = '22023';
  end if;
  if nullif(btrim(p_subcategory), '') is not null and not (btrim(p_subcategory) = any (v_cat.subcategories)) then
    raise exception 'Choose one of the sub-categories of %.', v_cat.name using errcode = '22023';
  end if;
  if p_date > app.org_today(v_claim.organization_id) then
    raise exception 'Expenses can’t be dated in the future.' using errcode = '22023';
  end if;
  if p_date < app.org_today(v_claim.organization_id) - 180 then
    raise exception 'Claim expenses within 180 days.' using errcode = '22023';
  end if;
  if v_cat.max_per_item is not null and p_amount > v_cat.max_per_item then
    raise exception '% items are limited to ₹%.', v_cat.name, trim_scale(v_cat.max_per_item) using errcode = '22023';
  end if;
  if v_cat.requires_receipt and p_receipt_hash is null then
    raise exception '% needs a receipt.', v_cat.name using errcode = '22023';
  end if;
  if p_receipt_hash is not null then
    v_path := v_claim.organization_id || '/' || v_claim.id || '/' || p_id;
  end if;
  insert into public.expense_items (id, organization_id, claim_id, category_id, expense_date, merchant, description, amount,
                                    receipt_path, receipt_name, receipt_hash, subcategory)
  values (p_id, v_claim.organization_id, p_claim, p_category, p_date, nullif(btrim(p_merchant), ''), nullif(btrim(p_description), ''),
          round(p_amount, 2), v_path, p_receipt_name, p_receipt_hash, nullif(btrim(p_subcategory), ''));
  update public.expense_claims set total = (select coalesce(sum(amount), 0) from public.expense_items where claim_id = p_claim) where id = p_claim;
  return v_path;
end $$;
revoke all on function public.add_expense_item(uuid, uuid, uuid, date, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.add_expense_item(uuid, uuid, uuid, date, numeric, text, text, text, text, text) to authenticated, service_role;

-- ─── On hold for more information ───────────────────────────────────────────

-- The approver of the current step (or finance) asks the employee for more information; the claim stays pending.
create function public.hold_expense_claim(p_claim uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.expense_claims;
  v_user uuid;
begin
  select * into v_c from public.expense_claims where id = p_claim and status = 'pending' for update;
  if v_c.id is null or not (app.can_decide_approval(v_c.approval_request_id) or app.has_permission(v_c.organization_id, 'expense.manage'))
     or exists (select 1 from public.employees e where e.id = v_c.employee_id and e.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_note), '') is null then raise exception 'Say what information you need.' using errcode = '22023'; end if;
  update public.expense_claims set held_at = now(), hold_note = left(btrim(p_note), 500), hold_reply = null where id = p_claim;
  select user_id into v_user from public.employees where id = v_c.employee_id;
  if v_user is not null then
    perform app.notify(v_c.organization_id, v_user, 'expense.on_hold', 'More information needed: ' || left(v_c.title, 150), left(btrim(p_note), 500), '/expenses/' || p_claim);
  end if;
end $$;

-- The employee answers; the claim goes back to its approvers.
create function public.reply_expense_claim(p_claim uuid, p_reply text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.expense_claims;
  v_user uuid;
begin
  select * into v_c from public.expense_claims where id = p_claim and status = 'pending' and held_at is not null for update;
  if v_c.id is null or not exists (select 1 from public.employees e where e.id = v_c.employee_id and e.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_reply), '') is null then raise exception 'Write your answer.' using errcode = '22023'; end if;
  update public.expense_claims set held_at = null, hold_reply = left(btrim(p_reply), 500) where id = p_claim;
  for v_user in select app.current_approvers(v_c.approval_request_id) loop
    perform app.notify(v_c.organization_id, v_user, 'expense.replied', 'Information added: ' || left(v_c.title, 150), null, '/expenses/' || p_claim);
  end loop;
end $$;

-- ─── Skip approval (finance), when the organization allows it ───────────────

create function public.finalize_expense_claim(p_claim uuid, p_comment text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c   public.expense_claims;
  v_req public.approval_requests;
begin
  select * into v_c from public.expense_claims where id = p_claim and status = 'pending' for update;
  if v_c.id is null or not app.has_permission(v_c.organization_id, 'expense.manage')
     or not coalesce((select allow_skip from public.expense_settings where organization_id = v_c.organization_id), false)
     or exists (select 1 from public.employees e where e.id = v_c.employee_id and e.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_comment), '') is null then raise exception 'Say why the remaining approvers are skipped.' using errcode = '22023'; end if;
  select * into v_req from public.approval_requests where id = v_c.approval_request_id and status = 'pending' for update;
  if v_req.id is null or v_req.requested_by = auth.uid() then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.approval_actions (organization_id, request_id, step_no, actor_user_id, decision, comment)
  values (v_req.organization_id, v_req.id, v_req.current_step, auth.uid(), 'approve', 'Approved by finance, skipping the remaining approvers: ' || left(btrim(p_comment), 900));
  update public.approval_requests set status = 'approved', decided_at = now() where id = v_req.id returning * into v_req;
  perform app.run_approval_handler(v_req, 'approved');
end $$;

-- ─── Finance records an expense for someone ─────────────────────────────────

create function public.record_expense(p_org uuid, p_employee uuid, p_category uuid, p_date date, p_amount numeric,
                                      p_merchant text default null, p_description text default null, p_subcategory text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cat public.expense_categories;
  v_id  uuid;
begin
  if not app.has_permission(p_org, 'expense.manage')
     or not exists (select 1 from public.employees e where e.id = p_employee and e.organization_id = p_org)
     or exists (select 1 from public.employees e where e.id = p_employee and e.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_cat from public.expense_categories where id = p_category and organization_id = p_org and is_active;
  if v_cat.id is null then raise exception 'Choose a category.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 10000000 then raise exception 'Enter an amount.' using errcode = '22023'; end if;
  if p_date is null or p_date > app.org_today(p_org) then raise exception 'Expenses can’t be dated in the future.' using errcode = '22023'; end if;
  if nullif(btrim(p_subcategory), '') is not null and not (btrim(p_subcategory) = any (v_cat.subcategories)) then
    raise exception 'Choose one of the sub-categories of %.', v_cat.name using errcode = '22023';
  end if;
  insert into public.expense_claims (organization_id, employee_id, title, status, total, submitted_at, decided_at, recorded_by_finance)
  values (p_org, p_employee, left(v_cat.name || coalesce(' · ' || nullif(btrim(p_merchant), ''), '') || ' · ' || to_char(p_date, 'DD Mon YYYY'), 120),
          'approved', round(p_amount, 2), now(), now(), true)
  returning id into v_id;
  insert into public.expense_items (organization_id, claim_id, category_id, expense_date, merchant, description, amount, subcategory)
  values (p_org, v_id, p_category, p_date, nullif(btrim(p_merchant), ''), nullif(btrim(p_description), ''), round(p_amount, 2), nullif(btrim(p_subcategory), ''));
  return v_id;
end $$;

-- ─── Payouts outside payroll ────────────────────────────────────────────────

-- Finance pays approved claims by bank transfer or cash. Claims in a payroll run that is being processed are
-- refused (payroll would pay them too); they are paid when that run is locked.
create function public.pay_expense_claims(p_claims uuid[], p_mode text, p_reference text default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  c record;
  n integer := 0;
  v_user uuid;
begin
  if p_mode not in ('bank', 'cash') then raise exception 'Choose bank transfer or cash.' using errcode = '22023'; end if;
  for c in select * from public.expense_claims where id = any (p_claims) and status = 'approved' for update loop
    if not app.has_permission(c.organization_id, 'expense.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
    if exists (select 1 from public.payroll_run_employees re join public.payroll_runs r on r.id = re.run_id
                where r.organization_id = c.organization_id and r.status in ('computed', 'approved')
                  and coalesce(re.input -> 'reimbursementClaims', '[]'::jsonb) ? c.id::text) then
      raise exception '“%” is in a payroll run being processed; it will be paid with that payroll.', c.title using errcode = '22023';
    end if;
    update public.expense_claims set status = 'paid', payout_mode = p_mode, payout_reference = nullif(btrim(p_reference), ''), paid_at = now(), paid_by = auth.uid()
     where id = c.id;
    select user_id into v_user from public.employees where id = c.employee_id;
    if v_user is not null then
      perform app.notify(c.organization_id, v_user, 'expense.paid', 'Reimbursed: ' || left(c.title, 150),
        case p_mode when 'bank' then 'Paid by bank transfer.' else 'Paid in cash.' end, '/expenses/' || c.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Bank details for approved claims, for a transfer file. Needs bank access as well; recorded like payroll's bank file.
create function public.expense_bank_advice(p_org uuid, p_claims uuid[])
returns table (claim_id uuid, employee_code text, employee_name text, account_holder_name text, bank_name text, account_number text, ifsc text, amount numeric)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'expense.manage') or not app.has_permission(p_org, 'employee.bank.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, metadata)
  values (p_org, auth.uid(), 'bank_file_export', 'expense_claims', jsonb_build_object('claims', cardinality(p_claims)));
  return query
    select c.id, e.employee_code, trim(concat_ws(' ', e.first_name, e.last_name)), b.account_holder_name, b.bank_name, b.account_number, b.ifsc, c.total
      from public.expense_claims c
      join public.employees e on e.id = c.employee_id
      left join restricted.employee_bank_accounts b on b.employee_id = c.employee_id and b.archived_at is null
     where c.organization_id = p_org and c.id = any (p_claims) and c.status = 'approved'
     order by e.employee_code;
end $$;

revoke all on function public.hold_expense_claim(uuid, text) from public, anon;
revoke all on function public.reply_expense_claim(uuid, text) from public, anon;
revoke all on function public.finalize_expense_claim(uuid, text) from public, anon;
revoke all on function public.record_expense(uuid, uuid, uuid, date, numeric, text, text, text) from public, anon;
revoke all on function public.pay_expense_claims(uuid[], text, text) from public, anon;
revoke all on function public.expense_bank_advice(uuid, uuid[]) from public, anon;
grant execute on function public.hold_expense_claim(uuid, text) to authenticated, service_role;
grant execute on function public.reply_expense_claim(uuid, text) to authenticated, service_role;
grant execute on function public.finalize_expense_claim(uuid, text) to authenticated, service_role;
grant execute on function public.record_expense(uuid, uuid, uuid, date, numeric, text, text, text) to authenticated, service_role;
grant execute on function public.pay_expense_claims(uuid[], text, text) to authenticated, service_role;
grant execute on function public.expense_bank_advice(uuid, uuid[]) to authenticated, service_role;
