-- PeopleCore · Attendance anomaly detector (docs/06-ai-architecture.md: flag only, never proof; T10 spoofed attendance).
--
-- Each hour the worker looks at phone and web punches received in the last two days and flags, once per punch, for
-- review under Attendance › Approvals:
-- * impossible_travel: more than 20 km from the person's previous punch with a location, at over 150 km/h;
-- * poor_location: the phone reported its location only to within more than 1 km;
-- * odd_hours: more than 4 hours before the start or 6 hours after the end of the day's attendance rule (rules that
--   run past midnight are left alone).
-- A flag is a question for a person, not a verdict: the punch counts as usual until someone acts on it.

create function app.distance_km(p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric) returns numeric
language sql immutable set search_path = '' as $$
  select (2 * 6371 * asin(sqrt(power(sin(radians(p_lat2 - p_lat1) / 2), 2)
                               + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lon2 - p_lon1) / 2), 2))))::numeric;
$$;
grant execute on function app.distance_km(numeric, numeric, numeric, numeric) to authenticated, service_role;

create function public.worker_attendance_anomalies(p_since interval default interval '2 days') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_travel integer;
  v_location integer;
  v_hours integer;
begin
  with recent as (
    select p.*, lag(p.latitude) over w as prev_lat, lag(p.longitude) over w as prev_lon, lag(p.punched_at) over w as prev_at
      from public.attendance_punches p
     where p.latitude is not null and p.longitude is not null
       and p.employee_id in (select employee_id from public.attendance_punches where received_at > now() - p_since and method in ('mobile', 'web'))
       and p.punched_at > now() - p_since - interval '1 day'
    window w as (partition by p.employee_id order by p.punched_at, p.id)
  ), moved as (
    select r.*, app.distance_km(r.prev_lat, r.prev_lon, r.latitude, r.longitude) as km,
           greatest(extract(epoch from r.punched_at - r.prev_at) / 3600, 1.0 / 60) as hours
      from recent r
     where r.prev_lat is not null and r.received_at > now() - p_since and r.method in ('mobile', 'web')
  ), flagged as (
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    select m.organization_id, m.employee_id, 'punch', m.id, 'impossible_travel',
           round(m.km) || ' km from the previous punch in ' || greatest(1, round(m.hours * 60)) || ' minutes (about '
             || round(m.km / m.hours) || ' km/h). The location may be spoofed, or someone else punched.'
      from moved m
     where m.km > 20 and m.km / m.hours > 150
    on conflict (subject_type, subject_id, rule) do nothing
    returning 1)
  select count(*) into v_travel from flagged;

  with flagged as (
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    select p.organization_id, p.employee_id, 'punch', p.id, 'poor_location',
           'The phone gave its location only to within ' || round(p.accuracy_m / 1000.0, 1) || ' km, too rough to confirm where the punch was made.'
      from public.attendance_punches p
     where p.received_at > now() - p_since and p.method in ('mobile', 'web') and p.accuracy_m > 1000
    on conflict (subject_type, subject_id, rule) do nothing
    returning 1)
  select count(*) into v_location from flagged;

  with local as (
    select p.*, (p.punched_at at time zone o.timezone) as at_local, s.start_time, s.end_time
      from public.attendance_punches p
      join public.organizations o on o.id = p.organization_id
      cross join lateral app.shift_for(p.employee_id, (p.punched_at at time zone o.timezone)::date) s
     where p.received_at > now() - p_since and p.method in ('mobile', 'web') and s.id is not null and s.end_time > s.start_time
  ), flagged as (
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    select l.organization_id, l.employee_id, 'punch', l.id, 'odd_hours',
           'Punched at ' || to_char(l.at_local, 'HH24:MI') || ', far outside the ' || to_char(l.start_time, 'HH24:MI') || '–'
             || to_char(l.end_time, 'HH24:MI') || ' attendance rule for the day.'
      from local l
     where l.at_local::time < l.start_time - interval '4 hours' and l.start_time >= time '04:00'
        or l.at_local::time > l.end_time + interval '6 hours' and l.end_time <= time '18:00'
    on conflict (subject_type, subject_id, rule) do nothing
    returning 1)
  select count(*) into v_hours from flagged;

  return jsonb_build_object('impossible_travel', v_travel, 'poor_location', v_location, 'odd_hours', v_hours);
end $$;
revoke all on function public.worker_attendance_anomalies(interval) from public, anon, authenticated;
grant execute on function public.worker_attendance_anomalies(interval) to service_role;
