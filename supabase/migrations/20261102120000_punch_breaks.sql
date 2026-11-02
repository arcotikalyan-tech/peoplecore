-- PeopleCore · Lunch and breaks: a punch says what it is.
--
-- Punches were bare times: the first of a day was the check-in, the last the check-out, and the rule's break (60
-- minutes unless set) came off any day longer than half a day. Now a punch can say what it is: check in, check out,
-- start or end lunch, start or end a break. The website and the phone app send it; a punch without one (a biometric
-- device, an import, a correction, an older phone app) is a check-in or check-out by its place, as before.
--
-- * record_punch takes p_kind and keeps the day in order: check in first, one lunch or break at a time, end the one
--   that's on, check out last (checking out ends a lunch or break that's on). A rule that asks for a selfie asks for
--   it with every punch, lunch and breaks included (the check was never about direction).
-- * app.compute_attendance_day: the day's first and last punch, and punch_count, are check-ins and check-outs only, so
--   an odd count still means a missing punch everywhere it is read. Lunch and breaks recorded with punches are kept in
--   attendance_days.break_minutes, and worked time loses the larger of the rule's break and the breaks taken: a full
--   day of 8 hours with an hour's break is 9 hours at work, and breaks beyond the hour make the day longer.
-- * The automatic clock-in and clock-out count check-ins and check-outs only, and say which they are.

create type public.punch_kind as enum ('in', 'out', 'lunch_start', 'lunch_end', 'break_start', 'break_end');
alter table public.attendance_punches add column kind public.punch_kind;
comment on column public.attendance_punches.kind is
  'What the punch is. Null: a check-in or check-out by its place (devices, imports, corrections, older phone apps).';
alter table public.attendance_days add column break_minutes integer not null default 0 check (break_minutes >= 0);
comment on column public.attendance_days.break_minutes is
  'Lunch and breaks recorded with punches. Worked minutes lose the larger of this and the rule''s break.';

-- The punches that make up a work day: 4 hours before the rule's start to 20 hours after it (night shifts), as
-- compute_attendance_day collects them.
create function app.work_window(p_employee uuid, p_date date) returns tstzrange
language plpgsql stable security definer set search_path = '' as $$
declare
  v_shift public.shifts;
  v_tz    text;
  v_start timestamptz;
begin
  select o.timezone into v_tz from public.employees e join public.organizations o on o.id = e.organization_id where e.id = p_employee;
  v_shift := app.shift_for(p_employee, p_date);
  v_start := (p_date + coalesce(v_shift.start_time, '09:00'::time))::timestamp at time zone v_tz;
  return tstzrange(v_start - interval '4 hours', v_start + interval '20 hours', '[)');
end $$;

-- Where someone's day stood just before a time: checked in (an odd number of check-ins and check-outs), and on lunch
-- or a break (a start after the last check-in or check-out with no end since).
create function app.punch_state(p_employee uuid, p_window tstzrange, p_before timestamptz, out checked_in boolean, out paused text)
language sql stable security definer set search_path = '' as $$
  with day as (
    select punched_at, kind from public.attendance_punches
     where employee_id = p_employee and punched_at <@ coalesce(p_window, 'empty'::tstzrange) and punched_at < p_before
  ), main as (
    select count(*) as n, max(punched_at) as last_at from day where kind is null or kind in ('in', 'out')
  ), pause as (
    select d.kind from day d, main m
     where d.kind in ('lunch_start', 'lunch_end', 'break_start', 'break_end') and (m.last_at is null or d.punched_at > m.last_at)
     order by d.punched_at desc limit 1
  )
  select (select n from main) % 2 = 1,
         case (select kind from pause) when 'lunch_start' then 'lunch' when 'break_start' then 'break' end
$$;

