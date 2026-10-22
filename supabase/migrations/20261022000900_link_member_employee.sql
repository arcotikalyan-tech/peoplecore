-- PeopleCore · Linking a sign-in to an employee record for people who are already members (the owner, HR, anyone
-- invited before their record existed), so they can punch in, apply for leave and see their pay.
--
-- * link_member_employee(member, employee) and unlink_member_employee(member): people with member.manage and
--   employee.update. A record takes one sign-in, and a member one record (unique (organization_id, user_id)).
-- * Adding an employee (or fixing their work email) whose work email is the sign-in email of a member without a record
--   links them straight away.

create function public.link_member_employee(p_member uuid, p_employee uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.organization_members;
  v_e public.employees;
begin
  select * into v_m from public.organization_members where id = p_member;
  if v_m.id is null or not (app.has_permission(v_m.organization_id, 'member.manage') and app.has_permission(v_m.organization_id, 'employee.update')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_e from public.employees where id = p_employee and organization_id = v_m.organization_id for update;
  if v_e.id is null then
    raise exception 'Choose an employee from this organization.' using errcode = '22023';
  end if;
  if v_e.user_id is not null then
    raise exception 'That employee record is already linked to another account.' using errcode = '22023';
  end if;
  if exists (select 1 from public.employees where organization_id = v_m.organization_id and user_id = v_m.user_id) then
    raise exception 'This member is already linked to an employee record.' using errcode = '22023';
  end if;
  update public.employees set user_id = v_m.user_id where id = p_employee;
end $$;

create function public.unlink_member_employee(p_member uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.organization_members;
begin
  select * into v_m from public.organization_members where id = p_member;
  if v_m.id is null or not (app.has_permission(v_m.organization_id, 'member.manage') and app.has_permission(v_m.organization_id, 'employee.update')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.employees set user_id = null where organization_id = v_m.organization_id and user_id = v_m.user_id;
  if not found then
    raise exception 'This member isn’t linked to an employee record.' using errcode = '22023';
  end if;
end $$;

-- An employee whose work email is a member's sign-in email (and who has no record yet) is linked as it is saved.
create function app.link_employee_to_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null and new.work_email is not null then
    select om.user_id into new.user_id
      from public.organization_members om
      join auth.users u on u.id = om.user_id
     where om.organization_id = new.organization_id and om.status in ('active', 'invited')
       and lower(u.email) = lower(new.work_email)
       and not exists (select 1 from public.employees e where e.organization_id = new.organization_id and e.user_id = om.user_id and e.id <> new.id)
     limit 1;
  end if;
  return new;
end $$;
create trigger employees_link_member before insert on public.employees
  for each row execute function app.link_employee_to_member();
create trigger employees_link_member_on_email before update of work_email on public.employees
  for each row when (new.user_id is null and new.work_email is distinct from old.work_email) execute function app.link_employee_to_member();

revoke all on function public.link_member_employee(uuid, uuid) from public, anon;
revoke all on function public.unlink_member_employee(uuid) from public, anon;
revoke all on function app.link_employee_to_member() from public;
grant execute on function public.link_member_employee(uuid, uuid) to authenticated, service_role;
grant execute on function public.unlink_member_employee(uuid) to authenticated, service_role;
