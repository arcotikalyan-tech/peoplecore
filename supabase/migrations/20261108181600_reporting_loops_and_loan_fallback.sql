-- PeopleCore · No reporting loops, and loans never stuck without a manager (audit EMP-03).
--
-- * Only "reports to themselves" was refused, so A could report to B while B reported to A (or a longer circle), which
--   breaks team views and skip-level approvals. Setting a manager now walks up the new manager's line and refuses a loop.
-- * Every approval flow's reporting-manager step names who decides when there is no manager who can act (left,
--   suspended, none set), except the loan flow, so such a loan waited for nobody. Payroll now decides then, as it does at
--   the loan's second step. Pending loans pick this up at once (approvers are worked out when asked for).

create function app.check_reporting_loop() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_at    uuid := new.manager_employee_id;
  v_depth int := 0;
begin
  if new.manager_employee_id is null or (tg_op = 'UPDATE' and new.manager_employee_id is not distinct from old.manager_employee_id) then
    return new;
  end if;
  while v_at is not null and v_depth < 100 loop
    if v_at = new.id then
      raise exception 'That would make a reporting loop: % already reports, directly or through others, to this person.',
        (select trim(concat_ws(' ', first_name, last_name)) from public.employees where id = new.manager_employee_id)
        using errcode = '22023';
    end if;
    select manager_employee_id into v_at from public.employees where id = v_at;
    v_depth := v_depth + 1;
  end loop;
  return new;
end $$;
create trigger employees_no_reporting_loop before insert or update of manager_employee_id on public.employees
  for each row execute function app.check_reporting_loop();
revoke all on function app.check_reporting_loop() from public;

update app.approval_flow_templates set permission_key = 'payroll.approve'
 where subject_type = 'loan' and approver_rule = 'reporting_manager' and permission_key is null;
update public.approval_flow_steps s set permission_key = 'payroll.approve'
  from public.approval_flows f
 where f.id = s.flow_id and f.subject_type = 'loan' and s.approver_rule = 'reporting_manager' and s.permission_key is null;
