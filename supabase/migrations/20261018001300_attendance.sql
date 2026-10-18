-- PeopleCore · Attendance and shifts (Phase 3).
--
-- * Shifts and effective-dated roster assignments (an organization default shift covers everyone else).
-- * Punches are raw and immutable. Each carries a source key (client punch id from web/mobile, or device
--   serial + record id from a biometric device), so retries and offline sync insert it exactly once.
--   Punches more than 2 minutes in the future are refused; offline punches up to 72 hours old are accepted
--   and flagged when they arrive late.
-- * Geofences per location: a punch outside every fence (or without a location where fences exist) is
--   flagged for review, never silently refused. Anomalies are evidence for a person to review, not proof.
-- * attendance_days is DERIVED (a cache), recomputed from punches, shifts, the holiday calendar and approved
--   leave. The monthly summary recomputes its month first, so it is reproducible from the source data.
-- * Regularization (a missed or wrong punch) goes through the approvals engine; approval adds punches marked
--   'regularization' and recomputes the day.

-- ─── Permissions ────────────────────────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('attendance.manage', 'attendance', 'Configure shifts, rosters, geofences and devices; import punches', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'attendance.manage', 'org'), ('hr_admin', 'attendance.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'attendance.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Shifts and rosters ─────────────────────────────────────────────────────

create table public.shifts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  code               text not null check (code ~ '^[A-Z0-9_-]{1,12}$'),
  name               text not null check (char_length(name) between 2 and 60),
  start_time         time not null,
  end_time           time not null,
  break_minutes      smallint not null default 60 check (break_minutes between 0 and 240),
  grace_minutes      smallint not null default 15 check (grace_minutes between 0 and 240),
  full_day_minutes   smallint not null default 480 check (full_day_minutes between 60 and 1440),
  half_day_minutes   smallint not null default 240 check (half_day_minutes between 30 and 1440),
  is_default         boolean not null default false,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  check (half_day_minutes <= full_day_minutes)
);
create unique index shifts_default_uq on public.shifts (organization_id) where is_default;

create table public.roster_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  shift_id         uuid not null,
  effective_from   date not null,
  effective_to     date,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, shift_id) references public.shifts (organization_id, id),
  exclude using gist (employee_id with =, daterange(effective_from, effective_to, '[]') with &&)
);

create table public.geofences (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  name             text not null check (char_length(name) between 2 and 80),
  latitude         numeric(9,6) not null check (latitude between -90 and 90),
  longitude        numeric(9,6) not null check (longitude between -180 and 180),
  radius_m         integer not null check (radius_m between 20 and 5000),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);

create table public.biometric_devices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  serial_number    text not null check (serial_number ~ '^[A-Za-z0-9_-]{3,60}$'),
  name             text not null check (char_length(name) between 2 and 80),
  location_id      uuid,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, serial_number),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);

-- ─── Punches (raw, immutable) ───────────────────────────────────────────────

create type public.punch_method as enum ('web', 'mobile', 'biometric', 'import', 'regularization');

create table public.attendance_punches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  punched_at       timestamptz not null,
  method           public.punch_method not null,
  source_key       text not null check (char_length(source_key) between 1 and 200),
  device_id        uuid,
  latitude         numeric(9,6) check (latitude between -90 and 90),
  longitude        numeric(9,6) check (longitude between -180 and 180),
  accuracy_m       integer check (accuracy_m between 0 and 100000),
  received_at      timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  unique (organization_id, source_key),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, device_id) references public.biometric_devices (organization_id, id)
);
create index attendance_punches_employee_idx on public.attendance_punches (employee_id, punched_at);

-- ─── Derived days, regularizations, anomalies ───────────────────────────────

create type public.attendance_status as enum ('present', 'half_day', 'absent', 'on_leave', 'weekly_off', 'holiday', 'not_marked');

