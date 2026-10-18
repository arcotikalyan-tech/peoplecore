-- PeopleCore · Corrections and reimbursements go into the NEXT run computed, whatever its month.
--
-- Migrations 20261018001800/1900 only took approved claims and adjustments dated on or before the end of the
-- run's month. Running a month late (or catching up an old month) then silently skipped corrections recorded
-- since. Now every unpaid approved claim and every unapplied adjustment goes into the next run that is
-- computed; locking that run marks exactly those as paid/applied, so nothing is paid twice.

create or replace function public.payroll_run_inputs(p_run uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base jsonb;
  v_run  public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_base := app.payroll_run_inputs_base(p_run);
  return jsonb_set(v_base, '{employees}', coalesce((
    select jsonb_agg(
             e || jsonb_build_object(
               'reimbursements', coalesce((select sum(c.total) from public.expense_claims c
                                            where c.employee_id = (e ->> 'employeeId')::uuid and c.status = 'approved'), 0),
               'reimbursementClaims', coalesce((select jsonb_agg(c.id order by c.id) from public.expense_claims c
                                                 where c.employee_id = (e ->> 'employeeId')::uuid and c.status = 'approved'), '[]'::jsonb),
               'adjustments', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'kind', a.kind,
                                                                            'amount', a.amount, 'taxable', a.taxable) order by a.created_at, a.id)
                                          from public.payroll_adjustments a
                                         where a.employee_id = (e ->> 'employeeId')::uuid and a.applied_run_id is null), '[]'::jsonb),
               'adjustmentIds', coalesce((select jsonb_agg(a.id order by a.created_at, a.id) from public.payroll_adjustments a
                                           where a.employee_id = (e ->> 'employeeId')::uuid and a.applied_run_id is null), '[]'::jsonb))
             order by e ->> 'employeeCode')
      from jsonb_array_elements(v_base -> 'employees') e), '[]'::jsonb));
end $$;
