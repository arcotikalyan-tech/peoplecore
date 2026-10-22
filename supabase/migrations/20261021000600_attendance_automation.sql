-- PeopleCore · Kredily second pass, batch 2: attendance rules and automation (docs/12-kredily-gap-list.md).
--
-- * Rules: an effective date (people assigned to a rule follow it from that date; before it the default rule applies),
--   automatic clock-in at the shift start and clock-out at its end on working days, comp-off that waits for approval
--   unless the rule approves it automatically, and automatic deduction at the end of each attendance cycle.
-- * Penalties per rule, behind a master switch: late coming, early leaving and short hours, each with an allowance per
--   cycle, an interval (one deduction for every N further anomalies) and a method: a full day, half a day, or hourly
--   (the minutes, pro rata to a full day). Short hours can instead make the day a half day by its duration, which is
--   what always happened and stays the default. Under full- and half-day methods a day already counted by a higher
--   rule (late, then early, then short) isn't counted again; hourly rules count every day they apply to. A deduction
--   comes out of up to two paid leave types first, while they have a balance, and the rest is loss of pay.
-- * The attendance cycle (Settings) and payroll's attendance and leave input cycle are one setting from now on: changing
--   either changes both. Organizations keep payroll's value, so no pay changes.
-- * Automatic deduction: in the three days after a cycle ends (from 6 am), rules with it on get their penalties applied
--   and absent days deducted from salary. A payroll run that also counts absences as loss of pay doesn't count the
--   days deducted this way again.
-- * Zones: a geofence can be a circle, a rectangle or a polygon; check-ins are judged against the shape, and attendance
--   admins can test a point against a location's zones.
-- * Comp-off: optionally, HR hears when someone earns comp-off and employees when theirs is credited; pending comp-off
--   is approved or rejected in bulk, and so is overtime.
-- * Regularization: how many days back employees may ask (1–90, 60 by default), an optional monthly cap, and asking for
--   several days at once. Attendance admins can go back 90 days.
-- * Reminders: a daily attendance summary for attendance admins (yesterday's, at 9 am) and late / early punch reminders
--   for employees (11 am), in the organization's time.
-- * Saved views (named filters people keep for a page) and bulk revert of penalties.

-- ─── Rules ──────────────────────────────────────────────────────────────────

alter table public.shifts
  add column effective_from         date,
  add column auto_clock_in          boolean not null default false,
  add column auto_clock_out         boolean not null default false,
  add column deduct_absent          boolean not null default false,
  add column comp_off_auto_approve  boolean not null default true,
  add column penalties_enabled      boolean not null default false,
  add column late_interval          smallint not null default 1 check (late_interval between 1 and 31),
  add column late_method            text not null default 'half_day' check (late_method in ('full_day', 'half_day', 'hourly')),
  add column early_marks_allowed    smallint check (early_marks_allowed between 0 and 31),          -- null: no early-leaving penalty
  add column early_interval         smallint not null default 1 check (early_interval between 1 and 31),
  add column early_method           text not null default 'half_day' check (early_method in ('full_day', 'half_day', 'hourly')),
  add column short_marks_allowed    smallint check (short_marks_allowed between 0 and 31),          -- null: no short-hours penalty
  add column short_interval         smallint not null default 1 check (short_interval between 1 and 31),
  add column short_method           text not null default 'half_day_by_duration'
                                    check (short_method in ('full_day', 'half_day', 'hourly', 'half_day_by_duration')),
  add column penalty_leave_order    uuid[] not null default '{}' check (cardinality(penalty_leave_order) <= 2);

-- Rules that had a late-mark allowance keep their penalty (the master switch is new); its size becomes the method.
update public.shifts set penalties_enabled = true, late_method = case when late_penalty_days = 1 then 'full_day' else 'half_day' end
 where late_marks_allowed is not null;

-- Penalties come out of the organization's own paid leave types, each named once.
create function app.check_penalty_leave_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.penalty_leave_order) > 0 and (
       cardinality(new.penalty_leave_order) <> (select count(distinct x) from unnest(new.penalty_leave_order) x)
       or cardinality(new.penalty_leave_order) <> (select count(*) from public.leave_types t
                                                    where t.organization_id = new.organization_id and t.id = any (new.penalty_leave_order) and t.is_paid)) then
    raise exception 'Deduct penalties from paid leave types of your own, each once.' using errcode = '23503';
  end if;
  return new;
end $$;
revoke all on function app.check_penalty_leave_order() from public;
create trigger shifts_penalty_leave_order before insert or update of penalty_leave_order on public.shifts
  for each row execute function app.check_penalty_leave_order();

-- The shift for a day: an explicit assignment (once its rule is in effect), else the rotation's shift, else the default.
create or replace function app.shift_for(p_employee uuid, p_date date) returns public.shifts
language sql stable security definer set search_path = '' as $$
  select s.* from public.shifts s
   where s.id = coalesce(
     (select r.shift_id from public.roster_assignments r join public.shifts rs on rs.id = r.shift_id
       where r.employee_id = p_employee and r.effective_from <= p_date and (r.effective_to is null or r.effective_to >= p_date)
         and (rs.effective_from is null or rs.effective_from <= p_date)
       order by r.effective_from desc limit 1),
     (select ro.pattern[1 + (((p_date - ro.start_date) / ro.period_days) % cardinality(ro.pattern) + cardinality(ro.pattern)) % cardinality(ro.pattern)]
        from public.rotation_assignments ra join public.shift_rotations ro on ro.id = ra.rotation_id
       where ra.employee_id = p_employee and ra.effective_from <= p_date and (ra.effective_to is null or ra.effective_to >= p_date)
       order by ra.effective_from desc limit 1),
     (select d.id from public.shifts d join public.employees e on e.organization_id = d.organization_id
       where e.id = p_employee and d.is_default));
$$;

-- The rule someone follows on a day, for the people who may see their attendance ("My rule").
create function public.attendance_rule_for(p_employee uuid, p_date date) returns setof public.shifts
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.employee_org_or_deny(p_employee, 'attendance.read');
  return query select s.* from app.shift_for(p_employee, p_date) s where s.id is not null;
end $$;
revoke all on function public.attendance_rule_for(uuid, date) from public, anon;
grant execute on function public.attendance_rule_for(uuid, date) to authenticated, service_role;

-- ─── Settings ───────────────────────────────────────────────────────────────

alter table public.attendance_settings
  add column last_deduction_cycle     date,
  add column comp_off_notify_hr       boolean not null default false,
  add column comp_off_notify_employee boolean not null default false,
  add column daily_summary            boolean not null default false,
  add column last_daily_summary       date,
  add column punch_reminders          boolean not null default false,
  add column last_punch_reminder      date,
  add column regularize_days_back     smallint not null default 60 check (regularize_days_back between 1 and 90),
  add column regularize_monthly_limit smallint check (regularize_monthly_limit between 1 and 31);  -- null: no cap

-- One cycle: the attendance cycle and payroll's attendance and leave input cycle follow each other.
update public.attendance_settings a set cycle_start_day = p.input_cycle_start_day
  from public.payroll_settings p where p.organization_id = a.organization_id and a.cycle_start_day <> p.input_cycle_start_day;

create function app.sync_cycle_start() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'attendance_settings' then
    update public.payroll_settings set input_cycle_start_day = new.cycle_start_day
     where organization_id = new.organization_id and input_cycle_start_day is distinct from new.cycle_start_day;
  else
    update public.attendance_settings set cycle_start_day = new.input_cycle_start_day
     where organization_id = new.organization_id and cycle_start_day is distinct from new.input_cycle_start_day;
  end if;
  return null;
end $$;
revoke all on function app.sync_cycle_start() from public;
create trigger attendance_settings_sync_cycle after update of cycle_start_day on public.attendance_settings
  for each row when (old.cycle_start_day is distinct from new.cycle_start_day) execute function app.sync_cycle_start();
create trigger payroll_settings_sync_cycle after update of input_cycle_start_day on public.payroll_settings
  for each row when (old.input_cycle_start_day is distinct from new.input_cycle_start_day) execute function app.sync_cycle_start();

-- A cycle is named by the month it ends in (the payroll month): starting on day N > 1, the October cycle runs from
-- N September to N-1 October.
create function app.attendance_cycle_month(p_org uuid, p_date date) returns date
language sql stable security definer set search_path = '' as $$
  select case when n = 1 or extract(day from p_date) < n then date_trunc('month', p_date)::date
              else (date_trunc('month', p_date) + interval '1 month')::date end
    from (select coalesce((select cycle_start_day from public.attendance_settings where organization_id = p_org), 1)::int as n) s;
$$;

