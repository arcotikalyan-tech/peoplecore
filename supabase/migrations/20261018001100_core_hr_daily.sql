-- PeopleCore · Core HR daily upkeep, run by the worker (hourly; idempotent).
--
-- 1. Future-dated assignment changes: the employment record covering the organization's local today
--    becomes the employees snapshot (department, designation, location, manager, employment type).
-- 2. Joiners: pre-joining employees whose joining date has arrived become active, and an
--    `employee.joined` event is emitted once per employee (onboarding and other modules react to it).
-- Each employee is handled in its own subtransaction: one bad record (say, a future move into a since
-- archived department) is reported and skipped, never blocking everyone else.

create function public.worker_daily_core_hr() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r           record;
  v_applied   int := 0;
  v_activated int := 0;
  v_failures  jsonb := '[]'::jsonb;
begin
  for r in
    select e.id, e.organization_id, er.department_id, er.designation_id, er.location_id, er.manager_employee_id, er.employment_type
      from public.employees e
      join public.employment_records er on er.employee_id = e.id
     where e.status <> 'exited'
       and er.effective_from <= app.org_today(e.organization_id)
       and (er.effective_to is null or er.effective_to >= app.org_today(e.organization_id))
       and (e.department_id, e.designation_id, e.location_id, e.manager_employee_id, e.employment_type)
           is distinct from (er.department_id, er.designation_id, er.location_id, er.manager_employee_id, er.employment_type)
  loop
    begin
      update public.employees
         set department_id = r.department_id, designation_id = r.designation_id, location_id = r.location_id,
             manager_employee_id = r.manager_employee_id, employment_type = r.employment_type
       where id = r.id;
      v_applied := v_applied + 1;
    exception when others then
      v_failures := v_failures || jsonb_build_object('employee_id', r.id, 'step', 'assignment', 'error', sqlerrm);
    end;
  end loop;

  for r in
    select e.id, e.organization_id from public.employees e
     where e.status = 'pre_joining' and e.date_of_joining <= app.org_today(e.organization_id)
  loop
    begin
      update public.employees set status = 'active' where id = r.id;
      perform app.emit_event(r.organization_id, 'employee.joined', r.id, '{}', 'employee.joined:' || r.id);
      v_activated := v_activated + 1;
    exception when others then
      v_failures := v_failures || jsonb_build_object('employee_id', r.id, 'step', 'activation', 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('applied', v_applied, 'activated', v_activated, 'failures', v_failures);
end $$;

revoke all on function public.worker_daily_core_hr() from public, anon, authenticated;
grant execute on function public.worker_daily_core_hr() to service_role;
