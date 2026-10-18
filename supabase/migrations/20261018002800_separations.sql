-- PeopleCore · Separation and offboarding, part 1 (Phase 6): resignations and HR-initiated exits, notice periods
-- with waiver or recovery of any shortfall, approval, a clearance checklist, and exit on the last working day.
--
-- * An employee resigns (or HR starts a termination, retirement, end of contract…). The notice period comes from
--   the organization's notice periods per employment type; asking to leave earlier creates a shortfall that HR
--   either waives or recovers in the full and final settlement (part 2).
-- * Approval goes through the approvals engine: the reporting manager, then HR (`separation.manage`).
-- * On approval the employee is on notice with their exit date set, and a clearance checklist is created: return
--   each issued asset, revoke each recorded system access, handover (manager), no dues (finance), exit interview
--   (HR). Returning an asset or revoking access clears its item automatically.
-- * The day after the last working day the worker completes the separation: the employee is exited and their
--   sign-in to this organization is suspended (PeopleCore access revoked); HR is told about any open clearance items.
-- * Why someone left and the exit interview are HR-only: they are not in the table privileges; they come from
--   `separation_details`, for the employee themselves and HR.

insert into public.permissions (key, module, description, is_sensitive) values
  ('separation.manage', 'offboarding', 'Handle resignations and exits, clearance and settlements', true);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'separation.manage', 'org'), ('hr_admin', 'separation.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'separation.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Notice periods ─────────────────────────────────────────────────────────

create table public.notice_periods (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  employment_type  public.employment_type not null,
  notice_days      smallint not null check (notice_days between 0 and 180),
  primary key (organization_id, employment_type)
);
alter table public.notice_periods enable row level security;
create policy notice_periods_select on public.notice_periods for select to authenticated using (app.is_member(organization_id));
create policy notice_periods_write on public.notice_periods for all to authenticated
  using (app.has_permission(organization_id, 'separation.manage')) with check (app.has_permission(organization_id, 'separation.manage'));
grant select, insert, update on public.notice_periods to authenticated;
grant all on public.notice_periods to service_role;

create function app.seed_org_notice_periods(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.notice_periods (organization_id, employment_type, notice_days) values
    (p_org, 'permanent', 30), (p_org, 'contract', 15), (p_org, 'intern', 7), (p_org, 'temporary', 7), (p_org, 'consultant', 15)
  on conflict do nothing;
$$;
create function app.seed_org_notice_periods_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_notice_periods(new.id);
  return null;
end $$;
create trigger organizations_seed_notice_periods after insert on public.organizations
  for each row execute function app.seed_org_notice_periods_trigger();
select app.seed_org_notice_periods(id) from public.organizations;

-- ─── Separations ────────────────────────────────────────────────────────────

create type public.separation_type as enum ('resignation', 'termination', 'retirement', 'contract_end', 'other');
create type public.separation_status as enum ('submitted', 'approved', 'completed', 'rejected', 'withdrawn', 'cancelled');

create table public.separations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  employee_id          uuid not null,
  type                 public.separation_type not null,
  reason_category      text check (reason_category in ('better_opportunity', 'compensation', 'manager', 'growth', 'relocation',
                                                       'personal', 'health', 'studies', 'performance', 'conduct', 'restructuring', 'other')),
  reason               text check (char_length(reason) <= 2000),
  initiated_by         uuid not null default auth.uid(),
  submitted_on         date not null,
  requested_last_day   date not null,
  notice_days          smallint not null,
  notice_end           date not null,
  last_working_day     date not null,
  shortfall_days       int not null default 0 check (shortfall_days >= 0),
  shortfall_treatment  text check (shortfall_treatment in ('waived', 'recovered')),
  status               public.separation_status not null default 'submitted',
  approval_request_id  uuid,
  decided_at           timestamptz,
  completed_at         timestamptz,
  rehire_eligible      boolean,
  alumni_opt_in        boolean not null default false,
  exit_interview       jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id),
  check (last_working_day >= submitted_on)
);
create unique index separations_open_uq on public.separations (employee_id) where status in ('submitted', 'approved');
create index separations_org_idx on public.separations (organization_id, status, last_working_day);