create function app.attendance_cycle_bounds(p_org uuid, p_month date, out cycle_from date, out cycle_to date)
language sql stable security definer set search_path = '' as $$
  select case when n = 1 then m else (m - interval '1 month')::date + n - 1 end,
         case when n = 1 then (m + interval '1 month - 1 day')::date else m + n - 2 end
    from (select date_trunc('month', p_month)::date as m,
                 coalesce((select cycle_start_day from public.attendance_settings where organization_id = p_org), 1)::int as n) s;
$$;
revoke all on function app.attendance_cycle_month(uuid, date) from public;
revoke all on function app.attendance_cycle_bounds(uuid, date) from public;

-- ─── Days ───────────────────────────────────────────────────────────────────

-- The minutes the day asks for (a full day, half on half working days and half-day leave, none when off).
alter table public.attendance_days add column expected_minutes integer not null default 0;

alter table public.comp_off_credits drop constraint comp_off_credits_status_check;
alter table public.comp_off_credits
  add constraint comp_off_credits_status_check check (status in ('pending', 'credited', 'rejected', 'reverted')),
  add column decided_by uuid,
  add column decided_at timestamptz;

-- Who hears about comp-off: the employee when it's credited, rejected or waiting; HR when it's earned (both optional).
create function app.notify_comp_off(p_employee uuid, p_date date, p_days numeric, p_event text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp    public.employees;
  v_set    public.attendance_settings;
  v_amount text := case when p_days = 1 then '1 day' else 'half a day' end;
  v_when   text := to_char(p_date, 'FMDD Mon');
begin
  select * into v_emp from public.employees where id = p_employee;
  select * into v_set from public.attendance_settings where organization_id = v_emp.organization_id;
  if coalesce(v_set.comp_off_notify_employee, false) and v_emp.user_id is not null then
    perform app.notify(v_emp.organization_id, v_emp.user_id, 'attendance.comp_off',
      case p_event when 'pending' then format('Comp-off for working on %s (%s) is waiting for approval', v_when, v_amount)
                   when 'rejected' then format('Comp-off for working on %s wasn’t approved', v_when)
                   else format('Comp-off credited: %s for working on %s', v_amount, v_when) end,
      case when p_event in ('credited', 'approved') then 'It’s in your comp-off balance, ready to apply for.' end, '/leave');
  end if;
  if coalesce(v_set.comp_off_notify_hr, false) and p_event in ('credited', 'pending') then
    perform app.notify_permission_holders(v_emp.organization_id, 'attendance.manage', 'attendance.comp_off',
      format('%s worked on %s and earned %s of comp-off%s', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)), v_when, v_amount,
             case when p_event = 'pending' then ' to approve' else '' end),
      '/attendance?tab=logs&view=compoff', v_emp.user_id);
  end if;
end $$;
revoke all on function app.notify_comp_off(uuid, date, numeric, text) from public;

-- The day, recomputed: as before, plus the minutes the day asks for, short days that stay present under a short-hours
-- penalty, and comp-off that waits for approval when the rule says so.
create or replace function app.compute_attendance_day(p_employee uuid, p_date date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp       public.employees;
  v_tz        text;
  v_today     date;
  v_open      boolean;
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
  v_comp_ok   boolean;
  v_short_pen boolean;
  v_expected  int;
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
  v_short_pen := coalesce(v_shift.penalties_enabled, false) and v_shift.short_marks_allowed is not null
                 and coalesce(v_shift.short_method, 'half_day_by_duration') <> 'half_day_by_duration';
  v_start := ((p_date + coalesce(v_shift.start_time, '09:00'::time))::timestamp at time zone v_tz);
  v_end := ((p_date + coalesce(v_shift.end_time, '18:00'::time))::timestamp at time zone v_tz);
  if v_end <= v_start then v_end := v_end + interval '1 day'; end if;
  -- A work day collects punches from 4 hours before the shift start to 20 hours after it (night shifts).
  v_window := tstzrange(v_start - interval '4 hours', v_start + interval '20 hours', '[)');
  v_open := now() < upper(v_window);
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
    when v_open and v_count % 2 = 1 then 'present'  -- checked in, not out yet
    when v_halfwork and v_worked >= v_half then 'present'
    -- Under a short-hours penalty a short day stays present; the penalty deducts for it beyond the allowance.
    when v_short_pen and v_leave = 0 and v_worked >= v_half then 'present'
    when v_worked >= v_half or (v_leave = 0.5 and v_count >= 1) then 'half_day'
    when v_leave = 0.5 then 'half_day'
    when p_date = v_today or v_open then 'not_marked'
    else 'absent'
  end;
  v_expected := case when v_leave = 1 or v_holiday or v_off then 0 when v_halfwork or v_leave = 0.5 then v_half else v_full end;

  if v_shift.overtime_after_minutes is not null and v_worked > v_full + v_shift.overtime_after_minutes then
    v_ot := v_worked - v_full;
  end if;

  insert into public.attendance_days (organization_id, employee_id, work_date, shift_id, status, first_in, last_out, worked_minutes,
                                      late_minutes, early_out_minutes, overtime_minutes, punch_count, leave_days, leave_paid,
                                      is_regularized, expected_minutes, computed_at)
  values (v_emp.organization_id, p_employee, p_date, v_shift.id, v_status, v_first, case when v_count >= 2 then v_last end,
          v_worked, v_late, v_early, v_ot, v_count, v_leave, v_paid, coalesce(v_reg, false), v_expected, now())
  on conflict (employee_id, work_date) do update set
    shift_id = excluded.shift_id, status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
    worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes, early_out_minutes = excluded.early_out_minutes,
    overtime_minutes = excluded.overtime_minutes, punch_count = excluded.punch_count, leave_days = excluded.leave_days,
    leave_paid = excluded.leave_paid, is_regularized = excluded.is_regularized, expected_minutes = excluded.expected_minutes,
    computed_at = excluded.computed_at;

  -- Overtime waits for a decision; a decided record keeps its decision.
  if v_ot > 0 then
    insert into public.overtime_records (organization_id, employee_id, work_date, minutes)
    values (v_emp.organization_id, p_employee, p_date, v_ot)
    on conflict (employee_id, work_date) do update set minutes = excluded.minutes where public.overtime_records.status = 'pending';
  else
    delete from public.overtime_records where employee_id = p_employee and work_date = p_date and status = 'pending';
  end if;

  -- Work on an off day or holiday earns comp-off once (half a day below a full day's work): credited straight away, or
  -- waiting for approval when the rule doesn't approve it automatically.
  if v_shift.comp_off_min_minutes is not null and (v_off or v_holiday) and v_worked >= v_shift.comp_off_min_minutes then
    -- The comp-off leave type is created the first time an organization's rule earns one.
    insert into public.leave_types (organization_id, code, name, is_paid) values (v_emp.organization_id, 'COMP_OFF', 'Comp off', true)
    on conflict do nothing;
    select id into v_comp_type from public.leave_types where organization_id = v_emp.organization_id and code = 'COMP_OFF' and is_active;
    if v_comp_type is not null then
      v_comp_days := case when v_worked >= v_full then 1 else 0.5 end;
      v_comp_ok := coalesce(v_shift.comp_off_auto_approve, true);
      insert into public.comp_off_credits (organization_id, employee_id, work_date, days, leave_type_id, status)
      values (v_emp.organization_id, p_employee, p_date, v_comp_days, v_comp_type, case when v_comp_ok then 'credited' else 'pending' end)
      on conflict (employee_id, work_date) do nothing;
      if found then
        if v_comp_ok then
          insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key, created_by)
          values (v_emp.organization_id, p_employee, v_comp_type, p_date, 'accrual', v_comp_days,
                  'Comp-off for work on ' || to_char(p_date, 'DD Mon YYYY'), 'compoff:' || p_employee || ':' || p_date, null)
          on conflict (idempotency_key) do nothing;
        end if;
        perform app.notify_comp_off(p_employee, p_date, v_comp_days, case when v_comp_ok then 'credited' else 'pending' end);
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
  if v_count = 1 and p_date < v_today and not v_open then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    select v_emp.organization_id, p_employee, 'punch', p.id, 'missing_punch',
           'Only one punch on ' || to_char(p_date, 'DD Mon YYYY') || '. Request a regularization if the other was missed.'
      from public.attendance_punches p where p.employee_id = p_employee and p.punched_at <@ v_window
    on conflict (subject_type, subject_id, rule) do nothing;
  end if;
end $$;

-- ─── Penalties ──────────────────────────────────────────────────────────────

-- days is the loss of pay (what payroll deducts); total_days the penalty before leave took its part; leave_split what
-- came out of which leave type; version counts re-applications (it keys the ledger entries).
alter table public.attendance_penalties drop constraint attendance_penalties_kind_check;
alter table public.attendance_penalties drop constraint attendance_penalties_days_check;
alter table public.attendance_penalties alter column days type numeric(6,2);
alter table public.attendance_penalties
  add constraint attendance_penalties_kind_check check (kind in ('late_marks', 'early_exits', 'short_hours', 'absent')),
  add constraint attendance_penalties_days_check check (days >= 0),
  add column method      text check (method in ('full_day', 'half_day', 'hourly')),
  add column total_days  numeric(6,2),
  add column leave_split jsonb not null default '[]'::jsonb check (jsonb_typeof(leave_split) = 'array'),
  add column ladder      uuid[] not null default '{}',
  add column version     integer not null default 0;
update public.attendance_penalties set total_days = days, version = 1,
       method = case when days >= occurrences then 'full_day' else 'half_day' end;
alter table public.attendance_penalties
  alter column total_days set not null,
  add constraint attendance_penalties_total_check check (total_days >= days);

-- Gives back the leave a penalty took (it stays on record in the ledger).
create function app.undo_penalty_leave(p_penalty uuid, p_why text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pen public.attendance_penalties;
  v_x   jsonb;
begin
  select * into v_pen from public.attendance_penalties where id = p_penalty;
  for v_x in select * from jsonb_array_elements(v_pen.leave_split) loop
    insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key, created_by)
    values (v_pen.organization_id, v_pen.employee_id, (v_x ->> 'leaveTypeId')::uuid, app.org_today(v_pen.organization_id), 'penalty',
            (v_x ->> 'days')::numeric, 'Attendance penalty ' || p_why || ', ' || to_char(v_pen.cycle_month, 'Mon YYYY'),
            'attpen-undo:' || p_penalty || ':' || v_pen.version || ':' || (v_x ->> 'leaveTypeId'), auth.uid())
    on conflict (idempotency_key) do nothing;
  end loop;
  update public.attendance_penalties set leave_split = '[]'::jsonb where id = p_penalty;
end $$;

-- Takes a penalty of p_total days: from the leave types in order while they have a balance, the rest as loss of pay.
-- A penalty whose total and leave order haven't changed is left as it is.
create function app.apply_penalty_deduction(p_penalty uuid, p_total numeric, p_ladder uuid[], p_entry date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pen   public.attendance_penalties;
  v_type  uuid;
  v_left  numeric := p_total;
  v_avail numeric;
  v_take  numeric;
  v_split jsonb := '[]'::jsonb;
  v_ver   integer;
begin
  select * into v_pen from public.attendance_penalties where id = p_penalty for update;
  if v_pen.id is null or v_pen.reverted_at is not null then return; end if;
  if v_pen.version > 0 and v_pen.total_days = p_total and v_pen.ladder = coalesce(p_ladder, '{}') then return; end if;
  perform app.undo_penalty_leave(p_penalty, 'recalculated');
  v_ver := v_pen.version + 1;
  foreach v_type in array coalesce(p_ladder, '{}') loop
    exit when v_left <= 0;
    select coalesce((select sum(l.days) from public.leave_ledger l where l.employee_id = v_pen.employee_id and l.leave_type_id = v_type), 0)
           - coalesce((select sum(r.days) from public.leave_requests r
                        where r.employee_id = v_pen.employee_id and r.leave_type_id = v_type and r.status = 'pending'), 0)
      into v_avail;
    v_take := least(v_left, greatest(0, v_avail));
    if v_take > 0 then
      insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key, created_by)
      values (v_pen.organization_id, v_pen.employee_id, v_type, p_entry, 'penalty', -v_take,
              'Attendance penalty, ' || to_char(v_pen.cycle_month, 'Mon YYYY') || ': ' || coalesce(v_pen.detail, v_pen.kind),
              'attpen:' || p_penalty || ':' || v_ver || ':' || v_type, auth.uid());
      v_split := v_split || jsonb_build_array(jsonb_build_object('leaveTypeId', v_type, 'days', v_take));
      v_left := v_left - v_take;
    end if;
  end loop;
  update public.attendance_penalties
     set total_days = p_total, days = v_left, leave_split = v_split, ladder = coalesce(p_ladder, '{}'), version = v_ver
   where id = p_penalty;
end $$;

-- Records one kind of penalty for an employee's cycle, or brings an earlier one up to date (a total of zero clears
-- it). A penalty HR reverted stays reverted. Returns whether a penalty applies.
create function app.record_attendance_penalty(p_employee uuid, p_org uuid, p_month date, p_kind text, p_occurrences integer,
                                              p_total numeric, p_method text, p_detail text, p_ladder uuid[], p_entry date)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(p_total, 0) <= 0
     and not exists (select 1 from public.attendance_penalties where employee_id = p_employee and cycle_month = p_month and kind = p_kind) then
    return false;
  end if;
  insert into public.attendance_penalties (organization_id, employee_id, cycle_month, kind, occurrences, days, total_days, method, detail, applied_by)
  values (p_org, p_employee, p_month, p_kind, greatest(coalesce(p_occurrences, 0), 1), 0, 0, p_method, left(p_detail, 300), auth.uid())
  on conflict (employee_id, cycle_month, kind) do update
     set occurrences = excluded.occurrences, method = excluded.method, detail = excluded.detail, applied_at = now(), applied_by = excluded.applied_by
   where public.attendance_penalties.reverted_at is null
  returning id into v_id;
  if v_id is null then return false; end if;
  perform app.apply_penalty_deduction(v_id, greatest(coalesce(p_total, 0), 0), p_ladder, p_entry);
  return coalesce(p_total, 0) > 0;
