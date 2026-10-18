-- PeopleCore · Payroll (Phase 4, slice 1).
--
-- Flow: payroll.prepare creates a run for a month → the app fetches the run's inputs (payroll_run_inputs) and
-- computes payslips with the deterministic engine (packages/payroll) → stores the results with a fingerprint of
-- the inputs (store_payroll_results) → someone ELSE with payroll.approve verifies (the app recomputes from the
-- stored inputs and compares) and approves → the run is locked: immutable, payslips visible, bank file
-- available. Corrections after locking go into the next run (arrears), never by editing a locked run.
--
-- Statutory rule sets are global reference data (not tenant data), effective-dated and versioned, with a
-- `validated` flag: the bundled sets are NOT professionally validated, and the app says so on every run.
-- Compensation amounts are redacted in the audit trail.

-- ─── Salary components and compensation ─────────────────────────────────────

create type public.component_kind as enum ('earning', 'deduction');

create table public.salary_components (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  code             text not null check (code ~ '^[A-Z0-9_]{2,20}$'),
  name             text not null check (char_length(name) between 2 and 80),
  kind             public.component_kind not null default 'earning',
  taxable          boolean not null default true,
  pf_wage          boolean not null default false,
  position         smallint not null default 0,
  is_active        boolean not null default true,
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.compensation_records (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  effective_from   date not null,
  effective_to     date,
  annual_ctc       numeric(14,2) not null check (annual_ctc > 0),
  note             text check (char_length(note) <= 500),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  exclude using gist (employee_id with =, daterange(effective_from, effective_to, '[]') with &&)
);

create table public.compensation_lines (
  organization_id  uuid not null,
  record_id        uuid not null,
  component_id     uuid not null,
  monthly_amount   numeric(12,2) not null check (monthly_amount >= 0),
  primary key (record_id, component_id),
  foreign key (organization_id, record_id) references public.compensation_records (organization_id, id) on delete cascade,
  foreign key (organization_id, component_id) references public.salary_components (organization_id, id)
);

create table public.employee_statutory_profiles (
  organization_id  uuid not null,
  employee_id      uuid primary key,
  pf_applicable    boolean not null default true,
  esi_applicable   boolean,  -- null: decided each month by the contracted wage
  pt_state         text check (pt_state ~ '^[A-Z]{2}$'),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

create trigger salary_components_audit after insert or update or delete on public.salary_components for each row execute function app.audit_row();
create trigger compensation_records_audit after insert or update on public.compensation_records for each row execute function app.audit_row('annual_ctc');
create trigger compensation_lines_audit after insert or update or delete on public.compensation_lines for each row execute function app.audit_row('monthly_amount');
create trigger employee_statutory_profiles_touch before update on public.employee_statutory_profiles for each row execute function app.touch_updated_at();
create trigger employee_statutory_profiles_audit after insert or update on public.employee_statutory_profiles for each row execute function app.audit_row();

-- ─── Statutory rule sets (global reference data) ────────────────────────────

create table public.statutory_rule_sets (
  id              uuid primary key default gen_random_uuid(),
  country         char(2) not null default 'IN',
  code            text not null unique check (code ~ '^[A-Z0-9_]{3,40}$'),
  effective_from  date not null,
  effective_to    date,
  rules           jsonb not null,
  validated       boolean not null default false,
  validated_by    text,
  validated_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  check (validated = (validated_by is not null)),
  exclude using gist (country with =, daterange(effective_from, effective_to, '[]') with &&)
);

-- ─── Runs and results ───────────────────────────────────────────────────────

create type public.payroll_status as enum ('draft', 'computed', 'approved', 'locked', 'cancelled');
create type public.line_kind as enum ('earning', 'deduction', 'employer');

create table public.payroll_runs (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  period_month         date not null check (extract(day from period_month) = 1),
  status               public.payroll_status not null default 'draft',
  lop_from_absence     boolean not null default false,
  rule_set_id          uuid not null references public.statutory_rule_sets (id),
  engine_version       text,
  inputs_hash          text,
  prepared_by          uuid default auth.uid(),
  computed_at          timestamptz,
  approved_by          uuid,
  approved_at          timestamptz,
  locked_by            uuid,
  locked_at            timestamptz,
  employee_count       int not null default 0,
  total_gross          numeric(14,2) not null default 0,
  total_deductions     numeric(14,2) not null default 0,
  total_net            numeric(14,2) not null default 0,
  total_employer_cost  numeric(14,2) not null default 0,
  created_at           timestamptz not null default now(),
  unique (organization_id, id),
  -- Separation of duties (maker ≠ checker), enforced on the row itself.
  check (approved_by is null or approved_by <> prepared_by)
);
create unique index payroll_runs_month_uq on public.payroll_runs (organization_id, period_month) where status <> 'cancelled';

create table public.payroll_run_employees (
  organization_id  uuid not null,
  run_id           uuid not null,
  employee_id      uuid not null,
  period_month     date not null,
  input            jsonb not null,
  payable_days     numeric(5,2) not null,
  lop_days         numeric(5,2) not null,
  gross            numeric(12,2) not null,
  deductions       numeric(12,2) not null,
  net              numeric(12,2) not null,
  employer_cost    numeric(12,2) not null,
  taxable          numeric(12,2) not null,
  exceptions       jsonb not null default '[]',
  has_blocking     boolean not null default false,
  primary key (run_id, employee_id),
  foreign key (organization_id, run_id) references public.payroll_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id)
);

create table public.payroll_line_items (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  run_id           uuid not null,
  employee_id      uuid not null,
  code             text not null,
  name             text not null,
  kind             public.line_kind not null,
  amount           numeric(12,2) not null,
  foreign key (run_id, employee_id) references public.payroll_run_employees (run_id, employee_id) on delete cascade
);
create index payroll_line_items_run_idx on public.payroll_line_items (run_id, employee_id);

create trigger payroll_runs_audit after insert or update on public.payroll_runs for each row execute function app.audit_row();

-- Approved results can't change; a locked run can't change at all (corrections go into the next run).
create function app.guard_payroll_results() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status public.payroll_status;
begin
  -- Deletes cascading from deleting a whole organization (trigger depth > 1) are allowed.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select status into v_status from public.payroll_runs where id = coalesce(old.run_id, new.run_id);
  if v_status in ('approved', 'locked') then
    raise exception 'This payroll run is % and its results can’t change.', v_status using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_run_employees_guard before insert or update or delete on public.payroll_run_employees
  for each row execute function app.guard_payroll_results();
create trigger payroll_line_items_guard before insert or update or delete on public.payroll_line_items
  for each row execute function app.guard_payroll_results();

create function app.guard_locked_run() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;  -- organization deleted
  if old.status = 'locked' then
    raise exception 'A locked payroll run can’t be changed. Make corrections in the next run.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_runs_locked_guard before update or delete on public.payroll_runs
  for each row execute function app.guard_locked_run();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.salary_components enable row level security;
alter table public.compensation_records enable row level security;
alter table public.compensation_lines enable row level security;
alter table public.employee_statutory_profiles enable row level security;
alter table public.statutory_rule_sets enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_run_employees enable row level security;
alter table public.payroll_line_items enable row level security;

create function app.is_payroll_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_org, 'payroll.prepare') or app.has_permission(p_org, 'payroll.approve');
$$;

