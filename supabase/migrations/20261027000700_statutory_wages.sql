-- PeopleCore · PF and ESI wages in the statutory files are the ones payroll used.
--
-- The PF ECR and register rebuilt the PF wage as PF ÷ 12% after PF had been rounded (12,345 came back as 12,342), and
-- the ESI return worked out ESI wages with its own list of exclusions, which missed loan disbursals, F&F lines and
-- custom adjustments the engine leaves out. Runs computed by engine 1.4 store both wages; older runs keep the old
-- reconstruction.

create or replace function public.payroll_statutory_rows(p_run uuid, p_report text)
returns table (employee_id uuid, employee_code text, employee_name text, pan text, uan text, esic_number text, pt_state text,
               payable_days numeric, lop_days numeric, gross numeric, taxable numeric, pf_wages numeric, pf_employee numeric,
               eps_employer numeric, epf_employer numeric, esi_wages numeric, esi_employee numeric, esi_employer numeric, pt numeric, tds numeric)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id)
     or not app.has_permission(v_run.organization_id, 'employee.identity.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.status <> 'locked' then
    raise exception 'Lock the run before exporting statutory files.' using errcode = '22023';
  end if;
  if p_report not in ('pf_ecr', 'esi', 'pt', 'tds', 'register') then
    raise exception 'Unknown report.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_run.organization_id, auth.uid(), 'payroll_export', 'payroll_runs', p_run, jsonb_build_object('report', p_report, 'employees', v_run.employee_count));
  return query
    select re.employee_id, e.employee_code, trim(concat_ws(' ', e.first_name, e.last_name)), i.pan, i.uan, i.esic_number,
           re.input -> 'statutory' ->> 'ptState', re.payable_days, re.lop_days, re.gross, re.taxable,
           coalesce(re.pf_wages, round(coalesce(sum(li.amount) filter (where li.code = 'PF'), 0) / 0.12)),
           coalesce(sum(li.amount) filter (where li.code = 'PF'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'EPS_ER'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'EPF_ER'), 0),
           coalesce(re.esi_wages,
             case when bool_or(li.code = 'ESI') then re.gross - coalesce(sum(li.amount) filter (where li.kind = 'earning' and
               (li.code in ('REIMB', 'ARREAR', 'BONUS', 'LEAVE_ENC', 'JOIN_ARREARS')
                or (li.code = 'OT' and not coalesce(re.input -> 'adjustments' @> '[{"code": "OT", "esiWage": true}]'::jsonb, false)))), 0) else 0 end),
           coalesce(sum(li.amount) filter (where li.code = 'ESI'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'ESI_ER'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'PT'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'TDS'), 0)
      from public.payroll_run_employees re
      join public.employees e on e.id = re.employee_id
      left join restricted.employee_identity i on i.employee_id = re.employee_id
      left join public.payroll_line_items li on li.run_id = re.run_id and li.employee_id = re.employee_id
     where re.run_id = p_run
     group by re.employee_id, e.employee_code, e.first_name, e.last_name, i.pan, i.uan, i.esic_number, re.input, re.payable_days, re.lop_days, re.gross, re.taxable,
              re.pf_wages, re.esi_wages
     order by e.employee_code;
end $$;
