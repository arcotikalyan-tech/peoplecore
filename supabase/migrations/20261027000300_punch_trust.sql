-- PeopleCore · Check-ins the rules can trust.
--
-- record_punch can be called by any signed-in employee straight from a browser, so everything the caller sends was
-- trusted as is:
-- * Time: any time back to 72 hours was accepted and only flagged past an hour, so a clock set back 59 minutes gave an
--   on-time check-in. A punch sent within 5 minutes of now now takes the server's time; older ones (offline phones)
--   keep theirs and are flagged for review from 5 minutes.
-- * Location: "inside" meant within the reported accuracy of the zone, and the accuracy could be anything up to 100 km.
--   Accuracy now counts for at most 150 m.
-- * Selfie: a fresh phone punch skipped the selfie by saying it came from the phone. A punch sent within 10 minutes
--   under a rule that asks for a selfie needs one whichever app sent it; older phone punches are still recorded and
--   flagged.
-- * Office network: the IP is whatever the caller says. When the platform lists the app servers' addresses
--   (platform_settings.trusted_proxy_ips), a call that didn't come through them is judged by the address the database
--   saw instead. Until then the behaviour is unchanged, so web check-ins keep working.

alter table public.platform_settings add column trusted_proxy_ips text[] not null default '{}';
comment on column public.platform_settings.trusted_proxy_ips is
  'Addresses of the PeopleCore app servers. A punch whose request came from elsewhere is judged by that address, not the one it claims.';

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
    raise exception 'Your attendance rule needs a selfie to check in.' using errcode = '42501';
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

  insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key, latitude, longitude, accuracy_m, ip, selfie_path)
  values (v_emp.organization_id, v_emp.id, v_at, p_method, v_key, p_latitude, p_longitude, p_accuracy_m, left(v_ip, 64), p_selfie_path)
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