create policy salary_components_select on public.salary_components for select to authenticated using (app.is_member(organization_id));
create policy salary_components_write on public.salary_components for all to authenticated
  using (app.has_permission(organization_id, 'compensation.update')) with check (app.has_permission(organization_id, 'compensation.update'));
create policy compensation_records_select on public.compensation_records for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'compensation.read'));
create policy compensation_lines_select on public.compensation_lines for select to authenticated
  using (exists (select 1 from public.compensation_records r where r.id = record_id and app.can_access_employee(r.organization_id, r.employee_id, 'compensation.read')));
create policy employee_statutory_profiles_select on public.employee_statutory_profiles for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'compensation.read') or app.is_payroll_staff(organization_id));
create policy employee_statutory_profiles_write on public.employee_statutory_profiles for all to authenticated
  using (app.has_permission(organization_id, 'payroll.prepare')) with check (app.has_permission(organization_id, 'payroll.prepare'));
create policy statutory_rule_sets_select on public.statutory_rule_sets for select to authenticated using (true);
create policy payroll_runs_select on public.payroll_runs for select to authenticated
  using (app.is_payroll_staff(organization_id) or (app.has_permission(organization_id, 'compensation.read') and status = 'locked'));
-- Payslips: payroll staff see all; everyone else sees what compensation.read allows, once the run is locked.
create function app.can_read_payslip(p_run uuid, p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payroll_runs r where r.id = p_run
                  and (app.is_payroll_staff(r.organization_id)
                       or (r.status = 'locked' and app.can_access_employee(r.organization_id, p_employee, 'compensation.read'))));
