-- PeopleCore · Payroll the checker can trust, and nothing paid twice.
--
-- * Results are computed in the app and stored by store_payroll_results, which anyone with payroll.prepare can call
--   directly. Approval checked only the inputs' fingerprint, so tampered lines, dropped blocking exceptions or an edited
--   list of claims to mark paid would pass. Now the approver's server recomputes the results from the current inputs
--   and approval needs their fingerprint to match what is stored (app.payroll_results_digest; the app builds the same
--   text with resultsDigestSource in @peoplecore/payroll).
-- * Two runs open at once (say October and November) both took every approved claim, unapplied adjustment and
--   approved encashment, so the same money could appear on two payslips. Storing a run that includes an item already
--   in another open run is refused, and locking refuses a run whose items another run has since paid.
-- * Locking marked claims, adjustments and encashments by the ids in the stored input without checking they belong to
--   that organization and employee. They must now.
-- * Each result keeps the PF and ESI wages the engine used (engine 1.4), for the statutory files.

alter table public.payroll_run_employees
  add column pf_wages  numeric(12,2),
  add column esi_wages numeric(12,2);

-- ─── Fingerprint of the stored results ──────────────────────────────────────

create function app.payroll_results_digest(p_run uuid) returns text
language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(string_agg(t.row_text, E'\n' order by t.emp collate "C"), ''), 'UTF8')), 'hex')
    from (
      select re.employee_id::text as emp,
             concat_ws('|',
               re.employee_id::text,
               case when re.has_blocking then '1' else '0' end,
               trim_scale(re.payable_days)::text,
               coalesce((re.input ->> 'onHold')::boolean, false)::text,
               coalesce((select string_agg(x, ',' order by x collate "C") from jsonb_array_elements_text(coalesce(re.input -> 'reimbursementClaims', '[]')) x), ''),
               coalesce((select string_agg(x, ',' order by x collate "C") from jsonb_array_elements_text(coalesce(re.input -> 'adjustmentIds', '[]')) x), ''),
               coalesce((select string_agg(x, ',' order by x collate "C") from jsonb_array_elements_text(coalesce(re.input -> 'encashmentIds', '[]')) x), ''),
               trim_scale(coalesce(re.pf_wages, 0))::text || '/' || trim_scale(coalesce(re.esi_wages, 0))::text,
               coalesce((select string_agg(li.code || '/' || li.kind::text || '/' || trim_scale(li.amount)::text, ','
                                           order by li.code collate "C", li.kind::text collate "C", li.amount)
                           from public.payroll_line_items li where li.run_id = re.run_id and li.employee_id = re.employee_id), '')) as row_text
        from public.payroll_run_employees re
       where re.run_id = p_run) t
$$;
revoke all on function app.payroll_results_digest(uuid) from public;

-- Items (claims, adjustments, encashments) a run's stored inputs include that another open run of the same organization
-- also includes: the month of that other run, or null.
create function app.payroll_items_elsewhere(p_run uuid, p_org uuid, p_inputs jsonb) returns date
language sql stable security definer set search_path = '' as $$
  select min(o.period_month)
    from jsonb_array_elements(p_inputs) mine
    cross join lateral (values ('reimbursementClaims'), ('adjustmentIds'), ('encashmentIds')) k(key)
    cross join lateral jsonb_array_elements_text(coalesce(mine -> k.key, '[]')) item
    join public.payroll_runs o on o.organization_id = p_org and o.id <> p_run and o.status in ('draft', 'computed', 'approved')
   where exists (select 1 from public.payroll_run_employees ore
                  where ore.run_id = o.id and coalesce(ore.input -> k.key, '[]') ? item)
$$;
revoke all on function app.payroll_items_elsewhere(uuid, uuid, jsonb) from public;

-- ─── Storing results: refuse items another open run already pays ────────────

