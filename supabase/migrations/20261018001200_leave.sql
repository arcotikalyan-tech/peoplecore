-- PeopleCore · Leave and holidays (Phase 3).
--
-- * Holiday calendars hold holidays and weekly offs; an employee follows the calendar of their location,
--   else the organization's default calendar.
-- * Leave types (CL, SL, EL, LOP by default) with versioned, effective-dated policies: accrual period and
--   amount, carry-forward cap, eligibility by employment type and during probation.
-- * The balance is a LEDGER: accruals, debits, reversals, lapses and adjustments are rows; the balance is
--   their sum (never a stored number). Rows are written only by functions; nobody can edit or delete them.
-- * Requests count working days on the employee's calendar (unless the type counts every day), reserve
--   balance while pending, can't overlap, and go through the approvals engine (manager, else leave.approve).
--   Approval debits the ledger; cancelling an approved leave that hasn't started reverses the debit.
-- * Accrual (monthly or yearly, pro-rated for mid-year joiners) and year-end lapse run in the worker and are
--   idempotent per employee and period.

-- ─── Permissions ────────────────────────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('leave.read', 'leave', 'View leave balances and requests', false),
  ('leave.manage', 'leave', 'Configure leave, holidays and adjust balances', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'leave.read', 'org'), ('owner', 'leave.manage', 'org'),
  ('hr_admin', 'leave.read', 'org'), ('hr_admin', 'leave.manage', 'org'),
  ('payroll_admin', 'leave.read', 'org'),
  ('department_head', 'leave.read', 'team'),
  ('manager', 'leave.read', 'team'),
  ('employee', 'leave.read', 'self'),
  ('auditor', 'leave.read', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key in ('leave.read', 'leave.manage')
on conflict (role_id, permission_key) do nothing;

-- ─── Holidays ───────────────────────────────────────────────────────────────

create table public.holiday_calendars (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  location_id      uuid,  -- null: the organization's default calendar
  -- Days of the week that are off (0 = Sunday … 6 = Saturday).
  weekly_offs      smallint[] not null default '{0,6}' check (weekly_offs <@ '{0,1,2,3,4,5,6}'::smallint[]),
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);
create unique index holiday_calendars_default_uq on public.holiday_calendars (organization_id) where location_id is null;
create unique index holiday_calendars_location_uq on public.holiday_calendars (organization_id, location_id) where location_id is not null;

create table public.holidays (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  calendar_id      uuid not null,
  holiday_date     date not null,
  name             text not null check (char_length(name) between 2 and 80),
  is_optional      boolean not null default false,
  unique (calendar_id, holiday_date),
  foreign key (organization_id, calendar_id) references public.holiday_calendars (organization_id, id) on delete cascade
);

-- ─── Leave types and policies ───────────────────────────────────────────────

create type public.accrual_period as enum ('monthly', 'yearly', 'none');
create type public.leave_entry_kind as enum ('opening', 'accrual', 'debit', 'reversal', 'lapse', 'adjust');
create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.leave_types (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations (id) on delete cascade,
  code                       text not null check (code ~ '^[A-Z0-9_]{1,10}$'),
  name                       text not null check (char_length(name) between 2 and 60),
  is_paid                    boolean not null default true,
  allow_half_day             boolean not null default true,
  allow_negative             boolean not null default false,  -- e.g. leave without pay
  count_all_days             boolean not null default false,  -- weekends and holidays inside the range count
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.leave_policies (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null,
  leave_type_id              uuid not null,
  effective_from             date not null,
  accrual_period             public.accrual_period not null,
  accrual_days               numeric(5,2) not null default 0 check (accrual_days >= 0 and accrual_days <= 366),
  carry_forward_max          numeric(6,2) check (carry_forward_max >= 0),  -- null: unlimited
  eligible_employment_types  public.employment_type[],                     -- null: everyone
  accrue_during_probation    boolean not null default true,
  created_by                 uuid default auth.uid(),
  created_at                 timestamptz not null default now(),
  unique (leave_type_id, effective_from),
  foreign key (organization_id, leave_type_id) references public.leave_types (organization_id, id) on delete cascade
);

create table public.leave_requests (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  employee_id          uuid not null,
  leave_type_id        uuid not null,
  start_date           date not null,
  end_date             date not null,
  half_day_start       boolean not null default false,  -- first day: second half only
  half_day_end         boolean not null default false,  -- last day: first half only
  days                 numeric(6,2) not null check (days > 0),
  reason               text check (char_length(reason) <= 500),
  status               public.leave_status not null default 'pending',
  approval_request_id  uuid,
  requested_by         uuid not null default auth.uid(),
  created_at           timestamptz not null default now(),
  decided_at           timestamptz,
  unique (organization_id, id),
  check (end_date >= start_date),
  check (not (start_date = end_date and half_day_start and half_day_end)),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, leave_type_id) references public.leave_types (organization_id, id),
  exclude using gist (employee_id with =, daterange(start_date, end_date, '[]') with &&) where (status in ('pending', 'approved'))
);
create index leave_requests_org_dates_idx on public.leave_requests (organization_id, start_date, end_date) where status in ('pending', 'approved');

create table public.leave_ledger (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  employee_id      uuid not null,
  leave_type_id    uuid not null,
  entry_date       date not null,
  kind             public.leave_entry_kind not null,
  days             numeric(6,2) not null check (days <> 0),
  request_id       uuid,
  note             text check (char_length(note) <= 300),
  idempotency_key  text unique,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, leave_type_id) references public.leave_types (organization_id, id),
  foreign key (organization_id, request_id) references public.leave_requests (organization_id, id)
);
create index leave_ledger_balance_idx on public.leave_ledger (employee_id, leave_type_id, entry_date);

