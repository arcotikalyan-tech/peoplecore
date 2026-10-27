-- The dashboard's figures in one request. The page used to send about thirty counts of its own (38 database requests
-- for HR per load); under load they queued behind the connection pool and the whole page failed. This returns the
-- same figures as the caller (security invoker: row-level security decides what is counted, exactly as before), and
-- only for the sections the page asks for, so a section someone can't see costs nothing.
--
-- p_sections: any of people, attendance, payroll, helpdesk, separations, learning, settlements.
-- p_month_ends: the last day of each month in the headcount trend (the page labels them).

create or replace function public.dashboard_figures(p_org uuid, p_me uuid, p_today date, p_sections text[], p_month_ends date[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  today_days as (
    select d.employee_id, d.status::text as status, d.late_minutes
    from public.attendance_days d
    where d.organization_id = p_org and d.work_date = p_today and 'attendance' = any(p_sections)
  ),
  people as (
    select e.id, concat_ws(' ', e.first_name, e.last_name) as name, e.first_name, t.status, t.late_minutes
    from public.employees e
    left join today_days t on t.employee_id = e.id
    where e.organization_id = p_org and e.status in ('active', 'on_notice') and 'attendance' = any(p_sections)
  ),
  late as (select * from people where status in ('present', 'half_day', 'wfh', 'on_duty') and late_minutes > 0),
  on_leave as (select * from people where status = 'on_leave'),
  absent as (select * from people where status is null or status in ('absent', 'not_marked')),
  last_run as (
    select r.id, r.period_month, r.employee_count
    from public.payroll_runs r
    where r.organization_id = p_org and r.status = 'locked' and 'payroll' = any(p_sections)
    order by r.period_month desc
    limit 1
  ),
  run_lines as (
    select l.code, l.amount from public.payroll_line_items l join last_run r on l.run_id = r.id
    where l.code in ('PF', 'ESI', 'PT', 'TDS') and l.amount > 0
  )
  select jsonb_build_object(
    'tasks', case when p_me is not null then (
      select count(*) from public.tasks t where t.organization_id = p_org and t.assignee_employee_id = p_me and t.status = 'open') end,
    'open_tickets', case when 'helpdesk' = any(p_sections) then (
      select count(*) from public.tickets t where t.organization_id = p_org and t.status in ('open', 'in_progress', 'waiting')) end,
    'breached_tickets', case when 'helpdesk' = any(p_sections) then (
      select count(*) from public.tickets t where t.organization_id = p_org and t.status in ('open', 'in_progress', 'waiting') and t.breached_at is not null) end,
    'open_separations', case when 'separations' = any(p_sections) then (
      select count(*) from public.separations s where s.organization_id = p_org and s.status in ('submitted', 'approved')) end,
    'overdue_training', case when 'learning' = any(p_sections) then (
      select count(*) from public.course_enrollments c where c.organization_id = p_org and c.status in ('assigned', 'in_progress') and c.due_on < p_today) end,
    'settlements_to_approve', case when 'settlements' = any(p_sections) then (
      select count(*) from public.fnf_settlements s where s.organization_id = p_org and s.status = 'computed') end,
    'active_employees', case when 'people' = any(p_sections) then (
      select count(*) from public.employees e where e.organization_id = p_org and e.status = 'active') end,
    'exits_30d', case when 'people' = any(p_sections) then (
      select count(*) from public.employees e where e.organization_id = p_org and e.date_of_exit between p_today - 30 and p_today) end,
    'headcount_trend', case when 'people' = any(p_sections) then (
      select jsonb_agg((
        select count(*) from public.employees e
        where e.organization_id = p_org and e.status <> 'pre_joining' and e.date_of_joining <= m.last
          and (e.date_of_exit is null or e.date_of_exit > m.last)
      ) order by m.ord)
      from unnest(p_month_ends) with ordinality as m(last, ord)) end,
    'presence', case when 'attendance' = any(p_sections) then (
      select jsonb_build_object(
        'expected', count(*) filter (where d.status not in ('weekly_off', 'holiday')),
        'at_work', count(*) filter (where d.status in ('present', 'wfh', 'on_duty')),
        'half_days', count(*) filter (where d.status = 'half_day'))
      from public.attendance_days d
      where d.organization_id = p_org and d.work_date between date_trunc('month', p_today)::date and p_today) end,
    'snapshot', case when 'attendance' = any(p_sections) then jsonb_build_object(
      'total', (select count(*) from people),
      'late', jsonb_build_object('count', (select count(*) from late),
        'people', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name)) from (select id, name from late order by first_name, id limit 4) x), '[]'::jsonb)),
      'on_leave', jsonb_build_object('count', (select count(*) from on_leave),
        'people', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name)) from (select id, name from on_leave order by first_name, id limit 4) x), '[]'::jsonb)),
      'absent', jsonb_build_object('count', (select count(*) from absent),
        'people', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name)) from (select id, name from absent order by first_name, id limit 4) x), '[]'::jsonb))
    ) end,
    'deductions', case when 'payroll' = any(p_sections) then (
      select jsonb_build_object(
        'run', jsonb_build_object('id', r.id, 'period_month', r.period_month, 'employee_count', r.employee_count),
        'pf', (select count(*) from run_lines where code = 'PF'),
        'esi', (select count(*) from run_lines where code = 'ESI'),
        'pt', (select count(*) from run_lines where code = 'PT'),
        'tds', (select count(*) from run_lines where code = 'TDS'),
        'pf_over_ceiling', (select count(*) from run_lines where code = 'PF' and amount > 1800))
      from last_run r) end
  );
$$;

revoke all on function public.dashboard_figures(uuid, uuid, date, text[], date[]) from public;
grant execute on function public.dashboard_figures(uuid, uuid, date, text[], date[]) to authenticated;
grant execute on function public.dashboard_figures(uuid, uuid, date, text[], date[]) to service_role;

comment on function public.dashboard_figures(uuid, uuid, date, text[], date[]) is
  'The dashboard''s figures in one request, counted as the caller (row-level security applies), for the requested sections only.';