revoke all on function app.work_window(uuid, date) from public;
revoke all on function app.punch_state(uuid, tstzrange, timestamptz) from public;

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
  v_breaks    int := 0;
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
  -- Check-ins and check-outs only: lunch and break punches sit between them.
  select min(punched_at), max(punched_at), count(*), bool_or(method = 'regularization')
    into v_first, v_last, v_count, v_reg
    from public.attendance_punches
   where employee_id = p_employee and punched_at <@ v_window and (kind is null or kind in ('in', 'out'));

  -- Lunch and breaks recorded with punches: each runs from its start to its end, or to a check-out that came first.
  select coalesce(sum(extract(epoch from n.punched_at - s.punched_at) / 60), 0)::int
    into v_breaks
    from public.attendance_punches s
    left join lateral (
      select p.punched_at, p.kind from public.attendance_punches p
       where p.employee_id = p_employee and p.punched_at <@ v_window and p.punched_at > s.punched_at
       order by p.punched_at limit 1) n on n.kind is null or n.kind = 'out'
                                        or n.kind = case s.kind when 'lunch_start' then 'lunch_end'::public.punch_kind else 'break_end' end
   where s.employee_id = p_employee and s.punched_at <@ v_window and s.kind in ('lunch_start', 'break_start');

  if v_count >= 2 then
    -- The rule's break (60 minutes unless set) comes off a day longer than half a day; lunch and breaks taken beyond
    -- it come off too. A full day of 8 hours with an hour's break is 9 hours at work, however the hour is split.
    v_worked := greatest(0, (extract(epoch from v_last - v_first) / 60)::int
                            - greatest(case when extract(epoch from v_last - v_first) / 60 > v_half
                                            then coalesce(v_shift.break_minutes, 60) else 0 end, v_breaks));
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
                                      is_regularized, expected_minutes, break_minutes, computed_at)
  values (v_emp.organization_id, p_employee, p_date, v_shift.id, v_status, v_first, case when v_count >= 2 then v_last end,
          v_worked, v_late, v_early, v_ot, v_count, v_leave, v_paid, coalesce(v_reg, false), v_expected, v_breaks, now())
  on conflict (employee_id, work_date) do update set
    shift_id = excluded.shift_id, status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
    worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes, early_out_minutes = excluded.early_out_minutes,
    overtime_minutes = excluded.overtime_minutes, punch_count = excluded.punch_count, leave_days = excluded.leave_days,
    leave_paid = excluded.leave_paid, is_regularized = excluded.is_regularized, expected_minutes = excluded.expected_minutes,
    break_minutes = excluded.break_minutes, computed_at = excluded.computed_at;

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
      from public.attendance_punches p
     where p.employee_id = p_employee and p.punched_at <@ v_window and (p.kind is null or p.kind in ('in', 'out'))
    on conflict (subject_type, subject_id, rule) do nothing;
  end if;
end $$;

create or replace function public.worker_attendance_auto_clock(p_now timestamptz default now()) returns jsonb
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
         where p.employee_id = e.id and p.punched_at <@ tstzrange(v_from - interval '4 hours', v_from + interval '20 hours', '[)')
           and (p.kind is null or p.kind in ('in', 'out'));
        if v_s.auto_clock_in and v_n = 0 and p_now < v_from + interval '4 hours' then
          insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key, kind)
          values (o.id, e.id, v_from, 'auto', 'auto:in:' || e.id || ':' || d, 'in')
          on conflict (organization_id, source_key) do nothing;
          if found then n_in := n_in + 1; v_n := 1; v_lastp := v_from; end if;
        end if;
        if v_s.auto_clock_out and v_n % 2 = 1 and p_now >= v_to and v_lastp < v_to then
          insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key, kind)
          values (o.id, e.id, v_to, 'auto', 'auto:out:' || e.id || ':' || d, 'out')
          on conflict (organization_id, source_key) do nothing;
          if found then n_out := n_out + 1; end if;
        end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('clocked_in', n_in, 'clocked_out', n_out);
end $$;

drop function public.record_punch(text, timestamptz, public.punch_method, numeric, numeric, integer, uuid, text, text);

