-- PeopleCore · Two employee details that could not be changed after the employee was added:
-- * Employee type (contract → permanent, intern → permanent…) through Change assignment, kept in the history like any
--   other change; the new type applies from its effective date (the daily job applies future-dated changes).
-- * The joining date, corrected (a typo when the employee was added): the joining entry of the history moves with it,
--   a date after a later change in the history or after the exit is refused, and the status follows (pre-joining
--   until a future joining date, active from it). Leave and payroll already processed are not recalculated.

drop function public.change_employee_assignment(uuid, date, public.assignment_change_reason, uuid, uuid, uuid, uuid, text);
create function public.change_employee_assignment(
  p_employee_id         uuid,
  p_effective_from      date,
  p_change_reason       public.assignment_change_reason,
  p_department_id       uuid default null,
  p_designation_id      uuid default null,
  p_location_id         uuid default null,
  p_manager_employee_id uuid default null,
  p_notes               text default null,
  p_employment_type     public.employment_type default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_emp     public.employees;
  v_current public.employment_records;
  v_id      uuid;
  v_type    public.employment_type;
begin
  -- Permission check before the row lock: FOR UPDATE applies UPDATE policies, which would turn
  -- "not authorized" into a misleading "not found" for people who can see but not edit the employee.
  select * into v_emp from public.employees where id = p_employee_id;
  if not found then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if not app.has_permission(v_emp.organization_id, 'employee.update') then
    raise exception 'not authorized to change assignments' using errcode = '42501';
  end if;
  perform 1 from public.employees where id = p_employee_id for update;
  if p_change_reason = 'joining' then
    raise exception 'joining records are created with the employee' using errcode = '22023';
  end if;
  if p_manager_employee_id = p_employee_id then
    raise exception 'an employee cannot report to themselves' using errcode = '22023';
  end if;
  v_type := coalesce(p_employment_type, v_emp.employment_type);

  select * into v_current from public.employment_records
   where employee_id = p_employee_id and effective_to is null
   for update;
  if found then
    if p_effective_from <= v_current.effective_from then
      raise exception 'effective date must be after %', v_current.effective_from using errcode = '22023';
    end if;
    update public.employment_records set effective_to = p_effective_from - 1 where id = v_current.id;
  end if;

  insert into public.employment_records (
    organization_id, employee_id, effective_from, department_id, designation_id, location_id,
    manager_employee_id, employment_type, change_reason, notes)
  values (
    v_emp.organization_id, p_employee_id, p_effective_from, p_department_id, p_designation_id, p_location_id,
    p_manager_employee_id, v_type, p_change_reason, nullif(trim(p_notes), ''))
  returning id into v_id;

  if p_effective_from <= app.org_today(v_emp.organization_id) then
    update public.employees
       set department_id = p_department_id, designation_id = p_designation_id,
           location_id = p_location_id, manager_employee_id = p_manager_employee_id, employment_type = v_type
     where id = p_employee_id;
  end if;
  return v_id;
end $$;
revoke all on function public.change_employee_assignment(uuid, date, public.assignment_change_reason, uuid, uuid, uuid, uuid, text, public.employment_type) from public, anon;
grant execute on function public.change_employee_assignment(uuid, date, public.assignment_change_reason, uuid, uuid, uuid, uuid, text, public.employment_type) to authenticated, service_role;

create function public.correct_joining_date(p_employee uuid, p_date date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp  public.employees;
  v_next date;
begin
  select * into v_emp from public.employees where id = p_employee for update;
  if v_emp.id is null or not app.has_permission(v_emp.organization_id, 'employee.update') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_date is null then raise exception 'Enter the joining date.' using errcode = '22023'; end if;
  if p_date = v_emp.date_of_joining then return; end if;
  if v_emp.date_of_exit is not null and p_date > v_emp.date_of_exit then
    raise exception 'The joining date can’t be after the exit date (%).', to_char(v_emp.date_of_exit, 'FMDD Mon YYYY') using errcode = '22023';
  end if;
  select min(effective_from) into v_next from public.employment_records where employee_id = p_employee and change_reason <> 'joining';
  if v_next is not null and p_date >= v_next then
    raise exception 'The joining date must be before the first change in their history (%).', to_char(v_next, 'FMDD Mon YYYY') using errcode = '22023';
  end if;
  update public.employment_records set effective_from = p_date where employee_id = p_employee and change_reason = 'joining';
  update public.employees
     set date_of_joining = p_date,
         status = case when v_emp.status in ('active', 'pre_joining')
                       then (case when p_date > app.org_today(v_emp.organization_id) then 'pre_joining' else 'active' end)::public.employee_status
                       else v_emp.status end
   where id = p_employee;
end $$;
revoke all on function public.correct_joining_date(uuid, date) from public, anon;
grant execute on function public.correct_joining_date(uuid, date) to authenticated, service_role;