create table public.attendance_days (
  organization_id   uuid not null,
  employee_id       uuid not null,
  work_date         date not null,
  shift_id          uuid,
  status            public.attendance_status not null,
  first_in          timestamptz,
  last_out          timestamptz,
  worked_minutes    integer not null default 0,
  late_minutes      integer not null default 0,
  punch_count       integer not null default 0,
  leave_days        numeric(3,1) not null default 0,  -- 0, 0.5 or 1 of approved leave on this day
  leave_paid        boolean,
  is_regularized    boolean not null default false,
  computed_at       timestamptz not null default now(),
  primary key (employee_id, work_date),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index attendance_days_org_date_idx on public.attendance_days (organization_id, work_date);

create table public.regularization_requests (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  employee_id          uuid not null,
  work_date            date not null,
  check_in             time,
  check_out            time,
  reason               text not null check (char_length(reason) between 3 and 500),
  status               public.leave_status not null default 'pending',
  approval_request_id  uuid,
  requested_by         uuid not null default auth.uid(),
  created_at           timestamptz not null default now(),
  decided_at           timestamptz,
  unique (organization_id, id),
  check (check_in is not null or check_out is not null),
  check (check_in is null or check_out is null or check_out > check_in),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create unique index regularization_pending_uq on public.regularization_requests (employee_id, work_date) where status = 'pending';

create table public.anomaly_flags (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  subject_type     text not null,
  subject_id       uuid not null,
  rule             text not null check (rule ~ '^[a-z_]{1,40}$'),
  explanation      text not null check (char_length(explanation) <= 500),
  status           text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (subject_type, subject_id, rule),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index anomaly_flags_open_idx on public.anomaly_flags (organization_id, status, created_at desc);

create trigger shifts_audit after insert or update or delete on public.shifts for each row execute function app.audit_row();
create trigger roster_assignments_audit after insert or update or delete on public.roster_assignments for each row execute function app.audit_row();
create trigger geofences_audit after insert or update or delete on public.geofences for each row execute function app.audit_row();
create trigger biometric_devices_audit after insert or update or delete on public.biometric_devices for each row execute function app.audit_row();
create trigger regularization_requests_audit after insert or update on public.regularization_requests for each row execute function app.audit_row();
create trigger anomaly_flags_audit after update on public.anomaly_flags for each row execute function app.audit_row();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.shifts enable row level security;
alter table public.roster_assignments enable row level security;
alter table public.geofences enable row level security;
alter table public.biometric_devices enable row level security;
alter table public.attendance_punches enable row level security;
alter table public.attendance_days enable row level security;
alter table public.regularization_requests enable row level security;
alter table public.anomaly_flags enable row level security;

do $$
declare t text;
begin
  foreach t in array array['shifts', 'geofences', 'biometric_devices'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.is_member(organization_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (app.has_permission(organization_id, ''attendance.manage'')) with check (app.has_permission(organization_id, ''attendance.manage''))', t);
  end loop;
end $$;

create policy roster_assignments_select on public.roster_assignments for select to authenticated
  using (app.has_permission(organization_id, 'attendance.manage') or app.can_access_employee(organization_id, employee_id, 'attendance.read'));
create policy roster_assignments_write on public.roster_assignments for all to authenticated
  using (app.has_permission(organization_id, 'attendance.manage')) with check (app.has_permission(organization_id, 'attendance.manage'));

create policy attendance_punches_select on public.attendance_punches for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'attendance.read'));
create policy attendance_days_select on public.attendance_days for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'attendance.read'));
create policy regularization_requests_select on public.regularization_requests for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'attendance.read')
         or (approval_request_id is not null and app.can_view_approval(approval_request_id)));
create policy anomaly_flags_select on public.anomaly_flags for select to authenticated
  using (app.has_permission(organization_id, 'attendance.manage')
         or (app.can_access_employee(organization_id, employee_id, 'attendance.approve')));

grant select, insert, update, delete on public.shifts, public.geofences, public.biometric_devices, public.roster_assignments to authenticated;
grant select on public.attendance_punches, public.attendance_days, public.regularization_requests, public.anomaly_flags to authenticated;
grant all on public.shifts, public.geofences, public.biometric_devices, public.roster_assignments, public.attendance_punches,
             public.attendance_days, public.regularization_requests, public.anomaly_flags to service_role;

-- ─── Day computation ────────────────────────────────────────────────────────

create function app.shift_for(p_employee uuid, p_date date) returns public.shifts
language sql stable security definer set search_path = '' as $$
  select s.* from public.shifts s
   where s.id = coalesce(
     (select r.shift_id from public.roster_assignments r
       where r.employee_id = p_employee and r.effective_from <= p_date and (r.effective_to is null or r.effective_to >= p_date)),
     (select d.id from public.shifts d join public.employees e on e.organization_id = d.organization_id
       where e.id = p_employee and d.is_default));
$$;

