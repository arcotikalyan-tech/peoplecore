-- PeopleCore · Core HR: bulk employee import with a dry run.
--
-- import_employees(org, rows, dry_run) creates every row inside a subtransaction and collects a report of
-- per-row problems. If it is a dry run, or any row failed, the subtransaction is rolled back, so nothing is
-- kept; the report survives (PL/pgSQL variables outlive the rollback). A dry run therefore applies exactly
-- the same rules as the real import: constraints, unique emails and codes, archived-item guards, permissions.
--
-- Runs as the caller (security invoker): RLS and create_employee's permission check apply. A permission
-- refusal is not a row problem; it aborts the whole call.
--
-- Rows are JSON objects with: line (for the report), employee_code, first_name, middle_name, last_name,
-- work_email, work_phone, employment_type, date_of_joining, probation_end_date, department_code,
-- designation, location_code, manager_code. Managers are matched by employee code, either an existing
-- employee or another row of the same file, in any order (set in a second pass).

create function app.import_row_message(p_state text, p_constraint text, p_message text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_state = '23505' then case p_constraint
      when 'employees_work_email_uq' then 'Another employee already uses this work email.'
      when 'employees_organization_id_employee_code_key' then 'This employee code is already in use.'
      else 'This employee already exists.' end
    when p_state = '23514' then case p_constraint
      when 'employees_work_email_check' then 'Work email is not valid.'
      when 'employees_work_phone_check' then 'Work phone is not valid.'
      when 'employees_employee_code_check' then 'Employee code may use letters, digits, / _ - (up to 30).'
      when 'employees_first_name_check' then 'First name is required (up to 100 characters).'
      when 'employees_check2' then 'Probation can’t end before the date of joining.'
      else 'Some values are not allowed.' end
    when p_state in ('22P02', '22007', '22008') then 'A value has the wrong format (dates are YYYY-MM-DD).'
    when p_state = '22023' then p_message   -- our own messages, written for users
    else 'This row could not be imported.'
  end;
$$;

create function public.import_employees(p_org uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_row        jsonb;
  v_line       int;
  v_id         uuid;
  v_ref        uuid;
  v_ids        jsonb := '{}'::jsonb;   -- employee_code → id of rows created by this import
  v_by_line    jsonb := '{}'::jsonb;   -- line → id of rows created by this import
  v_errors     jsonb := '[]'::jsonb;
  v_created    int := 0;
  v_committed  boolean := false;
  v_state      text;
  v_constraint text;
  v_message    text;
begin
  if not app.has_permission(p_org, 'employee.create') then
    raise exception 'not authorized to create employees' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no rows to import.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2,000 rows at a time.' using errcode = '22023';
  end if;

  begin  -- everything in here is undone unless this is a real import with no errors
    -- Pass 1: create employees (without managers).
    for v_row in select * from jsonb_array_elements(p_rows) loop
      v_line := coalesce((v_row ->> 'line')::int, 0);
      begin
        v_id := public.create_employee(
          p_organization_id    => p_org,
          p_first_name         => v_row ->> 'first_name',
          p_employment_type    => (v_row ->> 'employment_type')::public.employment_type,
          p_date_of_joining    => (v_row ->> 'date_of_joining')::date,
          p_employee_code      => v_row ->> 'employee_code',
          p_middle_name        => v_row ->> 'middle_name',
          p_last_name          => v_row ->> 'last_name',
          p_work_email         => v_row ->> 'work_email',
          p_work_phone         => v_row ->> 'work_phone',
          p_probation_end_date => (v_row ->> 'probation_end_date')::date,
          p_department_id      => case when nullif(v_row ->> 'department_code', '') is null then null else
            coalesce((select d.id from public.departments d
                       where d.organization_id = p_org and d.code = upper(v_row ->> 'department_code') and d.archived_at is null),
                     app.import_unknown('department code', v_row ->> 'department_code')) end,
          p_designation_id     => case when nullif(v_row ->> 'designation', '') is null then null else
            coalesce((select d.id from public.designations d
                       where d.organization_id = p_org and lower(d.title) = lower(v_row ->> 'designation') and d.archived_at is null),
                     app.import_unknown('designation', v_row ->> 'designation')) end,
          p_location_id        => case when nullif(v_row ->> 'location_code', '') is null then null else
            coalesce((select l.id from public.locations l
                       where l.organization_id = p_org and l.code = upper(v_row ->> 'location_code') and l.archived_at is null),
                     app.import_unknown('location code', v_row ->> 'location_code')) end
        );
        v_ids := v_ids || jsonb_build_object((select e.employee_code from public.employees e where e.id = v_id), v_id);
        v_by_line := v_by_line || jsonb_build_object(v_line::text, v_id);
        v_created := v_created + 1;
      exception
        when insufficient_privilege then raise;
        when others then
          get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
          v_errors := v_errors || jsonb_build_object('line', v_line, 'message', app.import_row_message(v_state, v_constraint, v_message));
      end;
    end loop;

    -- Pass 2: managers, by employee code (a row of this file, or an existing employee).
    for v_row in select * from jsonb_array_elements(p_rows) loop
      continue when nullif(v_row ->> 'manager_code', '') is null;
      v_line := coalesce((v_row ->> 'line')::int, 0);
      v_id := (v_by_line ->> v_line::text)::uuid;
      continue when v_id is null;  -- the row itself failed and is already reported
      v_ref := coalesce((v_ids ->> (v_row ->> 'manager_code'))::uuid,
                        (select e.id from public.employees e where e.organization_id = p_org and e.employee_code = v_row ->> 'manager_code'));
      if v_ref is null then
        v_errors := v_errors || jsonb_build_object('line', v_line, 'message', format('Unknown manager code “%s”.', v_row ->> 'manager_code'));
      elsif v_ref = v_id then
        v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'An employee can’t be their own manager.');
      else
        update public.employees set manager_employee_id = v_ref where id = v_id;
        update public.employment_records set manager_employee_id = v_ref where employee_id = v_id and change_reason = 'joining';
      end if;
    end loop;

    if p_dry_run or jsonb_array_length(v_errors) > 0 then
      raise exception 'rollback' using errcode = 'PCR01';
    end if;
    v_committed := true;
  exception when sqlstate 'PCR01' then
    v_committed := false;  -- rolled back; the report is kept
  end;

  if v_committed then
    perform app.log_employee_import(p_org, jsonb_array_length(p_rows), v_created);
  end if;

  return jsonb_build_object(
    'committed', v_committed,
    'rows', jsonb_array_length(p_rows),
    'valid', jsonb_array_length(p_rows) - (select count(distinct e ->> 'line') from jsonb_array_elements(v_errors) e)::int,
    'errors', (select coalesce(jsonb_agg(e order by (e ->> 'line')::int), '[]'::jsonb) from jsonb_array_elements(v_errors) e)
  );
end $$;

-- The audit entry for a committed import (callers can't write audit_events themselves).
create function app.log_employee_import(p_org uuid, p_rows int, p_created int) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'employee.create') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, metadata)
  values (p_org, auth.uid(), 'import', 'employees', jsonb_build_object('rows', p_rows, 'created', p_created));
end $$;

-- Raises a row error for an unknown reference (used inside the coalesce above).
create function app.import_unknown(p_what text, p_value text) returns uuid
language plpgsql volatile set search_path = '' as $$
begin
  raise exception 'Unknown or archived %: “%”.', p_what, p_value using errcode = '22023';
end $$;

revoke all on function app.import_row_message(text, text, text) from public;
revoke all on function app.import_unknown(text, text) from public;
revoke all on function app.log_employee_import(uuid, int, int) from public;
grant execute on function app.log_employee_import(uuid, int, int) to authenticated, service_role;
grant execute on function app.import_row_message(text, text, text) to authenticated, service_role;
grant execute on function app.import_unknown(text, text) to authenticated, service_role;
revoke all on function public.import_employees(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_employees(uuid, jsonb, boolean) to authenticated, service_role;
