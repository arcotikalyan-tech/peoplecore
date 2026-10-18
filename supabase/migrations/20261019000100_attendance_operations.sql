-- PeopleCore · Attendance operations (docs/11-kredily-parity-checklist.md, Attendance).
--
-- Attendance rules gain early-leave grace, verification switches, a late-mark penalty, overtime and comp-off
-- thresholds. A 5-week work-week pattern (working / half day / off for each weekday of each week of the month)
-- can be assigned to people; without one, the holiday calendar's weekly offs apply as before. People ask for
-- work-from-home and on-duty days through the approval engine; approved days are paid like present days.
-- Overtime beyond the rule's threshold waits for a manager's decision; work on an off day or holiday credits
-- comp-off leave. Penalties for late marks beyond the allowance are recorded per month and reduce payable
-- days in payroll. Each organization has attendance settings (cycle, reminders, approvals, office IPs).

-- The 'wfh' and 'on_duty' statuses come from migration 20261019000000.

-- ─── Rules (shifts) ─────────────────────────────────────────────────────────

alter table public.shifts
  add column description             text check (char_length(description) <= 300),
  add column early_grace_minutes     smallint not null default 0 check (early_grace_minutes between 0 and 240),
  add column verify_selfie           boolean not null default false,
  add column verify_geofence         boolean not null default false,
  add column verify_ip               boolean not null default false,
  add column late_marks_allowed      smallint check (late_marks_allowed between 0 and 31),          -- null: no late penalty
  add column late_penalty_days       numeric(3,1) not null default 0.5 check (late_penalty_days in (0.5, 1)),
  add column overtime_after_minutes  smallint check (overtime_after_minutes between 0 and 720),     -- null: no overtime
  add column comp_off_min_minutes    smallint check (comp_off_min_minutes between 60 and 1440);     -- null: no comp-off

alter table public.attendance_days
  add column early_out_minutes integer not null default 0,
  add column overtime_minutes  integer not null default 0;

-- ─── Work week ──────────────────────────────────────────────────────────────

-- Five strings, one per week of the month (days 1–7, 8–14, …, 29–31), each seven characters Monday → Sunday:
-- W working day, H half day, O weekly off.
create function app.valid_week_pattern(p_pattern text[]) returns boolean
language sql immutable set search_path = '' as $$
  select array_length(p_pattern, 1) = 5 and coalesce((select bool_and(d ~ '^[WHO]{7}$') from unnest(p_pattern) d), false);
$$;

create table public.work_week_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 60),
  description      text check (char_length(description) <= 300),
  pattern          text[] not null check (app.valid_week_pattern(pattern)),
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);
create unique index work_week_rules_default_uq on public.work_week_rules (organization_id) where is_default;

create table public.work_week_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  rule_id          uuid not null,
  effective_from   date not null,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (employee_id, effective_from),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, rule_id) references public.work_week_rules (organization_id, id) on delete cascade
);

-- The pattern that applies to an employee on a day: their latest assignment, else the organization's default.
create function app.work_week_for(p_employee uuid, p_date date) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.pattern from public.work_week_assignments a join public.work_week_rules r on r.id = a.rule_id
      where a.employee_id = p_employee and a.effective_from <= p_date order by a.effective_from desc limit 1),
    (select r.pattern from public.work_week_rules r join public.employees e on e.organization_id = r.organization_id
      where e.id = p_employee and r.is_default));
$$;

-- ─── Work from home and on duty ─────────────────────────────────────────────

create type public.attendance_request_kind as enum ('wfh', 'on_duty');