-- Recomputes one employee-day from the source data and stores it. Days in the future are not stored.
create function app.compute_attendance_day(p_employee uuid, p_date date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp       public.employees;
  v_tz        text;
  v_today     date;
  v_shift     public.shifts;
  v_start     timestamptz;
  v_window    tstzrange;
  v_first     timestamptz;
  v_last      timestamptz;
  v_count     int;
  v_worked    int := 0;
  v_late      int := 0;
  v_calendar  uuid;
  v_off       boolean;
  v_holiday   boolean;
  v_leave     numeric := 0;
  v_paid      boolean;
  v_status    public.attendance_status;
  v_reg       boolean;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null then return; end if;
  select timezone into v_tz from public.organizations where id = v_emp.organization_id;
  v_today := app.org_today(v_emp.organization_id);
  if p_date > v_today or p_date < v_emp.date_of_joining or (v_emp.date_of_exit is not null and p_date > v_emp.date_of_exit) then
    delete from public.attendance_days where employee_id = p_employee and work_date = p_date;
    return;
  end if;

  v_shift := app.shift_for(p_employee, p_date);
  v_start := ((p_date + coalesce(v_shift.start_time, '09:00'::time))::timestamp at time zone v_tz);
  -- A work day collects punches from 4 hours before the shift start to 20 hours after it (night shifts).
  v_window := tstzrange(v_start - interval '4 hours', v_start + interval '20 hours', '[)');
  select min(punched_at), max(punched_at), count(*), bool_or(method = 'regularization')
    into v_first, v_last, v_count, v_reg
    from public.attendance_punches where employee_id = p_employee and punched_at <@ v_window;

  if v_count >= 2 then
    v_worked := greatest(0, (extract(epoch from v_last - v_first) / 60)::int
                            - case when extract(epoch from v_last - v_first) / 60 > coalesce(v_shift.half_day_minutes, 240)
                                   then coalesce(v_shift.break_minutes, 60) else 0 end);
  end if;
  if v_count >= 1 then
    v_late := greatest(0, (extract(epoch from v_first - v_start) / 60)::int - coalesce(v_shift.grace_minutes, 15));
  end if;

  v_calendar := app.employee_calendar(p_employee);
  select extract(dow from p_date)::smallint = any (weekly_offs) into v_off from public.holiday_calendars where id = v_calendar;
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

  v_status := case
    when v_worked >= coalesce(v_shift.full_day_minutes, 480) then 'present'
    when v_leave = 1 then 'on_leave'
    when v_holiday then 'holiday'
    when coalesce(v_off, false) then 'weekly_off'
    when v_worked >= coalesce(v_shift.half_day_minutes, 240) or (v_leave = 0.5 and v_count >= 1) then 'half_day'
    when v_leave = 0.5 then 'half_day'
    when p_date = v_today then 'not_marked'
    else 'absent'
  end;

  insert into public.attendance_days (organization_id, employee_id, work_date, shift_id, status, first_in, last_out, worked_minutes,
                                      late_minutes, punch_count, leave_days, leave_paid, is_regularized, computed_at)
  values (v_emp.organization_id, p_employee, p_date, v_shift.id, v_status, v_first, case when v_count >= 2 then v_last end,
          v_worked, v_late, v_count, v_leave, v_paid, coalesce(v_reg, false), now())
  on conflict (employee_id, work_date) do update set
    shift_id = excluded.shift_id, status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
    worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes, punch_count = excluded.punch_count,
    leave_days = excluded.leave_days, leave_paid = excluded.leave_paid, is_regularized = excluded.is_regularized,
    computed_at = excluded.computed_at;

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

-- Punches affect the day they fall in (and, for night shifts, the day before).
create function app.recompute_after_punch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_local date;
begin
  select (new.punched_at at time zone o.timezone)::date into v_local from public.organizations o where o.id = new.organization_id;
  perform app.compute_attendance_day(new.employee_id, v_local);
  perform app.compute_attendance_day(new.employee_id, v_local - 1);
  return null;
end $$;
create trigger attendance_punches_recompute after insert on public.attendance_punches
  for each row execute function app.recompute_after_punch();

-- ─── Recording punches ──────────────────────────────────────────────────────

create function app.distance_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric) returns double precision
language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians((p_lat2 - p_lat1)::double precision) / 2), 2)
    + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
      * power(sin(radians((p_lng2 - p_lng1)::double precision) / 2), 2)));
$$;

