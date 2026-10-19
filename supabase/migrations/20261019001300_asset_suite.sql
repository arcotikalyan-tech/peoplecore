-- PeopleCore · Asset suite (Kredily's Asset Management): categories with a useful life (book value), a condition on
-- every asset, employee asset requests decided (and fulfilled) by asset managers, a repair log, and dues for
-- assets lost, damaged or not returned, settled as recovered, waived or deducted through the next payroll run.
--
-- * Categories: assets keep their category name (for search and exports) and gain a category_id. A category typed
--   by name is created on the fly, so the register, imports and the seed never disagree with the category list.
-- * Requests: an employee asks for a requestable category with a reason. An asset manager approves (optionally
--   issuing a specific asset in stock at once, which fulfils it) or rejects; the employee can cancel while pending.
-- * Repairs: an asset that isn't issued goes for repair with a vendor and an issue; completing the repair records
--   the cost and puts it back in stock (or retires it).
-- * Dues: on any issue (open or returned) an asset manager records an amount the holder owes. Settling it through
--   payroll adds an ASSET_RECOVERY deduction (non-taxable) that payroll sees among the next run's adjustments.

-- ─── Categories ─────────────────────────────────────────────────────────────

create table public.asset_categories (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  name                text not null check (char_length(name) between 2 and 60),
  icon                text check (char_length(icon) <= 8),
  description         text check (char_length(description) <= 200),
  useful_life_months  smallint check (useful_life_months between 1 and 600),
  requestable         boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index asset_categories_name_idx on public.asset_categories (organization_id, lower(name));
create trigger asset_categories_audit after insert or update or delete on public.asset_categories for each row execute function app.audit_row();

alter table public.asset_categories enable row level security;
-- Every member sees the categories (to request one); asset managers keep them.
create policy asset_categories_select on public.asset_categories for select to authenticated using (app.is_member(organization_id));
create policy asset_categories_write on public.asset_categories for all to authenticated
  using (app.has_permission(organization_id, 'asset.manage')) with check (app.has_permission(organization_id, 'asset.manage'));
grant select, insert, update, delete on public.asset_categories to authenticated;
grant all on public.asset_categories to service_role;

alter table public.assets
  add column category_id uuid,
  add column condition   text not null default 'good' check (condition in ('new', 'good', 'fair', 'poor', 'damaged')),
  add constraint assets_category_fk foreign key (organization_id, category_id) references public.asset_categories (organization_id, id);
create index assets_category_idx on public.assets (organization_id, category_id);

insert into public.asset_categories (organization_id, name)
select distinct on (organization_id, lower(btrim(category))) organization_id, btrim(category) from public.assets
on conflict do nothing;
update public.assets a set category_id = c.id, category = c.name
  from public.asset_categories c where c.organization_id = a.organization_id and lower(c.name) = lower(btrim(a.category));
-- Always set (by the trigger below); a check rather than NOT NULL so inserts may name the category instead.
alter table public.assets add constraint assets_category_set check (category_id is not null);

-- The category name follows the category; a name without an id finds (or creates) the category.
create function app.assets_category() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.asset_categories;
begin
  if new.category_id is not null then
    select * into v_c from public.asset_categories where id = new.category_id and organization_id = new.organization_id;
    if v_c.id is null then
      raise exception 'Choose a category.' using errcode = '22023';
    end if;
    new.category := v_c.name;
  elsif char_length(btrim(coalesce(new.category, ''))) between 2 and 60 then
    select * into v_c from public.asset_categories
     where organization_id = new.organization_id and lower(name) = lower(btrim(new.category));
    if v_c.id is null then
      insert into public.asset_categories (organization_id, name) values (new.organization_id, btrim(new.category)) returning * into v_c;
    end if;
    new.category_id := v_c.id;
    new.category := v_c.name;
  else
    raise exception 'Choose a category.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function app.assets_category() from public;
create trigger assets_category before insert or update of category, category_id on public.assets
  for each row execute function app.assets_category();

create function app.asset_categories_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.assets set category = new.name where category_id = new.id and category is distinct from new.name;
  return new;
end $$;
revoke all on function app.asset_categories_rename() from public;
create trigger asset_categories_rename after update of name on public.asset_categories
  for each row execute function app.asset_categories_rename();

-- ─── Requests ───────────────────────────────────────────────────────────────

create table public.asset_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  category_id      uuid not null,
  reason           text not null check (char_length(reason) between 3 and 500),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'fulfilled', 'rejected', 'cancelled')),
  asset_id         uuid,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text check (char_length(decision_note) <= 500),
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, category_id) references public.asset_categories (organization_id, id),
  foreign key (organization_id, asset_id) references public.assets (organization_id, id)
);
create index asset_requests_org_idx on public.asset_requests (organization_id, status, created_at desc);
create index asset_requests_employee_idx on public.asset_requests (organization_id, employee_id);
create trigger asset_requests_audit after insert or update on public.asset_requests for each row execute function app.audit_row();

