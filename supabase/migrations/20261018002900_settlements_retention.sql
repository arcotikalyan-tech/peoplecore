-- PeopleCore · Separation and offboarding, part 2 (Phase 6): full and final settlement through the payroll engine,
-- leavers paid in the next run, records kept per retention class, and alumni.
--
-- * Settlement (ADR-010): `settlement_inputs` gathers what the deterministic engine needs (salary, encashable
--   leave, service dates, notice shortfall); the app computes it with `computeSettlement` (packages/payroll) and
--   stores the lines with a fingerprint of the inputs. Payroll prepares, a different person approves (enforced
--   here, as for payroll runs), and only for the inputs they reviewed. Approved lines become payroll adjustments,
--   so they are paid or recovered in the final payroll run with the usual statutory deductions and TDS.
-- * Leavers whose settlement is approved after their exit month join the next run with no salary days.
-- * Retention: per organization, how long after someone leaves each class of personal data is kept. The worker
--   then deletes it (identity numbers, bank accounts, personal details and emergency contacts, documents) and logs
--   what it removed; the employee record itself stays as a minimal archive (name, code, dates). Payroll records are
--   kept (statutory books).

-- ─── Leave encashment ───────────────────────────────────────────────────────

alter table public.leave_types add column encashable boolean not null default false;
update public.leave_types set encashable = true where code in ('EL', 'PL');
-- Earned/privilege leave is encashable by default, including in organizations created from now on.
create function app.leave_types_default_encashable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.code in ('EL', 'PL') then new.encashable := true; end if;
  return new;
end $$;
create trigger leave_types_default_encashable before insert on public.leave_types
  for each row execute function app.leave_types_default_encashable();
revoke all on function app.leave_types_default_encashable() from public;

-- ─── Settlements ────────────────────────────────────────────────────────────

create table public.fnf_settlements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  separation_id    uuid not null unique,
  employee_id      uuid not null,
  status           text not null default 'computed' check (status in ('computed', 'approved', 'voided')),
  inputs           jsonb not null,
  inputs_hash      text not null check (inputs_hash ~ '^[0-9a-f]{64}$'),
  lines            jsonb not null,
  earnings         numeric(14,2) not null,
  deductions       numeric(14,2) not null,
  net              numeric(14,2) not null,
  engine_version   text not null,
  prepared_by      uuid not null default auth.uid(),
  prepared_at      timestamptz not null default now(),
  approved_by      uuid,
  approved_at      timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, separation_id) references public.separations (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id),
  -- Maker ≠ checker, at the database level.
  check (approved_by is null or approved_by <> prepared_by)
);
create trigger fnf_settlements_audit after insert or update on public.fnf_settlements for each row execute function app.audit_row();

-- Which settlement an adjustment pays, so cancelling the separation can take back what hasn't been paid yet.
alter table public.payroll_adjustments add column settlement_id uuid,
  add foreign key (organization_id, settlement_id) references public.fnf_settlements (organization_id, id) on delete set null (settlement_id);

alter table public.fnf_settlements enable row level security;
-- Payroll staff and HR; the employee sees theirs once it is approved.
create policy fnf_settlements_select on public.fnf_settlements for select to authenticated
  using (app.is_payroll_staff(organization_id) or app.has_permission(organization_id, 'separation.manage')
         or (status = 'approved' and app.is_own_employee(employee_id)));
grant select on public.fnf_settlements to authenticated;
grant all on public.fnf_settlements to service_role;

-- What the engine needs, from the database (never from the browser).
create function app.settlement_base(p_separation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.separations;
  v_e public.employees;
begin
  select * into v_s from public.separations where id = p_separation;
  select * into v_e from public.employees where id = v_s.employee_id;
  return jsonb_build_object(
    'employeeId', v_e.id, 'name', trim(concat_ws(' ', v_e.first_name, v_e.last_name)),
    'dateOfJoining', v_e.date_of_joining, 'lastWorkingDay', v_s.last_working_day,
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind, 'monthly', cl.monthly_amount,
                                          'taxable', c.taxable, 'pfWage', c.pf_wage) order by c.position, c.code)
        from public.compensation_records r
        join public.compensation_lines cl on cl.record_id = r.id
        join public.salary_components c on c.id = cl.component_id
       where r.employee_id = v_e.id and r.effective_from <= v_s.last_working_day
         and (r.effective_to is null or r.effective_to >= v_s.last_working_day)), '[]'::jsonb),
    'encashableLeaveDays', coalesce((
      select greatest(0, sum(l.days)) from public.leave_ledger l join public.leave_types t on t.id = l.leave_type_id
       where l.employee_id = v_e.id and t.encashable), 0),
    'noticeShortfallDays', v_s.shortfall_days,
    'shortfallTreatment', v_s.shortfall_treatment);
