-- PeopleCore · Check-in photos from the phone app, and stricter checks on every check-in photo.
-- * The phone app takes a selfie at check-in and check-out when the attendance rule asks for one, and sends it with
--   the punch to the app server (/api/mobile/punch), which stores it in the private attendance-selfies bucket under
--   the employee's own folder and records the punch as them. Files still only ever reach storage through the server.
-- * record_punch now requires the photo to be in storage, arrived within 15 minutes, and not used by another punch;
--   a photo can be used once (a unique index too). Phone punches under a selfie rule are flagged only when they come
--   without a photo (offline punches synced without one).

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
  -- The photo must have reached storage just now (the app server stores it right before the punch), and count once.
  if p_selfie_path is not null and not exists (
       select 1 from storage.objects o
        where o.bucket_id = 'attendance-selfies' and o.name = p_selfie_path and o.created_at > now() - interval '15 minutes') then
    raise exception 'The selfie didn’t arrive. Please take it again.' using errcode = '22023';
  end if;
  if p_selfie_path is not null and exists (select 1 from public.attendance_punches where selfie_path = p_selfie_path) then
    raise exception 'That selfie was already used for a punch. Please take a new one.' using errcode = '22023';
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
  if coalesce(v_shift.verify_selfie, false) and p_method = 'mobile' and p_selfie_path is null then
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

create unique index attendance_punches_selfie_uq on public.attendance_punches (selfie_path) where selfie_path is not null;