create table public.clearance_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  separation_id    uuid not null,
  kind             text not null check (kind in ('asset', 'access', 'handover', 'finance', 'exit_interview')),
  ref_id           uuid,
  title            text not null check (char_length(title) between 1 and 200),
  owner            text not null check (owner in ('manager', 'hr', 'it', 'finance')),
  status           text not null default 'pending' check (status in ('pending', 'cleared', 'waived')),
  note             text check (char_length(note) <= 500),
  cleared_by       uuid,
  cleared_at       timestamptz,
  created_at       timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, separation_id) references public.separations (organization_id, id) on delete cascade
);
create index clearance_items_ref_idx on public.clearance_items (ref_id) where status = 'pending';

create trigger separations_touch before update on public.separations for each row execute function app.touch_updated_at();
create trigger separations_audit after insert or update on public.separations
  for each row execute function app.audit_row('reason', 'exit_interview');
create trigger clearance_items_audit after insert or update on public.clearance_items for each row execute function app.audit_row();

alter table public.separations enable row level security;
alter table public.clearance_items enable row level security;
-- The employee, their reporting line and HR see a separation (not why: see separation_details).
-- IT (asset managers) and finance also see approved and completed ones: they clear assets, access and dues.
create policy separations_select on public.separations for select to authenticated
  using (app.is_own_employee(employee_id) or app.has_permission(organization_id, 'separation.manage')
         or app.is_in_reporting_line(organization_id, employee_id)
         or (status in ('approved', 'completed')
             and (app.has_permission(organization_id, 'asset.manage') or app.has_permission(organization_id, 'payroll.prepare')
                  or app.has_permission(organization_id, 'expense.manage'))));
-- Checklist items: everyone who can see the separation, plus IT (asset managers) and finance for their own items.
create function app.can_view_clearance(p_separation uuid, p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.separations s where s.id = p_separation
                  and (app.is_own_employee(s.employee_id) or app.has_permission(s.organization_id, 'separation.manage')
                       or app.is_in_reporting_line(s.organization_id, s.employee_id)
                       or (p_owner = 'it' and app.has_permission(s.organization_id, 'asset.manage'))
                       or (p_owner = 'finance' and (app.has_permission(s.organization_id, 'payroll.prepare')
                                                    or app.has_permission(s.organization_id, 'expense.manage')))));
$$;
create policy clearance_items_select on public.clearance_items for select to authenticated using (app.can_view_clearance(separation_id, owner));
grant select (id, organization_id, employee_id, type, reason_category, initiated_by, submitted_on, requested_last_day, notice_days, notice_end,
              last_working_day, shortfall_days, shortfall_treatment, status, approval_request_id, decided_at, completed_at, rehire_eligible,
              alumni_opt_in, created_at, updated_at)
  on public.separations to authenticated;
grant select on public.clearance_items to authenticated;
grant all on public.separations, public.clearance_items to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

