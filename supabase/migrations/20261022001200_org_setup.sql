-- PeopleCore · Organization setup: the steps a new company's owner and HR team finish before everyone starts using
-- PeopleCore (company details, structure, shift timings, weekly offs, holidays, leave, employees, invitations,
-- payroll), shown on their dashboard with how much is done.
--
-- * org_setup_status(org): for people who run setup (org.manage or onboarding.manage), what the live data already
--   shows, as yes or no (and two counts), never the values; and each step someone marked by hand. Security definer,
--   so everyone who runs setup sees the same progress whatever else they may read (an HR executive can't read
--   salaries, but sees whether they are assigned).
--   Steps whose defaults come with every new company (the General shift; casual, sick, earned and event leave and leave
--   without pay) count as done once they differ from those defaults, or once someone confirms the defaults are right.
-- * org_setup_steps.status: 'done' (marked by hand, e.g. "the default shift is right") or 'skipped' (an optional
--   step this company doesn't need). Existing rows are 'done'.

alter table public.org_setup_steps add column status text not null default 'done' check (status in ('done', 'skipped'));

create function public.org_setup_status(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_org, 'org.manage') or app.has_permission(p_org, 'onboarding.manage') then jsonb_build_object(
    'company', exists (select 1 from public.company_profiles c where c.organization_id = p_org and c.pan is not null)
               and exists (select 1 from public.company_addresses a where a.organization_id = p_org),
    'locations', exists (select 1 from public.locations l where l.organization_id = p_org),
    'structure', exists (select 1 from public.departments d where d.organization_id = p_org)
                 and exists (select 1 from public.designations d where d.organization_id = p_org),
    'shifts_changed', exists (select 1 from public.shifts s where s.organization_id = p_org
                                and (s.code <> 'GEN' or s.start_time <> '09:30' or s.end_time <> '18:30'
                                     or s.break_minutes <> 60 or s.grace_minutes <> 15)),
    'leave_changed', exists (select 1 from public.leave_types t where t.organization_id = p_org and t.code not in ('CL', 'SL', 'EL', 'EVL', 'LOP', 'COMP_OFF')),
    'holidays', exists (select 1 from public.holidays h where h.organization_id = p_org
                          and h.holiday_date >= make_date(extract(year from current_date)::int, 1, 1)),
    'employees', (select count(*) from public.employees e where e.organization_id = p_org and e.status <> 'exited'),
    'signed_in', (select count(*) from public.employees e where e.organization_id = p_org and e.status <> 'exited' and e.user_id is not null),
    'managers', exists (select 1 from public.employees e where e.organization_id = p_org and e.manager_employee_id is not null),
    'members', (select count(*) from public.organization_members m where m.organization_id = p_org and m.status in ('active', 'invited')),
    'hr_team', exists (select 1 from public.member_roles mr join public.roles r on r.id = mr.role_id
                        where mr.organization_id = p_org and r.key in ('hr_admin', 'hr_executive', 'payroll_admin', 'finance_admin')),
    'salaries', exists (select 1 from public.compensation_records c where c.organization_id = p_org),
    'bank', exists (select 1 from public.payroll_bank_settings b where b.organization_id = p_org and b.account_number is not null),
    'marks', coalesce((select jsonb_object_agg(s.step_key, s.status) from public.org_setup_steps s where s.organization_id = p_org), '{}'::jsonb)
  ) end;
$$;
revoke all on function public.org_setup_status(uuid) from public, anon;
grant execute on function public.org_setup_status(uuid) to authenticated, service_role;