$$;
create policy payroll_run_employees_select on public.payroll_run_employees for select to authenticated using (app.can_read_payslip(run_id, employee_id));
create policy payroll_line_items_select on public.payroll_line_items for select to authenticated using (app.can_read_payslip(run_id, employee_id));

grant select on public.salary_components, public.compensation_records, public.compensation_lines, public.employee_statutory_profiles,
                public.statutory_rule_sets, public.payroll_runs, public.payroll_run_employees, public.payroll_line_items to authenticated;
grant insert, update, delete on public.salary_components to authenticated;
grant insert, update on public.employee_statutory_profiles to authenticated;
grant all on public.salary_components, public.compensation_records, public.compensation_lines, public.employee_statutory_profiles,
             public.statutory_rule_sets, public.payroll_runs, public.payroll_run_employees, public.payroll_line_items to service_role;

-- ─── Compensation ───────────────────────────────────────────────────────────

-- New compensation from a date: closes the current record the day before. p_lines: [{component_id, monthly_amount}].
create function public.set_compensation(p_employee uuid, p_effective_from date, p_annual_ctc numeric, p_lines jsonb, p_note text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org  uuid;
  v_id   uuid;
  v_line jsonb;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'compensation.update') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Give at least one salary component.' using errcode = '22023';
  end if;
  if exists (select 1 from public.compensation_records where employee_id = p_employee and effective_from >= p_effective_from) then
    raise exception 'There is already compensation from that date or later. Choose a later date.' using errcode = '22023';
  end if;
  update public.compensation_records set effective_to = p_effective_from - 1
   where employee_id = p_employee and effective_to is null;
  insert into public.compensation_records (organization_id, employee_id, effective_from, annual_ctc, note)
  values (v_org, p_employee, p_effective_from, p_annual_ctc, nullif(btrim(p_note), ''))
  returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.compensation_lines (organization_id, record_id, component_id, monthly_amount)
    select v_org, v_id, c.id, (v_line ->> 'monthly_amount')::numeric
      from public.salary_components c where c.organization_id = v_org and c.id = (v_line ->> 'component_id')::uuid;
    if not found then
      raise exception 'Unknown salary component.' using errcode = '22023';
    end if;
  end loop;
  return v_id;
end $$;

-- ─── Runs ───────────────────────────────────────────────────────────────────

create function public.create_payroll_run(p_org uuid, p_month date, p_lop_from_absence boolean default false) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_rules uuid;
  v_id    uuid;
begin
  if not app.has_permission(p_org, 'payroll.prepare') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select id into v_rules from public.statutory_rule_sets
   where country = 'IN' and effective_from <= v_end and (effective_to is null or effective_to >= v_end);
  if v_rules is null then
    raise exception 'No statutory rules cover %. A platform administrator must add them.', to_char(v_month, 'Mon YYYY') using errcode = '22023';
  end if;
  begin
    insert into public.payroll_runs (organization_id, period_month, lop_from_absence, rule_set_id)
    values (p_org, v_month, coalesce(p_lop_from_absence, false), v_rules)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already a payroll run for %.', to_char(v_month, 'Mon YYYY') using errcode = '22023';
  end;
  return v_id;
end $$;

-- Everything the engine needs, as one JSON document (the app computes; the database stays the record).
create function public.payroll_run_inputs(p_run uuid) returns jsonb
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
       and emp.date_of_joining <= v_end and (emp.date_of_exit is null or emp.date_of_exit >= v_start)
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