-- Opens a separation for an employee (both entry points share it) and asks for approval.
create function app.open_separation(p_employee uuid, p_type public.separation_type, p_last_day date, p_reason_category text, p_reason text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_e      public.employees;
  v_today  date;
  v_notice smallint;
  v_id     uuid;
  v_req    uuid;
begin
  select * into v_e from public.employees where id = p_employee;
  if v_e.status not in ('active', 'on_notice') then
    raise exception 'Only current employees can be separated.' using errcode = '22023';
  end if;
  if exists (select 1 from public.separations where employee_id = p_employee and status in ('submitted', 'approved')) then
    raise exception 'A separation is already open for this employee.' using errcode = '22023';
  end if;
  v_today := app.org_today(v_e.organization_id);
  if p_last_day is null or p_last_day < v_today then
    raise exception 'The last working day can’t be in the past.' using errcode = '22023';
  end if;
  if p_last_day > v_today + 365 then
    raise exception 'Choose a last working day within a year.' using errcode = '22023';
  end if;
  select notice_days into v_notice from public.notice_periods where organization_id = v_e.organization_id and employment_type = v_e.employment_type;
  v_notice := coalesce(v_notice, 30);
  insert into public.separations (organization_id, employee_id, type, reason_category, reason, submitted_on, requested_last_day, notice_days,
                                  notice_end, last_working_day, shortfall_days)
  values (v_e.organization_id, p_employee, p_type, p_reason_category, nullif(btrim(coalesce(p_reason, '')), ''), v_today, p_last_day, v_notice,
          v_today + v_notice, p_last_day, greatest(0, (v_today + v_notice) - p_last_day))
  returning id into v_id;
  v_req := app.request_approval(v_e.organization_id, 'separation', v_id, p_employee,
    initcap(replace(p_type::text, '_', ' ')) || ': ' || concat_ws(' ', v_e.first_name, v_e.last_name) || ', last day ' || to_char(p_last_day, 'DD Mon YYYY'),
    '/separations/' || v_id);
  update public.separations set approval_request_id = v_req where id = v_id;
  return v_id;
end $$;

create function public.submit_resignation(p_org uuid, p_last_day date, p_reason_category text default null, p_reason text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp uuid;
begin
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid();
  if v_emp is null or not app.is_member(p_org) then
    raise exception 'Your account isn’t linked to an employee record.' using errcode = '42501';
  end if;
  return app.open_separation(v_emp, 'resignation', p_last_day, p_reason_category, p_reason);
end $$;

create function public.initiate_separation(p_employee uuid, p_type public.separation_type, p_last_day date,
                                           p_reason_category text default null, p_reason text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'separation.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.employees where id = p_employee and user_id = auth.uid()) then
    raise exception 'Use Resign for your own separation.' using errcode = '22023';
  end if;
  return app.open_separation(p_employee, p_type, p_last_day, p_reason_category, p_reason);
end $$;

-- HR sets the last working day and what happens to a notice shortfall (waived, or recovered in the settlement).
create function public.set_separation_terms(p_separation uuid, p_last_day date, p_treatment text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.separations;
  v_short int;
begin
  select * into v_s from public.separations where id = p_separation for update;
  if v_s.id is null or not app.has_permission(v_s.organization_id, 'separation.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_s.status not in ('submitted', 'approved') then
    raise exception 'This separation is closed.' using errcode = '22023';
  end if;
  if p_last_day is null or p_last_day < greatest(v_s.submitted_on, case when v_s.status = 'approved' then app.org_today(v_s.organization_id) end) then
    raise exception 'The last working day can’t be in the past.' using errcode = '22023';
  end if;
  v_short := greatest(0, v_s.notice_end - p_last_day);
  if p_treatment is not null and p_treatment not in ('waived', 'recovered') then
    raise exception 'Choose waive or recover.' using errcode = '22023';
  end if;
  update public.separations set last_working_day = p_last_day, shortfall_days = v_short,
    shortfall_treatment = case when v_short = 0 then null else coalesce(p_treatment, shortfall_treatment) end
   where id = p_separation;
  if v_s.status = 'approved' then
    update public.employees set date_of_exit = p_last_day where id = v_s.employee_id;
  end if;
end $$;

-- Approval outcome: on approval the employee goes on notice and the clearance checklist is created.
create function app.on_separation_decided(p_separation uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s    public.separations;
  v_e    public.employees;
  r      record;
begin
  select * into v_s from public.separations where id = p_separation for update;
  if v_s.id is null or v_s.status <> 'submitted' then return; end if;
  select * into v_e from public.employees where id = v_s.employee_id;
  if p_outcome <> 'approved' then
    update public.separations set status = case p_outcome when 'cancelled' then 'withdrawn' else 'rejected' end::public.separation_status,
      decided_at = now() where id = p_separation;
    return;
  end if;
  update public.separations set status = 'approved', decided_at = now() where id = p_separation;
  update public.employees set status = 'on_notice', date_of_exit = v_s.last_working_day where id = v_s.employee_id;

  for r in select x.id, a.name, a.tag from public.asset_assignments x join public.assets a on a.id = x.asset_id
            where x.employee_id = v_s.employee_id and x.returned_at is null loop
    insert into public.clearance_items (organization_id, separation_id, kind, ref_id, title, owner)
    values (v_s.organization_id, p_separation, 'asset', r.id, 'Return ' || r.name || ' (' || r.tag || ')', 'it');
  end loop;
  for r in select g.id, s.name, g.account from public.access_grants g join public.access_systems s on s.id = g.system_id
            where g.employee_id = v_s.employee_id and g.revoked_at is null loop
    insert into public.clearance_items (organization_id, separation_id, kind, ref_id, title, owner)
    values (v_s.organization_id, p_separation, 'access', r.id, 'Revoke ' || r.name || ': ' || r.account, 'it');
  end loop;
  insert into public.clearance_items (organization_id, separation_id, kind, title, owner) values
    (v_s.organization_id, p_separation, 'handover', 'Work handed over', 'manager'),
    (v_s.organization_id, p_separation, 'finance', 'No dues: expenses, advances and loans settled', 'finance'),
    (v_s.organization_id, p_separation, 'exit_interview', 'Exit interview', 'hr');

  perform app.emit_event(v_s.organization_id, 'separation.approved', p_separation,
    jsonb_build_object('employee_id', v_s.employee_id, 'last_working_day', v_s.last_working_day), 'separation.approved:' || p_separation);
  perform app.notify(v_s.organization_id, v_e.user_id, 'separation.approved',
    'Your last working day is ' || to_char(v_s.last_working_day, 'DD Mon YYYY'), 'See your clearance checklist.', '/separations/' || p_separation);
end $$;
insert into app.approval_handlers (subject_type, handler) values ('separation', 'app.on_separation_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label) values
  ('separation', 1, 'reporting_manager', 'separation.manage', 'Reporting manager'),
  ('separation', 2, 'permission', 'separation.manage', 'HR');
select app.seed_org_flows(id, 'separation') from public.organizations;

-- Who may clear an item: HR any; the manager handover; asset managers assets and access; finance no-dues.
create function app.can_clear(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clearance_items i join public.separations s on s.id = i.separation_id
     where i.id = p_item
       and not app.is_own_employee(s.employee_id)
       and (app.has_permission(s.organization_id, 'separation.manage')
            or (i.owner = 'manager' and app.is_in_reporting_line(s.organization_id, s.employee_id))
            or (i.owner = 'it' and app.has_permission(s.organization_id, 'asset.manage'))
            or (i.owner = 'finance' and (app.has_permission(s.organization_id, 'payroll.prepare') or app.has_permission(s.organization_id, 'expense.manage')))));
$$;

-- Clear (or, with a note, waive) a checklist item. Assets and access clear themselves when returned or revoked;
-- they can only be waived here (for example a lost laptop recovered in the settlement).
create function public.clear_item(p_item uuid, p_status text, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_i public.clearance_items;
  v_s public.separations;
begin
  select * into v_i from public.clearance_items where id = p_item for update;
  if v_i.id is null or not app.can_clear(p_item) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_s from public.separations where id = v_i.separation_id;
  if v_s.status <> 'approved' and not (v_s.status = 'completed' and app.has_permission(v_s.organization_id, 'separation.manage')) then
    raise exception 'This separation isn’t in progress.' using errcode = '22023';
  end if;
  if v_i.status <> 'pending' then
    raise exception 'This item is already done.' using errcode = '22023';
  end if;
  if p_status not in ('cleared', 'waived') then
    raise exception 'Choose clear or waive.' using errcode = '22023';
  end if;
  if p_status = 'cleared' and v_i.kind in ('asset', 'access') then
    raise exception '%', case v_i.kind when 'asset' then 'Record the return on the asset; this clears itself.'
                                       else 'Revoke the access in System access; this clears itself.' end using errcode = '22023';
  end if;
  if p_status = 'waived' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say why it’s waived.' using errcode = '22023';
  end if;
  update public.clearance_items set status = p_status, note = nullif(btrim(coalesce(p_note, '')), ''), cleared_by = auth.uid(), cleared_at = now()
   where id = p_item;
end $$;

-- Returning an asset or revoking access clears the matching open checklist item.
create function app.clearance_autoclear() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Separate branches: each table's row only has its own column.
  if tg_table_name = 'asset_assignments' then
    if new.returned_at is not null and old.returned_at is null then
      update public.clearance_items set status = 'cleared', cleared_by = auth.uid(), cleared_at = now(), note = 'Returned'
       where ref_id = new.id and status = 'pending';
    end if;
  elsif new.revoked_at is not null and old.revoked_at is null then
    update public.clearance_items set status = 'cleared', cleared_by = auth.uid(), cleared_at = now(), note = 'Revoked'
     where ref_id = new.id and status = 'pending';
  end if;
  return null;
end $$;
create trigger asset_assignments_clearance after update of returned_at on public.asset_assignments
  for each row execute function app.clearance_autoclear();
create trigger access_grants_clearance after update of revoked_at on public.access_grants
  for each row execute function app.clearance_autoclear();

-- The employee withdraws before approval (through the approvals engine); HR cancels an approved one.
create function public.withdraw_separation(p_separation uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.separations;
begin
  select * into v_s from public.separations where id = p_separation for update;
  if v_s.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_s.status = 'submitted' and app.is_own_employee(v_s.employee_id) and v_s.type = 'resignation' then
    perform public.cancel_approval(v_s.approval_request_id); -- the handler marks it withdrawn
    return;
  end if;
  if not app.has_permission(v_s.organization_id, 'separation.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_s.status not in ('submitted', 'approved') then
    raise exception 'This separation is closed.' using errcode = '22023';
  end if;
  update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_s.approval_request_id and status = 'pending';
  update public.separations set status = 'cancelled' where id = p_separation;
  if v_s.status = 'approved' then
    update public.employees set status = 'active', date_of_exit = null where id = v_s.employee_id and status = 'on_notice';
    update public.clearance_items set status = 'waived', note = 'Separation cancelled', cleared_by = auth.uid(), cleared_at = now()
     where separation_id = p_separation and status = 'pending';
  end if;
end $$;

-- What was said: the reason and exit interview, for the employee and HR only.
create function public.separation_details(p_separation uuid)
returns table (reason text, exit_interview jsonb)
language sql stable security definer set search_path = '' as $$
  select s.reason, s.exit_interview from public.separations s
   where s.id = p_separation and (app.is_own_employee(s.employee_id) or app.has_permission(s.organization_id, 'separation.manage'));
$$;

-- The exit interview, by the employee (or HR with them). Completing it clears its checklist item.
create function public.save_exit_interview(p_separation uuid, p_answers jsonb, p_alumni boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.separations;
begin
  select * into v_s from public.separations where id = p_separation for update;
  if v_s.id is null or not (app.is_own_employee(v_s.employee_id) or app.has_permission(v_s.organization_id, 'separation.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_s.status not in ('approved', 'completed') then
    raise exception 'The exit interview opens once the separation is approved.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text) > 8000 then
    raise exception 'Answer the questions.' using errcode = '22023';
  end if;
  update public.separations set exit_interview = p_answers, alumni_opt_in = coalesce(p_alumni, false) where id = p_separation;
  update public.clearance_items set status = 'cleared', cleared_by = auth.uid(), cleared_at = now(), note = 'Completed'
   where separation_id = p_separation and kind = 'exit_interview' and status = 'pending';
end $$;

create function public.set_rehire_eligibility(p_separation uuid, p_eligible boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.separations where id = p_separation;
  if v_org is null or not app.has_permission(v_org, 'separation.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.separations set rehire_eligible = p_eligible where id = p_separation;
end $$;

-- Worker: complete separations after the last working day: the employee exits and loses access to this
-- organization; HR hears about clearance still open. Each employee separately, so one problem can't block others.
create function public.worker_separations() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r        record;
  v_open   int;
  v_done   int := 0;
  v_failed int := 0;
begin
  for r in select s.id, s.organization_id, s.employee_id, e.user_id, concat_ws(' ', e.first_name, e.last_name) as name
             from public.separations s join public.employees e on e.id = s.employee_id
            where s.status = 'approved' and s.last_working_day < app.org_today(s.organization_id) loop
    begin
      update public.separations set status = 'completed', completed_at = now() where id = r.id;
      update public.employees set status = 'exited' where id = r.employee_id;
      -- Sign-in to this organization ends, except for its last owner (who must hand over first; HR is told below).
      if r.user_id is not null and exists (
           select 1 from public.organization_members om
            where om.organization_id = r.organization_id and om.status = 'active' and om.user_id <> r.user_id
              and exists (select 1 from public.member_roles mr join public.roles ro on ro.id = mr.role_id
                           where mr.member_id = om.id and ro.key = 'owner' and mr.valid_until is null))
         or not exists (select 1 from public.member_roles mr join public.roles ro on ro.id = mr.role_id
                          join public.organization_members om on om.id = mr.member_id
                         where om.organization_id = r.organization_id and om.user_id = r.user_id and ro.key = 'owner') then
        update public.organization_members set status = 'suspended' where organization_id = r.organization_id and user_id = r.user_id and status = 'active';
      else
        perform app.notify_permission_holders(r.organization_id, 'separation.manage', 'separation.exit_failed',
          r.name || ' is the last owner and keeps access until ownership is handed over', '/separations/' || r.id);
      end if;
      perform app.emit_event(r.organization_id, 'employee.exited', r.employee_id, jsonb_build_object('separation_id', r.id), 'employee.exited:' || r.id);
      select count(*) into v_open from public.clearance_items where separation_id = r.id and status = 'pending';
      if v_open > 0 then
        perform app.notify_permission_holders(r.organization_id, 'separation.manage', 'separation.clearance_open',
          r.name || ' has left with ' || v_open || ' clearance item(s) open', '/separations/' || r.id);
      end if;
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed + 1;
      perform app.notify_permission_holders(r.organization_id, 'separation.manage', 'separation.exit_failed',
        'Couldn’t complete the exit of ' || r.name || ': ' || left(sqlerrm, 120), '/separations/' || r.id);
    end;
  end loop;
  return jsonb_build_object('completed', v_done, 'failed', v_failed);
end $$;

-- ─── Workflows can start from separations ───────────────────────────────────

alter table app.workflow_triggers drop constraint workflow_triggers_subject_kind_check;
alter table app.workflow_triggers add constraint workflow_triggers_subject_kind_check check (subject_kind in ('employee', 'leave_request', 'separation', 'none'));
insert into app.workflow_triggers (event_type, label, subject_kind) values
  ('separation.approved', 'A resignation or exit is approved', 'separation'),
  ('employee.exited', 'An employee leaves (day after their last working day)', 'employee');

create or replace function public.worker_start_workflows(p_event bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_e    record;
  v_kind text;
  v_emp  uuid;
  d      record;
  v_run  uuid;
  v_n    int := 0;
begin
  select * into v_e from app.domain_events where id = p_event;
  select subject_kind into v_kind from app.workflow_triggers where event_type = v_e.event_type;
  if v_e.id is null or v_kind is null then return jsonb_build_object('started', 0); end if;
  v_emp := case v_kind when 'employee' then v_e.subject_id
                       when 'leave_request' then (select employee_id from public.leave_requests where id = v_e.subject_id)
                       when 'separation' then (select employee_id from public.separations where id = v_e.subject_id) end;
  for d in select w.id, w.current_version_id, v.conditions
             from public.workflow_definitions w join public.workflow_versions v on v.id = w.current_version_id
            where w.organization_id = v_e.organization_id and w.trigger_event = v_e.event_type and w.is_active
            order by w.created_at loop
    continue when not app.workflow_matches(d.conditions, v_emp);
    insert into public.workflow_runs (organization_id, definition_id, version_id, event_id, event_type, subject_id, subject_employee_id)
    values (v_e.organization_id, d.id, d.current_version_id, v_e.id, v_e.event_type, v_e.subject_id, v_emp)
    on conflict (definition_id, event_id) do nothing
    returning id into v_run;
    continue when v_run is null;
    v_n := v_n + 1;
    perform app.workflow_advance(v_run);
  end loop;
  return jsonb_build_object('started', v_n);
end $$;

revoke all on function app.seed_org_notice_periods(uuid) from public;
revoke all on function app.seed_org_notice_periods_trigger() from public;
revoke all on function app.open_separation(uuid, public.separation_type, date, text, text) from public;
revoke all on function app.on_separation_decided(uuid, text) from public;
revoke all on function app.can_clear(uuid) from public;
revoke all on function app.can_view_clearance(uuid, text) from public;
grant execute on function app.can_view_clearance(uuid, text) to authenticated, service_role;
revoke all on function app.clearance_autoclear() from public;
revoke all on function public.submit_resignation(uuid, date, text, text) from public, anon;
revoke all on function public.initiate_separation(uuid, public.separation_type, date, text, text) from public, anon;
revoke all on function public.set_separation_terms(uuid, date, text) from public, anon;
revoke all on function public.clear_item(uuid, text, text) from public, anon;
revoke all on function public.withdraw_separation(uuid) from public, anon;
revoke all on function public.separation_details(uuid) from public, anon;
revoke all on function public.save_exit_interview(uuid, jsonb, boolean) from public, anon;
revoke all on function public.set_rehire_eligibility(uuid, boolean) from public, anon;
revoke all on function public.worker_separations() from public, anon, authenticated;
grant execute on function app.can_clear(uuid) to authenticated, service_role;
grant execute on function public.submit_resignation(uuid, date, text, text) to authenticated, service_role;
grant execute on function public.initiate_separation(uuid, public.separation_type, date, text, text) to authenticated, service_role;
grant execute on function public.set_separation_terms(uuid, date, text) to authenticated, service_role;
grant execute on function public.clear_item(uuid, text, text) to authenticated, service_role;
grant execute on function public.withdraw_separation(uuid) to authenticated, service_role;
grant execute on function public.separation_details(uuid) to authenticated, service_role;
grant execute on function public.save_exit_interview(uuid, jsonb, boolean) to authenticated, service_role;
grant execute on function public.set_rehire_eligibility(uuid, boolean) to authenticated, service_role;
grant execute on function public.worker_separations() to service_role;