alter table public.asset_requests enable row level security;
create policy asset_requests_select on public.asset_requests for select to authenticated
  using (app.has_permission(organization_id, 'asset.manage') or app.is_own_employee(employee_id));
grant select on public.asset_requests to authenticated;
grant all on public.asset_requests to service_role;

create function public.request_asset(p_org uuid, p_category uuid, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_cat public.asset_categories;
  v_id  uuid;
begin
  select * into v_emp from public.employees
   where organization_id = p_org and user_id = auth.uid() and status <> 'exited' and app.is_member(p_org);
  if v_emp.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_cat from public.asset_categories where id = p_category and organization_id = p_org;
  if v_cat.id is null or not v_cat.requestable then
    raise exception 'Choose a category you can request.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why you need it.' using errcode = '22023';
  end if;
  if exists (select 1 from public.asset_requests where employee_id = v_emp.id and category_id = p_category and status in ('pending', 'approved')) then
    raise exception 'You already have an open request for this category.' using errcode = '22023';
  end if;
  insert into public.asset_requests (organization_id, employee_id, category_id, reason)
  values (p_org, v_emp.id, p_category, left(btrim(p_reason), 500))
  returning id into v_id;
  perform app.notify_permission_holders(p_org, 'asset.manage', 'asset.requested',
    trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)) || ' requested: ' || v_cat.name, '/assets?tab=requests', auth.uid());
  return v_id;
end $$;

-- Approve (and, with an asset in stock, issue it: fulfilled), fulfil an approved request, or reject.
create function public.decide_asset_request(p_request uuid, p_approve boolean, p_note text default null, p_asset uuid default null)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r    public.asset_requests;
  v_cat  text;
  v_user uuid;
  v_new  text;