-- Stores the engine's results (replacing earlier ones). Totals are recomputed here from the lines.
create function public.store_payroll_results(p_run uuid, p_engine_version text, p_inputs_hash text, p_results jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.payroll_runs;
  r     jsonb;
  l     jsonb;
  v_emp uuid;
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
  delete from public.payroll_run_employees where run_id = p_run;
  for r in select * from jsonb_array_elements(p_results) loop
    select id into v_emp from public.employees where organization_id = v_run.organization_id and id = (r ->> 'employeeId')::uuid;
    if v_emp is null then
      raise exception 'A result names an employee outside this organization.' using errcode = '22023';
    end if;
    insert into public.payroll_run_employees (organization_id, run_id, employee_id, period_month, input, payable_days, lop_days,
                                              gross, deductions, net, employer_cost, taxable, exceptions, has_blocking)
    values (v_run.organization_id, p_run, v_emp, v_run.period_month, r -> 'input',
            (r -> 'input' ->> 'payableDays')::numeric, (r -> 'input' ->> 'daysInPeriod')::numeric - (r -> 'input' ->> 'payableDays')::numeric,
            0, 0, 0, 0, (r ->> 'taxableThisMonth')::numeric, coalesce(r -> 'exceptions', '[]'),
            exists (select 1 from jsonb_array_elements(coalesce(r -> 'exceptions', '[]')) x where (x ->> 'blocking')::boolean));
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

-- The checker approves: never the preparer, only without blocking exceptions, and only for the inputs they verified.
create function public.approve_payroll_run(p_run uuid, p_inputs_hash text) returns void
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
  if exists (select 1 from public.payroll_run_employees where run_id = p_run and has_blocking) then
    raise exception 'Resolve the blocking exceptions before approving.' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_run;
end $$;

create function public.lock_payroll_run(p_run uuid) returns void
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
  perform app.emit_event(v_run.organization_id, 'payroll.locked', p_run, jsonb_build_object('month', to_char(v_run.period_month, 'YYYY-MM')), 'payroll.locked:' || p_run);
  for v_user in select e.user_id from public.payroll_run_employees re join public.employees e on e.id = re.employee_id
                 where re.run_id = p_run and e.user_id is not null loop
    perform app.notify(v_run.organization_id, v_user, 'payroll.payslip', 'Your payslip for ' || to_char(v_run.period_month, 'Mon YYYY') || ' is ready', null, '/payslips');
  end loop;
end $$;

create function public.cancel_payroll_run(p_run uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run for update;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.status = 'locked' then
    raise exception 'A locked payroll run can’t be changed. Make corrections in the next run.' using errcode = '22023';
  end if;
  update public.payroll_runs set status = 'cancelled' where id = p_run;
end $$;

-- Bank transfer file for a locked run: needs payroll.approve and bank access; every export is audited.
create function public.payroll_bank_file(p_run uuid)
returns table (employee_code text, employee_name text, account_holder text, account_number text, ifsc text, amount numeric)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.has_permission(v_run.organization_id, 'payroll.approve')
     or not app.has_permission(v_run.organization_id, 'employee.bank.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.status <> 'locked' then
    raise exception 'Lock the run before exporting the bank file.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_run.organization_id, auth.uid(), 'bank_file_export', 'payroll_runs', p_run,
          jsonb_build_object('employees', v_run.employee_count, 'total_net', v_run.total_net));
  return query
    select e.employee_code, trim(concat_ws(' ', e.first_name, e.last_name)), b.account_holder_name, b.account_number, b.ifsc, re.net
      from public.payroll_run_employees re
      join public.employees e on e.id = re.employee_id
      left join restricted.employee_bank_accounts b on b.employee_id = re.employee_id and b.archived_at is null
     where re.run_id = p_run and re.net > 0
     order by e.employee_code;
end $$;

-- ─── Defaults and reference data ────────────────────────────────────────────

create function app.seed_org_payroll(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.salary_components (organization_id, code, name, kind, taxable, pf_wage, position) values
    (p_org, 'BASIC', 'Basic salary', 'earning', true, true, 1),
    (p_org, 'HRA', 'House rent allowance', 'earning', true, false, 2),
    (p_org, 'SPECIAL', 'Special allowance', 'earning', true, false, 3)
  on conflict (organization_id, code) do nothing;
$$;
create function app.seed_org_payroll_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_payroll(new.id);
  return null;
end $$;
create trigger organizations_seed_payroll after insert on public.organizations
  for each row execute function app.seed_org_payroll_trigger();
select app.seed_org_payroll(id) from public.organizations;

-- FY 2025-26 rules as understood when written (see packages/payroll/src/rules.ts, which must match), and the
-- same values carried into FY 2026-27 provisionally. Neither is professionally validated.
insert into public.statutory_rule_sets (code, effective_from, effective_to, rules, notes) values
  ('IN_FY2025_26', '2025-04-01', '2026-03-31', $json${
    "pf": {"employeeRate": 0.12, "employerEpsRate": 0.0833, "employerTotalRate": 0.12, "edliRate": 0.005, "adminRate": 0.005, "wageCeiling": 15000, "capAtCeiling": true},
    "esi": {"employeeRate": 0.0075, "employerRate": 0.0325, "grossCeiling": 21000},
    "pt": {
      "KA": [{"min": 0, "max": 24999, "amount": 0}, {"min": 25000, "max": null, "amount": 200, "februaryAmount": 300}],
      "MH": [{"min": 0, "max": 7500, "amount": 0}, {"min": 7501, "max": 10000, "amount": 175}, {"min": 10001, "max": null, "amount": 200, "februaryAmount": 300}]
    },
    "incomeTax": {"regime": "new", "standardDeduction": 75000,
      "slabs": [{"upTo": 400000, "rate": 0}, {"upTo": 800000, "rate": 0.05}, {"upTo": 1200000, "rate": 0.1}, {"upTo": 1600000, "rate": 0.15},
                {"upTo": 2000000, "rate": 0.2}, {"upTo": 2400000, "rate": 0.25}, {"upTo": null, "rate": 0.3}],
      "rebateIncomeLimit": 1200000, "marginalRelief": true, "cessRate": 0.04, "surchargeThreshold": 5000000}
  }$json$::jsonb, 'Union Budget 2025 new regime; EPF/ESI; Karnataka and Maharashtra PT. Not professionally validated.');
insert into public.statutory_rule_sets (code, effective_from, rules, notes)
select 'IN_FY2026_27_PROVISIONAL', '2026-04-01', rules, 'FY 2025-26 values carried forward until the FY 2026-27 rules are confirmed and validated.'
  from public.statutory_rule_sets where code = 'IN_FY2025_26';

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function app.guard_payroll_results() from public;
revoke all on function app.guard_locked_run() from public;
revoke all on function app.is_payroll_staff(uuid) from public;
revoke all on function app.can_read_payslip(uuid, uuid) from public;
revoke all on function app.seed_org_payroll(uuid) from public;
revoke all on function app.seed_org_payroll_trigger() from public;
grant execute on function app.is_payroll_staff(uuid) to authenticated, service_role;
grant execute on function app.can_read_payslip(uuid, uuid) to authenticated, service_role;
revoke all on function public.set_compensation(uuid, date, numeric, jsonb, text) from public, anon;
revoke all on function public.create_payroll_run(uuid, date, boolean) from public, anon;
revoke all on function public.payroll_run_inputs(uuid) from public, anon;
revoke all on function public.store_payroll_results(uuid, text, text, jsonb) from public, anon;
revoke all on function public.approve_payroll_run(uuid, text) from public, anon;
revoke all on function public.lock_payroll_run(uuid) from public, anon;
revoke all on function public.cancel_payroll_run(uuid) from public, anon;
revoke all on function public.payroll_bank_file(uuid) from public, anon;
grant execute on function public.set_compensation(uuid, date, numeric, jsonb, text) to authenticated, service_role;
grant execute on function public.create_payroll_run(uuid, date, boolean) to authenticated, service_role;
grant execute on function public.payroll_run_inputs(uuid) to authenticated, service_role;
grant execute on function public.store_payroll_results(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.approve_payroll_run(uuid, text) to authenticated, service_role;
grant execute on function public.lock_payroll_run(uuid) to authenticated, service_role;
grant execute on function public.cancel_payroll_run(uuid) to authenticated, service_role;
grant execute on function public.payroll_bank_file(uuid) to authenticated, service_role;