create trigger leave_types_audit after insert or update or delete on public.leave_types for each row execute function app.audit_row();
create trigger leave_policies_audit after insert or update or delete on public.leave_policies for each row execute function app.audit_row();
create trigger holidays_audit after insert or update or delete on public.holidays for each row execute function app.audit_row();
create trigger holiday_calendars_audit after insert or update or delete on public.holiday_calendars for each row execute function app.audit_row();
create trigger leave_requests_audit after insert or update on public.leave_requests for each row execute function app.audit_row();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.holiday_calendars enable row level security;
alter table public.holidays enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_policies enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_ledger enable row level security;

do $$
declare t text;
begin
  foreach t in array array['holiday_calendars', 'holidays', 'leave_types', 'leave_policies'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.is_member(organization_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.has_permission(organization_id, ''leave.manage''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (app.has_permission(organization_id, ''leave.manage'')) with check (app.has_permission(organization_id, ''leave.manage''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (app.has_permission(organization_id, ''leave.manage''))', t);
  end loop;
end $$;

-- Visible with leave.read for the employee, or to anyone who can see the request's approval (its approvers).
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'leave.read')
         or (approval_request_id is not null and app.can_view_approval(approval_request_id)));
create policy leave_ledger_select on public.leave_ledger for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'leave.read'));

grant select, insert, update, delete on public.holiday_calendars, public.holidays, public.leave_types, public.leave_policies to authenticated;
-- Requests and the ledger are written only by the functions below.
grant select on public.leave_requests, public.leave_ledger to authenticated;
grant all on public.holiday_calendars, public.holidays, public.leave_types, public.leave_policies,
             public.leave_requests, public.leave_ledger to service_role;

-- ─── Calendar arithmetic ────────────────────────────────────────────────────

create function app.employee_calendar(p_employee uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.id from public.holiday_calendars c join public.employees e on e.organization_id = c.organization_id
      where e.id = p_employee and c.location_id = e.location_id),
    (select c.id from public.holiday_calendars c join public.employees e on e.organization_id = c.organization_id
      where e.id = p_employee and c.location_id is null));
$$;

