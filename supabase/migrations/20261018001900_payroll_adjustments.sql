-- PeopleCore · Payroll adjustments: arrears and recoveries through the next run (Phase 4).
--
-- Locked runs never change. A correction (an arrear owed for an earlier month, a recovery of an overpayment or
-- an advance) is recorded as an adjustment; the next run includes every unapplied adjustment for the employee
-- (the engine pays it in full, never prorated), and locking that run marks exactly those adjustments applied.

create table public.payroll_adjustments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  code             text not null check (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name             text not null check (char_length(name) between 2 and 80),
  kind             public.component_kind not null,
  amount           numeric(12,2) not null check (amount > 0 and amount < 100000000),
  taxable          boolean not null default true,
  reason           text not null check (char_length(reason) between 3 and 500),
  applied_run_id   uuid,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  -- Runs are only ever deleted by the demo purge; the adjustment then simply counts as unapplied again.
  foreign key (organization_id, applied_run_id) references public.payroll_runs (organization_id, id) on delete set null (applied_run_id)
);
create index payroll_adjustments_pending_idx on public.payroll_adjustments (organization_id, employee_id) where applied_run_id is null;
create trigger payroll_adjustments_audit after insert or update or delete on public.payroll_adjustments
  for each row execute function app.audit_row('amount');

-- Applied adjustments are history: they can't be edited or removed.
create function app.guard_applied_adjustment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;  -- cascades (organization deleted, demo purge)
  if old.applied_run_id is not null then
    raise exception 'This adjustment was paid in a locked run and can’t change. Record a new adjustment instead.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_adjustments_guard before update or delete on public.payroll_adjustments
  for each row execute function app.guard_applied_adjustment();

alter table public.payroll_adjustments enable row level security;
create policy payroll_adjustments_select on public.payroll_adjustments for select to authenticated
  using (app.is_payroll_staff(organization_id));
create policy payroll_adjustments_insert on public.payroll_adjustments for insert to authenticated
  with check (app.has_permission(organization_id, 'payroll.prepare') and applied_run_id is null);
create policy payroll_adjustments_delete on public.payroll_adjustments for delete to authenticated
  using (app.has_permission(organization_id, 'payroll.prepare'));
grant select, insert, delete on public.payroll_adjustments to authenticated;
grant all on public.payroll_adjustments to service_role;

-- Same for expense claims paid by a run (migration 20261018001800 created the key without an action).
alter table public.expense_claims drop constraint expense_claims_organization_id_paid_run_id_fkey;
alter table public.expense_claims add constraint expense_claims_organization_id_paid_run_id_fkey
  foreign key (organization_id, paid_run_id) references public.payroll_runs (organization_id, id) on delete set null (paid_run_id);

-- Run inputs: reimbursements (expenses) and unapplied adjustments, with their ids so locking can mark them.
create or replace function public.payroll_run_inputs(p_run uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base jsonb;
  v_run  public.payroll_runs;
  v_end  date;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_base := app.payroll_run_inputs_base(p_run);
  v_end := (v_run.period_month + interval '1 month - 1 day')::date;
  return jsonb_set(v_base, '{employees}', coalesce((
    select jsonb_agg(
             e || jsonb_build_object(
               'reimbursements', coalesce((select sum(c.total) from public.expense_claims c
                                            where c.employee_id = (e ->> 'employeeId')::uuid and c.status = 'approved'
                                              and c.decided_at::date <= v_end), 0),
               'reimbursementClaims', coalesce((select jsonb_agg(c.id order by c.id) from public.expense_claims c
                                                 where c.employee_id = (e ->> 'employeeId')::uuid and c.status = 'approved'
                                                   and c.decided_at::date <= v_end), '[]'::jsonb),
               'adjustments', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'kind', a.kind,
                                                                            'amount', a.amount, 'taxable', a.taxable) order by a.created_at, a.id)
                                          from public.payroll_adjustments a
                                         where a.employee_id = (e ->> 'employeeId')::uuid and a.applied_run_id is null
                                           and a.created_at::date <= v_end), '[]'::jsonb),
               'adjustmentIds', coalesce((select jsonb_agg(a.id order by a.created_at, a.id) from public.payroll_adjustments a
                                           where a.employee_id = (e ->> 'employeeId')::uuid and a.applied_run_id is null
                                             and a.created_at::date <= v_end), '[]'::jsonb))
             order by e ->> 'employeeCode')
      from jsonb_array_elements(v_base -> 'employees') e), '[]'::jsonb));
end $$;

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
  update public.payroll_runs set status = 'locked', locked_by = auth.uid(), locked_at = now() where id = p_run;
  update public.expense_claims c set status = 'paid', paid_run_id = p_run
    from public.payroll_run_employees re, jsonb_array_elements_text(coalesce(re.input -> 'reimbursementClaims', '[]')) claim_id
   where re.run_id = p_run and c.id = claim_id::uuid and c.status = 'approved';
  update public.payroll_adjustments a set applied_run_id = p_run
    from public.payroll_run_employees re, jsonb_array_elements_text(coalesce(re.input -> 'adjustmentIds', '[]')) adj_id
   where re.run_id = p_run and a.id = adj_id::uuid and a.applied_run_id is null;
  perform app.emit_event(v_run.organization_id, 'payroll.locked', p_run, jsonb_build_object('month', to_char(v_run.period_month, 'YYYY-MM')), 'payroll.locked:' || p_run);
  for v_user in select e.user_id from public.payroll_run_employees re join public.employees e on e.id = re.employee_id
                 where re.run_id = p_run and e.user_id is not null loop
    perform app.notify(v_run.organization_id, v_user, 'payroll.payslip', 'Your payslip for ' || to_char(v_run.period_month, 'Mon YYYY') || ' is ready', null, '/payslips');
  end loop;
end $$;

revoke all on function app.guard_applied_adjustment() from public;