create table public.attendance_requests (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  employee_id          uuid not null,
  kind                 public.attendance_request_kind not null,
  start_date           date not null,
  end_date             date not null,
  reason               text not null check (char_length(reason) between 3 and 500),
  status               public.leave_status not null default 'pending',
  approval_request_id  uuid,
  requested_by         uuid not null default auth.uid(),
  created_at           timestamptz not null default now(),
  decided_at           timestamptz,
  unique (organization_id, id),
  check (end_date >= start_date and end_date - start_date <= 30),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index attendance_requests_employee_idx on public.attendance_requests (employee_id, start_date);

-- ─── Overtime, comp-off, penalties ──────────────────────────────────────────

create table public.overtime_records (
  organization_id  uuid not null,
  employee_id      uuid not null,
  work_date        date not null,
  minutes          integer not null check (minutes > 0),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by       uuid,
  decided_at       timestamptz,
  primary key (employee_id, work_date),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index overtime_records_org_idx on public.overtime_records (organization_id, status, work_date);

create table public.comp_off_credits (
  organization_id  uuid not null,
  employee_id      uuid not null,
  work_date        date not null,
  days             numeric(3,1) not null check (days in (0.5, 1)),
  leave_type_id    uuid not null,
  status           text not null default 'credited' check (status in ('credited', 'reverted')),
  credited_at      timestamptz not null default now(),
  reverted_by      uuid,
  reverted_at      timestamptz,
  primary key (employee_id, work_date),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, leave_type_id) references public.leave_types (organization_id, id)
);
create index comp_off_credits_org_idx on public.comp_off_credits (organization_id, work_date);

create table public.attendance_penalties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  cycle_month      date not null check (extract(day from cycle_month) = 1),
  kind             text not null check (kind in ('late_marks')),
  occurrences      integer not null check (occurrences > 0),
  days             numeric(4,1) not null check (days > 0),
  detail           text check (char_length(detail) <= 300),
  applied_at       timestamptz not null default now(),
  applied_by       uuid,
  reverted_at      timestamptz,
  reverted_by      uuid,
  unique (employee_id, cycle_month, kind),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index attendance_penalties_org_idx on public.attendance_penalties (organization_id, cycle_month);

-- ─── Settings ───────────────────────────────────────────────────────────────

create table public.attendance_settings (
  organization_id          uuid primary key references public.organizations (id) on delete cascade,
  cycle_start_day          smallint not null default 1 check (cycle_start_day between 1 and 28),
  remind_missing_checkout  boolean not null default true,
  pending_digest           boolean not null default true,
  late_punch_alert         boolean not null default false,
  skip_level_approval      boolean not null default false,
  allowed_ips              text[] not null default '{}' check (cardinality(allowed_ips) <= 50),
  updated_by               uuid default auth.uid(),
  updated_at               timestamptz not null default now()
);
create trigger attendance_settings_touch before update on public.attendance_settings for each row execute function app.touch_updated_at();

-- ─── Audit, RLS, grants ─────────────────────────────────────────────────────

create trigger work_week_rules_audit after insert or update or delete on public.work_week_rules for each row execute function app.audit_row();
create trigger work_week_assignments_audit after insert or update or delete on public.work_week_assignments for each row execute function app.audit_row();
create trigger attendance_requests_audit after insert or update on public.attendance_requests for each row execute function app.audit_row();
create trigger overtime_records_audit after update on public.overtime_records for each row execute function app.audit_row();
create trigger comp_off_credits_audit after insert or update on public.comp_off_credits for each row execute function app.audit_row();
create trigger attendance_penalties_audit after insert or update on public.attendance_penalties for each row execute function app.audit_row();
create trigger attendance_settings_audit after update on public.attendance_settings for each row execute function app.audit_row();

alter table public.work_week_rules enable row level security;
alter table public.work_week_assignments enable row level security;
alter table public.attendance_requests enable row level security;
alter table public.overtime_records enable row level security;
alter table public.comp_off_credits enable row level security;
alter table public.attendance_penalties enable row level security;
alter table public.attendance_settings enable row level security;

create policy work_week_rules_select on public.work_week_rules for select to authenticated using (app.is_member(organization_id));
create policy work_week_rules_write on public.work_week_rules for all to authenticated
  using (organization_id in (select app.orgs_with_scope('attendance.manage', 'org')))
  with check (organization_id in (select app.orgs_with_scope('attendance.manage', 'org')));

create policy work_week_assignments_select on public.work_week_assignments for select to authenticated
  using (organization_id in (select app.orgs_with_scope('attendance.read', 'org')) or employee_id in (select app.employees_in_scope('attendance.read')));
create policy work_week_assignments_write on public.work_week_assignments for all to authenticated
  using (organization_id in (select app.orgs_with_scope('attendance.manage', 'org')))
  with check (organization_id in (select app.orgs_with_scope('attendance.manage', 'org')));

create policy attendance_requests_select on public.attendance_requests for select to authenticated
  using (organization_id in (select app.orgs_with_scope('attendance.read', 'org')) or employee_id in (select app.employees_in_scope('attendance.read'))
         or (approval_request_id is not null and app.can_view_approval(approval_request_id)));

create policy overtime_records_select on public.overtime_records for select to authenticated
  using (organization_id in (select app.orgs_with_scope('attendance.read', 'org')) or employee_id in (select app.employees_in_scope('attendance.read')));
create policy comp_off_credits_select on public.comp_off_credits for select to authenticated
  using (organization_id in (select app.orgs_with_scope('attendance.read', 'org')) or employee_id in (select app.employees_in_scope('attendance.read')));
create policy attendance_penalties_select on public.attendance_penalties for select to authenticated
  using (organization_id in (select app.orgs_with_scope('attendance.read', 'org')) or employee_id in (select app.employees_in_scope('attendance.read')));

create policy attendance_settings_select on public.attendance_settings for select to authenticated using (app.is_member(organization_id));
create policy attendance_settings_update on public.attendance_settings for update to authenticated
  using (organization_id in (select app.orgs_with_scope('attendance.manage', 'org')))
  with check (organization_id in (select app.orgs_with_scope('attendance.manage', 'org')));

grant select, insert, update, delete on public.work_week_rules, public.work_week_assignments to authenticated;
grant select on public.attendance_requests, public.overtime_records, public.comp_off_credits, public.attendance_penalties to authenticated;
grant select, update on public.attendance_settings to authenticated;
grant all on public.work_week_rules, public.work_week_assignments, public.attendance_requests, public.overtime_records,
  public.comp_off_credits, public.attendance_penalties, public.attendance_settings to service_role;

-- ─── The day, recomputed ────────────────────────────────────────────────────

create or replace function app.compute_attendance_day(p_employee uuid, p_date date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp       public.employees;
  v_tz        text;
  v_today     date;
  v_shift     public.shifts;
  v_start     timestamptz;
  v_end       timestamptz;
  v_window    tstzrange;
  v_first     timestamptz;
  v_last      timestamptz;
  v_count     int;
  v_worked    int := 0;
  v_late      int := 0;
  v_early     int := 0;
  v_full      int;
  v_half      int;
  v_calendar  uuid;
  v_week      text[];
  v_code      text;
  v_off       boolean := false;
  v_halfwork  boolean := false;
  v_holiday   boolean;
  v_leave     numeric := 0;
  v_paid      boolean;
  v_request   text;
  v_status    public.attendance_status;
  v_reg       boolean;
  v_ot        int := 0;
  v_comp_type uuid;
  v_comp_days numeric;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null then return; end if;
  select timezone into v_tz from public.organizations where id = v_emp.organization_id;
  v_today := app.org_today(v_emp.organization_id);
  if p_date > v_today or p_date < v_emp.date_of_joining or (v_emp.date_of_exit is not null and p_date > v_emp.date_of_exit) then
    delete from public.attendance_days where employee_id = p_employee and work_date = p_date;
    delete from public.overtime_records where employee_id = p_employee and work_date = p_date and status = 'pending';
    return;
  end if;

  v_shift := app.shift_for(p_employee, p_date);
  v_full := coalesce(v_shift.full_day_minutes, 480);
  v_half := coalesce(v_shift.half_day_minutes, 240);
  v_start := ((p_date + coalesce(v_shift.start_time, '09:00'::time))::timestamp at time zone v_tz);
  v_end := ((p_date + coalesce(v_shift.end_time, '18:00'::time))::timestamp at time zone v_tz);
  if v_end <= v_start then v_end := v_end + interval '1 day'; end if;
  -- A work day collects punches from 4 hours before the shift start to 20 hours after it (night shifts).
  v_window := tstzrange(v_start - interval '4 hours', v_start + interval '20 hours', '[)');
  select min(punched_at), max(punched_at), count(*), bool_or(method = 'regularization')
    into v_first, v_last, v_count, v_reg
    from public.attendance_punches where employee_id = p_employee and punched_at <@ v_window;

  if v_count >= 2 then
    v_worked := greatest(0, (extract(epoch from v_last - v_first) / 60)::int
                            - case when extract(epoch from v_last - v_first) / 60 > v_half
                                   then coalesce(v_shift.break_minutes, 60) else 0 end);
    v_early := greatest(0, (extract(epoch from v_end - v_last) / 60)::int - coalesce(v_shift.early_grace_minutes, 0));
  end if;
  if v_count >= 1 then
    v_late := greatest(0, (extract(epoch from v_first - v_start) / 60)::int - coalesce(v_shift.grace_minutes, 15));
  end if;

  -- Weekly offs: the assigned work-week pattern if there is one, else the holiday calendar's weekly offs.
  v_calendar := app.employee_calendar(p_employee);
  v_week := app.work_week_for(p_employee, p_date);
  if v_week is not null then
    v_code := substr(v_week[least(5, (extract(day from p_date)::int - 1) / 7 + 1)], extract(isodow from p_date)::int, 1);
    v_off := v_code = 'O';
    v_halfwork := v_code = 'H';
  else
    select coalesce(extract(dow from p_date)::smallint = any (weekly_offs), false) into v_off from public.holiday_calendars where id = v_calendar;
    v_off := coalesce(v_off, false);
  end if;
  v_holiday := exists (select 1 from public.holidays where calendar_id = v_calendar and holiday_date = p_date and not is_optional);

  select case when r.start_date = r.end_date and (r.half_day_start or r.half_day_end) then 0.5
              when p_date = r.start_date and r.half_day_start then 0.5
              when p_date = r.end_date and r.half_day_end then 0.5
              else 1 end, t.is_paid
    into v_leave, v_paid
    from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
   where r.employee_id = p_employee and r.status = 'approved' and p_date between r.start_date and r.end_date
   limit 1;
  v_leave := coalesce(v_leave, 0);

  select kind::text into v_request from public.attendance_requests
   where employee_id = p_employee and status = 'approved' and p_date between start_date and end_date
   order by created_at desc limit 1;

  v_status := case
    when v_worked >= v_full then 'present'
    when v_leave = 1 then 'on_leave'
    when v_request is not null then v_request::public.attendance_status
    when v_holiday then 'holiday'
    when v_off then 'weekly_off'
    when v_halfwork and v_worked >= v_half then 'present'
    when v_worked >= v_half or (v_leave = 0.5 and v_count >= 1) then 'half_day'
    when v_leave = 0.5 then 'half_day'
    when p_date = v_today then 'not_marked'
    else 'absent'
  end;

  if v_shift.overtime_after_minutes is not null and v_worked > v_full + v_shift.overtime_after_minutes then
    v_ot := v_worked - v_full;
  end if;

  insert into public.attendance_days (organization_id, employee_id, work_date, shift_id, status, first_in, last_out, worked_minutes,
                                      late_minutes, early_out_minutes, overtime_minutes, punch_count, leave_days, leave_paid,
                                      is_regularized, computed_at)
  values (v_emp.organization_id, p_employee, p_date, v_shift.id, v_status, v_first, case when v_count >= 2 then v_last end,
          v_worked, v_late, v_early, v_ot, v_count, v_leave, v_paid, coalesce(v_reg, false), now())
  on conflict (employee_id, work_date) do update set
    shift_id = excluded.shift_id, status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
    worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes, early_out_minutes = excluded.early_out_minutes,
    overtime_minutes = excluded.overtime_minutes, punch_count = excluded.punch_count, leave_days = excluded.leave_days,
    leave_paid = excluded.leave_paid, is_regularized = excluded.is_regularized, computed_at = excluded.computed_at;

  -- Overtime waits for a decision; a decided record keeps its decision.
  if v_ot > 0 then
    insert into public.overtime_records (organization_id, employee_id, work_date, minutes)
    values (v_emp.organization_id, p_employee, p_date, v_ot)
    on conflict (employee_id, work_date) do update set minutes = excluded.minutes where public.overtime_records.status = 'pending';
  else
    delete from public.overtime_records where employee_id = p_employee and work_date = p_date and status = 'pending';
  end if;

  -- Work on an off day or holiday earns comp-off once (half a day below a full day's work).
  if v_shift.comp_off_min_minutes is not null and (v_off or v_holiday) and v_worked >= v_shift.comp_off_min_minutes then
    -- The comp-off leave type is created the first time an organization's rule earns one.
    insert into public.leave_types (organization_id, code, name, is_paid) values (v_emp.organization_id, 'COMP_OFF', 'Comp off', true)
    on conflict do nothing;
    select id into v_comp_type from public.leave_types where organization_id = v_emp.organization_id and code = 'COMP_OFF' and is_active;
    if v_comp_type is not null then
      v_comp_days := case when v_worked >= v_full then 1 else 0.5 end;
      insert into public.comp_off_credits (organization_id, employee_id, work_date, days, leave_type_id)
      values (v_emp.organization_id, p_employee, p_date, v_comp_days, v_comp_type)
      on conflict (employee_id, work_date) do nothing;
      if found then
        insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key, created_by)
        values (v_emp.organization_id, p_employee, v_comp_type, p_date, 'accrual', v_comp_days,
                'Comp-off for work on ' || to_char(p_date, 'DD Mon YYYY'), 'compoff:' || p_employee || ':' || p_date, null)
        on conflict (idempotency_key) do nothing;
      end if;
    end if;
  end if;

  -- A past day with a single punch is missing a check-out (or check-in): flag it for the employee to fix.
  -- Once the day has both punches (a later import, a regularization), the flag resolves itself.
  if v_count >= 2 then
    update public.anomaly_flags set status = 'resolved', reviewed_at = now()
     where employee_id = p_employee and rule = 'missing_punch' and status = 'open'
       and subject_id in (select p.id from public.attendance_punches p where p.employee_id = p_employee and p.punched_at <@ v_window);
  end if;
  if v_count = 1 and p_date < v_today then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    select v_emp.organization_id, p_employee, 'punch', p.id, 'missing_punch',
           'Only one punch on ' || to_char(p_date, 'DD Mon YYYY') || '. Request a regularization if the other was missed.'
      from public.attendance_punches p where p.employee_id = p_employee and p.punched_at <@ v_window
    on conflict (subject_type, subject_id, rule) do nothing;
  end if;
end $$;

-- ─── Requests: work from home, on duty ──────────────────────────────────────

create function public.request_attendance(p_employee uuid, p_kind public.attendance_request_kind, p_start date, p_end date, p_reason text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp   public.employees;
  v_today date;
  v_id    uuid;
  v_req   uuid;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null or not app.is_member(v_emp.organization_id)
     or not (v_emp.user_id = auth.uid() or v_emp.organization_id in (select app.orgs_with_scope('attendance.manage', 'org'))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_today := app.org_today(v_emp.organization_id);
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a start date and an end date on or after it.' using errcode = '22023';
  end if;
  if p_end - p_start > 30 then
    raise exception 'A request covers at most 31 days.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 90 then
    raise exception 'Requests can cover the last 30 days up to 90 days ahead.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why.' using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_requests where employee_id = p_employee and status in ('pending', 'approved')
              and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'Those dates overlap a request that is pending or approved.' using errcode = '22023';
  end if;
  insert into public.attendance_requests (organization_id, employee_id, kind, start_date, end_date, reason)
  values (v_emp.organization_id, p_employee, p_kind, p_start, p_end, btrim(p_reason))
  returning id into v_id;
  v_req := app.request_approval(v_emp.organization_id, 'attendance_request', v_id, p_employee,
    format('%s: %s %s', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)),
           case p_kind when 'wfh' then 'work from home' else 'on duty' end,
           case when p_start = p_end then to_char(p_start, 'DD Mon YYYY') else to_char(p_start, 'DD Mon') || ' – ' || to_char(p_end, 'DD Mon YYYY') end),
    '/attendance');
  update public.attendance_requests set approval_request_id = v_req where id = v_id;
  return v_id;
end $$;

create function app.on_attendance_request_decided(p_request uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req public.attendance_requests;
begin
  select * into v_req from public.attendance_requests where id = p_request for update;
  if v_req.id is null or v_req.status <> 'pending' then return; end if;
  update public.attendance_requests
     set status = case p_outcome when 'approved' then 'approved' when 'rejected' then 'rejected' else 'cancelled' end::public.leave_status,
         decided_at = now()
   where id = p_request;
  if p_outcome = 'approved' then
    perform app.compute_attendance_day(v_req.employee_id, d::date)
       from generate_series(v_req.start_date, least(v_req.end_date, app.org_today(v_req.organization_id)), interval '1 day') d;
  end if;
end $$;

insert into app.approval_handlers (subject_type, handler) values ('attendance_request', 'app.on_attendance_request_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label)
values ('attendance_request', 1, 'reporting_manager', 'attendance.approve', 'Reporting manager');
-- Existing organizations get the flow too (new ones get it from the templates).
select app.seed_org_flows(o.id, 'attendance_request') from public.organizations o;

-- ─── Overtime and comp-off decisions ────────────────────────────────────────

create function public.decide_overtime(p_employee uuid, p_date date, p_approve boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rec public.overtime_records;
begin
  select * into v_rec from public.overtime_records where employee_id = p_employee and work_date = p_date for update;
  if v_rec.employee_id is null
     or not (v_rec.organization_id in (select app.orgs_with_scope('attendance.manage', 'org'))
             or v_rec.organization_id in (select app.orgs_with_scope('attendance.approve', 'org'))
             or p_employee in (select app.employees_in_scope('attendance.approve'))
             or app.is_in_reporting_line(v_rec.organization_id, p_employee))
     or app.is_own_employee(p_employee) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_rec.status <> 'pending' then
    raise exception 'This overtime has already been decided.' using errcode = '22023';
  end if;
  update public.overtime_records set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
   where employee_id = p_employee and work_date = p_date;
end $$;

create function public.revert_comp_off(p_employee uuid, p_date date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rec public.comp_off_credits;
begin
  select * into v_rec from public.comp_off_credits where employee_id = p_employee and work_date = p_date for update;
  if v_rec.employee_id is null or v_rec.organization_id not in (select app.orgs_with_scope('attendance.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_rec.status = 'reverted' then return; end if;
  update public.comp_off_credits set status = 'reverted', reverted_by = auth.uid(), reverted_at = now()
   where employee_id = p_employee and work_date = p_date;
  insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
  values (v_rec.organization_id, p_employee, v_rec.leave_type_id, app.org_today(v_rec.organization_id), 'reversal', -v_rec.days,
          'Comp-off for ' || to_char(p_date, 'DD Mon YYYY') || ' reverted', 'compoff-revert:' || p_employee || ':' || p_date)
  on conflict (idempotency_key) do nothing;
end $$;

-- ─── Penalties ──────────────────────────────────────────────────────────────

-- Late marks beyond the rule's allowance in a month become loss-of-pay days. Re-running a month updates the
-- figures; a reverted penalty stays reverted.
create function app.compute_attendance_penalties(p_org uuid, p_month date) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_n     integer := 0;
  r       record;
begin
  for r in
    select d.employee_id, count(*)::int as lates, s.late_marks_allowed, s.late_penalty_days
      from public.attendance_days d join public.shifts s on s.id = d.shift_id
     where d.organization_id = p_org and d.work_date between v_month and v_end
       and d.late_minutes > 0 and d.status in ('present', 'half_day') and s.late_marks_allowed is not null
     group by d.employee_id, s.late_marks_allowed, s.late_penalty_days
    having count(*) > s.late_marks_allowed
  loop
    insert into public.attendance_penalties (organization_id, employee_id, cycle_month, kind, occurrences, days, detail, applied_by)
    values (p_org, r.employee_id, v_month, 'late_marks', r.lates - r.late_marks_allowed, (r.lates - r.late_marks_allowed) * r.late_penalty_days,
            format('%s late marks; %s allowed', r.lates, r.late_marks_allowed), auth.uid())
    on conflict (employee_id, cycle_month, kind) do update
       set occurrences = excluded.occurrences, days = excluded.days, detail = excluded.detail, applied_at = now(), applied_by = excluded.applied_by
     where public.attendance_penalties.reverted_at is null;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function public.run_attendance_penalties(p_org uuid, p_month date) returns integer
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_org not in (select app.orgs_with_scope('attendance.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_month is null or p_month > app.org_today(p_org) then
    raise exception 'Choose a month that has started.' using errcode = '22023';
  end if;
  return app.compute_attendance_penalties(p_org, p_month);
end $$;

create function public.revert_attendance_penalty(p_penalty uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rec public.attendance_penalties;
begin
  select * into v_rec from public.attendance_penalties where id = p_penalty for update;
  if v_rec.id is null or v_rec.organization_id not in (select app.orgs_with_scope('attendance.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.attendance_penalties set reverted_at = now(), reverted_by = auth.uid() where id = p_penalty and reverted_at is null;
end $$;

-- Worker: last month's penalties for every organization, on the first days of a month.
create function public.worker_attendance_penalties() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer := 0;
  o   record;
begin
  for o in select id from public.organizations where status = 'active' loop
    v_n := v_n + app.compute_attendance_penalties(o.id, (date_trunc('month', app.org_today(o.id)) - interval '1 month')::date);
  end loop;
  return jsonb_build_object('penalties', v_n);
end $$;

-- ─── Payroll: penalties reduce payable days ─────────────────────────────────

create or replace function public.payroll_run_inputs(p_run uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base jsonb;
  v_run  public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_base := app.payroll_run_inputs_base(p_run);
  return jsonb_set(v_base, '{employees}', coalesce((
    select jsonb_agg(
             e || jsonb_build_object(
               'reimbursements', coalesce((select sum(c.total) from public.expense_claims c
                                            where c.employee_id = (e ->> 'employeeId')::uuid and c.status = 'approved'), 0),
               'reimbursementClaims', coalesce((select jsonb_agg(c.id order by c.id) from public.expense_claims c
                                                 where c.employee_id = (e ->> 'employeeId')::uuid and c.status = 'approved'), '[]'::jsonb),
               'adjustments', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'kind', a.kind,
                                                                            'amount', a.amount, 'taxable', a.taxable) order by a.created_at, a.id)
                                          from public.payroll_adjustments a
                                         where a.employee_id = (e ->> 'employeeId')::uuid and a.applied_run_id is null), '[]'::jsonb),
               'adjustmentIds', coalesce((select jsonb_agg(a.id order by a.created_at, a.id) from public.payroll_adjustments a
                                           where a.employee_id = (e ->> 'employeeId')::uuid and a.applied_run_id is null), '[]'::jsonb),
               'penaltyDays', p.days,
               'payableDays', greatest(0, (e ->> 'payableDays')::numeric - p.days))
             order by e ->> 'employeeCode')
      from jsonb_array_elements(v_base -> 'employees') e
      cross join lateral (
        select coalesce(sum(ap.days), 0) as days from public.attendance_penalties ap
         where ap.employee_id = (e ->> 'employeeId')::uuid and ap.cycle_month = v_run.period_month and ap.reverted_at is null) p), '[]'::jsonb));
end $$;

-- ─── Overview figures (security invoker: RLS decides whose days are counted) ──

-- One day: counts by status, late arrivals, first check-ins by local hour, and presence by location.
create function public.attendance_day_summary(p_org uuid, p_date date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with d as (
    select a.status, a.late_minutes, a.first_in, e.location_id
      from public.attendance_days a join public.employees e on e.id = a.employee_id
     where a.organization_id = p_org and a.work_date = p_date)
  select jsonb_build_object(
    'byStatus', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from d group by status) s),
    'late', (select count(*) from d where late_minutes > 0 and status in ('present', 'half_day')),
    'byHour', (select coalesce(jsonb_object_agg(h, n), '{}'::jsonb) from (
                 select extract(hour from first_in at time zone (select timezone from public.organizations where id = p_org))::int h, count(*) n
                   from d where first_in is not null group by 1) x),
    'byLocation', (select coalesce(jsonb_agg(jsonb_build_object('locationId', location_id, 'present', present, 'total', total)), '[]'::jsonb) from (
                 select location_id, count(*) filter (where status in ('present', 'half_day', 'on_duty')) present, count(*) total
                   from d group by location_id) y));
$$;

-- A period: daily presence, punctuality by department, the late-arrival heatmap and totals.
create function public.attendance_analytics(p_org uuid, p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with d as (
    select a.work_date, a.status, a.late_minutes, a.worked_minutes, a.overtime_minutes, e.department_id
      from public.attendance_days a join public.employees e on e.id = a.employee_id
     where a.organization_id = p_org and a.work_date between p_from and p_to and p_to - p_from <= 120)
  select jsonb_build_object(
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', work_date, 'present', present, 'expected', expected) order by work_date), '[]'::jsonb) from (
                select work_date, count(*) filter (where status in ('present', 'half_day', 'wfh', 'on_duty')) present,
                       count(*) filter (where status not in ('weekly_off', 'holiday')) expected
                  from d group by work_date) x),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('departmentId', department_id, 'onTime', on_time, 'worked', worked) order by worked desc), '[]'::jsonb) from (
                select department_id, count(*) filter (where status in ('present', 'half_day') and late_minutes = 0) on_time,
                       count(*) filter (where status in ('present', 'half_day')) worked
                  from d group by department_id) y),
    'heatmap', (select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'dow', dow, 'late', late)), '[]'::jsonb) from (
                select to_char(date_trunc('week', work_date), 'YYYY-MM-DD') wk, extract(isodow from work_date)::int dow,
                       count(*) filter (where late_minutes > 0) late
                  from d group by 1, 2) z),
    'avgWorkedMinutes', (select coalesce(round(avg(worked_minutes) filter (where worked_minutes > 0)), 0) from d),
    'overtimeMinutes', (select coalesce(sum(overtime_minutes), 0) from d),
    'lateDays', (select count(*) from d where late_minutes > 0 and status in ('present', 'half_day')),
    'presentDays', (select count(*) from d where status in ('present', 'half_day', 'wfh', 'on_duty')));
$$;

-- ─── Seeding: work-week templates and settings ──────────────────────────────

create function app.seed_org_attendance_operations(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.work_week_rules (organization_id, name, description, pattern) values
    (p_org, 'Saturday and Sunday off', 'Five working days; Saturday and Sunday off every week.', array['WWWWWOO','WWWWWOO','WWWWWOO','WWWWWOO','WWWWWOO']),
    (p_org, 'Sunday off', 'Six working days; Sunday off.', array['WWWWWWO','WWWWWWO','WWWWWWO','WWWWWWO','WWWWWWO']),
    (p_org, 'Second and fourth Saturday off', 'Sunday off; the 2nd and 4th Saturdays off too.', array['WWWWWWO','WWWWWOO','WWWWWWO','WWWWWOO','WWWWWWO']),
    (p_org, 'Saturday half day', 'Saturday is a half working day; Sunday off.', array['WWWWWHO','WWWWWHO','WWWWWHO','WWWWWHO','WWWWWHO'])
  on conflict (organization_id, name) do nothing;
  insert into public.attendance_settings (organization_id) values (p_org) on conflict do nothing;
$$;

create function app.seed_org_attendance_operations_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_attendance_operations(new.id);
  return new;
end $$;
create trigger organizations_seed_attendance_operations after insert on public.organizations
  for each row execute function app.seed_org_attendance_operations_trigger();

select app.seed_org_attendance_operations(id) from public.organizations;

-- ─── Function grants ────────────────────────────────────────────────────────

revoke all on function app.valid_week_pattern(text[]) from public;
revoke all on function app.work_week_for(uuid, date) from public, anon, authenticated;
revoke all on function app.on_attendance_request_decided(uuid, text) from public, anon, authenticated;
revoke all on function app.compute_attendance_penalties(uuid, date) from public, anon, authenticated;
revoke all on function app.seed_org_attendance_operations(uuid) from public, anon, authenticated;
revoke all on function app.seed_org_attendance_operations_trigger() from public, anon, authenticated;
grant execute on function app.valid_week_pattern(text[]) to authenticated, service_role;
grant execute on function app.work_week_for(uuid, date) to service_role;
grant execute on function app.compute_attendance_penalties(uuid, date) to service_role;

revoke all on function public.request_attendance(uuid, public.attendance_request_kind, date, date, text) from public, anon;
revoke all on function public.decide_overtime(uuid, date, boolean) from public, anon;
revoke all on function public.revert_comp_off(uuid, date) from public, anon;
revoke all on function public.run_attendance_penalties(uuid, date) from public, anon;
revoke all on function public.revert_attendance_penalty(uuid) from public, anon;
revoke all on function public.worker_attendance_penalties() from public, anon, authenticated;
grant execute on function public.request_attendance(uuid, public.attendance_request_kind, date, date, text) to authenticated, service_role;
grant execute on function public.decide_overtime(uuid, date, boolean) to authenticated, service_role;
grant execute on function public.revert_comp_off(uuid, date) to authenticated, service_role;
grant execute on function public.run_attendance_penalties(uuid, date) to authenticated, service_role;
grant execute on function public.revert_attendance_penalty(uuid) to authenticated, service_role;
grant execute on function public.worker_attendance_penalties() to service_role;
revoke all on function public.attendance_day_summary(uuid, date) from public, anon;
revoke all on function public.attendance_analytics(uuid, date, date) from public, anon;
grant execute on function public.attendance_day_summary(uuid, date) to authenticated, service_role;
grant execute on function public.attendance_analytics(uuid, date, date) to authenticated, service_role;
