-- PeopleCore · Expenses (Phase 4).
--
-- * Employees create claims with items (date, category, merchant, amount) and receipts. Receipts live in the
--   private `expense-receipts` bucket (no Storage policies for signed-in users; the server stores and signs, as
--   for employee documents). Each receipt's SHA-256 is recorded.
-- * Duplicate checks run when a claim is submitted: the same receipt file anywhere in the organization, or the
--   same employee, date, category and amount on another claim. Possible duplicates are flagged for approvers,
--   never auto-rejected.
-- * Approval: reporting manager, then finance (expense.approve), through the approvals engine.
-- * Approved claims are paid with the next payroll run as non-taxable reimbursements: payroll_run_inputs adds
--   them (and lists their ids in the run's inputs), and locking the run marks exactly those claims paid.

-- ─── Permission ─────────────────────────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('expense.manage', 'expenses', 'Configure expense categories and see all claims', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'expense.manage', 'org'), ('payroll_admin', 'expense.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'expense.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Storage ────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ─── Tables ─────────────────────────────────────────────────────────────────

create type public.expense_status as enum ('draft', 'pending', 'approved', 'rejected', 'paid', 'cancelled');

create table public.expense_categories (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  code              text not null check (code ~ '^[A-Z0-9_]{2,20}$'),
  name              text not null check (char_length(name) between 2 and 60),
  requires_receipt  boolean not null default true,
  max_per_item      numeric(12,2) check (max_per_item > 0),
  is_active         boolean not null default true,
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.expense_claims (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  employee_id          uuid not null,
  title                text not null check (char_length(title) between 2 and 120),
  status               public.expense_status not null default 'draft',
  total                numeric(12,2) not null default 0,
  approval_request_id  uuid,
  submitted_at         timestamptz,
  decided_at           timestamptz,
  paid_run_id          uuid,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, paid_run_id) references public.payroll_runs (organization_id, id)
);
create index expense_claims_employee_idx on public.expense_claims (organization_id, employee_id, created_at desc);

create table public.expense_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  claim_id         uuid not null,
  category_id      uuid not null,
  expense_date     date not null,
  merchant         text check (char_length(merchant) <= 120),
  description      text check (char_length(description) <= 500),
  amount           numeric(12,2) not null check (amount > 0 and amount < 10000000),
  receipt_path     text unique,
  receipt_name     text check (char_length(receipt_name) <= 200),
  receipt_hash     text check (receipt_hash ~ '^[0-9a-f]{64}$'),
  duplicate_note   text,
  created_at       timestamptz not null default now(),
  check (receipt_path is null or receipt_hash is not null),
  foreign key (organization_id, claim_id) references public.expense_claims (organization_id, id) on delete cascade,
  foreign key (organization_id, category_id) references public.expense_categories (organization_id, id)
);
create index expense_items_hash_idx on public.expense_items (organization_id, receipt_hash) where receipt_hash is not null;

create trigger expense_categories_audit after insert or update or delete on public.expense_categories for each row execute function app.audit_row();
create trigger expense_claims_audit after insert or update on public.expense_claims for each row execute function app.audit_row();
create trigger expense_items_audit after insert or update or delete on public.expense_items for each row execute function app.audit_row();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.expense_categories enable row level security;
alter table public.expense_claims enable row level security;
alter table public.expense_items enable row level security;

create function app.can_view_claim(p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.expense_claims c
     where c.id = p_claim and app.is_member(c.organization_id)
       and (exists (select 1 from public.employees e where e.id = c.employee_id and e.user_id = auth.uid())
            or app.has_permission(c.organization_id, 'expense.manage')
            or (c.approval_request_id is not null and app.can_view_approval(c.approval_request_id))));
$$;

create policy expense_categories_select on public.expense_categories for select to authenticated using (app.is_member(organization_id));
create policy expense_categories_write on public.expense_categories for all to authenticated
  using (app.has_permission(organization_id, 'expense.manage')) with check (app.has_permission(organization_id, 'expense.manage'));
create policy expense_claims_select on public.expense_claims for select to authenticated using (app.can_view_claim(id));
create policy expense_items_select on public.expense_items for select to authenticated using (app.can_view_claim(claim_id));

grant select, insert, update, delete on public.expense_categories to authenticated;
grant select on public.expense_claims, public.expense_items to authenticated;
grant all on public.expense_categories, public.expense_claims, public.expense_items to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

create function app.own_draft_claim(p_claim uuid) returns public.expense_claims
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.expense_claims;
begin
  select c.* into v from public.expense_claims c join public.employees e on e.id = c.employee_id
   where c.id = p_claim and e.user_id = auth.uid() and app.is_member(c.organization_id);
  if v.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v.status <> 'draft' then
    raise exception 'Only a draft claim can be changed.' using errcode = '22023';
  end if;
  return v;
end $$;

create function public.create_expense_claim(p_org uuid, p_title text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp uuid;
  v_id  uuid;
begin
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid() and status <> 'exited';
  if v_emp is null or not app.is_member(p_org) then
    raise exception 'Your account isn’t linked to an employee record.' using errcode = '42501';
  end if;
  insert into public.expense_claims (organization_id, employee_id, title) values (p_org, v_emp, btrim(p_title)) returning id into v_id;
  return v_id;
end $$;

-- Adds an item. The receipt (if any) was stored by the server under expense-receipts/<org>/<claim>/<id>.
create function public.add_expense_item(
  p_claim uuid, p_id uuid, p_category uuid, p_date date, p_amount numeric,
  p_merchant text default null, p_description text default null,
  p_receipt_name text default null, p_receipt_hash text default null
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
                                    receipt_path, receipt_name, receipt_hash)
  values (p_id, v_claim.organization_id, p_claim, p_category, p_date, nullif(btrim(p_merchant), ''), nullif(btrim(p_description), ''),
          round(p_amount, 2), v_path, p_receipt_name, p_receipt_hash);
  update public.expense_claims set total = (select coalesce(sum(amount), 0) from public.expense_items where claim_id = p_claim) where id = p_claim;
  return v_path;
end $$;

-- Removes an item from a draft; returns the receipt path for the server to delete.
create function public.remove_expense_item(p_item uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item public.expense_items;
begin
  select * into v_item from public.expense_items where id = p_item;
  if v_item.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform app.own_draft_claim(v_item.claim_id);
  delete from public.expense_items where id = p_item;
  update public.expense_claims set total = (select coalesce(sum(amount), 0) from public.expense_items where claim_id = v_item.claim_id) where id = v_item.claim_id;
  return v_item.receipt_path;
end $$;

-- Submits for approval, flagging possible duplicates for the approvers.
create function public.submit_expense_claim(p_claim uuid) returns void
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
  v_req := app.request_approval(v_claim.organization_id, 'expense_claim', p_claim, v_claim.employee_id,
    format('%s: %s (₹%s)%s', v_name, v_claim.title, trim_scale(v_claim.total),
           case when exists (select 1 from public.expense_items where claim_id = p_claim and duplicate_note is not null) then ' — possible duplicate' else '' end),
    '/expenses/' || p_claim);
  update public.expense_claims set status = 'pending', submitted_at = now(), approval_request_id = v_req where id = p_claim;
end $$;

create function app.on_expense_decided(p_claim uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.expense_claims
     set status = case p_outcome when 'approved' then 'approved' when 'rejected' then 'rejected' else 'draft' end::public.expense_status,
         decided_at = case when p_outcome = 'cancelled' then null else now() end,
         approval_request_id = case when p_outcome = 'cancelled' then null else approval_request_id end
   where id = p_claim and status = 'pending';
end $$;
insert into app.approval_handlers (subject_type, handler) values ('expense_claim', 'app.on_expense_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label) values
  ('expense_claim', 1, 'reporting_manager', 'expense.approve', 'Reporting manager'),
  ('expense_claim', 2, 'permission', 'expense.manage', 'Finance');

-- Receipt download: what the server needs to sign a link (only for people who can see the claim).
create function public.expense_receipt(p_item uuid) returns table (receipt_path text, receipt_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item public.expense_items;
begin
  select * into v_item from public.expense_items where id = p_item;
  if v_item.id is null or v_item.receipt_path is null or not app.can_view_claim(v_item.claim_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select v_item.receipt_path, v_item.receipt_name;
end $$;

-- ─── Payroll link ───────────────────────────────────────────────────────────

-- The original inputs function becomes an internal building block (it keeps its own permission check)…
alter function public.payroll_run_inputs(uuid) set schema app;
alter function app.payroll_run_inputs(uuid) rename to payroll_run_inputs_base;
revoke all on function app.payroll_run_inputs_base(uuid) from public, anon, authenticated;

-- …and approved, unpaid claims (approved by the end of the period) become reimbursements in the run's inputs.
create function public.payroll_run_inputs(p_run uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base jsonb;
  v_run  public.payroll_runs;
  v_end  date;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_base := app.payroll_run_inputs_base(p_run);
  v_end := (v_run.period_month + interval '1 month - 1 day')::date;
  return jsonb_set(v_base, '{employees}', coalesce((
    select jsonb_agg(
             e || jsonb_build_object(
               'reimbursements', coalesce((select sum(c.total) from public.expense_claims c
                                            where c.employee_id = (e ->> 'employeeId')::uuid and c.status = 'approved'
                                              and c.decided_at::date <= v_end), 0),
               'reimbursementClaims', coalesce((select jsonb_agg(c.id order by c.id) from public.expense_claims c
                                                 where c.employee_id = (e ->> 'employeeId')::uuid and c.status = 'approved'
                                                   and c.decided_at::date <= v_end), '[]'::jsonb))
             order by e ->> 'employeeCode')
      from jsonb_array_elements(v_base -> 'employees') e), '[]'::jsonb));
end $$;

-- Locking a run marks exactly the claims its inputs included as paid.
create or replace function public.lock_payroll_run(p_run uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run  public.payroll_runs;
  v_user uuid;
begin
  select * into v_run from public.payroll_runs where id = p_run for update;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'Only an approved run can be locked.' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'locked', locked_by = auth.uid(), locked_at = now() where id = p_run;
  update public.expense_claims c set status = 'paid', paid_run_id = p_run
    from public.payroll_run_employees re, jsonb_array_elements_text(coalesce(re.input -> 'reimbursementClaims', '[]')) claim_id
   where re.run_id = p_run and c.id = claim_id::uuid and c.status = 'approved';
  perform app.emit_event(v_run.organization_id, 'payroll.locked', p_run, jsonb_build_object('month', to_char(v_run.period_month, 'YYYY-MM')), 'payroll.locked:' || p_run);
  for v_user in select e.user_id from public.payroll_run_employees re join public.employees e on e.id = re.employee_id
                 where re.run_id = p_run and e.user_id is not null loop
    perform app.notify(v_run.organization_id, v_user, 'payroll.payslip', 'Your payslip for ' || to_char(v_run.period_month, 'Mon YYYY') || ' is ready', null, '/payslips');
  end loop;
end $$;

-- ─── Defaults ───────────────────────────────────────────────────────────────

create function app.seed_org_expenses(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.expense_categories (organization_id, code, name, requires_receipt, max_per_item) values
    (p_org, 'TRAVEL', 'Travel', true, null),
    (p_org, 'MEALS', 'Meals', true, 5000),
    (p_org, 'CONVEYANCE', 'Local conveyance', false, 2000),
    (p_org, 'PHONE', 'Phone and internet', true, 3000),
    (p_org, 'OTHER', 'Other', true, null)
  on conflict (organization_id, code) do nothing;
$$;
create function app.seed_org_expenses_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_expenses(new.id);
  return null;
end $$;
create trigger organizations_seed_expenses after insert on public.organizations
  for each row execute function app.seed_org_expenses_trigger();
select app.seed_org_expenses(id), app.seed_org_flows(id, 'expense_claim') from public.organizations;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function app.can_view_claim(uuid) from public;
revoke all on function app.own_draft_claim(uuid) from public;
revoke all on function app.on_expense_decided(uuid, text) from public;
revoke all on function app.seed_org_expenses(uuid) from public;
revoke all on function app.seed_org_expenses_trigger() from public;
grant execute on function app.can_view_claim(uuid) to authenticated, service_role;
revoke all on function public.create_expense_claim(uuid, text) from public, anon;
revoke all on function public.add_expense_item(uuid, uuid, uuid, date, numeric, text, text, text, text) from public, anon;
revoke all on function public.remove_expense_item(uuid) from public, anon;
revoke all on function public.submit_expense_claim(uuid) from public, anon;
revoke all on function public.expense_receipt(uuid) from public, anon;
grant execute on function public.create_expense_claim(uuid, text) to authenticated, service_role;
grant execute on function public.add_expense_item(uuid, uuid, uuid, date, numeric, text, text, text, text) to authenticated, service_role;
grant execute on function public.remove_expense_item(uuid) to authenticated, service_role;
grant execute on function public.submit_expense_claim(uuid) to authenticated, service_role;
grant execute on function public.expense_receipt(uuid) to authenticated, service_role;
revoke all on function public.payroll_run_inputs(uuid) from public, anon;
grant execute on function public.payroll_run_inputs(uuid) to authenticated, service_role;
