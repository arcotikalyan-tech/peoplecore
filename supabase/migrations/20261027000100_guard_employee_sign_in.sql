-- PeopleCore · Whose sign-in an employee record uses is changed only by people who manage members.
--
-- The employees update policy needs only employee.update, so an HR executive could set another person's record to
-- their own sign-in (or clear their own) and then read that person's payslips, identity summary and reporting line.
-- Linking still works through link_member_employee / unlink_member_employee and add_member (member.manage), and a new
-- record still links itself to the member with the same work email (that trigger runs after this one, and an update
-- of work_email alone doesn't fire this one). The worker, the seed and the database owner aren't affected.

create function app.guard_employee_user_id() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Signed-in requests run as the authenticated role; the worker, the seed and the database owner don't.
  if current_setting('role', true) = 'authenticated' and auth.uid() is not null
     and ((tg_op = 'INSERT' and new.user_id is not null) or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id))
     and not app.has_permission(new.organization_id, 'member.manage') then
    raise exception 'Only people who manage members can change whose sign-in an employee record uses.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app.guard_employee_user_id() from public;

create trigger employees_guard_user_id before insert or update of user_id on public.employees
  for each row execute function app.guard_employee_user_id();