end $$;

-- One employee's late-coming, early-leaving and short-hours penalties for a cycle, from the days already computed.
-- The rule at the end of the cycle sets the allowances; a day counts only where its own rule has that penalty on.
create function app.employee_attendance_penalties(p_employee uuid, p_org uuid, p_month date, p_from date, p_to date, p_rule public.shifts)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_used  date[] := '{}';
  v_dates date[];
  v_mins  int[];
  v_n     int;
  v_extra int;
  v_total numeric;
  v_hits  int := 0;
  k       record;
begin
  for k in
    select * from (values
      ('late_marks', 1, p_rule.late_marks_allowed, p_rule.late_interval, p_rule.late_method, 'late arrivals'),
      ('early_exits', 2, p_rule.early_marks_allowed, p_rule.early_interval, p_rule.early_method, 'early exits'),
      ('short_hours', 3, p_rule.short_marks_allowed, p_rule.short_interval, p_rule.short_method, 'short days')
    ) x(kind, prio, allowed, step, method, noun)
    order by prio
  loop
    if not p_rule.penalties_enabled or k.allowed is null or k.method = 'half_day_by_duration' then
      perform app.record_attendance_penalty(p_employee, p_org, p_month, k.kind, 0, 0, null, 'No penalty under the rule', p_rule.penalty_leave_order, p_to);
      continue;
    end if;
    select coalesce(array_agg(a.work_date order by a.work_date), '{}'),
           coalesce(array_agg(case k.kind when 'late_marks' then a.late_minutes when 'early_exits' then a.early_out_minutes
                                           else greatest(0, a.expected_minutes - a.worked_minutes) end order by a.work_date), '{}')
      into v_dates, v_mins
      from public.attendance_days a join public.shifts s on s.id = a.shift_id
     where a.employee_id = p_employee and a.work_date between p_from and p_to and s.penalties_enabled
       and (k.method = 'hourly' or not (a.work_date = any (v_used)))
       and case k.kind
             when 'late_marks' then s.late_marks_allowed is not null and a.late_minutes > 0 and a.status in ('present', 'half_day')
             when 'early_exits' then s.early_marks_allowed is not null and a.early_out_minutes > 0 and a.punch_count >= 2
                                     and a.status in ('present', 'half_day')
             else s.short_marks_allowed is not null and s.short_method <> 'half_day_by_duration' and a.status = 'present'
                  and a.punch_count >= 2 and a.leave_days = 0 and a.worked_minutes < a.expected_minutes end;
    v_n := cardinality(v_dates);
    v_extra := greatest(0, v_n - k.allowed);
    v_total := case
      when v_extra = 0 then 0
      when k.method = 'hourly' then round((select coalesce(sum(m), 0) from unnest(v_mins[k.allowed + 1 : v_n]) m)::numeric / p_rule.full_day_minutes, 2)
      when k.method = 'full_day' then floor(v_extra::numeric / k.step)
      else floor(v_extra::numeric / k.step) * 0.5 end;
    -- Under full- and half-day methods a day counted here isn't counted again by a lower rule.
    if k.method <> 'hourly' then v_used := v_used || v_dates; end if;
    if app.record_attendance_penalty(p_employee, p_org, p_month, k.kind, v_extra, v_total, k.method,
         format('%s %s, %s allowed%s', v_n, k.noun, k.allowed,
                case k.method when 'hourly' then '; then the time, pro rata'
                              when 'full_day' then format('; then a full day for every %s more', k.step)
                              else format('; then half a day for every %s more', k.step) end),
         p_rule.penalty_leave_order, p_to) then
      v_hits := v_hits + 1;
    end if;
  end loop;
  return v_hits;
