-- PeopleCore · The same person can't be added twice (audit EMP-05).
--
-- Employee codes were unique only as typed ("emp-7" and "EMP-7" both allowed), and nothing stopped two current employees
-- sharing a PAN or UAN. A PAN or UAN may repeat only when the earlier record has left the company, so a rehire still
-- works. Existing records aren't changed or checked; only new and edited ones are.

create function app.check_identity_unique() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if new.pan is not null and (tg_op = 'INSERT' or new.pan is distinct from old.pan) then
    select e.employee_code into v_code
      from restricted.employee_identity i join public.employees e on e.id = i.employee_id
     where i.organization_id = new.organization_id and i.employee_id <> new.employee_id and i.pan = new.pan and e.status <> 'exited'
     limit 1;
    if found then
      raise exception 'This PAN is already recorded for employee %, who hasn’t left. One person can’t have two employee records.', v_code
        using errcode = '22023';
    end if;
  end if;
  if new.uan is not null and (tg_op = 'INSERT' or new.uan is distinct from old.uan) then
    select e.employee_code into v_code
      from restricted.employee_identity i join public.employees e on e.id = i.employee_id
     where i.organization_id = new.organization_id and i.employee_id <> new.employee_id and i.uan = new.uan and e.status <> 'exited'
     limit 1;
    if found then
      raise exception 'This UAN is already recorded for employee %, who hasn’t left. One person can’t have two employee records.', v_code
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger employee_identity_unique before insert or update of pan, uan on restricted.employee_identity
  for each row execute function app.check_identity_unique();

create function app.check_employee_code_unique() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or lower(new.employee_code) is distinct from lower(old.employee_code) then
    -- An exact match is left to the unique constraint; one differing only in capitals is reported as that constraint,
    -- so the website and the importer show their usual "This employee code is already in use."
    if exists (select 1 from public.employees e
                where e.organization_id = new.organization_id and e.id <> new.id and e.employee_code <> new.employee_code
                  and lower(e.employee_code) = lower(new.employee_code)) then
      raise exception 'Employee code % is already in use (codes don’t depend on capitals).', new.employee_code
        using errcode = '23505', constraint = 'employees_organization_id_employee_code_key';
    end if;
  end if;
  return new;
end $$;
create trigger employees_code_unique before insert or update of employee_code on public.employees
  for each row execute function app.check_employee_code_unique();

revoke all on function app.check_identity_unique() from public;
revoke all on function app.check_employee_code_unique() from public;
