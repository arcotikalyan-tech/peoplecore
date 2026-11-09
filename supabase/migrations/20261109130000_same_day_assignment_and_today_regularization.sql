-- Two fixes from the owner's testing (2026-11-09).
--
-- 1. "I have changed the reporting manager multiple times but it's not updating": a second assignment change dated the
--    same day as the last one was refused ("effective date must be after ..."), so only the first change of the day
--    reached the employee record and the org chart. A change on the same date now replaces that day's change; an earlier
--    date than a booked one says which date is booked. Changes dated in the future still apply on their date.
-- 2. "Regularise the day is enabled only after the day completes": a missed check-in or check-out today can now be
--    corrected today (it goes to the manager for approval as before). Future days stay refused, and today's corrected
--    times can't be later than the present moment.

create or replace function public.change_employee_assignment(
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
  if found and p_effective_from = v_current.effective_from then
    -- Another change on the same date replaces that day's change (HR correcting a manager they just set): it used to be
    -- refused, so the second and later changes of the day never reached the org chart.
    update public.employment_records
       set department_id = p_department_id, designation_id = p_designation_id, location_id = p_location_id,
           manager_employee_id = p_manager_employee_id, employment_type = v_type,
           change_reason = case when v_current.change_reason = 'joining' then v_current.change_reason else p_change_reason end,
           notes = coalesce(nullif(trim(p_notes), ''), v_current.notes)
     where id = v_current.id
    returning id into v_id;
  elsif found and p_effective_from < v_current.effective_from then
    raise exception 'There’s already a change dated %. Choose a date after it, or the same date to replace it.',
      to_char(v_current.effective_from, 'FMDD Mon YYYY') using errcode = '22023';
  end if;
  if v_id is null and found then
    update public.employment_records set effective_to = p_effective_from - 1 where id = v_current.id;
  end if;

  if v_id is null then
  insert into public.employment_records (
    organization_id, employee_id, effective_from, department_id, designation_id, location_id,
    manager_employee_id, employment_type, change_reason, notes)
  values (
    v_emp.organization_id, p_employee_id, p_effective_from, p_department_id, p_designation_id, p_location_id,
    p_manager_employee_id, v_type, p_change_reason, nullif(trim(p_notes), ''))
  returning id into v_id;
  end if;

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

create or replace function public.request_regularization(p_employee uuid, p_date date, p_in time default null, p_out time default null, p_reason text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp   public.employees;
  v_hr    boolean;
  v_set   public.attendance_settings;
  v_back  integer;
  v_today date;
  v_id    uuid;
  v_req   uuid;
  v_now   time;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null or not app.is_member(v_emp.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_hr := app.has_permission(v_emp.organization_id, 'attendance.manage');
  if not (v_emp.user_id = auth.uid() or v_hr) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_today := app.org_today(v_emp.organization_id);
  select * into v_set from public.attendance_settings where organization_id = v_emp.organization_id;
  -- Employees ask within the organization's window; attendance admins can go back 90 days.
  v_back := case when v_hr then 90 else coalesce(v_set.regularize_days_back, 60) end;
  -- Today can be corrected too (a check-in or check-out missed earlier today), up to the present moment.
  if p_date > v_today then
    raise exception 'You can’t correct a day that hasn’t started yet.' using errcode = '22023';
  end if;
  if p_date = v_today then
    v_now := (now() at time zone (select timezone from public.organizations where id = v_emp.organization_id))::time;
    if p_in is not null and p_in > v_now + interval '2 minutes' then
      raise exception 'The check-in time can’t be later than now.' using errcode = '22023';
    end if;
    if p_out is not null and (p_out > v_now + interval '2 minutes' or (p_in is not null and p_out <= p_in)) then
      raise exception 'The check-out time can’t be later than now.' using errcode = '22023';
    end if;
  end if;
  if p_date < v_today - v_back then
    raise exception 'Only the last % days can be regularized.', v_back using errcode = '22023';
  end if;
  if p_in is null and p_out is null then
    raise exception 'Give the check-in time, the check-out time, or both.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why the day needs correcting.' using errcode = '22023';
  end if;
  if not v_hr and v_set.regularize_monthly_limit is not null
     and (select count(*) from public.regularization_requests r
           where r.employee_id = p_employee and r.status in ('pending', 'approved')
             and date_trunc('month', r.work_date) = date_trunc('month', p_date)) >= v_set.regularize_monthly_limit then
    raise exception 'You can ask for at most % regularization% a month.', v_set.regularize_monthly_limit,
      case when v_set.regularize_monthly_limit = 1 then '' else 's' end using errcode = '22023';
  end if;
  begin
    insert into public.regularization_requests (organization_id, employee_id, work_date, check_in, check_out, reason)
    values (v_emp.organization_id, p_employee, p_date, p_in, p_out, btrim(p_reason))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already a pending regularization for that day.' using errcode = '22023';
  end;
  v_req := app.request_approval(v_emp.organization_id, 'regularization', v_id, p_employee,
    format('%s: attendance for %s (%s)', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)), to_char(p_date, 'DD Mon YYYY'),
           concat_ws(' – ', to_char(p_in, 'HH24:MI'), to_char(p_out, 'HH24:MI'))),
    '/attendance');
  update public.regularization_requests set approval_request_id = v_req where id = v_id;
  return v_id;
end $$;

revoke all on function public.request_regularization(uuid, date, time, time, text) from public, anon;
grant execute on function public.request_regularization(uuid, date, time, time, text) to authenticated, service_role;