create or replace function public.store_payroll_results(p_run uuid, p_engine_version text, p_inputs_hash text, p_results jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run   public.payroll_runs;
  r       jsonb;
  l       jsonb;
  v_emp   uuid;
  v_other date;
begin
  select * into v_run from public.payroll_runs where id = p_run for update;
  if v_run.id is null or not app.has_permission(v_run.organization_id, 'payroll.prepare') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.status not in ('draft', 'computed') then
    raise exception 'Only draft or computed runs can be recomputed.' using errcode = '22023';
  end if;
  if p_inputs_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid inputs fingerprint.' using errcode = '22023';
  end if;
  v_other := app.payroll_items_elsewhere(p_run, v_run.organization_id,
               coalesce((select jsonb_agg(x -> 'input') from jsonb_array_elements(p_results) x), '[]'));
  if v_other is not null then
    raise exception 'Some reimbursements, adjustments or leave encashments are already in the % payroll run. Lock or cancel that run first, then compute this one.',
      to_char(v_other, 'Mon YYYY') using errcode = '22023';
  end if;
  delete from public.payroll_run_employees where run_id = p_run;
  for r in select * from jsonb_array_elements(p_results) loop
    select id into v_emp from public.employees where organization_id = v_run.organization_id and id = (r ->> 'employeeId')::uuid;
    if v_emp is null then
      raise exception 'A result names an employee outside this organization.' using errcode = '22023';
    end if;
    insert into public.payroll_run_employees (organization_id, run_id, employee_id, period_month, input, payable_days, lop_days,
                                              gross, deductions, net, employer_cost, taxable, exceptions, has_blocking, pf_wages, esi_wages)
    values (v_run.organization_id, p_run, v_emp, v_run.period_month, r -> 'input',
            (r -> 'input' ->> 'payableDays')::numeric, (r -> 'input' ->> 'daysInPeriod')::numeric - (r -> 'input' ->> 'payableDays')::numeric,
            0, 0, 0, 0, (r ->> 'taxableThisMonth')::numeric, coalesce(r -> 'exceptions', '[]'),
            exists (select 1 from jsonb_array_elements(coalesce(r -> 'exceptions', '[]')) x where (x ->> 'blocking')::boolean),
            (r -> 'statutoryWages' ->> 'pf')::numeric, (r -> 'statutoryWages' ->> 'esi')::numeric);
    for l in select * from jsonb_array_elements(r -> 'lines') loop
      insert into public.payroll_line_items (organization_id, run_id, employee_id, code, name, kind, amount)
      values (v_run.organization_id, p_run, v_emp, l ->> 'code', l ->> 'name', (l ->> 'kind')::public.line_kind, (l ->> 'amount')::numeric);
    end loop;
    -- Totals come from the lines, not from what the client says.
    update public.payroll_run_employees pre set
      gross = coalesce((select sum(amount) from public.payroll_line_items where run_id = p_run and employee_id = v_emp and kind = 'earning'), 0),
      deductions = coalesce((select sum(amount) from public.payroll_line_items where run_id = p_run and employee_id = v_emp and kind = 'deduction'), 0),
      employer_cost = coalesce((select sum(amount) from public.payroll_line_items where run_id = p_run and employee_id = v_emp and kind in ('earning', 'employer')), 0)
     where pre.run_id = p_run and pre.employee_id = v_emp;
    update public.payroll_run_employees set net = gross - deductions where run_id = p_run and employee_id = v_emp;
  end loop;
  update public.payroll_runs set
    status = 'computed', engine_version = p_engine_version, inputs_hash = p_inputs_hash, prepared_by = auth.uid(), computed_at = now(),
    employee_count = (select count(*) from public.payroll_run_employees where run_id = p_run),
    total_gross = coalesce((select sum(gross) from public.payroll_run_employees where run_id = p_run), 0),
    total_deductions = coalesce((select sum(deductions) from public.payroll_run_employees where run_id = p_run), 0),
    total_net = coalesce((select sum(net) from public.payroll_run_employees where run_id = p_run), 0),
    total_employer_cost = coalesce((select sum(employer_cost) from public.payroll_run_employees where run_id = p_run), 0)
   where id = p_run;
end $$;

-- ─── Approval: the checker's recomputed results must match the stored ones ──

drop function public.approve_payroll_run(uuid, text);
create function public.approve_payroll_run(p_run uuid, p_inputs_hash text, p_results_hash text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run for update;
  if v_run.id is null or not app.has_permission(v_run.organization_id, 'payroll.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.prepared_by = auth.uid() then
    raise exception 'The person who prepared a payroll run can’t approve it.' using errcode = '42501';
  end if;
  if v_run.status <> 'computed' then
    raise exception 'Only a computed run can be approved.' using errcode = '22023';
  end if;
  if p_inputs_hash is distinct from v_run.inputs_hash then
    raise exception 'The results don’t match the inputs you verified. Recompute and check again.' using errcode = '22023';
  end if;
  if p_results_hash is distinct from app.payroll_results_digest(p_run) then
    raise exception 'The stored payslips don’t match what these inputs give. Recompute the run and check again.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_run_employees where run_id = p_run and has_blocking) then
    raise exception 'Resolve the blocking exceptions before approving.' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_run;
end $$;
revoke all on function public.approve_payroll_run(uuid, text, text) from public, anon;
grant execute on function public.approve_payroll_run(uuid, text, text) to authenticated, service_role;

-- ─── Locking: only this organization's and employee's items, none paid elsewhere ──

create or replace function public.lock_payroll_run(p_run uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run  public.payroll_runs;
  v_user uuid;
begin
  select * into v_run from public.payroll_runs where id = p_run for update;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'Only an approved run can be locked.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_run_employees re
               cross join lateral jsonb_array_elements_text(coalesce(re.input -> 'reimbursementClaims', '[]')) claim_id
               left join public.expense_claims c on c.id = claim_id::uuid and c.organization_id = v_run.organization_id
                                                and c.employee_id = re.employee_id and c.status = 'approved'
              where re.run_id = p_run and c.id is null)
     or exists (select 1 from public.payroll_run_employees re
               cross join lateral jsonb_array_elements_text(coalesce(re.input -> 'adjustmentIds', '[]')) adj_id
               left join public.payroll_adjustments a on a.id = adj_id::uuid and a.organization_id = v_run.organization_id
                                                     and a.employee_id = re.employee_id and a.applied_run_id is null
              where re.run_id = p_run and a.id is null)
     or exists (select 1 from public.payroll_run_employees re
               cross join lateral jsonb_array_elements_text(coalesce(re.input -> 'encashmentIds', '[]')) enc_id
               left join public.leave_encashments le on le.id = enc_id::uuid and le.organization_id = v_run.organization_id
                                                    and le.employee_id = re.employee_id and le.payroll_run_id is null
              where re.run_id = p_run and le.id is null) then
    raise exception 'Something in this run has already been paid in another run or has changed. Recompute the run and approve it again.' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'locked', locked_by = auth.uid(), locked_at = now() where id = p_run;
  update public.expense_claims c set status = 'paid', paid_run_id = p_run
    from public.payroll_run_employees re, jsonb_array_elements_text(coalesce(re.input -> 'reimbursementClaims', '[]')) claim_id
   where re.run_id = p_run and c.id = claim_id::uuid and c.status = 'approved'
     and c.organization_id = v_run.organization_id and c.employee_id = re.employee_id;
  update public.payroll_adjustments a set applied_run_id = p_run
    from public.payroll_run_employees re, jsonb_array_elements_text(coalesce(re.input -> 'adjustmentIds', '[]')) adj_id
   where re.run_id = p_run and a.id = adj_id::uuid and a.applied_run_id is null
     and a.organization_id = v_run.organization_id and a.employee_id = re.employee_id;
  update public.leave_encashments le set payroll_run_id = p_run
    from public.payroll_run_employees re, jsonb_array_elements_text(coalesce(re.input -> 'encashmentIds', '[]')) enc_id
   where re.run_id = p_run and le.id = enc_id::uuid and le.payroll_run_id is null
     and le.organization_id = v_run.organization_id and le.employee_id = re.employee_id;
  insert into public.payroll_payouts (organization_id, run_id, employee_id, amount, status, note)
  select re.organization_id, p_run, re.employee_id, re.net,
         case when coalesce((re.input ->> 'onHold')::boolean, false) then 'on_hold' else 'pending' end::public.payout_status,
         case when coalesce((re.input ->> 'onHold')::boolean, false) then
           (select i.hold_reason from public.payroll_employee_inputs i where i.employee_id = re.employee_id and i.period_month = v_run.period_month) end
    from public.payroll_run_employees re where re.run_id = p_run and re.net > 0;
  perform app.emit_event(v_run.organization_id, 'payroll.locked', p_run, jsonb_build_object('month', to_char(v_run.period_month, 'YYYY-MM')), 'payroll.locked:' || p_run);
  for v_user in select e.user_id from public.payroll_run_employees re join public.employees e on e.id = re.employee_id
                 where re.run_id = p_run and e.user_id is not null loop
    perform app.notify(v_run.organization_id, v_user, 'payroll.payslip', 'Your payslip for ' || to_char(v_run.period_month, 'Mon YYYY') || ' is ready', null, '/payslips');
  end loop;
end $$;