end $$;

-- A cycle's penalties for an organization (the days recomputed first). Automatic runs only cover rules with automatic
-- deduction; those rules also deduct absent days (half days without leave count half) from salary.
drop function app.compute_attendance_penalties(uuid, date);
create function app.compute_attendance_penalties(p_org uuid, p_month date, p_auto boolean default false) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_from  date;
  v_to    date;
  v_last  date;
  v_rule  public.shifts;
  v_abs   numeric;
  v_occ   integer;
  v_hits  integer := 0;
  e       record;
  d       date;
begin
  select b.cycle_from, b.cycle_to into v_from, v_to from app.attendance_cycle_bounds(p_org, v_month) b;
  v_last := least(v_to, app.org_today(p_org) - 1);
  if v_last < v_from then return 0; end if;
  for e in select emp.id, emp.date_of_joining from public.employees emp
            where emp.organization_id = p_org and emp.status <> 'pre_joining'
              and emp.date_of_joining <= v_last and (emp.date_of_exit is null or emp.date_of_exit >= v_from) loop
    for d in select generate_series(greatest(v_from, e.date_of_joining), v_last, interval '1 day')::date loop
      perform app.compute_attendance_day(e.id, d);
    end loop;
    select s.* into v_rule from public.attendance_days a join public.shifts s on s.id = a.shift_id
     where a.employee_id = e.id and a.work_date between v_from and v_last order by a.work_date desc limit 1;
    continue when v_rule.id is null or (p_auto and not v_rule.deduct_absent);
    v_hits := v_hits + app.employee_attendance_penalties(e.id, p_org, v_month, v_from, v_last, v_rule);
    if v_rule.deduct_absent then
      select coalesce(sum(case when a.status = 'absent' then 1 else 0.5 end), 0), count(*)
        into v_abs, v_occ
        from public.attendance_days a
       where a.employee_id = e.id and a.work_date between v_from and v_last
         and (a.status = 'absent' or (a.status = 'half_day' and a.leave_days = 0 and coalesce(a.leave_paid, false) = false));
      if app.record_attendance_penalty(e.id, p_org, v_month, 'absent', v_occ, v_abs, 'full_day',
           format('%s absent day%s in the cycle, deducted from salary', trim_scale(v_abs), case when v_abs = 1 then '' else 's' end), '{}', v_last) then
        v_hits := v_hits + 1;
      end if;
    else
      perform app.record_attendance_penalty(e.id, p_org, v_month, 'absent', 0, 0, 'full_day', 'Automatic deduction is off', '{}', v_last);
    end if;
  end loop;
  return v_hits;
end $$;

