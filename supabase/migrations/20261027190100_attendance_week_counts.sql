-- Daily attendance counts for the attendance hub's trend lines. The hub read every attendance day of the week (about
-- seven rows per employee, a thousand rows per request, one request after another) only to count them; this counts in
-- the database instead, as the caller (security invoker: row-level security decides which days are counted).
-- Anomaly flags are counted by their UTC day, as the hub did. At most 62 days per call.

create or replace function public.attendance_week_counts(p_org uuid, p_from date, p_to date)
returns table (work_date date, at_work bigint, late bigint, on_leave bigint, absent bigint, flags bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  span as (
    select g::date as work_date
    from generate_series(p_from, least(p_to, p_from + 61), interval '1 day') as g
  ),
  days as (
    select a.work_date,
      count(*) filter (where a.status in ('present', 'half_day', 'on_duty', 'wfh')) as at_work,
      count(*) filter (where a.status in ('present', 'half_day', 'on_duty', 'wfh') and a.late_minutes > 0) as late,
      count(*) filter (where a.status = 'on_leave') as on_leave,
      count(*) filter (where a.status = 'absent') as absent
    from public.attendance_days a
    where a.organization_id = p_org and a.work_date between p_from and least(p_to, p_from + 61)
    group by a.work_date
  ),
  flagged as (
    select (f.created_at at time zone 'UTC')::date as work_date, count(*) as n
    from public.anomaly_flags f
    where f.organization_id = p_org and f.created_at >= (p_from::timestamp at time zone 'UTC')
    group by 1
  )
  select s.work_date, coalesce(d.at_work, 0), coalesce(d.late, 0), coalesce(d.on_leave, 0), coalesce(d.absent, 0), coalesce(f.n, 0)
  from span s
  left join days d on d.work_date = s.work_date
  left join flagged f on f.work_date = s.work_date
  order by s.work_date;
$$;

revoke all on function public.attendance_week_counts(uuid, date, date) from public;
grant execute on function public.attendance_week_counts(uuid, date, date) to authenticated;
grant execute on function public.attendance_week_counts(uuid, date, date) to service_role;

comment on function public.attendance_week_counts(uuid, date, date) is
  'Per-day attendance and anomaly counts for the attendance hub''s trends, as the caller (row-level security applies); at most 62 days.';
