-- Accounting export for a locked run: the run's line items summed per component, for the journal that
-- packages/payroll (payrollJournal) builds. Payroll staff only (the people who see the run); every export is audited.
create function public.payroll_journal_items(p_run uuid)
returns table (code text, name text, kind public.line_kind, amount numeric, employees integer)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.status <> 'locked' then
    raise exception 'Lock the run before exporting the journal.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_run.organization_id, auth.uid(), 'journal_export', 'payroll_runs', p_run,
          jsonb_build_object('employees', v_run.employee_count, 'total_gross', v_run.total_gross, 'total_net', v_run.total_net));
  return query
    select li.code, min(li.name), li.kind, sum(li.amount), count(distinct li.employee_id)::integer
      from public.payroll_line_items li
     where li.run_id = p_run
     group by li.kind, li.code
     order by li.kind, li.code;
end $$;

revoke all on function public.payroll_journal_items(uuid) from public, anon;
grant execute on function public.payroll_journal_items(uuid) to authenticated, service_role;