-- Days a request takes: working days on the employee's calendar (or every day), minus half days.
create function app.leave_days(p_employee uuid, p_type uuid, p_start date, p_end date, p_half_start boolean, p_half_end boolean)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_all      boolean;
  v_calendar uuid := app.employee_calendar(p_employee);
  v_offs     smallint[];
  v_days     numeric := 0;
  v_day      date;
  v_counts   boolean;
  v_first    boolean;
  v_last     boolean;
begin
  select count_all_days into v_all from public.leave_types where id = p_type;
  select weekly_offs into v_offs from public.holiday_calendars where id = v_calendar;
  v_offs := coalesce(v_offs, '{0,6}');
  for v_day in select generate_series(p_start, p_end, interval '1 day')::date loop
    v_counts := v_all or (
      not (extract(dow from v_day)::smallint = any (v_offs))
      and not exists (select 1 from public.holidays h where h.calendar_id = v_calendar and h.holiday_date = v_day and not h.is_optional));
    continue when not v_counts;
    v_first := v_day = p_start and p_half_start;
    v_last := v_day = p_end and p_half_end;
    v_days := v_days + case when v_first or v_last then 0.5 else 1 end;
  end loop;
  return v_days;
end $$;

-- ─── Balances ───────────────────────────────────────────────────────────────