-- Self-service punch (web or mobile). Idempotent on p_client_id; returns the punch id.
create function public.record_punch(
  p_client_id   text,
  p_punched_at  timestamptz default null,
  p_method      public.punch_method default 'web',
  p_latitude    numeric default null,
  p_longitude   numeric default null,
  p_accuracy_m  integer default null,
  p_org         uuid default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp     public.employees;
  v_at      timestamptz := coalesce(p_punched_at, now());
  v_key     text;
  v_id      uuid;
  v_fences  int;
  v_inside  boolean;
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

  v_key := p_method || ':' || v_emp.id || ':' || p_client_id;
  select id into v_id from public.attendance_punches where organization_id = v_emp.organization_id and source_key = v_key;
  if v_id is not null then return v_id; end if;  -- already synced

  insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key, latitude, longitude, accuracy_m)
  values (v_emp.organization_id, v_emp.id, v_at, p_method, v_key, p_latitude, p_longitude, p_accuracy_m)
  on conflict (organization_id, source_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.attendance_punches where organization_id = v_emp.organization_id and source_key = v_key;
    return v_id;
  end if;

  -- Evidence for review, never automatic refusal.
  select count(*), bool_or(app.distance_m(g.latitude, g.longitude, p_latitude, p_longitude) <= g.radius_m + coalesce(p_accuracy_m, 0))
    into v_fences, v_inside
    from public.geofences g where g.organization_id = v_emp.organization_id and g.location_id = v_emp.location_id and g.is_active;
  if v_fences > 0 and (p_latitude is null or p_longitude is null) then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'no_location', 'Punch without a location where the workplace has a geofence.');
  elsif v_fences > 0 and not coalesce(v_inside, false) then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'outside_geofence', 'Punch recorded outside the workplace geofence.');
  end if;
  if now() - v_at > interval '1 hour' then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (v_emp.organization_id, v_emp.id, 'punch', v_id, 'late_sync',
            'Punch synced ' || round(extract(epoch from now() - v_at) / 3600) || ' hour(s) after it was made (offline device).');
  end if;
  return v_id;
end $$;

-- Biometric device logs (CSV export from the device): idempotent on device + record id.
create function public.import_device_punches(p_device uuid, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_dev      public.biometric_devices;
  v_row      jsonb;
  v_emp      uuid;
  v_inserted int := 0;
  v_skipped  int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_id       uuid;
  v_tz       text;
  v_at       timestamptz;
begin
  select * into v_dev from public.biometric_devices where id = p_device;
  if v_dev.id is null or not app.has_permission(v_dev.organization_id, 'attendance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'Import at most 20,000 records at a time.' using errcode = '22023';
  end if;
  select timezone into v_tz from public.organizations where id = v_dev.organization_id;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    select id into v_emp from public.employees where organization_id = v_dev.organization_id and employee_code = v_row ->> 'employee_code';
    if v_emp is null then
      v_errors := v_errors || jsonb_build_object('line', v_row -> 'line', 'message', format('Unknown employee code “%s”.', v_row ->> 'employee_code'));
      continue;
    end if;
    begin
      -- Devices export local wall-clock times: without an explicit offset, read them in the org's time zone.
      v_at := case when (v_row ->> 'punched_at') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
                   then (v_row ->> 'punched_at')::timestamptz
                   else (v_row ->> 'punched_at')::timestamp at time zone v_tz end;
      insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key, device_id)
      values (v_dev.organization_id, v_emp, v_at, 'biometric',
              'device:' || v_dev.serial_number || ':' || (v_row ->> 'record_id'), v_dev.id)
      on conflict (organization_id, source_key) do nothing
      returning id into v_id;
      if v_id is null then v_skipped := v_skipped + 1; else v_inserted := v_inserted + 1; end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('line', v_row -> 'line', 'message', 'Invalid date or record.');
    end;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_skipped, 'errors', v_errors);
end $$;

-- ─── Regularization ─────────────────────────────────────────────────────────

