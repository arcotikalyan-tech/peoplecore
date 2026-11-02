-- Each role's desk on the dashboard, in one request. The dashboard showed managers the HR layout cut down to their
-- line, and gave HR, payroll, finance, recruiters, auditors and device admins nothing for their own work. This returns
-- what each of them works on, as the caller (security invoker: row-level security decides what is read), and only
-- for the desks the page asks for, so a desk someone doesn't see costs nothing.
--
-- p_sections, any of:
--   team     the caller's reporting line (direct and indirect reports): each person's day today (status, check-in,
--            check-out, worked, late, the day's punches, leave or WFH), their month so far, who is away in the next two
--            weeks, what is coming up (work anniversaries, probation ends, last days, joiners) and the open review cycle.
--   hr       joiners, probation ends, exits, onboarding, people with no manager, requests waiting on HR.
--   payroll  the next pay period: its run and what changes it (requests not decided, salary revisions, tax declarations,
--            loans and EMIs, joiners and leavers, people with no salary). Money going out is the finance desk.
--   finance  payroll runs to approve, claims to pay, vendor invoices to approve and pay, settlements to approve.
--   hiring   open jobs, the pipeline by stage, interviews in the next week, offers waiting.
--   audit    the latest audited changes.
--   devices  attendance devices: when each last sent a punch, and today's punches.

-- How many people report directly to the caller, whatever their roles. Someone with reports but without the Reporting
-- manager role can't read their team, so the dashboard tells them why instead of showing an empty team. A count of
-- the caller's own reports only.
create function app.my_report_count(p_org uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.employees e
   where e.organization_id = p_org and e.status in ('active', 'on_notice')
     and e.manager_employee_id = (select m.id from public.employees m where m.organization_id = p_org and m.user_id = auth.uid() limit 1);
$$;
revoke all on function app.my_report_count(uuid) from public;
grant execute on function app.my_report_count(uuid) to authenticated, service_role;

create function public.dashboard_desks(p_org uuid, p_today date, p_sections text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  org as (select o.timezone from public.organizations o where o.id = p_org),
  me as (
    select e.id from public.employees e where e.organization_id = p_org and e.user_id = (select auth.uid()) limit 1
  ),
  line as (
    select e.id, 1 as depth
      from me join public.employees e on e.organization_id = p_org and e.manager_employee_id = me.id
     where e.status <> 'exited' and 'team' = any(p_sections)
    union all
    select e.id, l.depth + 1
      from line l join public.employees e on e.organization_id = p_org and e.manager_employee_id = l.id
     where e.status <> 'exited' and l.depth < 30
  ),
  team as (
    select e.id, concat_ws(' ', e.first_name, e.last_name) as name, e.first_name, e.employee_code, e.status::text as emp_status,
           e.date_of_joining, e.probation_end_date, e.confirmed_on, coalesce(nullif(trim(e.job_title), ''), g.title) as title,
           min(l.depth) as depth
      from line l
      join public.employees e on e.organization_id = p_org and e.id = l.id
      left join public.designations g on g.organization_id = p_org and g.id = e.designation_id
     where l.id is distinct from (select id from me)
     group by e.id, g.title
  ),
  current_team as (select * from team where emp_status in ('active', 'on_notice') and date_of_joining <= p_today),
  team_day as (
    select d.employee_id, d.status::text as status, d.first_in, d.last_out, d.worked_minutes, d.late_minutes, d.break_minutes
      from current_team t join public.attendance_days d on d.organization_id = p_org and d.employee_id = t.id and d.work_date = p_today
  ),
  team_punches as (
    select p.employee_id, jsonb_agg(jsonb_build_object('punched_at', p.punched_at, 'kind', p.kind) order by p.punched_at) as punches
      from team_day d join public.attendance_punches p on p.organization_id = p_org and p.employee_id = d.employee_id and p.punched_at >= d.first_in
     group by p.employee_id
  ),
  team_leave_today as (
    select distinct on (r.employee_id) r.employee_id, coalesce(lt.name, 'Leave') as what, r.status::text as status,
           (r.start_date = p_today and r.half_day_start) or (r.end_date = p_today and r.half_day_end) as half_day
      from current_team t
      join public.leave_requests r on r.organization_id = p_org and r.employee_id = t.id
      left join public.leave_types lt on lt.organization_id = p_org and lt.id = r.leave_type_id
     where r.status in ('approved', 'pending') and p_today between r.start_date and r.end_date
     order by r.employee_id, (r.status = 'approved') desc, r.created_at desc
  ),
  team_request_today as (
    select distinct on (a.employee_id) a.employee_id, a.kind::text as kind
      from current_team t join public.attendance_requests a on a.organization_id = p_org and a.employee_id = t.id
     where a.status = 'approved' and p_today between a.start_date and a.end_date
     order by a.employee_id, a.created_at desc
  ),
  team_month as (
    select d.employee_id,
           count(*) filter (where d.status in ('present', 'wfh', 'on_duty')) + 0.5 * count(*) filter (where d.status = 'half_day') as present,
           count(*) filter (where d.status not in ('weekly_off', 'holiday', 'not_marked')) as expected,
           count(*) filter (where d.late_minutes > 0) as late,
           coalesce(sum(d.leave_days), 0) as leave,
           count(*) filter (where d.status = 'absent') as absent
      from current_team t
      join public.attendance_days d on d.organization_id = p_org and d.employee_id = t.id
       and d.work_date between date_trunc('month', p_today)::date and p_today
     group by d.employee_id
  ),
  team_away as (
    select r.employee_id, t.name, r.start_date, r.end_date, r.days, coalesce(lt.name, 'Leave') as what, r.status::text as status
      from current_team t
      join public.leave_requests r on r.organization_id = p_org and r.employee_id = t.id
      left join public.leave_types lt on lt.organization_id = p_org and lt.id = r.leave_type_id
     where r.status in ('approved', 'pending') and r.end_date >= p_today and r.start_date <= p_today + 13
    union all
    select a.employee_id, t.name, a.start_date, a.end_date, (a.end_date - a.start_date + 1)::numeric,
           case a.kind when 'wfh' then 'Work from home' else 'On duty' end, a.status::text
      from current_team t join public.attendance_requests a on a.organization_id = p_org and a.employee_id = t.id
     where a.status in ('approved', 'pending') and a.end_date >= p_today and a.start_date <= p_today + 13
  ),
  team_events as (
    -- Work anniversaries: this year's (or next year's) date; 29 February falls on 28 February in other years.
    select 'anniversary' as kind, t.id as employee_id, t.name, x.on_date, x.years::text as detail
      from current_team t
      cross join lateral (select extract(year from age(p_today, t.date_of_joining))::int as y) a
      cross join lateral (
        select case when (t.date_of_joining + make_interval(years => a.y))::date < p_today
                    then (t.date_of_joining + make_interval(years => a.y + 1))::date else (t.date_of_joining + make_interval(years => a.y))::date end as on_date,
               case when (t.date_of_joining + make_interval(years => a.y))::date < p_today then a.y + 1 else a.y end as years) x
     where x.years >= 1 and x.on_date <= p_today + 30
    union all
    select 'probation', t.id, t.name, t.probation_end_date, null
      from current_team t
     where t.emp_status = 'active' and t.confirmed_on is null and t.probation_end_date <= p_today + 30
    union all
    select 'last_day', t.id, t.name, s.last_working_day, s.status::text
      from current_team t join public.separations s on s.organization_id = p_org and s.employee_id = t.id
     where s.status in ('submitted', 'approved') and s.last_working_day >= p_today
    union all
    select 'joining', t.id, t.name, t.date_of_joining, t.title
      from team t where t.emp_status = 'pre_joining' or (t.emp_status = 'active' and t.date_of_joining > p_today)
  ),
  team_reviews as (
    select c.id, c.name, c.self_review_due, c.manager_review_due,
           count(*) filter (where r.status = 'not_started') as not_started,
           count(*) filter (where r.status = 'self_submitted') as to_rate,
           count(*) filter (where r.status in ('manager_submitted', 'calibrated')) as done
      from me
      join public.reviews r on r.organization_id = p_org and r.manager_employee_id = me.id
      join public.review_cycles c on c.organization_id = p_org and c.id = r.cycle_id
     where c.status in ('active', 'calibration') and 'team' = any(p_sections)
     group by c.id, c.name, c.self_review_due, c.manager_review_due
  ),
  -- The pay period payroll works on next: the month after the last locked run, and never later than this month.
  pay_period as (
    select p.first, (p.first + interval '1 month - 1 day')::date as last
      from (select least(coalesce((select max(r.period_month) from public.payroll_runs r where r.organization_id = p_org and r.status = 'locked')
                                  + interval '1 month', date_trunc('month', p_today)), date_trunc('month', p_today))::date as first) p
     where 'payroll' = any(p_sections)
  ),
  names as (
    select e.id, e.user_id, concat_ws(' ', e.first_name, e.last_name) as name from public.employees e where e.organization_id = p_org
  )
  select jsonb_build_object(
    'team', case when 'team' = any(p_sections) then jsonb_build_object(
      'reports', app.my_report_count(p_org),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'code', t.employee_code, 'title', t.title, 'direct', t.depth = 1, 'notice', t.emp_status = 'on_notice',
          'status', d.status, 'first_in', d.first_in, 'last_out', d.last_out, 'worked', coalesce(d.worked_minutes, 0),
          'late', coalesce(d.late_minutes, 0), 'breaks', coalesce(d.break_minutes, 0), 'punches', coalesce(p.punches, '[]'::jsonb),
          'leave', case when lv.employee_id is not null then jsonb_build_object('what', lv.what, 'status', lv.status, 'half_day', lv.half_day) end,
          'request', rq.kind,
          'month', jsonb_build_object('present', coalesce(m.present, 0), 'expected', coalesce(m.expected, 0), 'late', coalesce(m.late, 0),
                                      'leave', coalesce(m.leave, 0), 'absent', coalesce(m.absent, 0))
        ) order by t.depth, t.first_name, t.id)
        from current_team t
        left join team_day d on d.employee_id = t.id
        left join team_punches p on p.employee_id = t.id
        left join team_leave_today lv on lv.employee_id = t.id
        left join team_request_today rq on rq.employee_id = t.id
        left join team_month m on m.employee_id = t.id), '[]'::jsonb),
      'away', coalesce((select jsonb_agg(jsonb_build_object('employee_id', a.employee_id, 'name', a.name, 'start', a.start_date, 'end', a.end_date,
                          'days', a.days, 'what', a.what, 'status', a.status) order by a.start_date, a.name)
                        from (select * from team_away order by start_date, name limit 20) a), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('kind', ev.kind, 'employee_id', ev.employee_id, 'name', ev.name, 'on', ev.on_date, 'detail', ev.detail)
                          order by ev.on_date, ev.name)
                          from (select * from team_events order by on_date, name limit 20) ev), '[]'::jsonb),
      'reviews', coalesce((select jsonb_agg(jsonb_build_object('cycle', r.name, 'self_due', r.self_review_due, 'manager_due', r.manager_review_due,
                           'not_started', r.not_started, 'to_rate', r.to_rate, 'done', r.done) order by r.manager_review_due nulls last)
                           from team_reviews r), '[]'::jsonb)
    ) end,

    'hr', case when 'hr' = any(p_sections) then jsonb_build_object(
      'joining', (select count(*) from public.employees e where e.organization_id = p_org and e.status = 'pre_joining'),
      'joined_this_month', (select count(*) from public.employees e where e.organization_id = p_org and e.status in ('active', 'on_notice')
                              and e.date_of_joining between date_trunc('month', p_today)::date and p_today),
      'probation_due', (select count(*) from public.employees e where e.organization_id = p_org and e.status = 'active' and e.confirmed_on is null
                          and e.probation_end_date between p_today and p_today + 30),
      'probation_overdue', (select count(*) from public.employees e where e.organization_id = p_org and e.status = 'active' and e.confirmed_on is null
                              and e.probation_end_date < p_today),
      'exits_to_decide', (select count(*) from public.separations s where s.organization_id = p_org and s.status = 'submitted'),
      'leaving', (select count(*) from public.separations s where s.organization_id = p_org and s.status in ('submitted', 'approved') and s.last_working_day >= p_today),
      'onboarding', (select count(*) from public.onboarding_plans o where o.organization_id = p_org and o.status = 'in_progress'),
      'no_manager', (select count(*) from public.employees e where e.organization_id = p_org and e.status in ('active', 'on_notice') and e.manager_employee_id is null),
      'leave_pending', (select count(*) from public.leave_requests r where r.organization_id = p_org and r.status = 'pending'),
      'attendance_pending', (select count(*) from public.regularization_requests r where r.organization_id = p_org and r.status = 'pending')
                          + (select count(*) from public.attendance_requests r where r.organization_id = p_org and r.status = 'pending'),
      'letters_pending', (select count(*) from public.letter_requests r where r.organization_id = p_org and r.status = 'pending'),
      'assets_pending', (select count(*) from public.asset_requests r where r.organization_id = p_org and r.status = 'pending'),
      'moves', coalesce((select jsonb_agg(x order by x->>'on', x->>'name') from (
          (select jsonb_build_object('kind', 'joining', 'employee_id', e.id, 'name', concat_ws(' ', e.first_name, e.last_name), 'on', e.date_of_joining) as x
             from public.employees e where e.organization_id = p_org and e.status = 'pre_joining' and e.date_of_joining <= p_today + 30
            order by e.date_of_joining, e.first_name limit 6)
          union all
          (select jsonb_build_object('kind', 'probation', 'employee_id', e.id, 'name', concat_ws(' ', e.first_name, e.last_name), 'on', e.probation_end_date)
             from public.employees e where e.organization_id = p_org and e.status = 'active' and e.confirmed_on is null and e.probation_end_date <= p_today + 30
            order by e.probation_end_date, e.first_name limit 6)
          union all
          (select jsonb_build_object('kind', 'last_day', 'employee_id', e.id, 'name', concat_ws(' ', e.first_name, e.last_name), 'on', s.last_working_day, 'status', s.status)
             from public.separations s join public.employees e on e.organization_id = p_org and e.id = s.employee_id
            where s.organization_id = p_org and s.status in ('submitted', 'approved') and s.last_working_day between p_today and p_today + 30
            order by s.last_working_day, e.first_name limit 6)
        ) moves), '[]'::jsonb)
    ) end,

    'payroll', case when 'payroll' = any(p_sections) then (
      select jsonb_build_object(
        'period', pp.first,
        'run', (select jsonb_build_object('id', r.id, 'status', r.status, 'employee_count', r.employee_count, 'total_net', r.total_net)
                  from public.payroll_runs r where r.organization_id = p_org and r.period_month = pp.first and r.status <> 'cancelled'
                 order by r.created_at desc limit 1),
        'leave_pending', (select count(*) from public.leave_requests r where r.organization_id = p_org and r.status = 'pending'
                            and r.start_date <= pp.last and r.end_date >= pp.first),
        'attendance_pending', (select count(*) from public.regularization_requests r where r.organization_id = p_org and r.status = 'pending'
                                 and r.work_date between pp.first and pp.last)
                            + (select count(*) from public.attendance_requests r where r.organization_id = p_org and r.status = 'pending'
                                 and r.start_date <= pp.last and r.end_date >= pp.first),
        'revisions_pending', (select count(*) from public.salary_revisions s where s.organization_id = p_org and s.status = 'pending'),
        'declarations_to_review', (select count(*) from public.tax_declarations d where d.organization_id = p_org and d.status = 'submitted'),
        'loans_to_decide', (select count(*) from public.loans l where l.organization_id = p_org and l.status in ('pending', 'approved')),
        'emis', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(i.emi), 0))
                   from public.loan_installments i where i.organization_id = p_org and i.due_month = pp.first and i.status in ('scheduled', 'queued')),
        'joiners', (select count(*) from public.employees e where e.organization_id = p_org and e.status <> 'exited'
                      and e.date_of_joining between pp.first and pp.last),
        'leavers', (select count(*) from public.employees e where e.organization_id = p_org and e.date_of_exit between pp.first and pp.last),
        'no_salary', (select count(*) from public.employees e where e.organization_id = p_org and e.status in ('active', 'on_notice')
                        and e.date_of_joining <= pp.last
                        and not exists (select 1 from public.compensation_records c where c.organization_id = p_org and c.employee_id = e.id
                                          and c.effective_from <= pp.last and (c.effective_to is null or c.effective_to >= pp.first))))
      from pay_period pp) end,

    'finance', case when 'finance' = any(p_sections) then jsonb_build_object(
      'runs_to_approve', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'period_month', r.period_month, 'employee_count', r.employee_count,
                                     'total_net', r.total_net) order by r.period_month)
                                   from public.payroll_runs r where r.organization_id = p_org and r.status = 'computed'), '[]'::jsonb),
      'claims_to_pay', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(c.total), 0))
                          from public.expense_claims c where c.organization_id = p_org and c.status = 'approved'),
      'invoices_to_approve', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(v.net_amount), 0))
                                from public.vendor_payments v where v.organization_id = p_org and v.status = 'submitted'),
      'invoices_to_pay', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(v.net_amount), 0))
                            from public.vendor_payments v where v.organization_id = p_org and v.status = 'approved'),
      'invoices_overdue', (select count(*) from public.vendor_payments v where v.organization_id = p_org and v.status in ('submitted', 'approved')
                             and v.due_date < p_today),
      'settlements', (select count(*) from public.fnf_settlements s where s.organization_id = p_org and s.status = 'computed')
    ) end,

    'hiring', case when 'hiring' = any(p_sections) then jsonb_build_object(
      'open_jobs', (select count(*) from public.job_requisitions j where j.organization_id = p_org and j.status = 'open'),
      'openings', (select coalesce(sum(j.openings), 0) from public.job_requisitions j where j.organization_id = p_org and j.status = 'open'),
      'stages', (select jsonb_build_object(
                    'applied', count(*) filter (where a.stage = 'applied'), 'screening', count(*) filter (where a.stage = 'screening'),
                    'interview', count(*) filter (where a.stage = 'interview'), 'offer', count(*) filter (where a.stage = 'offer'))
                   from public.applications a join public.job_requisitions j on j.organization_id = p_org and j.id = a.requisition_id
                  where a.organization_id = p_org and j.status = 'open'),
      'hired_this_month', (select count(*) from public.applications a where a.organization_id = p_org and a.stage = 'hired'
                             and a.stage_changed_at >= (date_trunc('month', p_today)::timestamp at time zone (select timezone from org))),
      'interviews_today', (select count(*) from public.interviews i where i.organization_id = p_org and i.status = 'scheduled'
                             and (i.scheduled_at at time zone (select timezone from org))::date = p_today),
      'interviews', coalesce((select jsonb_agg(x.j order by x.at) from (
          select i.scheduled_at as at, jsonb_build_object('id', i.id, 'application_id', i.application_id, 'at', i.scheduled_at, 'round', i.round_name,
                   'mode', i.mode, 'candidate', concat_ws(' ', c.first_name, c.last_name), 'job', j.title) as j
            from public.interviews i
            join public.applications a on a.organization_id = p_org and a.id = i.application_id
            join public.candidates c on c.organization_id = p_org and c.id = a.candidate_id
            join public.job_requisitions j on j.organization_id = p_org and j.id = a.requisition_id
           where i.organization_id = p_org and i.status = 'scheduled' and i.scheduled_at >= now() - interval '1 hour'
             and (i.scheduled_at at time zone (select timezone from org))::date <= p_today + 7
           order by i.scheduled_at limit 6) x), '[]'::jsonb),
      'offers_to_approve', (select count(*) from public.offers o where o.organization_id = p_org and o.status = 'pending_approval'),
      'offers_to_send', (select count(*) from public.offers o where o.organization_id = p_org and o.status = 'approved'),
      'offers_out', (select count(*) from public.offers o where o.organization_id = p_org and o.status = 'sent')
    ) end,

    'audit', case when 'audit' = any(p_sections) then jsonb_build_object(
      'today', (select count(*) from public.audit_events a where a.organization_id = p_org
                  and a.occurred_at >= (p_today::timestamp at time zone (select timezone from org))),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.occurred_at, 'action', x.action, 'entity', x.entity_type,
                            'actor', coalesce(n.name, case when x.actor_user_id is null then 'System' else 'A member' end)) order by x.occurred_at desc)
                          from (select * from public.audit_events a where a.organization_id = p_org order by a.occurred_at desc limit 8) x
                          left join names n on n.user_id = x.actor_user_id), '[]'::jsonb)
    ) end,

    'devices', case when 'devices' = any(p_sections) then coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'serial', d.serial_number, 'active', d.is_active,
               'last_punch', (select p.received_at from public.attendance_punches p where p.organization_id = p_org and p.device_id = d.id
                               order by p.received_at desc limit 1),
               'today', (select count(*) from public.attendance_punches p where p.organization_id = p_org and p.device_id = d.id
                           and p.received_at >= (p_today::timestamp at time zone (select timezone from org))))
             order by d.is_active desc, d.name)
        from public.biometric_devices d where d.organization_id = p_org), '[]'::jsonb) end
  );
$$;

-- When each device last sent a punch, without reading every punch.
create index attendance_punches_device_idx on public.attendance_punches (device_id, received_at desc) where device_id is not null;

revoke all on function public.dashboard_desks(uuid, date, text[]) from public;
grant execute on function public.dashboard_desks(uuid, date, text[]) to authenticated;
grant execute on function public.dashboard_desks(uuid, date, text[]) to service_role;

comment on function public.dashboard_desks(uuid, date, text[]) is
  'Each role''s desk on the dashboard (team, hr, payroll, finance, hiring, audit, devices) in one request, read as the caller (row-level security applies), for the requested desks only.';