create function public.leave_balances(p_employee uuid)
returns table (leave_type_id uuid, code text, name text, is_paid boolean, allow_negative boolean, allow_half_day boolean,
               balance numeric, pending numeric, available numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := app.employee_org_or_deny(p_employee, 'leave.read');
begin
  return query
    select t.id, t.code, t.name, t.is_paid, t.allow_negative, t.allow_half_day,
           coalesce((select sum(l.days) from public.leave_ledger l where l.employee_id = p_employee and l.leave_type_id = t.id), 0),
           coalesce((select sum(r.days) from public.leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id and r.status = 'pending'), 0),
           coalesce((select sum(l.days) from public.leave_ledger l where l.employee_id = p_employee and l.leave_type_id = t.id), 0)
             - coalesce((select sum(r.days) from public.leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id and r.status = 'pending'), 0)
      from public.leave_types t
     where t.organization_id = v_org and t.is_active
     order by t.code;
end $$;

-- ─── Applying, deciding, cancelling ─────────────────────────────────────────

create function public.apply_leave(
  p_employee   uuid,
  p_type       uuid,
  p_start      date,
  p_end        date,
  p_half_start boolean default false,
  p_half_end   boolean default false,
  p_reason     text default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp       public.employees;
  v_type      public.leave_types;
  v_days      numeric;
  v_available numeric;
  v_id        uuid;
  v_approval  uuid;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null or not app.is_member(v_emp.organization_id)
     or not (v_emp.user_id = auth.uid() or app.has_permission(v_emp.organization_id, 'leave.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_emp.status = 'exited' then
    raise exception 'Leave can’t be requested for someone who has left.' using errcode = '22023';
  end if;
  select * into v_type from public.leave_types where id = p_type and organization_id = v_emp.organization_id;
  if v_type.id is null or not v_type.is_active then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'The leave can’t end before it starts.' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'A single request can cover at most a year.' using errcode = '22023';
  end if;
  if (p_half_start or p_half_end) and not v_type.allow_half_day then
    raise exception '% can’t be taken in half days.', v_type.name using errcode = '22023';
  end if;
  if p_start = p_end and p_half_start and p_half_end then
    raise exception 'Choose either the first or the second half of the day.' using errcode = '22023';
  end if;

  v_days := app.leave_days(p_employee, p_type, p_start, p_end, coalesce(p_half_start, false), coalesce(p_half_end, false));
  if v_days <= 0 then
    raise exception 'Those dates are all weekly offs or holidays.' using errcode = '22023';
  end if;
  if not v_type.allow_negative then
    select coalesce(sum(days), 0) into v_available from public.leave_ledger where employee_id = p_employee and leave_type_id = p_type;
    v_available := v_available - coalesce((select sum(days) from public.leave_requests
                                            where employee_id = p_employee and leave_type_id = p_type and status = 'pending'), 0);
    if v_days > v_available then
      raise exception 'Only % day(s) of % available; this request needs %.', trim_scale(v_available), v_type.name, trim_scale(v_days)
        using errcode = '22023';
    end if;
  end if;

  begin
    insert into public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, half_day_start, half_day_end, days, reason)
    values (v_emp.organization_id, p_employee, p_type, p_start, p_end, coalesce(p_half_start, false), coalesce(p_half_end, false),
            v_days, nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'This overlaps another leave request.' using errcode = '22023';
  end;

  v_approval := app.request_approval(v_emp.organization_id, 'leave_request', v_id, p_employee,
    format('%s: %s, %s%s (%s day%s)', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)), v_type.name,
           to_char(p_start, 'DD Mon YYYY'), case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else '' end,
           trim_scale(v_days), case when v_days = 1 then '' else 's' end),
    '/leave');
  update public.leave_requests set approval_request_id = v_approval where id = v_id;
  return v_id;
end $$;

-- Approval handler: approve debits the ledger; reject/cancel just close the request.
create function app.on_leave_decided(p_request uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req public.leave_requests;
begin
  select * into v_req from public.leave_requests where id = p_request for update;
  if v_req.id is null or v_req.status <> 'pending' then return; end if;
  update public.leave_requests
     set status = case p_outcome when 'approved' then 'approved' when 'rejected' then 'rejected' else 'cancelled' end::public.leave_status,
         decided_at = now()
   where id = p_request;
  if p_outcome = 'approved' then
    insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, request_id, idempotency_key)
    values (v_req.organization_id, v_req.employee_id, v_req.leave_type_id, v_req.start_date, 'debit', -v_req.days, v_req.id,
            'leave:debit:' || v_req.id)
    on conflict (idempotency_key) do nothing;
    perform app.emit_event(v_req.organization_id, 'leave.approved', v_req.id,
      jsonb_build_object('employee_id', v_req.employee_id, 'start_date', v_req.start_date, 'end_date', v_req.end_date),
      'leave.approved:' || v_req.id);
  end if;
end $$;

insert into app.approval_handlers (subject_type, handler) values ('leave_request', 'app.on_leave_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label)
values ('leave_request', 1, 'reporting_manager', 'leave.approve', 'Reporting manager');

-- Cancels a request: pending ones are withdrawn; approved ones only before they start (or by HR), with the
-- debit reversed.
create function public.cancel_leave(p_request uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req     public.leave_requests;
  v_emp     public.employees;
  v_manager boolean;
begin
  select * into v_req from public.leave_requests where id = p_request for update;
  select * into v_emp from public.employees where id = v_req.employee_id;
  if v_req.id is null or not app.is_member(v_req.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_manager := app.has_permission(v_req.organization_id, 'leave.manage');
  if not (v_emp.user_id = auth.uid() or v_manager) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_req.status not in ('pending', 'approved') then
    raise exception 'This request is already %.', v_req.status using errcode = '22023';
  end if;
  if v_req.status = 'approved' and v_req.start_date <= app.org_today(v_req.organization_id) and not v_manager then
    raise exception 'This leave has already started. Ask HR to change it.' using errcode = '22023';
  end if;

  if v_req.status = 'pending' then
    update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_req.approval_request_id and status = 'pending';
    insert into public.approval_actions (organization_id, request_id, step_no, actor_user_id, decision)
    select v_req.organization_id, r.id, r.current_step, auth.uid(), 'cancel' from public.approval_requests r where r.id = v_req.approval_request_id;
  else
    insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, request_id, idempotency_key)
    values (v_req.organization_id, v_req.employee_id, v_req.leave_type_id, v_req.start_date, 'reversal', v_req.days, v_req.id,
            'leave:reversal:' || v_req.id)
    on conflict (idempotency_key) do nothing;
  end if;
  update public.leave_requests set status = 'cancelled', decided_at = now() where id = p_request;
end $$;

-- HR adjusts a balance (opening balances, corrections). Always a new ledger row, never an edit.
create function public.adjust_leave_balance(p_employee uuid, p_type uuid, p_days numeric, p_note text, p_kind public.leave_entry_kind default 'adjust')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'leave.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_kind not in ('adjust', 'opening') then
    raise exception 'Adjustments are recorded as adjust or opening entries.' using errcode = '22023';
  end if;
  if p_days = 0 or abs(p_days) > 366 then
    raise exception 'Enter a number of days between -366 and 366 (not zero).' using errcode = '22023';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'Say why the balance is being adjusted.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.leave_types where id = p_type and organization_id = v_org) then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note)
  values (v_org, p_employee, p_type, app.org_today(v_org), p_kind, round(p_days * 2) / 2, btrim(p_note));
end $$;

-- ─── Accrual and lapse (worker, idempotent) ─────────────────────────────────

create function public.worker_leave_accrual() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r          record;
  v_credited int := 0;
  v_lapsed   int := 0;
  v_today    date;
  v_month    date;
  v_days     numeric;
  v_balance  numeric;
  v_key      text;
begin
  -- Year-end lapse: on or after 1 January, cap the previous year's closing balance at the carry-forward limit.
  for r in
    select e.id as employee_id, e.organization_id, p.leave_type_id, p.carry_forward_max, date_trunc('year', app.org_today(e.organization_id))::date as year_start
      from public.employees e
      join public.leave_types t on t.organization_id = e.organization_id and t.is_active and not t.allow_negative
      join lateral (select * from public.leave_policies p where p.leave_type_id = t.id
                     and p.effective_from <= date_trunc('year', app.org_today(e.organization_id))::date - 1
                     order by p.effective_from desc limit 1) p on true
     where e.status <> 'exited' and p.carry_forward_max is not null
  loop
    v_key := 'lapse:' || r.leave_type_id || ':' || r.employee_id || ':' || extract(year from r.year_start - 1);
    continue when exists (select 1 from public.leave_ledger where idempotency_key = v_key);
    select coalesce(sum(days), 0) into v_balance from public.leave_ledger
     where employee_id = r.employee_id and leave_type_id = r.leave_type_id and entry_date < r.year_start;
    if v_balance > r.carry_forward_max then
      insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
      values (r.organization_id, r.employee_id, r.leave_type_id, r.year_start, 'lapse', r.carry_forward_max - v_balance,
              'Year-end lapse above the carry-forward limit', v_key)
      on conflict (idempotency_key) do nothing;
      v_lapsed := v_lapsed + 1;
    end if;
  end loop;

  -- Accrual for the current month (monthly) or year (yearly), per eligible employee.
  for r in
    select e.id as employee_id, e.organization_id, e.date_of_joining, e.probation_end_date, e.employment_type,
           p.id as policy_id, p.leave_type_id, p.accrual_period, p.accrual_days, p.eligible_employment_types, p.accrue_during_probation
      from public.employees e
      join public.leave_types t on t.organization_id = e.organization_id and t.is_active
      join lateral (select * from public.leave_policies p where p.leave_type_id = t.id
                     and p.effective_from <= app.org_today(e.organization_id)
                     order by p.effective_from desc limit 1) p on true
     where e.status in ('active', 'on_notice') and p.accrual_period <> 'none' and p.accrual_days > 0
  loop
    v_today := app.org_today(r.organization_id);
    continue when r.eligible_employment_types is not null and not (r.employment_type = any (r.eligible_employment_types));
    continue when not r.accrue_during_probation and r.probation_end_date is not null and r.probation_end_date >= v_today;
    if r.accrual_period = 'monthly' then
      v_month := date_trunc('month', v_today)::date;
      -- Joiners after the 15th start accruing the following month.
      continue when r.date_of_joining > v_month + 14;
      v_key := 'accrual:' || r.policy_id || ':' || r.employee_id || ':' || to_char(v_month, 'YYYY-MM');
      v_days := r.accrual_days;
    else
      v_month := date_trunc('year', v_today)::date;
      v_key := 'accrual:' || r.policy_id || ':' || r.employee_id || ':' || to_char(v_month, 'YYYY');
      -- Mid-year joiners get the remaining months' share, rounded to half days.
      v_days := case when r.date_of_joining > v_month
                     then round(r.accrual_days * (13 - extract(month from r.date_of_joining)) / 12 * 2) / 2
                     else r.accrual_days end;
    end if;
    continue when v_days <= 0 or exists (select 1 from public.leave_ledger where idempotency_key = v_key);
    insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, idempotency_key)
    values (r.organization_id, r.employee_id, r.leave_type_id, greatest(v_month, r.date_of_joining), 'accrual', v_days, v_key)
    on conflict (idempotency_key) do nothing;
    v_credited := v_credited + 1;
  end loop;
  return jsonb_build_object('credited', v_credited, 'lapsed', v_lapsed);
end $$;

-- ─── Defaults for every organization ────────────────────────────────────────

create function app.seed_org_leave(p_org uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_type uuid;
begin
  insert into public.holiday_calendars (organization_id, name) values (p_org, 'Default calendar') on conflict do nothing;
  if exists (select 1 from public.leave_types where organization_id = p_org) then return; end if;

  insert into public.leave_types (organization_id, code, name) values (p_org, 'CL', 'Casual leave') returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max)
  values (p_org, v_type, '2000-01-01', 'monthly', 1, 0);

  insert into public.leave_types (organization_id, code, name) values (p_org, 'SL', 'Sick leave') returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max)
  values (p_org, v_type, '2000-01-01', 'monthly', 1, 0);

  insert into public.leave_types (organization_id, code, name, allow_half_day) values (p_org, 'EL', 'Earned leave', false) returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max, accrue_during_probation)
  values (p_org, v_type, '2000-01-01', 'monthly', 1.25, 30, false);

  insert into public.leave_types (organization_id, code, name, is_paid, allow_negative) values (p_org, 'LOP', 'Leave without pay', false, true) returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days)
  values (p_org, v_type, '2000-01-01', 'none', 0);