create function public.request_regularization(p_employee uuid, p_date date, p_in time default null, p_out time default null, p_reason text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp public.employees;
  v_id  uuid;
  v_req uuid;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null or not app.is_member(v_emp.organization_id)
     or not (v_emp.user_id = auth.uid() or app.has_permission(v_emp.organization_id, 'attendance.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_date >= app.org_today(v_emp.organization_id) then
    raise exception 'Regularize days that have ended; today can still be punched.' using errcode = '22023';
  end if;
  if p_date < app.org_today(v_emp.organization_id) - 60 then
    raise exception 'Only the last 60 days can be regularized.' using errcode = '22023';
  end if;
  if p_in is null and p_out is null then
    raise exception 'Give the check-in time, the check-out time, or both.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why the day needs correcting.' using errcode = '22023';
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

create function app.on_regularization_decided(p_request uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req public.regularization_requests;
  v_tz  text;
begin
  select * into v_req from public.regularization_requests where id = p_request for update;
  if v_req.id is null or v_req.status <> 'pending' then return; end if;
  update public.regularization_requests
     set status = case p_outcome when 'approved' then 'approved' when 'rejected' then 'rejected' else 'cancelled' end::public.leave_status,
         decided_at = now()
   where id = p_request;
  if p_outcome = 'approved' then
    select timezone into v_tz from public.organizations where id = v_req.organization_id;
    if v_req.check_in is not null then
      insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key)
      values (v_req.organization_id, v_req.employee_id, (v_req.work_date + v_req.check_in)::timestamp at time zone v_tz,
              'regularization', 'reg:' || v_req.id || ':in')
      on conflict (organization_id, source_key) do nothing;
    end if;
    if v_req.check_out is not null then
      insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key)
      values (v_req.organization_id, v_req.employee_id, (v_req.work_date + v_req.check_out)::timestamp at time zone v_tz,
              'regularization', 'reg:' || v_req.id || ':out')
      on conflict (organization_id, source_key) do nothing;
    end if;
    update public.anomaly_flags set status = 'resolved', reviewed_at = now(), reviewed_by = auth.uid()
     where employee_id = v_req.employee_id and rule = 'missing_punch' and status = 'open'
       and subject_id in (select p.id from public.attendance_punches p where p.employee_id = v_req.employee_id
                           and (p.punched_at at time zone v_tz)::date between v_req.work_date and v_req.work_date + 1);
    perform app.compute_attendance_day(v_req.employee_id, v_req.work_date);
  end if;
end $$;

insert into app.approval_handlers (subject_type, handler) values ('regularization', 'app.on_regularization_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label)
values ('regularization', 1, 'reporting_manager', 'attendance.approve', 'Reporting manager');

-- Reviewers close anomaly flags.
create function public.review_anomaly(p_flag uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_flag public.anomaly_flags;
begin
  select * into v_flag from public.anomaly_flags where id = p_flag;
  if v_flag.id is null or not (app.has_permission(v_flag.organization_id, 'attendance.manage')
                               or app.can_access_employee(v_flag.organization_id, v_flag.employee_id, 'attendance.approve')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'Resolve or dismiss.' using errcode = '22023';
  end if;
  if exists (select 1 from public.employees e where e.id = v_flag.employee_id and e.user_id = auth.uid()) then
    raise exception 'You can’t review flags on your own attendance.' using errcode = '42501';
  end if;
  update public.anomaly_flags set status = p_status, reviewed_by = auth.uid(), reviewed_at = now() where id = p_flag;
end $$;

-- ─── Monthly summary (payroll input) ────────────────────────────────────────

-- Recomputes every day of the month for the employees the caller can see, then summarizes. Same inputs,
-- same output: the summary is reproducible from punches, shifts, calendars and approved leave.
create function public.attendance_month_summary(p_org uuid, p_month date)
returns table (employee_id uuid, employee_code text, employee_name text, days_in_period int, present numeric, half_days int,
               absent int, paid_leave numeric, unpaid_leave numeric, weekly_offs int, holidays int, not_marked int,
               late_days int, payable_days numeric, lop_days numeric)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_last  date;
  e       record;
  d       date;
begin
  if not (app.has_permission(p_org, 'attendance.read') or app.has_permission(p_org, 'attendance.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_last := least(v_end, app.org_today(p_org));
  for e in select id from public.employees where organization_id = p_org and status <> 'pre_joining'
             and date_of_joining <= v_end and (date_of_exit is null or date_of_exit >= v_start) loop
    for d in select generate_series(v_start, v_last, interval '1 day')::date loop
      perform app.compute_attendance_day(e.id, d);
    end loop;
  end loop;

  return query
    select emp.id, emp.employee_code, trim(concat_ws(' ', emp.first_name, emp.last_name)),
           (v_end - v_start + 1)::int,
           sum(case when a.status = 'present' then 1 when a.status = 'half_day' then 0.5 else 0 end),
           count(*) filter (where a.status = 'half_day')::int,
           count(*) filter (where a.status = 'absent')::int,
           coalesce(sum(a.leave_days) filter (where a.leave_paid), 0),
           coalesce(sum(a.leave_days) filter (where a.leave_paid = false), 0),
           count(*) filter (where a.status = 'weekly_off')::int,
           count(*) filter (where a.status = 'holiday')::int,
           count(*) filter (where a.status = 'not_marked')::int,
           count(*) filter (where a.late_minutes > 0)::int,
           -- Payable: present + paid leave + weekly offs + holidays (half days count half; the other half is
           -- leave or LOP). Days after today are not judged yet.
           sum(case when a.status in ('present', 'weekly_off', 'holiday', 'not_marked') then 1
                    when a.status = 'half_day' then 0.5 + case when a.leave_paid then a.leave_days else 0 end
                    when a.status = 'on_leave' and a.leave_paid then 1 else 0 end),
           sum(case when a.status = 'absent' then 1
                    when a.status = 'on_leave' and a.leave_paid = false then 1
                    when a.status = 'half_day' and coalesce(a.leave_paid, false) = false then 0.5 else 0 end)
      from public.employees emp
      join public.attendance_days a on a.employee_id = emp.id and a.work_date between v_start and v_end
     where emp.organization_id = p_org
     group by emp.id, emp.employee_code, emp.first_name, emp.last_name
     order by emp.employee_code;
end $$;

-- One employee's month, recomputed from the source data first (for the employee's own view and managers).
create function public.attendance_days_for(p_employee uuid, p_month date)
returns setof public.attendance_days
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org   uuid := app.employee_org_or_deny(p_employee, 'attendance.read');
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, app.org_today(v_org));
  d       date;
begin
  for d in select generate_series(v_start, v_end, interval '1 day')::date loop
    perform app.compute_attendance_day(p_employee, d);
  end loop;
  return query select * from public.attendance_days where employee_id = p_employee and work_date between v_start and v_end order by work_date desc;
end $$;

-- Worker: keep the recent days fresh (absences appear the morning after, leave changes propagate).
create function public.worker_attendance_daily() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e record;
  d date;
  v_count int := 0;
begin
  for e in select id, organization_id from public.employees where status in ('active', 'on_notice') loop
    for d in select generate_series(app.org_today(e.organization_id) - 7, app.org_today(e.organization_id), interval '1 day')::date loop
      perform app.compute_attendance_day(e.id, d);
      v_count := v_count + 1;
    end loop;
  end loop;
  return jsonb_build_object('days', v_count);
end $$;

-- ─── Defaults ───────────────────────────────────────────────────────────────

create function app.seed_org_attendance(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.shifts (organization_id, code, name, start_time, end_time, is_default)
  select p_org, 'GEN', 'General shift', '09:30', '18:30', true
   where not exists (select 1 from public.shifts where organization_id = p_org);
$$;
create function app.seed_org_attendance_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_attendance(new.id);
  return null;
end $$;
create trigger organizations_seed_attendance after insert on public.organizations
  for each row execute function app.seed_org_attendance_trigger();
select app.seed_org_attendance(id), app.seed_org_flows(id, 'regularization') from public.organizations;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function app.shift_for(uuid, date) from public;
revoke all on function app.compute_attendance_day(uuid, date) from public;
revoke all on function app.recompute_after_punch() from public;
revoke all on function app.on_regularization_decided(uuid, text) from public;
revoke all on function app.seed_org_attendance(uuid) from public;
revoke all on function app.seed_org_attendance_trigger() from public;
grant execute on function app.distance_m(numeric, numeric, numeric, numeric) to authenticated, service_role;
revoke all on function public.record_punch(text, timestamptz, public.punch_method, numeric, numeric, integer, uuid) from public, anon;
revoke all on function public.import_device_punches(uuid, jsonb) from public, anon;
revoke all on function public.request_regularization(uuid, date, time, time, text) from public, anon;
revoke all on function public.review_anomaly(uuid, text) from public, anon;
revoke all on function public.attendance_month_summary(uuid, date) from public, anon;
revoke all on function public.attendance_days_for(uuid, date) from public, anon;
grant execute on function public.attendance_days_for(uuid, date) to authenticated, service_role;
revoke all on function public.worker_attendance_daily() from public, anon, authenticated;
grant execute on function public.record_punch(text, timestamptz, public.punch_method, numeric, numeric, integer, uuid) to authenticated, service_role;
grant execute on function public.import_device_punches(uuid, jsonb) to authenticated, service_role;
grant execute on function public.request_regularization(uuid, date, time, time, text) to authenticated, service_role;
grant execute on function public.review_anomaly(uuid, text) to authenticated, service_role;
grant execute on function public.attendance_month_summary(uuid, date) to authenticated, service_role;
grant execute on function public.worker_attendance_daily() to service_role;