end $$;

create function public.settlement_inputs(p_separation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.separations;
begin
  select * into v_s from public.separations where id = p_separation;
  if v_s.id is null or not (app.is_payroll_staff(v_s.organization_id) or app.has_permission(v_s.organization_id, 'separation.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_s.status not in ('approved', 'completed') then
    raise exception 'A settlement is prepared once the separation is approved.' using errcode = '22023';
  end if;
  return app.settlement_base(p_separation);
end $$;

-- Payroll stores the engine's result. The inputs must be today's (plus the extra lines payroll added); totals are
-- recomputed here from the lines.
create function public.store_settlement(p_separation uuid, p_engine_version text, p_inputs jsonb, p_inputs_hash text, p_lines jsonb)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s   public.separations;
  v_id  uuid;
  v_l   jsonb;
  v_old public.fnf_settlements;
begin
  select * into v_s from public.separations where id = p_separation;
  if v_s.id is null or not app.has_permission(v_s.organization_id, 'payroll.prepare') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_s.status not in ('approved', 'completed') then
    raise exception 'A settlement is prepared once the separation is approved.' using errcode = '22023';
  end if;
  if (p_inputs - 'extraLines') <> app.settlement_base(p_separation) then
    raise exception 'The employee’s details changed. Prepare the settlement again.' using errcode = '22023';
  end if;
  if p_inputs_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 30 then
    raise exception 'Invalid settlement.' using errcode = '22023';
  end if;
  for v_l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_l->>'code', '') !~ '^FNF_[A-Z0-9_]{1,16}$' or v_l->>'kind' not in ('earning', 'deduction')
       or (v_l->>'amount')::numeric < 0 or char_length(coalesce(v_l->>'name', '')) not between 2 and 80 then
      raise exception 'Invalid settlement line.' using errcode = '22023';
    end if;
  end loop;
  select * into v_old from public.fnf_settlements where separation_id = p_separation for update;
  if v_old.status = 'approved' then
    raise exception 'This settlement is approved and can’t change.' using errcode = '22023';
  end if;
  delete from public.fnf_settlements where separation_id = p_separation;
  insert into public.fnf_settlements (organization_id, separation_id, employee_id, inputs, inputs_hash, lines, earnings, deductions, net, engine_version)
  select v_s.organization_id, p_separation, v_s.employee_id, p_inputs, p_inputs_hash, p_lines, e, d, e - d, p_engine_version
    from (select coalesce(sum((l->>'amount')::numeric) filter (where l->>'kind' = 'earning'), 0) e,
                 coalesce(sum((l->>'amount')::numeric) filter (where l->>'kind' = 'deduction'), 0) d
            from jsonb_array_elements(p_lines) l) t
  returning id into v_id;
  return v_id;
end $$;

-- A different payroll approver approves exactly what they reviewed; the lines become payroll adjustments.
create function public.approve_settlement(p_settlement uuid, p_inputs_hash text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_f public.fnf_settlements;
  v_l jsonb;
begin
  select * into v_f from public.fnf_settlements where id = p_settlement for update;
  if v_f.id is null or not app.has_permission(v_f.organization_id, 'payroll.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_f.prepared_by = auth.uid() then
    raise exception 'Someone other than the preparer must approve it.' using errcode = '42501';
  end if;
  if v_f.status <> 'computed' then
    raise exception 'This settlement is already approved.' using errcode = '22023';
  end if;
  if p_inputs_hash is distinct from v_f.inputs_hash or (v_f.inputs - 'extraLines') <> app.settlement_base(v_f.separation_id) then
    raise exception 'The settlement changed since you opened it. Review it again.' using errcode = '22023';
  end if;
  update public.fnf_settlements set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_settlement;
  for v_l in select * from jsonb_array_elements(v_f.lines) loop
    continue when (v_l->>'amount')::numeric <= 0;
    insert into public.payroll_adjustments (organization_id, employee_id, code, name, kind, amount, taxable, reason, settlement_id)
    values (v_f.organization_id, v_f.employee_id, v_l->>'code', left(v_l->>'name', 80), (v_l->>'kind')::public.component_kind,
            (v_l->>'amount')::numeric, coalesce((v_l->>'taxable')::boolean, true), 'Full and final settlement', p_settlement);
  end loop;
  perform app.emit_event(v_f.organization_id, 'settlement.approved', p_settlement, jsonb_build_object('employee_id', v_f.employee_id),
    'settlement.approved:' || p_settlement);
  perform app.notify(v_f.organization_id, (select user_id from public.employees where id = v_f.employee_id), 'settlement.approved',
    'Your full and final settlement is approved', 'It is paid with your final salary.', '/separations/' || v_f.separation_id);
end $$;

-- ─── Leavers in the next payroll run ────────────────────────────────────────
-- (app.payroll_run_inputs_base as in migration 20261018001600, with one change marked below.)
create or replace function app.payroll_run_inputs_base(p_run uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run    public.payroll_runs;
  v_rules  public.statutory_rule_sets;
  v_start  date;
  v_end    date;
  v_days   int;
  v_fy     date;
  v_out    jsonb := '[]'::jsonb;
  e        record;
  v_comp   jsonb;
  v_lop    numeric;
  v_absent numeric;
  v_unpaid numeric;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_rules from public.statutory_rule_sets where id = v_run.rule_set_id;
  v_start := v_run.period_month;
  v_end := (v_start + interval '1 month - 1 day')::date;
  v_days := v_end - v_start + 1;
  v_fy := case when extract(month from v_start) >= 4 then make_date(extract(year from v_start)::int, 4, 1)
               else make_date(extract(year from v_start)::int - 1, 4, 1) end;

  -- Bring attendance up to date for the month (days after today count as payable).
  perform app.compute_attendance_day(emp.id, d::date)
     from public.employees emp, generate_series(v_start, least(v_end, app.org_today(v_run.organization_id)), interval '1 day') d
    where emp.organization_id = v_run.organization_id and emp.status <> 'pre_joining' and emp.date_of_joining <= v_end;

  for e in
    select emp.*, l.state_code as location_state
      from public.employees emp left join public.locations l on l.id = emp.location_id
     where emp.organization_id = v_run.organization_id and emp.status <> 'pre_joining'
       and emp.date_of_joining <= v_end
       and (emp.date_of_exit is null or emp.date_of_exit >= v_start
            -- Changed: leavers with settlement or other adjustments still to pay join with no salary days.
            or exists (select 1 from public.payroll_adjustments a where a.employee_id = emp.id and a.applied_run_id is null
                          and a.created_at::date <= v_end))
     order by emp.employee_code
  loop
    select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind, 'monthly', cl.monthly_amount,
                                                 'taxable', c.taxable, 'pfWage', c.pf_wage) order by c.position, c.code), '[]'::jsonb)
      into v_comp
      from public.compensation_records r
      join public.compensation_lines cl on cl.record_id = r.id
      join public.salary_components c on c.id = cl.component_id
     where r.employee_id = e.id and r.effective_from <= v_end and (r.effective_to is null or r.effective_to >= v_end);

    select coalesce(sum(a.leave_days) filter (where a.leave_paid = false), 0),
           coalesce(sum(case when a.status = 'absent' then 1
                             when a.status = 'half_day' and coalesce(a.leave_paid, false) = false and a.leave_days = 0 then 0.5 else 0 end), 0)
      into v_unpaid, v_absent
      from public.attendance_days a where a.employee_id = e.id and a.work_date between v_start and v_end;
    -- Days before joining and after leaving aren't paid.
    v_lop := v_unpaid + case when v_run.lop_from_absence then v_absent else 0 end
             + greatest(0, e.date_of_joining - v_start)
             + case when e.date_of_exit is not null and e.date_of_exit < v_end then v_end - e.date_of_exit else 0 end;

    v_out := v_out || jsonb_build_object(
      'employeeId', e.id, 'employeeCode', e.employee_code, 'name', trim(concat_ws(' ', e.first_name, e.last_name)),
      'components', v_comp, 'daysInPeriod', v_days, 'payableDays', greatest(0, v_days - v_lop),
      'statutory', (select jsonb_build_object('pf', coalesce(p.pf_applicable, true), 'esi', p.esi_applicable,
                                              'ptState', coalesce(p.pt_state, e.location_state))
                      from (select 1) one left join public.employee_statutory_profiles p on p.employee_id = e.id),
      'ytd', jsonb_build_object(
        'taxableIncome', coalesce((select sum(re.taxable) from public.payroll_run_employees re join public.payroll_runs r on r.id = re.run_id
                                    where re.employee_id = e.id and r.status = 'locked' and r.period_month >= v_fy and r.period_month < v_start), 0),
        'tds', coalesce((select sum(li.amount) from public.payroll_line_items li join public.payroll_runs r on r.id = li.run_id
                          where li.employee_id = e.id and li.code = 'TDS' and r.status = 'locked' and r.period_month >= v_fy and r.period_month < v_start), 0)),
      'reimbursements', 0);
  end loop;

  return jsonb_build_object(
    'runId', v_run.id, 'month', to_char(v_start, 'YYYY-MM'),
    'ruleSet', jsonb_build_object('id', v_rules.id, 'code', v_rules.code, 'validated', v_rules.validated, 'rules', v_rules.rules),
    'employees', v_out);
end $$;

-- ─── Retention ──────────────────────────────────────────────────────────────

create table public.retention_policies (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  record_class     text not null check (record_class in ('identity', 'bank', 'personal', 'documents')),
  retain_months    smallint not null check (retain_months between 0 and 240),
  primary key (organization_id, record_class)
);
alter table public.retention_policies enable row level security;
create policy retention_policies_select on public.retention_policies for select to authenticated
  using (app.has_permission(organization_id, 'separation.manage') or app.has_permission(organization_id, 'audit.read'));
create policy retention_policies_write on public.retention_policies for update to authenticated
  using (app.has_permission(organization_id, 'separation.manage')) with check (app.has_permission(organization_id, 'separation.manage'));
grant select, update on public.retention_policies to authenticated;
grant all on public.retention_policies to service_role;
create trigger retention_policies_audit after update on public.retention_policies for each row execute function app.audit_row();

-- What the worker removed, and when (append-only).
create table public.retention_actions (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  employee_id      uuid not null,
  record_class     text not null,
  rows_removed     int not null,
  storage_paths    text[] not null default '{}',
  acted_at         timestamptz not null default now(),
  unique (employee_id, record_class),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create trigger retention_actions_no_update before update on public.retention_actions for each row execute function app.prevent_mutation();
alter table public.retention_actions enable row level security;
create policy retention_actions_select on public.retention_actions for select to authenticated
  using (app.has_permission(organization_id, 'separation.manage') or app.has_permission(organization_id, 'audit.read'));
grant select on public.retention_actions to authenticated;
grant all on public.retention_actions to service_role;

create function app.seed_org_retention(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.retention_policies (organization_id, record_class, retain_months) values
    (p_org, 'identity', 36), (p_org, 'bank', 36), (p_org, 'personal', 36), (p_org, 'documents', 96)
  on conflict do nothing;
$$;
create function app.seed_org_retention_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_retention(new.id);
  return null;
end $$;
create trigger organizations_seed_retention after insert on public.organizations for each row execute function app.seed_org_retention_trigger();
select app.seed_org_retention(id) from public.organizations;

-- Worker: delete each class of a leaver's personal data once its retention period after exit has passed. Returns
-- the document files for the worker to delete from storage.
create function public.worker_retention() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r       record;
  v_rows  int;
  v_paths text[];
  v_all   text[] := '{}';
  v_more  int;
  v_n     int := 0;
begin
  for r in select e.organization_id, e.id as employee_id, p.record_class
             from public.employees e
             join public.retention_policies p on p.organization_id = e.organization_id
            where e.status = 'exited' and e.date_of_exit is not null
              and (e.date_of_exit + make_interval(months => p.retain_months))::date < app.org_today(e.organization_id)
              and not exists (select 1 from public.retention_actions a where a.employee_id = e.id and a.record_class = p.record_class)
            order by e.id, p.record_class loop
    v_paths := '{}';
    case r.record_class
      when 'identity' then
        delete from restricted.employee_identity where employee_id = r.employee_id;
        get diagnostics v_rows = row_count;
      when 'bank' then
        delete from restricted.employee_bank_accounts where employee_id = r.employee_id;
        get diagnostics v_rows = row_count;
      when 'personal' then
        delete from public.emergency_contacts where employee_id = r.employee_id;
        get diagnostics v_rows = row_count;
        delete from public.employee_personal where employee_id = r.employee_id;
        get diagnostics v_more = row_count;
        v_rows := v_rows + v_more;
      when 'documents' then
        select coalesce(array_agg(storage_path), '{}') into v_paths from public.employee_documents
         where employee_id = r.employee_id and deleted_at is null;
        update public.employee_documents set deleted_at = now() where employee_id = r.employee_id and deleted_at is null;
        get diagnostics v_rows = row_count;
    end case;
    insert into public.retention_actions (organization_id, employee_id, record_class, rows_removed, storage_paths)
    values (r.organization_id, r.employee_id, r.record_class, v_rows, v_paths);
    v_all := v_all || v_paths;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('actions', v_n, 'storagePaths', to_jsonb(v_all));
end $$;

-- Cancelling a separation (migration 20261018002800) now also voids its settlement: adjustments not yet paid are
-- removed; once any has been paid in a locked run the separation can't be cancelled (record a recovery instead).
create or replace function public.withdraw_separation(p_separation uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.separations;
  v_f public.fnf_settlements;
begin
  select * into v_s from public.separations where id = p_separation for update;
  if v_s.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_s.status = 'submitted' and app.is_own_employee(v_s.employee_id) and v_s.type = 'resignation' then
    perform public.cancel_approval(v_s.approval_request_id); -- the handler marks it withdrawn
    return;
  end if;
  if not app.has_permission(v_s.organization_id, 'separation.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_s.status not in ('submitted', 'approved') then
    raise exception 'This separation is closed.' using errcode = '22023';
  end if;
  select * into v_f from public.fnf_settlements where separation_id = p_separation for update;
  if v_f.id is not null then
    if exists (select 1 from public.payroll_adjustments where settlement_id = v_f.id and applied_run_id is not null) then
      raise exception 'The settlement has already been paid. Record a recovery in payroll instead of cancelling.' using errcode = '22023';
    end if;
    delete from public.payroll_adjustments where settlement_id = v_f.id;
    update public.fnf_settlements set status = 'voided' where id = v_f.id;
  end if;
  update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_s.approval_request_id and status = 'pending';
  update public.separations set status = 'cancelled' where id = p_separation;
  if v_s.status = 'approved' then
    update public.employees set status = 'active', date_of_exit = null where id = v_s.employee_id and status = 'on_notice';
    update public.clearance_items set status = 'waived', note = 'Separation cancelled', cleared_by = auth.uid(), cleared_at = now()
     where separation_id = p_separation and status = 'pending';
  end if;
end $$;

revoke all on function app.settlement_base(uuid) from public;
revoke all on function app.seed_org_retention(uuid) from public;
revoke all on function app.seed_org_retention_trigger() from public;
revoke all on function public.settlement_inputs(uuid) from public, anon;
revoke all on function public.store_settlement(uuid, text, jsonb, text, jsonb) from public, anon;
revoke all on function public.approve_settlement(uuid, text) from public, anon;
revoke all on function public.worker_retention() from public, anon, authenticated;
grant execute on function public.settlement_inputs(uuid) to authenticated, service_role;
grant execute on function public.store_settlement(uuid, text, jsonb, text, jsonb) to authenticated, service_role;
grant execute on function public.approve_settlement(uuid, text) to authenticated, service_role;
grant execute on function public.worker_retention() to service_role;