create or replace function public.run_attendance_penalties(p_org uuid, p_month date) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_from date;
begin
  if p_org not in (select app.orgs_with_scope('attendance.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_month is null then
    raise exception 'Choose a month that has started.' using errcode = '22023';
  end if;
  select b.cycle_from into v_from from app.attendance_cycle_bounds(p_org, p_month) b;
  if v_from >= app.org_today(p_org) then
    raise exception 'Choose a month that has started.' using errcode = '22023';
  end if;
  return app.compute_attendance_penalties(p_org, p_month, false);
end $$;

create or replace function public.revert_attendance_penalty(p_penalty uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rec public.attendance_penalties;
begin
  select * into v_rec from public.attendance_penalties where id = p_penalty for update;
  if v_rec.id is null or v_rec.organization_id not in (select app.orgs_with_scope('attendance.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_rec.reverted_at is not null then return; end if;
  perform app.undo_penalty_leave(p_penalty, 'reverted');
  update public.attendance_penalties set reverted_at = now(), reverted_by = auth.uid() where id = p_penalty;
end $$;

create function public.revert_attendance_penalties(p_ids uuid[]) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  if coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'Choose up to 500 at a time.' using errcode = '22023';
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    if exists (select 1 from public.attendance_penalties where id = v_id and reverted_at is null) then
      perform public.revert_attendance_penalty(v_id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- The old monthly job (never scheduled) gives way to automatic deduction.
drop function public.worker_attendance_penalties();

-- Automatic deduction: in the three days after a cycle ends, from 6 am local time, once per cycle.
create function public.worker_attendance_deductions(p_now timestamptz default now()) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  o       record;
  v_local timestamp;
  v_cycle date;
  v_to    date;
  v_n     integer;
  v_orgs  integer := 0;
  v_pens  integer := 0;
begin
  for o in select org.id, org.timezone, s.last_deduction_cycle
             from public.organizations org join public.attendance_settings s on s.organization_id = org.id
            where org.status = 'active' and exists (select 1 from public.shifts sh where sh.organization_id = org.id and sh.deduct_absent) loop
    v_local := p_now at time zone o.timezone;
    v_cycle := (app.attendance_cycle_month(o.id, v_local::date) - interval '1 month')::date;
    select b.cycle_to into v_to from app.attendance_cycle_bounds(o.id, v_cycle) b;
    continue when extract(hour from v_local) < 6 or v_local::date - v_to > 3 or o.last_deduction_cycle >= v_cycle;
    v_n := app.compute_attendance_penalties(o.id, v_cycle, true);
    update public.attendance_settings set last_deduction_cycle = v_cycle where organization_id = o.id;
    perform app.notify_permission_holders(o.id, 'attendance.manage', 'attendance.deductions',
      format('Attendance deductions applied for the %s cycle: %s penalt%s', to_char(v_cycle, 'FMMonth YYYY'), v_n, case when v_n = 1 then 'y' else 'ies' end),
      '/attendance?tab=logs&view=penalty&month=' || to_char(v_cycle, 'YYYY-MM'));
    v_orgs := v_orgs + 1;
    v_pens := v_pens + v_n;
  end loop;
  return jsonb_build_object('organizations', v_orgs, 'penalties', v_pens);
end $$;

-- ─── Payroll: absent days deducted automatically aren't counted twice ──────

create or replace function public.payroll_run_inputs(p_run uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base    jsonb := app.payroll_run_inputs_v2(p_run);
  v_run     public.payroll_runs;
  v_set     public.payroll_settings;
  v_start   date;
  v_end     date;
  v_cal     int;
  v_from    date;
  v_to      date;
  v_out     jsonb := '[]'::jsonb;
  v_e       jsonb;
  v_emp     public.employees;
  v_days    numeric;
  v_gone    numeric;
  v_att     numeric;
  v_pen     numeric;
  v_gross   numeric;
  v_ot      numeric;
  v_prev_s  date;
  v_prev_e  date;
  v_prev_d  numeric;
  v_worked  numeric;
  v_adj     jsonb;
  v_absent  boolean;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  select * into v_set from public.payroll_settings where organization_id = v_run.organization_id;
  if v_set.organization_id is null
     or (v_set.pay_days_basis = 'calendar' and v_set.input_cycle_start_day = 1 and v_set.joiner_cutoff_day is null and v_set.overtime_multiplier is null
         and not (v_run.lop_from_absence and exists (select 1 from public.attendance_penalties ap
                                                      where ap.organization_id = v_run.organization_id and ap.cycle_month = v_run.period_month
                                                        and ap.kind = 'absent' and ap.reverted_at is null and ap.total_days > 0))) then
    return v_base;
  end if;
  v_start := v_run.period_month;
  v_end := (v_start + interval '1 month - 1 day')::date;
  v_cal := v_end - v_start + 1;
  -- Attendance and leave inputs: from day N of the previous month to day N-1 of this one (N = 1: the month itself).
  v_from := case when v_set.input_cycle_start_day = 1 then v_start else (v_start - interval '1 month')::date + v_set.input_cycle_start_day - 1 end;
  v_to := case when v_set.input_cycle_start_day = 1 then v_end else v_start + v_set.input_cycle_start_day - 2 end;
  v_prev_s := (v_start - interval '1 month')::date;
  v_prev_e := v_start - 1;

  for v_e in select * from jsonb_array_elements(v_base -> 'employees') loop
    select * into v_emp from public.employees where id = (v_e ->> 'employeeId')::uuid;
    -- Joined after the cut-off: paid from next month's run.
    if v_set.joiner_cutoff_day is not null and v_emp.date_of_joining between v_start and v_end
       and extract(day from v_emp.date_of_joining) > v_set.joiner_cutoff_day then
      continue;
    end if;
    v_gross := coalesce((select sum((c ->> 'monthly')::numeric) from jsonb_array_elements(v_e -> 'components') c where c ->> 'kind' = 'earning'), 0);

    -- Pay days in the month and those before joining / after leaving, under the basis.
    if v_set.pay_days_basis = 'working' then
      select count(*) filter (where app.is_pay_day(v_emp.id, d::date, v_set.holidays_paid)),
             count(*) filter (where app.is_pay_day(v_emp.id, d::date, v_set.holidays_paid)
                                and (d::date < v_emp.date_of_joining or (v_emp.date_of_exit is not null and d::date > v_emp.date_of_exit)))
        into v_days, v_gone
        from generate_series(v_start, v_end, interval '1 day') d;
    else
      v_gone := greatest(0, v_emp.date_of_joining - v_start)
                + case when v_emp.date_of_exit is not null and v_emp.date_of_exit < v_end then v_end - v_emp.date_of_exit else 0 end;
      v_days := v_cal;
      if v_set.pay_days_basis = 'fixed_30' then v_days := 30; v_gone := round(v_gone * 30.0 / v_cal, 1); end if;
    end if;
    -- Unpaid leave (and absences when the run counts them, unless automatic deduction already took them) in the input
    -- cycle; penalty days as before.
    v_absent := exists (select 1 from public.attendance_penalties ap where ap.employee_id = v_emp.id and ap.cycle_month = v_run.period_month
                          and ap.kind = 'absent' and ap.reverted_at is null and ap.total_days > 0);
    select coalesce(sum(a.leave_days) filter (where a.leave_paid = false), 0)
           + case when v_run.lop_from_absence and not v_absent then coalesce(sum(case when a.status = 'absent' then 1
                     when a.status = 'half_day' and coalesce(a.leave_paid, false) = false and a.leave_days = 0 then 0.5 else 0 end), 0) else 0 end
      into v_att from public.attendance_days a where a.employee_id = v_emp.id and a.work_date between v_from and v_to;
    v_pen := coalesce((v_e ->> 'penaltyDays')::numeric, 0);
    v_e := v_e || jsonb_build_object('daysInPeriod', v_days, 'payableDays',
      case when v_e ->> 'lopOverride' is not null then greatest(0, v_days - (v_e ->> 'lopOverride')::numeric)
           else least(v_days, greatest(0, v_days - v_gone - v_att - v_pen)) end);

    v_adj := coalesce(v_e -> 'adjustments', '[]'::jsonb);
    -- Approved overtime in the input cycle, at the multiple of the hourly rate (monthly earnings ÷ pay days ÷ 8 hours).
    if v_set.overtime_multiplier is not null and v_days > 0 then
      select coalesce(sum(o.minutes), 0) into v_ot from public.overtime_records o
       where o.employee_id = v_emp.id and o.status = 'approved' and o.work_date between v_from and v_to;
      if v_ot > 0 and v_gross > 0 then
        v_adj := v_adj || jsonb_build_array(jsonb_build_object('code', 'OT', 'name', 'Overtime (' || round(v_ot / 60.0, 1) || ' h)', 'kind', 'earning',
          'amount', round(v_gross / v_days / 8 * (v_ot / 60.0) * v_set.overtime_multiplier), 'taxable', true, 'esiWage', v_set.overtime_in_esi));
      end if;
    end if;
    -- Joined last month after the cut-off: last month's days are paid now as joining arrears.
    if v_set.joiner_cutoff_day is not null and v_emp.date_of_joining between v_prev_s and v_prev_e
       and extract(day from v_emp.date_of_joining) > v_set.joiner_cutoff_day and v_gross > 0 then
      v_prev_d := v_prev_e - v_prev_s + 1;
      v_worked := v_prev_e - v_emp.date_of_joining + 1;
      v_adj := v_adj || jsonb_build_array(jsonb_build_object('code', 'JOIN_ARREARS', 'name', 'Joining arrears (' || v_worked || ' days)', 'kind', 'earning',
        'amount', round(v_gross * v_worked / v_prev_d), 'taxable', true));
    end if;
    v_out := v_out || jsonb_build_array(v_e || jsonb_build_object('adjustments', v_adj));
  end loop;
  return jsonb_set(v_base, '{employees}', v_out);
end $$;

-- ─── Comp-off and overtime decisions in bulk ────────────────────────────────

-- Who may decide someone's attendance items: attendance admins and approvers for them, never for themselves.
create function app.can_decide_attendance(p_org uuid, p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not app.is_own_employee(p_employee) and (
    p_org in (select app.orgs_with_scope('attendance.manage', 'org'))
    or p_org in (select app.orgs_with_scope('attendance.approve', 'org'))
    or p_employee in (select app.employees_in_scope('attendance.approve'))
    or app.is_in_reporting_line(p_org, p_employee));
$$;
revoke all on function app.can_decide_attendance(uuid, uuid) from public;

-- p_items: [{"employeeId": "…", "workDate": "YYYY-MM-DD"}]. Items already decided are skipped.
create function public.decide_comp_offs(p_items jsonb, p_approve boolean) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_rec  public.comp_off_credits;
  v_n    integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'Choose up to 500 at a time.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_rec from public.comp_off_credits
     where employee_id = (v_item ->> 'employeeId')::uuid and work_date = (v_item ->> 'workDate')::date for update;
    if v_rec.employee_id is null or not app.can_decide_attendance(v_rec.organization_id, v_rec.employee_id) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    continue when v_rec.status <> 'pending';
    update public.comp_off_credits set status = case when p_approve then 'credited' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
     where employee_id = v_rec.employee_id and work_date = v_rec.work_date;
    if p_approve then
      insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key, created_by)
      values (v_rec.organization_id, v_rec.employee_id, v_rec.leave_type_id, v_rec.work_date, 'accrual', v_rec.days,
              'Comp-off for work on ' || to_char(v_rec.work_date, 'DD Mon YYYY'), 'compoff:' || v_rec.employee_id || ':' || v_rec.work_date, auth.uid())
      on conflict (idempotency_key) do nothing;
    end if;
    perform app.notify_comp_off(v_rec.employee_id, v_rec.work_date, v_rec.days, case when p_approve then 'approved' else 'rejected' end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Only credited comp-off can be reverted (pending comp-off is approved or rejected).
create or replace function public.revert_comp_off(p_employee uuid, p_date date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rec public.comp_off_credits;
begin
  select * into v_rec from public.comp_off_credits where employee_id = p_employee and work_date = p_date for update;
  if v_rec.employee_id is null or v_rec.organization_id not in (select app.orgs_with_scope('attendance.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_rec.status = 'reverted' then return; end if;
  if v_rec.status <> 'credited' then
    raise exception 'Only credited comp-off can be reverted; approve or reject comp-off that is waiting.' using errcode = '22023';
  end if;
  update public.comp_off_credits set status = 'reverted', reverted_by = auth.uid(), reverted_at = now()
   where employee_id = p_employee and work_date = p_date;
  insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
  values (v_rec.organization_id, p_employee, v_rec.leave_type_id, app.org_today(v_rec.organization_id), 'reversal', -v_rec.days,
          'Comp-off for ' || to_char(p_date, 'DD Mon YYYY') || ' reverted', 'compoff-revert:' || p_employee || ':' || p_date)
  on conflict (idempotency_key) do nothing;
end $$;

create function public.revert_comp_offs(p_items jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_n    integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'Choose up to 500 at a time.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if exists (select 1 from public.comp_off_credits where employee_id = (v_item ->> 'employeeId')::uuid
                and work_date = (v_item ->> 'workDate')::date and status = 'credited') then
      perform public.revert_comp_off((v_item ->> 'employeeId')::uuid, (v_item ->> 'workDate')::date);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create function public.decide_overtimes(p_items jsonb, p_approve boolean) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_n    integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'Choose up to 500 at a time.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if exists (select 1 from public.overtime_records where employee_id = (v_item ->> 'employeeId')::uuid
                and work_date = (v_item ->> 'workDate')::date and status = 'pending') then
      perform public.decide_overtime((v_item ->> 'employeeId')::uuid, (v_item ->> 'workDate')::date, p_approve);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ─── Regularization limits and several days at once ────────────────────────

create or replace function public.request_regularization(p_employee uuid, p_date date, p_in time default null, p_out time default null, p_reason text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp   public.employees;
  v_hr    boolean;
  v_set   public.attendance_settings;
  v_back  integer;
  v_today date;
  v_id    uuid;
  v_req   uuid;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null or not app.is_member(v_emp.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_hr := app.has_permission(v_emp.organization_id, 'attendance.manage');
  if not (v_emp.user_id = auth.uid() or v_hr) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_today := app.org_today(v_emp.organization_id);
  select * into v_set from public.attendance_settings where organization_id = v_emp.organization_id;
  -- Employees ask within the organization's window; attendance admins can go back 90 days.
  v_back := case when v_hr then 90 else coalesce(v_set.regularize_days_back, 60) end;
  if p_date >= v_today then
    raise exception 'Regularize days that have ended; today can still be punched.' using errcode = '22023';
  end if;
  if p_date < v_today - v_back then
    raise exception 'Only the last % days can be regularized.', v_back using errcode = '22023';
  end if;
  if p_in is null and p_out is null then
    raise exception 'Give the check-in time, the check-out time, or both.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why the day needs correcting.' using errcode = '22023';
  end if;
  if not v_hr and v_set.regularize_monthly_limit is not null
     and (select count(*) from public.regularization_requests r
           where r.employee_id = p_employee and r.status in ('pending', 'approved')
             and date_trunc('month', r.work_date) = date_trunc('month', p_date)) >= v_set.regularize_monthly_limit then
    raise exception 'You can ask for at most % regularization% a month.', v_set.regularize_monthly_limit,
      case when v_set.regularize_monthly_limit = 1 then '' else 's' end using errcode = '22023';
  end if;
  begin
    insert into public.regularization_requests (organization_id, employee_id, work_date, check_in, check_out, reason)
    values (v_emp.organization_id, p_employee, p_date, p_in, p_out, btrim(p_reason))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already a pending regularization for that day.' using errcode = '22023';
  end;
  v_req := app.request_approval(v_emp.organization_id, 'regularization', v_id, p_employee,
    format('%s: attendance for %s (%s)', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)), to_char(p_date, 'DD Mon YYYY'),
           concat_ws(' – ', to_char(p_in, 'HH24:MI'), to_char(p_out, 'HH24:MI'))),
    '/attendance');
  update public.regularization_requests set approval_request_id = v_req where id = v_id;
  return v_id;
end $$;

-- The same correction for several days (up to 31). Days that can't be asked for are reported, the rest go ahead.
create function public.request_regularizations(p_employee uuid, p_dates date[], p_in time default null, p_out time default null, p_reason text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_day    date;
  v_ok     integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(p_dates), 0) = 0 or cardinality(p_dates) > 31 then
    raise exception 'Choose between 1 and 31 days.' using errcode = '22023';
  end if;
  for v_day in select distinct x from unnest(p_dates) x where x is not null order by 1 loop
    begin
      perform public.request_regularization(p_employee, v_day, p_in, p_out, p_reason);
      v_ok := v_ok + 1;
    exception when sqlstate '22023' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('date', v_day, 'message', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('requested', v_ok, 'errors', v_errors);
end $$;

-- ─── Zones ──────────────────────────────────────────────────────────────────

-- A circle has a centre and a radius; a rectangle two opposite corners; a polygon 3 to 50 corners, each [lat, lng].
alter table public.geofences
  add column shape  text not null default 'circle' check (shape in ('circle', 'rectangle', 'polygon')),
  add column points jsonb,
  alter column radius_m drop not null;
alter table public.geofences add constraint geofences_shape_points_check check (
  case shape when 'circle' then radius_m is not null and points is null
             when 'rectangle' then jsonb_typeof(points) = 'array' and jsonb_array_length(points) = 2
             else jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 3 and 50 end);

-- Corners are checked, and a drawn zone's centre (for lists) is the middle of its corners' extent.
create function app.geofence_shape() returns trigger
language plpgsql set search_path = '' as $$
declare
  p jsonb;
begin
  if new.shape = 'circle' then
    new.points := null;
    return new;
  end if;
  if jsonb_typeof(new.points) is distinct from 'array' then
    raise exception 'Give the zone’s corners.' using errcode = '22023';
  end if;
  for p in select * from jsonb_array_elements(new.points) loop
    if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2 or jsonb_typeof(p -> 0) <> 'number' or jsonb_typeof(p -> 1) <> 'number'
       or (p ->> 0)::numeric not between -90 and 90 or (p ->> 1)::numeric not between -180 and 180 then
      raise exception 'Each corner is a latitude and a longitude.' using errcode = '22023';
    end if;
  end loop;
  select round((max((x ->> 0)::numeric) + min((x ->> 0)::numeric)) / 2, 6), round((max((x ->> 1)::numeric) + min((x ->> 1)::numeric)) / 2, 6)
    into new.latitude, new.longitude
    from jsonb_array_elements(new.points) x;
  new.radius_m := null;
  return new;
end $$;
revoke all on function app.geofence_shape() from public;
create trigger geofences_shape before insert or update on public.geofences for each row execute function app.geofence_shape();

-- Metres from a point to a zone: zero or less inside (how far inside, negative), more outside. Corners are projected
-- onto a flat plane around the point, which is accurate for zones of a few kilometres.
create function app.zone_distance_m(p_zone public.geofences, p_lat numeric, p_lng numeric) returns double precision
language plpgsql immutable set search_path = '' as $$
declare
  v_k      double precision := pi() / 180 * 6371000;  -- metres per degree of latitude
  v_cos    double precision;
  v_poly   jsonb;
  v_x      double precision[] := '{}';
  v_y      double precision[] := '{}';
  v_n      int;
  v_inside boolean := false;
  v_best   double precision;
  v_dx     double precision;
  v_dy     double precision;
  v_t      double precision;
  v_d      double precision;
  i        int;
  j        int;
  p        jsonb;
begin
  if p_lat is null or p_lng is null then return null; end if;
  if p_zone.shape = 'circle' then
    return app.distance_m(p_zone.latitude, p_zone.longitude, p_lat, p_lng) - p_zone.radius_m;
  end if;
  v_cos := cos(radians(p_lat::double precision));
  v_poly := case when p_zone.shape = 'rectangle' then jsonb_build_array(
                   jsonb_build_array(p_zone.points -> 0 -> 0, p_zone.points -> 0 -> 1),
                   jsonb_build_array(p_zone.points -> 0 -> 0, p_zone.points -> 1 -> 1),
                   jsonb_build_array(p_zone.points -> 1 -> 0, p_zone.points -> 1 -> 1),
                   jsonb_build_array(p_zone.points -> 1 -> 0, p_zone.points -> 0 -> 1))
                 else p_zone.points end;
  -- Corners in metres east (x) and north (y) of the point.
  for p in select * from jsonb_array_elements(v_poly) loop
    v_x := v_x || (((p ->> 1)::double precision - p_lng::double precision) * v_k * v_cos);
    v_y := v_y || (((p ->> 0)::double precision - p_lat::double precision) * v_k);
  end loop;
  v_n := cardinality(v_x);
  for i in 1 .. v_n loop
    j := case when i = 1 then v_n else i - 1 end;
    -- A ray east from the point crosses the edge: inside flips.
    if (v_y[i] > 0) <> (v_y[j] > 0) and 0 < (v_x[j] - v_x[i]) * (0 - v_y[i]) / (v_y[j] - v_y[i]) + v_x[i] then
      v_inside := not v_inside;
    end if;
    v_dx := v_x[j] - v_x[i];
    v_dy := v_y[j] - v_y[i];
    v_t := case when v_dx * v_dx + v_dy * v_dy = 0 then 0
                else greatest(0, least(1, -(v_x[i] * v_dx + v_y[i] * v_dy) / (v_dx * v_dx + v_dy * v_dy))) end;
    v_d := sqrt(power(v_x[i] + v_t * v_dx, 2) + power(v_y[i] + v_t * v_dy, 2));
    v_best := least(coalesce(v_best, v_d), v_d);
  end loop;
  return case when v_inside then -v_best else v_best end;
end $$;
revoke all on function app.zone_distance_m(public.geofences, numeric, numeric) from public;

-- Check-in against the zone's shape (otherwise as in migration 20261020000900).
create or replace function public.record_punch(
  p_client_id   text,
  p_punched_at  timestamptz default null,
  p_method      public.punch_method default 'web',
  p_latitude    numeric default null,
  p_longitude   numeric default null,
  p_accuracy_m  integer default null,
  p_org         uuid default null,
  p_ip          text default null,
  p_selfie_path text default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp     public.employees;
  v_at      timestamptz := coalesce(p_punched_at, now());
  v_key     text;
  v_id      uuid;
  v_fences  int;
  v_inside  boolean;
  v_shift   public.shifts;
  v_ips     text[];
begin
  if p_method not in ('web', 'mobile') then
    raise exception 'Use web or mobile for your own punches.' using errcode = '22023';
  end if;
  if p_client_id is null or p_client_id !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Invalid punch id.' using errcode = '22023';
  end if;
  select * into v_emp from public.employees
   where user_id = auth.uid() and (p_org is null or organization_id = p_org) and status in ('active', 'on_notice')
   order by organization_id limit 1;
  if v_emp.id is null or not app.is_member(v_emp.organization_id) then
    raise exception 'Your account isn’t linked to an active employee record.' using errcode = '42501';
  end if;
  if v_at > now() + interval '2 minutes' then
    raise exception 'A punch can’t be in the future. Check the device clock.' using errcode = '22023';
  end if;
  if v_at < now() - interval '72 hours' then
    raise exception 'Punches older than 72 hours can’t be synced; request a regularization instead.' using errcode = '22023';
  end if;
  if p_selfie_path is not null and p_selfie_path !~ ('^' || v_emp.organization_id || '/' || v_emp.id || '/[0-9a-f-]{36}$') then
    raise exception 'Invalid selfie.' using errcode = '22023';
  end if;

  v_key := p_method || ':' || v_emp.id || ':' || p_client_id;
  select id into v_id from public.attendance_punches where organization_id = v_emp.organization_id and source_key = v_key;
  if v_id is not null then return v_id; end if;  -- already synced

  -- The rule's checks (for live punches; offline mobile punches synced later are judged by flags below).
  v_shift := app.shift_for(v_emp.id, (v_at at time zone (select timezone from public.organizations where id = v_emp.organization_id))::date);
  select count(*), bool_or(app.zone_distance_m(g, p_latitude, p_longitude) <= coalesce(p_accuracy_m, 0))
    into v_fences, v_inside
    from public.geofences g where g.organization_id = v_emp.organization_id and g.location_id = v_emp.location_id and g.is_active;
  if coalesce(v_shift.verify_ip, false) and p_method = 'web' then
    select allowed_ips into v_ips from public.attendance_settings where organization_id = v_emp.organization_id;
    if cardinality(coalesce(v_ips, '{}')) > 0 and (p_ip is null or not (p_ip = any (v_ips))) then
      raise exception 'Your attendance rule needs you to check in from the office network.' using errcode = '42501';
    end if;
  end if;
  if coalesce(v_shift.verify_geofence, false) and v_fences > 0 and now() - v_at < interval '10 minutes' then
    if p_latitude is null or p_longitude is null then
      raise exception 'Your attendance rule needs your location. Allow location access and try again.' using errcode = '42501';
    elsif not coalesce(v_inside, false) then
      raise exception 'You’re outside the workplace area for your attendance rule.' using errcode = '42501';
    end if;
  end if;
  if coalesce(v_shift.verify_selfie, false) and p_method = 'web' and p_selfie_path is null then
    raise exception 'Your attendance rule needs a selfie to check in.' using errcode = '42501';
  end if;

  insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key, latitude, longitude, accuracy_m, ip, selfie_path)
  values (v_emp.organization_id, v_emp.id, v_at, p_method, v_key, p_latitude, p_longitude, p_accuracy_m, left(p_ip, 64), p_selfie_path)
  on conflict (organization_id, source_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.attendance_punches where organization_id = v_emp.organization_id and source_key = v_key;
    return v_id;
  end if;

  -- Evidence for review.
  if v_fences > 0 and (p_latitude is null or p_longitude is null) then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'no_location', 'Punch without a location where the workplace has a geofence.');
  elsif v_fences > 0 and not coalesce(v_inside, false) then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'outside_geofence', 'Punch recorded outside the workplace geofence.');
  end if;
  if coalesce(v_shift.verify_selfie, false) and p_method = 'mobile' then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'no_selfie', 'Mobile punch without a selfie under a rule that asks for one.');
  end if;
  if now() - v_at > interval '1 hour' then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'late_sync',
            'Punch synced ' || round(extract(epoch from now() - v_at) / 3600) || ' hour(s) after it was made (offline device).');
  end if;
  return v_id;
end $$;

-- Test a point against a location's zones (or every zone): what a check-in there would get.
create function public.test_geofence(p_org uuid, p_location uuid, p_lat numeric, p_lng numeric, p_accuracy integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'attendance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Give a latitude and a longitude.' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'shape', g.shape, 'active', g.is_active,
                                        'inside', z.d <= greatest(coalesce(p_accuracy, 0), 0), 'metres', round(greatest(0, z.d)::numeric))
                     order by z.d)
      from public.geofences g cross join lateral (select app.zone_distance_m(g, p_lat, p_lng) as d) z
     where g.organization_id = p_org and (p_location is null or g.location_id = p_location)), '[]'::jsonb);
end $$;

-- ─── Automatic clock-in and clock-out ───────────────────────────────────────

-- A day someone is expected to work: not a weekly off or holiday, and no full day of approved leave.
create function app.is_work_day(p_employee uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_pay_day(p_employee, p_date, false)
     and not exists (select 1 from public.leave_requests r
                      where r.employee_id = p_employee and r.status = 'approved' and p_date between r.start_date and r.end_date
                        and not ((p_date = r.start_date and r.half_day_start) or (p_date = r.end_date and r.half_day_end)));
$$;
revoke all on function app.is_work_day(uuid, date) from public;

-- Every 15 minutes: under rules with it, a check-in at the shift start for people who haven't punched (within 4 hours
-- of the start) and a check-out at the shift end for people still checked in (within 4 hours of the end).
create function public.worker_attendance_auto_clock(p_now timestamptz default now()) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  o       record;
  e       record;
  d       date;
  v_day   date;
  v_s     public.shifts;
  v_from  timestamptz;
  v_to    timestamptz;
  v_n     int;
  v_lastp timestamptz;
  n_in    int := 0;
  n_out   int := 0;
begin
  for o in select org.id, org.timezone from public.organizations org
            where org.status = 'active'
              and exists (select 1 from public.shifts s where s.organization_id = org.id and (s.auto_clock_in or s.auto_clock_out)) loop
    v_day := (p_now at time zone o.timezone)::date;
    for e in select emp.id, emp.date_of_joining, emp.date_of_exit from public.employees emp
              where emp.organization_id = o.id and emp.status in ('active', 'on_notice') loop
      foreach d in array array[v_day - 1, v_day] loop
        continue when d < e.date_of_joining or (e.date_of_exit is not null and d > e.date_of_exit);
        v_s := app.shift_for(e.id, d);
        continue when v_s.id is null or not (v_s.auto_clock_in or v_s.auto_clock_out);
        v_from := (d + v_s.start_time)::timestamp at time zone o.timezone;
        v_to := (d + v_s.end_time)::timestamp at time zone o.timezone;
        if v_to <= v_from then v_to := v_to + interval '1 day'; end if;
        continue when p_now < v_from or p_now >= v_to + interval '4 hours' or not app.is_work_day(e.id, d);
        select count(*), max(p.punched_at) into v_n, v_lastp from public.attendance_punches p
         where p.employee_id = e.id and p.punched_at <@ tstzrange(v_from - interval '4 hours', v_from + interval '20 hours', '[)');
        if v_s.auto_clock_in and v_n = 0 and p_now < v_from + interval '4 hours' then
          insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key)
          values (o.id, e.id, v_from, 'auto', 'auto:in:' || e.id || ':' || d)
          on conflict (organization_id, source_key) do nothing;
          if found then n_in := n_in + 1; v_n := 1; v_lastp := v_from; end if;
        end if;
        if v_s.auto_clock_out and v_n % 2 = 1 and p_now >= v_to and v_lastp < v_to then
          insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key)
          values (o.id, e.id, v_to, 'auto', 'auto:out:' || e.id || ':' || d)
          on conflict (organization_id, source_key) do nothing;
          if found then n_out := n_out + 1; end if;
        end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('clocked_in', n_in, 'clocked_out', n_out);
end $$;

-- ─── Reminders ──────────────────────────────────────────────────────────────

create function app.minutes_label(p_minutes integer) returns text
language sql immutable set search_path = '' as $$
  select case when p_minutes < 60 then p_minutes || ' minute' || case when p_minutes = 1 then '' else 's' end
              when p_minutes % 60 = 0 then (p_minutes / 60) || ' h'
              else (p_minutes / 60) || ' h ' || (p_minutes % 60) || ' min' end;
$$;

-- As before (missing check-out at 10 am, the approvals digest at 9 am, late alerts to managers at 11 am), plus the
-- daily summary for attendance admins (yesterday's, at 9 am) and punch reminders for employees (late today, early
-- exits yesterday, at 11 am). Each once a day, in the organization's time.
drop function public.worker_attendance_reminders();
create function public.worker_attendance_reminders(p_now timestamptz default now()) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  o         record;
  r         record;
  v_local   timestamp;
  v_today   date;
  v_p       int;
  v_h       int;
  v_l       int;
  v_lv      int;
  v_a       int;
  n_out     int := 0;
  n_digest  int := 0;
  n_late    int := 0;
  n_summary int := 0;
  n_punch   int := 0;
begin
  for o in select org.id, org.timezone, coalesce(s.remind_missing_checkout, true) as remind_out, coalesce(s.pending_digest, true) as digest,
                  coalesce(s.late_punch_alert, false) as late, coalesce(s.daily_summary, false) as summary,
                  coalesce(s.punch_reminders, false) as punch, s.last_checkout_reminder, s.last_digest, s.last_late_alert,
                  s.last_daily_summary, s.last_punch_reminder
             from public.organizations org left join public.attendance_settings s on s.organization_id = org.id
            where org.status = 'active' loop
    v_local := p_now at time zone o.timezone;
    v_today := v_local::date;
    if o.remind_out and extract(hour from v_local) >= 10 and o.last_checkout_reminder is distinct from v_today then
      for r in select e.user_id, d.work_date from public.attendance_days d join public.employees e on e.id = d.employee_id
                where d.organization_id = o.id and d.work_date = v_today - 1 and d.punch_count % 2 = 1 and e.user_id is not null loop
        perform app.notify(o.id, r.user_id, 'attendance.missing_checkout', 'You didn’t check out yesterday',
                           'Request a regularization so the day is counted correctly.', '/attendance');
        n_out := n_out + 1;
      end loop;
      insert into public.attendance_settings (organization_id, last_checkout_reminder) values (o.id, v_today)
      on conflict (organization_id) do update set last_checkout_reminder = v_today;
    end if;
    if o.digest and extract(hour from v_local) >= 9 and o.last_digest is distinct from v_today then
      for r in select a.user_id, count(*) as n from public.approval_requests q cross join lateral app.current_approvers(q.id) as a(user_id)
                where q.organization_id = o.id and q.status = 'pending' and q.subject_type in ('regularization', 'attendance_request')
                group by a.user_id loop
        perform app.notify(o.id, r.user_id, 'attendance.digest', r.n || ' attendance request' || case when r.n = 1 then '' else 's' end || ' waiting for you',
                           null, '/attendance?tab=approvals');
        n_digest := n_digest + 1;
      end loop;
      insert into public.attendance_settings (organization_id, last_digest) values (o.id, v_today)
      on conflict (organization_id) do update set last_digest = v_today;
    end if;
    if o.late and extract(hour from v_local) >= 11 and o.last_late_alert is distinct from v_today then
      for r in select m.user_id, string_agg(trim(e.first_name || ' ' || coalesce(e.last_name, '')), ', ' order by e.first_name) as names, count(*) as n
                 from public.attendance_days d join public.employees e on e.id = d.employee_id join public.employees m on m.id = e.manager_employee_id
                where d.organization_id = o.id and d.work_date = v_today and d.late_minutes > 0 and m.user_id is not null
                group by m.user_id loop
        perform app.notify(o.id, r.user_id, 'attendance.late', r.n || ' late today: ' || left(r.names, 150), null, '/attendance?tab=logs');
        n_late := n_late + 1;
      end loop;
      insert into public.attendance_settings (organization_id, last_late_alert) values (o.id, v_today)
      on conflict (organization_id) do update set last_late_alert = v_today;
    end if;
    if o.summary and extract(hour from v_local) >= 9 and o.last_daily_summary is distinct from v_today then
      perform app.compute_attendance_day(e.id, v_today - 1) from public.employees e
       where e.organization_id = o.id and e.status in ('active', 'on_notice') and e.date_of_joining <= v_today - 1;
      select count(*) filter (where status in ('present', 'wfh', 'on_duty')), count(*) filter (where status = 'half_day'),
             count(*) filter (where late_minutes > 0 and status in ('present', 'half_day')),
             count(*) filter (where status = 'on_leave'), count(*) filter (where status = 'absent')
        into v_p, v_h, v_l, v_lv, v_a
        from public.attendance_days where organization_id = o.id and work_date = v_today - 1;
      -- Not on a day everyone had off.
      if v_p + v_h + v_lv + v_a > 0 then
        perform app.notify_permission_holders(o.id, 'attendance.manage', 'attendance.summary',
          format('Attendance on %s: %s present, %s half day, %s late, %s on leave, %s absent',
                 to_char(v_today - 1, 'Dy FMDD Mon'), v_p, v_h, v_l, v_lv, v_a),
          '/attendance?tab=logs&view=daily&date=' || to_char(v_today - 1, 'YYYY-MM-DD'));
        n_summary := n_summary + 1;
      end if;
      insert into public.attendance_settings (organization_id, last_daily_summary) values (o.id, v_today)
      on conflict (organization_id) do update set last_daily_summary = v_today;
    end if;
    if o.punch and extract(hour from v_local) >= 11 and o.last_punch_reminder is distinct from v_today then
      for r in select e.user_id, d.late_minutes as m from public.attendance_days d join public.employees e on e.id = d.employee_id
                where d.organization_id = o.id and d.work_date = v_today and d.late_minutes > 0 and d.status in ('present', 'half_day')
                  and e.user_id is not null loop
        perform app.notify(o.id, r.user_id, 'attendance.punch', 'You checked in ' || app.minutes_label(r.m) || ' late today',
                           'If your punch is wrong, request a regularization.', '/attendance');
        n_punch := n_punch + 1;
      end loop;
      for r in select e.user_id, d.early_out_minutes as m from public.attendance_days d join public.employees e on e.id = d.employee_id
                where d.organization_id = o.id and d.work_date = v_today - 1 and d.early_out_minutes > 0 and d.punch_count >= 2
                  and d.status in ('present', 'half_day') and e.user_id is not null loop
        perform app.notify(o.id, r.user_id, 'attendance.punch', 'You checked out ' || app.minutes_label(r.m) || ' early yesterday',
                           'If your punch is wrong, request a regularization.', '/attendance');
        n_punch := n_punch + 1;
      end loop;
      insert into public.attendance_settings (organization_id, last_punch_reminder) values (o.id, v_today)
      on conflict (organization_id) do update set last_punch_reminder = v_today;
    end if;
  end loop;
  return jsonb_build_object('missing_checkout', n_out, 'digests', n_digest, 'late_alerts', n_late, 'summaries', n_summary, 'punch_reminders', n_punch);
end $$;

-- ─── Saved views ────────────────────────────────────────────────────────────

-- Named filters a person keeps for a page (the attendance logs first); private to them.
create table public.saved_views (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page             text not null check (page ~ '^[a-z][a-z_.]{1,39}$'),
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  params           jsonb not null check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 2048),
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id, page, name)
);
alter table public.saved_views enable row level security;
create policy saved_views_own on public.saved_views for all to authenticated
  using (user_id = auth.uid() and app.is_member(organization_id))
  with check (user_id = auth.uid() and app.is_member(organization_id));
grant select, insert, update, delete on public.saved_views to authenticated;
grant all on public.saved_views to service_role;

-- ─── Function grants ────────────────────────────────────────────────────────

revoke all on function app.undo_penalty_leave(uuid, text) from public;
revoke all on function app.apply_penalty_deduction(uuid, numeric, uuid[], date) from public;
revoke all on function app.record_attendance_penalty(uuid, uuid, date, text, integer, numeric, text, text, uuid[], date) from public;
revoke all on function app.employee_attendance_penalties(uuid, uuid, date, date, date, public.shifts) from public;
revoke all on function app.compute_attendance_penalties(uuid, date, boolean) from public, anon, authenticated;
grant execute on function app.compute_attendance_penalties(uuid, date, boolean) to service_role;
revoke all on function app.minutes_label(integer) from public;

revoke all on function public.revert_attendance_penalties(uuid[]) from public, anon;
revoke all on function public.decide_comp_offs(jsonb, boolean) from public, anon;
revoke all on function public.revert_comp_offs(jsonb) from public, anon;
revoke all on function public.decide_overtimes(jsonb, boolean) from public, anon;
revoke all on function public.request_regularizations(uuid, date[], time, time, text) from public, anon;
revoke all on function public.test_geofence(uuid, uuid, numeric, numeric, integer) from public, anon;
grant execute on function public.revert_attendance_penalties(uuid[]) to authenticated, service_role;
grant execute on function public.decide_comp_offs(jsonb, boolean) to authenticated, service_role;
grant execute on function public.revert_comp_offs(jsonb) to authenticated, service_role;
grant execute on function public.decide_overtimes(jsonb, boolean) to authenticated, service_role;
grant execute on function public.request_regularizations(uuid, date[], time, time, text) to authenticated, service_role;
grant execute on function public.test_geofence(uuid, uuid, numeric, numeric, integer) to authenticated, service_role;

revoke all on function public.worker_attendance_deductions(timestamptz) from public, anon, authenticated;
revoke all on function public.worker_attendance_auto_clock(timestamptz) from public, anon, authenticated;
revoke all on function public.worker_attendance_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.worker_attendance_deductions(timestamptz) to service_role;
grant execute on function public.worker_attendance_auto_clock(timestamptz) to service_role;
grant execute on function public.worker_attendance_reminders(timestamptz) to service_role;