end $$;

create function app.seed_org_leave_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_leave(new.id);
  return null;
end $$;
create trigger organizations_seed_leave after insert on public.organizations
  for each row execute function app.seed_org_leave_trigger();

-- Existing organizations: defaults and the leave approval flow.
select app.seed_org_leave(id), app.seed_org_flows(id, 'leave_request') from public.organizations;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function app.employee_calendar(uuid) from public;
revoke all on function app.leave_days(uuid, uuid, date, date, boolean, boolean) from public;
revoke all on function app.on_leave_decided(uuid, text) from public;
revoke all on function app.seed_org_leave(uuid) from public;
revoke all on function app.seed_org_leave_trigger() from public;
revoke all on function public.leave_balances(uuid) from public, anon;
revoke all on function public.apply_leave(uuid, uuid, date, date, boolean, boolean, text) from public, anon;
revoke all on function public.cancel_leave(uuid) from public, anon;
revoke all on function public.adjust_leave_balance(uuid, uuid, numeric, text, public.leave_entry_kind) from public, anon;
revoke all on function public.worker_leave_accrual() from public, anon, authenticated;
grant execute on function public.leave_balances(uuid) to authenticated, service_role;
grant execute on function public.apply_leave(uuid, uuid, date, date, boolean, boolean, text) to authenticated, service_role;
grant execute on function public.cancel_leave(uuid) to authenticated, service_role;
grant execute on function public.adjust_leave_balance(uuid, uuid, numeric, text, public.leave_entry_kind) to authenticated, service_role;
grant execute on function public.worker_leave_accrual() to service_role;
