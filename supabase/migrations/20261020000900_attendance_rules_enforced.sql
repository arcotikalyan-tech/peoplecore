-- PeopleCore · Attendance rules enforced, rotating shifts, and the attendance reminders.
--
-- * A rule's verification switches now decide at check-in instead of only flagging afterwards:
--   - office network (web check-ins): the address must be one of the organization's allowed IPs (when any are set);
--   - geofence: where the workplace has a geofence, the location must be inside it;
--   - selfie (web check-ins): a photo must be attached. The mobile app can't take selfies yet, so its punches are
--     flagged for review instead of refused.
--   Selfies are kept in the private attendance-selfies bucket (written by the app server only).
-- * Rotating shifts: a pattern of shifts that advances every N days from a start date; people on a rotation get the
--   shift for the day from it (an explicit roster assignment still wins).
-- * Reminders, as the attendance settings promise: missing check-out (10 am, for yesterday), a pending-approvals digest
--   for approvers (9 am) and late-arrival alerts to managers (11 am), once a day each, in the organization's time.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-selfies', 'attendance-selfies', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

alter table public.attendance_punches
  add column selfie_path text check (selfie_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  add column ip text check (char_length(ip) <= 64);

-- ─── Rotating shifts ────────────────────────────────────────────────────────

create table public.shift_rotations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  pattern          uuid[] not null check (cardinality(pattern) between 2 and 12),
  period_days      smallint not null default 7 check (period_days between 1 and 31),
  start_date       date not null,
  created_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);
create trigger shift_rotations_audit after insert or update or delete on public.shift_rotations for each row execute function app.audit_row();

-- Every shift in the pattern belongs to the same organization.
create function app.check_rotation_pattern() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.shifts s where s.organization_id = new.organization_id and s.id = any (new.pattern))
     <> (select count(distinct x) from unnest(new.pattern) x) then
    raise exception 'Every shift in the rotation must be one of your shifts.' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger shift_rotations_pattern before insert or update on public.shift_rotations for each row execute function app.check_rotation_pattern();

create table public.rotation_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  rotation_id      uuid not null,
  effective_from   date not null,
  effective_to     date,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, rotation_id) references public.shift_rotations (organization_id, id) on delete cascade
);
create index rotation_assignments_employee_idx on public.rotation_assignments (employee_id, effective_from);
create trigger rotation_assignments_audit after insert or update or delete on public.rotation_assignments for each row execute function app.audit_row();

alter table public.shift_rotations enable row level security;
alter table public.rotation_assignments enable row level security;
create policy shift_rotations_select on public.shift_rotations for select to authenticated using (app.is_member(organization_id));
create policy shift_rotations_write on public.shift_rotations for all to authenticated
  using (app.has_permission(organization_id, 'attendance.manage')) with check (app.has_permission(organization_id, 'attendance.manage'));
create policy rotation_assignments_select on public.rotation_assignments for select to authenticated
  using (app.has_permission(organization_id, 'attendance.manage') or app.is_own_employee(employee_id) or app.is_in_reporting_line(organization_id, employee_id));
create policy rotation_assignments_write on public.rotation_assignments for all to authenticated
  using (app.has_permission(organization_id, 'attendance.manage')) with check (app.has_permission(organization_id, 'attendance.manage'));
grant select, insert, update, delete on public.shift_rotations, public.rotation_assignments to authenticated;
grant all on public.shift_rotations, public.rotation_assignments to service_role;

-- The shift for a day: an explicit roster assignment, else the rotation's shift for that day, else the default.
create or replace function app.shift_for(p_employee uuid, p_date date) returns public.shifts
language sql stable security definer set search_path = '' as $$
  select s.* from public.shifts s
   where s.id = coalesce(
     (select r.shift_id from public.roster_assignments r
       where r.employee_id = p_employee and r.effective_from <= p_date and (r.effective_to is null or r.effective_to >= p_date)
       order by r.effective_from desc limit 1),
     (select ro.pattern[1 + (((p_date - ro.start_date) / ro.period_days) % cardinality(ro.pattern) + cardinality(ro.pattern)) % cardinality(ro.pattern)]
        from public.rotation_assignments ra join public.shift_rotations ro on ro.id = ra.rotation_id
       where ra.employee_id = p_employee and ra.effective_from <= p_date and (ra.effective_to is null or ra.effective_to >= p_date)
       order by ra.effective_from desc limit 1),
     (select d.id from public.shifts d join public.employees e on e.organization_id = d.organization_id
       where e.id = p_employee and d.is_default));
$$;

-- ─── Check-in with the rule's checks ────────────────────────────────────────

drop function public.record_punch(text, timestamptz, public.punch_method, numeric, numeric, integer, uuid);

create function public.record_punch(
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
  select count(*), bool_or(app.distance_m(g.latitude, g.longitude, p_latitude, p_longitude) <= g.radius_m + coalesce(p_accuracy_m, 0))
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
revoke all on function public.record_punch(text, timestamptz, public.punch_method, numeric, numeric, integer, uuid, text, text) from public, anon;
grant execute on function public.record_punch(text, timestamptz, public.punch_method, numeric, numeric, integer, uuid, text, text) to authenticated, service_role;

-- Where the selfie of a punch is, for people who may see the punch (the employee, their line, attendance admins).
create function public.punch_selfie(p_punch uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.attendance_punches;
begin
  select * into p from public.attendance_punches where id = p_punch;
  if p.id is null or not (app.is_own_employee(p.employee_id) or app.has_permission(p.organization_id, 'attendance.manage')
                          or app.is_in_reporting_line(p.organization_id, p.employee_id)) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return p.selfie_path;
end $$;
revoke all on function public.punch_selfie(uuid) from public;
grant execute on function public.punch_selfie(uuid) to authenticated;

-- ─── Reminders ──────────────────────────────────────────────────────────────

alter table public.attendance_settings
  add column last_checkout_reminder date,
  add column last_digest date,
  add column last_late_alert date;

create function public.worker_attendance_reminders() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  o        record;
  r        record;
  v_local  timestamp;
  v_today  date;
  n_out    int := 0;
  n_digest int := 0;
  n_late   int := 0;
begin
  for o in select org.id, org.timezone, coalesce(s.remind_missing_checkout, true) as remind_out, coalesce(s.pending_digest, true) as digest,
                  coalesce(s.late_punch_alert, false) as late, s.last_checkout_reminder, s.last_digest, s.last_late_alert
             from public.organizations org left join public.attendance_settings s on s.organization_id = org.id loop
    v_local := now() at time zone o.timezone;
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
  end loop;
  return jsonb_build_object('missing_checkout', n_out, 'digests', n_digest, 'late_alerts', n_late);
end $$;
revoke all on function public.worker_attendance_reminders() from public, anon, authenticated;
grant execute on function public.worker_attendance_reminders() to service_role;
