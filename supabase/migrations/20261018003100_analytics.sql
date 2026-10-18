-- Analytics for dashboards, the Insights page and the reporting copilot (Phase 7).
--
-- * Every function is SECURITY INVOKER: it runs as the caller, so row-level security decides what it counts. HR's
--   figures cover the organization, a manager's their reporting line, an employee's only themselves; payroll
--   figures need payroll access. `analytics_scope` says which, so an answer can say what it covers.
-- * Only aggregates come back, never individual rows or names.
-- * Periods are capped (three years of months) so a question can't ask for an unbounded scan.

create function public.analytics_scope(p_org uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'scope', case when app.has_permission(p_org, 'employee.read') then 'organization'
                  when exists (select 1 from app.permission_scopes(p_org, 'employee.read') s where s = 'team') then 'reporting_line'
                  else 'self' end,
    'employees_visible', (select count(*) from public.employees e where e.organization_id = p_org and e.status not in ('pre_joining', 'exited')),
    'today', (now() at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'Asia/Kolkata'))::date);
$$;

-- People employed on a day (joined on or before it, not yet left), grouped. Uses each person's current
-- department, location and designation: moves within the organization aren't replayed.
create function public.analytics_headcount(p_org uuid, p_as_of date default null, p_group text default 'department')
returns table (label text, headcount bigint)
language sql stable security invoker set search_path = '' as $$
  with d as (
    select coalesce(p_as_of, (now() at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'Asia/Kolkata'))::date) as day
  ),
  e as (
    select e.* from public.employees e, d
     where e.organization_id = p_org and e.status <> 'pre_joining'
       and e.date_of_joining <= d.day and (e.date_of_exit is null or e.date_of_exit >= d.day)
  )
  select coalesce(case p_group
           when 'department' then (select x.name from public.departments x where x.id = e.department_id)
           when 'location' then (select x.name from public.locations x where x.id = e.location_id)
           when 'designation' then (select x.title from public.designations x where x.id = e.designation_id)
           when 'employment_type' then e.employment_type::text
           else 'Everyone' end, 'Not set') as label,
         count(*) as headcount
    from e
   group by 1
   order by 2 desc, 1;
$$;

-- Joiners and leavers per month, and how many were employed at the end of each month.
create function public.analytics_movements(p_org uuid, p_from date, p_to date)
returns table (month date, joiners bigint, leavers bigint, headcount_end bigint)
language sql stable security invoker set search_path = '' as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as m
     where p_from <= p_to and p_to - p_from <= 1100
  ),
  e as (
    select date_of_joining, date_of_exit from public.employees where organization_id = p_org and status <> 'pre_joining'
  )
  select m.m,
         (select count(*) from e where e.date_of_joining >= m.m and e.date_of_joining < (m.m + interval '1 month')::date),
         (select count(*) from e where e.date_of_exit >= m.m and e.date_of_exit < (m.m + interval '1 month')::date),
         (select count(*) from e where e.date_of_joining < (m.m + interval '1 month')::date
                                   and (e.date_of_exit is null or e.date_of_exit >= (m.m + interval '1 month')::date))
    from months m
   order by m.m;
$$;

-- Approved leave overlapping the period, by type (a request's days count in full).
create function public.analytics_leave(p_org uuid, p_from date, p_to date)
returns table (leave_type text, requests bigint, days numeric, people bigint)
language sql stable security invoker set search_path = '' as $$
  select t.name, count(*), sum(r.days), count(distinct r.employee_id)
    from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
   where r.organization_id = p_org and r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
     and p_to - p_from <= 1100
   group by t.name
   order by 3 desc, 1;
$$;

create function public.analytics_attendance(p_org uuid, p_from date, p_to date)
returns table (status text, days bigint, people bigint, late_days bigint)
language sql stable security invoker set search_path = '' as $$
  select a.status::text, count(*), count(distinct a.employee_id), count(*) filter (where a.late_minutes > 0)
    from public.attendance_days a
   where a.organization_id = p_org and a.work_date between p_from and p_to and p_to - p_from <= 1100
   group by 1
   order by 2 desc, 1;
$$;

-- Approved and locked payroll runs, newest first (payroll staff; org-wide compensation readers see locked runs).
create function public.analytics_payroll(p_org uuid, p_months int default 6)
returns table (month date, status text, employees int, gross numeric, deductions numeric, net numeric, employer_cost numeric)
language sql stable security invoker set search_path = '' as $$
  select r.period_month, r.status::text, r.employee_count, r.total_gross, r.total_deductions, r.total_net, r.total_employer_cost
    from public.payroll_runs r
   where r.organization_id = p_org and r.status in ('approved', 'locked')
   order by r.period_month desc
   limit least(greatest(coalesce(p_months, 6), 1), 24);
$$;

create function public.analytics_recruitment(p_org uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'open_requisitions', (select count(*) from public.job_requisitions q where q.organization_id = p_org and q.status = 'open'),
    'openings', (select coalesce(sum(q.openings), 0) from public.job_requisitions q where q.organization_id = p_org and q.status = 'open'),
    'applications_by_stage', coalesce((
      select jsonb_object_agg(s.stage, s.n) from (
        select a.stage::text as stage, count(*) as n
          from public.applications a join public.job_requisitions q on q.id = a.requisition_id
         where a.organization_id = p_org and q.status = 'open'
         group by 1) s), '{}'::jsonb),
    'hired_last_90_days', (select count(*) from public.applications a
                            where a.organization_id = p_org and a.stage = 'hired' and a.stage_changed_at > now() - interval '90 days'));
$$;

create function public.analytics_helpdesk(p_org uuid, p_from date, p_to date)
returns table (status text, tickets bigint, breached bigint, median_hours_to_resolve numeric)
language sql stable security invoker set search_path = '' as $$
  select t.status::text, count(*), count(*) filter (where t.breached_at is not null),
         round((percentile_cont(0.5) within group (order by extract(epoch from (t.resolved_at - t.created_at)) / 3600)
                filter (where t.resolved_at is not null))::numeric, 1)
    from public.tickets t
   where t.organization_id = p_org and t.created_at::date between p_from and p_to and p_to - p_from <= 1100
   group by 1
   order by 2 desc, 1;
$$;

create function public.analytics_learning(p_org uuid)
returns table (course text, assigned bigint, completed bigint, overdue bigint)
language sql stable security invoker set search_path = '' as $$
  select c.title, count(*), count(*) filter (where n.status = 'completed'),
         count(*) filter (where n.status not in ('completed', 'cancelled')
                            and n.due_on < (now() at time zone coalesce((select o.timezone from public.organizations o where o.id = p_org), 'Asia/Kolkata'))::date)
    from public.course_enrollments n join public.courses c on c.id = n.course_id
   where n.organization_id = p_org
   group by c.title
   order by 4 desc, 2 desc, 1
   limit 50;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'analytics_scope(uuid)', 'analytics_headcount(uuid, date, text)', 'analytics_movements(uuid, date, date)',
    'analytics_leave(uuid, date, date)', 'analytics_attendance(uuid, date, date)', 'analytics_payroll(uuid, int)',
    'analytics_recruitment(uuid)', 'analytics_helpdesk(uuid, date, date)', 'analytics_learning(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