begin
  select * into v_r from public.asset_requests where id = p_request for update;
  if v_r.id is null or not app.has_permission(v_r.organization_id, 'asset.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_r.status not in ('pending', 'approved') or (v_r.status = 'approved' and (not p_approve or p_asset is null)) then
    raise exception 'This request has already been decided.' using errcode = '22023';
  end if;
  select name into v_cat from public.asset_categories where id = v_r.category_id;
  select user_id into v_user from public.employees where id = v_r.employee_id;
  if not p_approve then
    if char_length(btrim(coalesce(p_note, ''))) < 3 then
      raise exception 'Give a reason for rejecting it.' using errcode = '22023';
    end if;
    v_new := 'rejected';
  elsif p_asset is not null then
    if not exists (select 1 from public.assets where id = p_asset and organization_id = v_r.organization_id) then
      raise exception 'Choose an asset in stock.' using errcode = '22023';
    end if;
    perform public.issue_asset(p_asset, v_r.employee_id, null, null);
    v_new := 'fulfilled';
  else
    v_new := 'approved';
  end if;
  update public.asset_requests
     set status = v_new, asset_id = coalesce(p_asset, asset_id), decided_by = auth.uid(), decided_at = now(),
         decision_note = coalesce(nullif(btrim(p_note), ''), decision_note)
   where id = p_request;
  perform app.notify(v_r.organization_id, v_user, 'asset.request.' || v_new,
    case v_new when 'rejected' then 'Your request for ' || v_cat || ' was declined'
               when 'approved' then 'Your request for ' || v_cat || ' was approved'
               else 'Your request for ' || v_cat || ' was fulfilled' end,
    nullif(btrim(p_note), ''), '/assets?tab=requests');
  return v_new;
end $$;

create function public.cancel_asset_request(p_request uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.asset_requests;
begin
  select * into v_r from public.asset_requests where id = p_request for update;
  if v_r.id is null or not app.is_own_employee(v_r.employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'Only a pending request can be cancelled.' using errcode = '22023';
  end if;
  update public.asset_requests set status = 'cancelled', decided_at = now() where id = p_request;
end $$;

-- ─── Repairs ────────────────────────────────────────────────────────────────

create table public.asset_repairs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  asset_id          uuid not null,
  vendor            text check (char_length(vendor) <= 120),
  issue             text not null check (char_length(issue) between 3 and 500),
  sent_on           date not null,
  expected_back_on  date,
  completed_on      date,
  cost              numeric(12,2) check (cost >= 0),
  outcome           text check (outcome in ('in_stock', 'retired')),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, asset_id) references public.assets (organization_id, id) on delete cascade,
  check (expected_back_on is null or expected_back_on >= sent_on),
  check (completed_on is null or completed_on >= sent_on)
);
create unique index asset_repairs_open_idx on public.asset_repairs (asset_id) where completed_on is null;
create trigger asset_repairs_audit after insert or update on public.asset_repairs for each row execute function app.audit_row();

alter table public.asset_repairs enable row level security;
create policy asset_repairs_select on public.asset_repairs for select to authenticated
  using (app.has_permission(organization_id, 'asset.manage'));
grant select on public.asset_repairs to authenticated;
grant all on public.asset_repairs to service_role;

create function public.send_asset_for_repair(p_asset uuid, p_issue text, p_vendor text default null, p_expected date default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_a  public.assets;
  v_id uuid;
begin
  select * into v_a from public.assets where id = p_asset for update;
  if v_a.id is null or not app.has_permission(v_a.organization_id, 'asset.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_a.status = 'assigned' then
    raise exception 'Take the asset back before sending it for repair.' using errcode = '22023';
  end if;
  if v_a.status in ('retired', 'lost') then
    raise exception 'A retired or lost asset can’t go for repair.' using errcode = '22023';
  end if;
  if exists (select 1 from public.asset_repairs where asset_id = p_asset and completed_on is null) then
    raise exception 'This asset is already out for repair.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_issue, ''))) < 3 then
    raise exception 'Describe the problem.' using errcode = '22023';
  end if;
  if p_expected is not null and p_expected < app.org_today(v_a.organization_id) then
    raise exception 'The expected return date can’t be in the past.' using errcode = '22023';
  end if;
  insert into public.asset_repairs (organization_id, asset_id, vendor, issue, sent_on, expected_back_on)
  values (v_a.organization_id, p_asset, nullif(btrim(p_vendor), ''), btrim(p_issue), app.org_today(v_a.organization_id), p_expected)
  returning id into v_id;
  update public.assets set status = 'in_repair' where id = p_asset;
  return v_id;
end $$;

create function public.complete_asset_repair(p_repair uuid, p_cost numeric default null, p_outcome text default 'in_stock', p_condition text default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.asset_repairs;
begin
  select * into v_r from public.asset_repairs where id = p_repair for update;
  if v_r.id is null or not app.has_permission(v_r.organization_id, 'asset.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_r.completed_on is not null then
    raise exception 'This repair is already complete.' using errcode = '22023';
  end if;
  if p_outcome not in ('in_stock', 'retired') then
    raise exception 'Choose whether it goes back in stock or is retired.' using errcode = '22023';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'Enter the repair cost.' using errcode = '22023';
  end if;
  update public.asset_repairs set completed_on = greatest(sent_on, app.org_today(organization_id)), cost = p_cost, outcome = p_outcome
   where id = p_repair;
  update public.assets set status = p_outcome::public.asset_status, condition = coalesce(p_condition, condition) where id = v_r.asset_id;
end $$;

-- ─── Dues (recoveries) ──────────────────────────────────────────────────────

alter table public.asset_assignments
  add column recovery_amount     numeric(12,2) check (recovery_amount > 0 and recovery_amount < 100000000),
  add column recovery_note       text check (char_length(recovery_note) <= 500),
  add column recovery_status     text check (recovery_status in ('pending', 'recovered', 'waived', 'payroll')),
  add column recovery_settled_at timestamptz,
  add column recovery_settled_by uuid,
  add column recovery_adjustment_id uuid,
  add constraint asset_assignments_recovery_check check ((recovery_amount is null) = (recovery_status is null));

create function public.set_asset_recovery(p_assignment uuid, p_amount numeric, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_x public.asset_assignments;
begin
  select * into v_x from public.asset_assignments where id = p_assignment for update;
  if v_x.id is null or not app.has_permission(v_x.organization_id, 'asset.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_x.recovery_status is not null and v_x.recovery_status <> 'pending' then
    raise exception 'These dues are already settled.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 100000000 then
    raise exception 'Enter the amount due.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say what the dues are for.' using errcode = '22023';
  end if;
  update public.asset_assignments set recovery_amount = round(p_amount, 2), recovery_note = btrim(p_note), recovery_status = 'pending'
   where id = p_assignment;
end $$;

-- Settle pending dues: recovered (paid back), waived, or deducted through the next payroll run.
create function public.settle_asset_recovery(p_assignment uuid, p_mode text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_x   public.asset_assignments;
  v_a   public.assets;
  v_adj uuid;
begin
  select * into v_x from public.asset_assignments where id = p_assignment for update;
  if v_x.id is null or not app.has_permission(v_x.organization_id, 'asset.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_x.recovery_status is distinct from 'pending' then
    raise exception 'There are no pending dues on this asset.' using errcode = '22023';
  end if;
  if p_mode not in ('recovered', 'waived', 'payroll') then
    raise exception 'Choose how the dues are settled.' using errcode = '22023';
  end if;
  if p_mode = 'payroll' then
    select * into v_a from public.assets where id = v_x.asset_id;
    insert into public.payroll_adjustments (organization_id, employee_id, code, name, kind, amount, taxable, reason)
    values (v_x.organization_id, v_x.employee_id, 'ASSET_RECOVERY', 'Asset recovery', 'deduction', v_x.recovery_amount, false,
            left(v_a.name || ' (' || v_a.tag || '): ' || v_x.recovery_note, 500))
    returning id into v_adj;
  end if;
  update public.asset_assignments
     set recovery_status = p_mode, recovery_settled_at = now(), recovery_settled_by = auth.uid(), recovery_adjustment_id = v_adj
   where id = p_assignment;
end $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function public.request_asset(uuid, uuid, text) from public, anon;
revoke all on function public.decide_asset_request(uuid, boolean, text, uuid) from public, anon;
revoke all on function public.cancel_asset_request(uuid) from public, anon;
revoke all on function public.send_asset_for_repair(uuid, text, text, date) from public, anon;
revoke all on function public.complete_asset_repair(uuid, numeric, text, text) from public, anon;
revoke all on function public.set_asset_recovery(uuid, numeric, text) from public, anon;
revoke all on function public.settle_asset_recovery(uuid, text) from public, anon;
grant execute on function public.request_asset(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.decide_asset_request(uuid, boolean, text, uuid) to authenticated, service_role;
grant execute on function public.cancel_asset_request(uuid) to authenticated, service_role;
grant execute on function public.send_asset_for_repair(uuid, text, text, date) to authenticated, service_role;
grant execute on function public.complete_asset_repair(uuid, numeric, text, text) to authenticated, service_role;
grant execute on function public.set_asset_recovery(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.settle_asset_recovery(uuid, text) to authenticated, service_role;