create function public.record_punch(
  p_client_id   text,
  p_punched_at  timestamptz default null,
  p_method      public.punch_method default 'web',
  p_latitude    numeric default null,
  p_longitude   numeric default null,
  p_accuracy_m  integer default null,
  p_org         uuid default null,
  p_ip          text default null,
  p_selfie_path text default null,
  p_kind        public.punch_kind default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp     public.employees;
  v_late    boolean := p_punched_at is not null and p_punched_at < now() - interval '5 minutes';
  v_at      timestamptz := case when v_late then p_punched_at else now() end;
  v_fresh   boolean := p_punched_at is null or p_punched_at >= now() - interval '10 minutes';
  v_key     text;
  v_id      uuid;
  v_fences  int;
  v_inside  boolean;
  v_shift   public.shifts;
  v_ips     text[];
  v_seen    text;
  v_proxies text[];
  v_ip      text := p_ip;
  v_tz      text;
  v_window  tstzrange;
  v_state   record;
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
  if p_punched_at > now() + interval '2 minutes' then
    raise exception 'A punch can’t be in the future. Check the device clock.' using errcode = '22023';
  end if;
  if p_punched_at < now() - interval '72 hours' then
    raise exception 'Punches older than 72 hours can’t be synced; request a regularization instead.' using errcode = '22023';
  end if;
  if p_selfie_path is not null and p_selfie_path !~ ('^' || v_emp.organization_id || '/' || v_emp.id || '/[0-9a-f-]{36}$') then
    raise exception 'Invalid selfie.' using errcode = '22023';
  end if;

  -- The address that counts: the one the database saw, unless the request came through a PeopleCore app server.
  v_seen := btrim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1));
  select trusted_proxy_ips into v_proxies from public.platform_settings;
  if v_seen <> '' and cardinality(coalesce(v_proxies, '{}')) > 0 and not (v_seen = any (v_proxies)) then
    v_ip := v_seen;
  end if;

  v_key := p_method || ':' || v_emp.id || ':' || p_client_id;
  select id into v_id from public.attendance_punches where organization_id = v_emp.organization_id and source_key = v_key;
  if v_id is not null then return v_id; end if;  -- already synced

  -- A punch that says what it is keeps the day in order, as it stood at the punch's time (offline phones sync later).
  if p_kind is not null then
    select timezone into v_tz from public.organizations where id = v_emp.organization_id;
    select w into v_window
      from unnest(array[app.work_window(v_emp.id, (v_at at time zone v_tz)::date),
                        app.work_window(v_emp.id, (v_at at time zone v_tz)::date - 1),
                        app.work_window(v_emp.id, (v_at at time zone v_tz)::date + 1)]) with ordinality t(w, n)
     where v_at <@ w order by n limit 1;
    select * into v_state from app.punch_state(v_emp.id, v_window, v_at);
    if p_kind = 'in' and v_state.checked_in then
      raise exception 'You’re already checked in.' using errcode = '22023';
    elsif p_kind <> 'in' and not v_state.checked_in then
      raise exception 'Check in first.' using errcode = '22023';
    elsif p_kind in ('lunch_start', 'break_start') and v_state.paused is not null then
      raise exception 'You’re on % already: end it first.', case v_state.paused when 'lunch' then 'lunch' else 'a break' end using errcode = '22023';
    elsif p_kind = 'lunch_end' and v_state.paused is distinct from 'lunch' then
      raise exception 'You aren’t on lunch.' using errcode = '22023';
    elsif p_kind = 'break_end' and v_state.paused is distinct from 'break' then
      raise exception 'You aren’t on a break.' using errcode = '22023';
    end if;
  end if;

  -- The rule's checks (for live punches; offline phone punches synced later are judged by flags below).
  v_shift := app.shift_for(v_emp.id, (v_at at time zone (select timezone from public.organizations where id = v_emp.organization_id))::date);
  select count(*), bool_or(app.zone_distance_m(g, p_latitude, p_longitude) <= least(coalesce(p_accuracy_m, 0), 150))
    into v_fences, v_inside
    from public.geofences g where g.organization_id = v_emp.organization_id and g.location_id = v_emp.location_id and g.is_active;
  if coalesce(v_shift.verify_ip, false) and p_method = 'web' then
    select allowed_ips into v_ips from public.attendance_settings where organization_id = v_emp.organization_id;
    if cardinality(coalesce(v_ips, '{}')) > 0 and (v_ip is null or not (v_ip = any (v_ips))) then
      raise exception 'Your attendance rule needs you to check in from the office network.' using errcode = '42501';
    end if;
  end if;
  if coalesce(v_shift.verify_geofence, false) and v_fences > 0 and v_fresh then
    if p_latitude is null or p_longitude is null then
      raise exception 'Your attendance rule needs your location. Allow location access and try again.' using errcode = '42501';
    elsif not coalesce(v_inside, false) then
      raise exception 'You’re outside the workplace area for your attendance rule.' using errcode = '42501';
    end if;
  end if;
  if coalesce(v_shift.verify_selfie, false) and p_selfie_path is null and (p_method = 'web' or v_fresh) then
    raise exception 'Your attendance rule needs a selfie with every punch.' using errcode = '42501';
  end if;

  -- Last, the photo: it must have reached storage just now (the app server stores it right before the punch), and count once.
  if p_selfie_path is not null and not exists (
       select 1 from storage.objects o
        where o.bucket_id = 'attendance-selfies' and o.name = p_selfie_path and o.created_at > now() - interval '15 minutes') then
    raise exception 'The selfie didn’t arrive. Please take it again.' using errcode = '22023';
  end if;
  if p_selfie_path is not null and exists (select 1 from public.attendance_punches where selfie_path = p_selfie_path) then
    raise exception 'That selfie was already used for a punch. Please take a new one.' using errcode = '22023';
  end if;

  insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key, latitude, longitude, accuracy_m, ip, selfie_path, kind)
  values (v_emp.organization_id, v_emp.id, v_at, p_method, v_key, p_latitude, p_longitude, p_accuracy_m, left(v_ip, 64), p_selfie_path, p_kind)
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
  if coalesce(v_shift.verify_selfie, false) and p_method = 'mobile' and p_selfie_path is null then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'no_selfie', 'Mobile punch without a selfie under a rule that asks for one.');
  end if;
  if v_late then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'late_sync',
            'Punch sent ' || case when now() - v_at < interval '1 hour' then round(extract(epoch from now() - v_at) / 60) || ' minute(s)'
                                  else round(extract(epoch from now() - v_at) / 3600) || ' hour(s)' end
            || ' after the time it gives (offline device, or a changed clock).');
  end if;
  return v_id;
end $$;

revoke all on function public.record_punch(text, timestamptz, public.punch_method, numeric, numeric, integer, uuid, text, text, public.punch_kind) from public, anon;
grant execute on function public.record_punch(text, timestamptz, public.punch_method, numeric, numeric, integer, uuid, text, text, public.punch_kind) to authenticated, service_role;
