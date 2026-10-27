-- PeopleCore · Unpaid leave over a weekend isn't docked for the weekend.
--
-- compute_attendance_day counted every date inside an approved leave as a full leave day, weekly offs and holidays
-- included, and payroll deducts unpaid leave_days. So unpaid leave from Friday to Monday took 2 days from the balance
-- but 4 days of pay. Each day's share now comes from app.leave_days, the rule the balance uses (weekly offs and
-- holidays count only for types that count them; half working days are half). Unchanged otherwise.

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

  -- The day's share of an approved leave, counted as the balance counts it (app.leave_days): a weekly off or holiday
  -- inside the leave is no leave day unless the type counts them, so unpaid leave over a weekend isn't docked for it.
  select app.leave_days(p_employee, r.leave_type_id, p_date, p_date, p_date = r.start_date and r.half_day_start,
                        p_date = r.end_date and r.half_day_end), t.is_paid
    into v_leave, v_paid
    from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
   where r.employee_id = p_employee and r.status = 'approved' and p_date between r.start_date and r.end_date
   limit 1;
  v_leave := coalesce(v_leave, 0);
  if v_leave = 0 then v_paid := null; end if;

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
