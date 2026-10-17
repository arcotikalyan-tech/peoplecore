-- PeopleCore · "Today" means today in the organization's time zone, not in UTC.
--
-- Bug found by the browser tests just after midnight IST: the app treated 18 Oct as today (Asia/Kolkata)
-- while the database's current_date was still 17 Oct (UTC). An assignment change effective "today" was
-- therefore treated as future-dated and the current snapshot was not updated; the same mismatch decided
-- whether a new joiner started as pre_joining.

create function app.org_today(p_org uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_org;
$$;

create or replace function public.create_employee(
  p_organization_id     uuid,
  p_first_name          text,
  p_employment_type     public.employment_type,
  p_date_of_joining     date,
  p_employee_code       text default null,
  p_middle_name         text default null,
  p_last_name           text default null,
  p_work_email          text default null,
  p_work_phone          text default null,
  p_department_id       uuid default null,
  p_designation_id      uuid default null,
  p_location_id         uuid default null,
  p_legal_entity_id     uuid default null,
  p_manager_employee_id uuid default null,
  p_probation_end_date  date default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id   uuid;
  v_code text := nullif(trim(p_employee_code), '');
begin
  if not app.has_permission(p_organization_id, 'employee.create') then
    raise exception 'not authorized to create employees' using errcode = '42501';
  end if;
  if v_code is null then
    v_code := 'EMP' || lpad(app.next_counter(p_organization_id, 'employee_code')::text, 5, '0');
  end if;

  insert into public.employees (
    organization_id, employee_code, first_name, middle_name, last_name, work_email, work_phone,
    status, employment_type, date_of_joining, probation_end_date,
    department_id, designation_id, location_id, legal_entity_id, manager_employee_id)
  values (
    p_organization_id, v_code, trim(p_first_name), nullif(trim(p_middle_name), ''), nullif(trim(p_last_name), ''),
    nullif(lower(trim(p_work_email)), ''), nullif(trim(p_work_phone), ''),
    case when p_date_of_joining > app.org_today(p_organization_id) then 'pre_joining' else 'active' end::public.employee_status,
    p_employment_type, p_date_of_joining, p_probation_end_date,
    p_department_id, p_designation_id, p_location_id, p_legal_entity_id, p_manager_employee_id)
  returning id into v_id;

  insert into public.employment_records (
    organization_id, employee_id, effective_from, department_id, designation_id, location_id,
    manager_employee_id, employment_type, change_reason)
  values (
    p_organization_id, v_id, p_date_of_joining, p_department_id, p_designation_id, p_location_id,
    p_manager_employee_id, p_employment_type, 'joining');

  return v_id;
end $$;

-- Closes the open employment record and opens a new one. The snapshot on `employees` is updated
-- immediately when the change is effective on or before the organization's local today; future-dated
-- changes are applied by the daily snapshot job (Phase 3, see BUILD_STATUS known issues).
create or replace function public.change_employee_assignment(
  p_employee_id         uuid,
  p_effective_from      date,
  p_change_reason       public.assignment_change_reason,
  p_department_id       uuid default null,
  p_designation_id      uuid default null,
  p_location_id         uuid default null,
  p_manager_employee_id uuid default null,
  p_notes               text default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_emp     public.employees;
  v_current public.employment_records;
  v_id      uuid;
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
    p_manager_employee_id, v_emp.employment_type, p_change_reason, nullif(trim(p_notes), ''))
  returning id into v_id;

  if p_effective_from <= app.org_today(v_emp.organization_id) then
    update public.employees
       set department_id = p_department_id, designation_id = p_designation_id,
           location_id = p_location_id, manager_employee_id = p_manager_employee_id
     where id = p_employee_id;
  end if;
  return v_id;
end $$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
