-- PeopleCore · Payroll suite (Kredily parity): settings, salary structures, revisions with sign-off and arrears,
-- per-month run inputs (LOP, TDS override, wage units, salary on hold), leave encashment payout, tax declarations
-- (old/new regime), payouts, bank advice and statutory reports.
--
-- The engine stays the only place pay is computed (packages/payroll). Everything here feeds its inputs or records
-- what happened after a run was locked. Locked runs never change.

-- ─── Rule sets: old regime and deduction caps (data; still not professionally validated) ────────────────────

update public.statutory_rule_sets
   set rules = jsonb_set(rules, '{incomeTax}', (rules -> 'incomeTax') || $json${
     "oldRegime": {"standardDeduction": 50000,
       "slabs": [{"upTo": 250000, "rate": 0}, {"upTo": 500000, "rate": 0.05}, {"upTo": 1000000, "rate": 0.2}, {"upTo": null, "rate": 0.3}],
       "rebateIncomeLimit": 500000, "marginalRelief": false, "cessRate": 0.04},
     "deductionCaps": {"sec80C": 150000, "sec80CCD1B": 50000, "sec80DSelf": 25000, "sec80DSelfSenior": 50000, "sec80DParents": 25000,
       "sec80DParentsSenior": 50000, "sec80TTA": 10000, "sec24b": 200000}
   }$json$::jsonb)
 where code in ('IN_FY2025_26', 'IN_FY2026_27_PROVISIONAL');

-- ─── Settings ───────────────────────────────────────────────────────────────

create table public.payroll_settings (
  organization_id     uuid primary key references public.organizations (id) on delete cascade,
  pay_day             smallint check (pay_day between 1 and 31),  -- null: last day of the month
  lop_from_absence    boolean not null default false,
  pf_enabled          boolean not null default true,
  esi_enabled         boolean not null default true,
  pt_enabled          boolean not null default true,
  default_regime      text not null default 'new' check (default_regime in ('old', 'new')),
  declaration_open    boolean not null default true,
  declaration_mode    text not null default 'yearly' check (declaration_mode in ('monthly', 'yearly')),
  declaration_until   date,
  proof_from          date,
  proof_until         date,
  payslip_template    text not null default 'modern' check (payslip_template in ('modern', 'classic', 'compact')),
  payslip_show_ytd    boolean not null default true,
  updated_by          uuid default auth.uid(),
  updated_at          timestamptz not null default now(),
  check (proof_until is null or proof_from is null or proof_until >= proof_from)
);

-- The company's paying account and the bank file format: payroll staff only.
create table public.payroll_bank_settings (
  organization_id   uuid primary key references public.organizations (id) on delete cascade,
  bank_name         text check (char_length(bank_name) between 2 and 120),
  account_number    text check (account_number ~ '^[0-9]{6,18}$'),
  ifsc              text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  file_format       text not null default 'generic' check (file_format in ('generic', 'hdfc', 'icici', 'sbi')),
  updated_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now()
);

create trigger payroll_settings_touch before update on public.payroll_settings for each row execute function app.touch_updated_at();
create trigger payroll_settings_audit after insert or update on public.payroll_settings for each row execute function app.audit_row();
create trigger payroll_bank_settings_touch before update on public.payroll_bank_settings for each row execute function app.touch_updated_at();
create trigger payroll_bank_settings_audit after insert or update on public.payroll_bank_settings
  for each row execute function app.audit_row('account_number');

-- ─── Components and structures ──────────────────────────────────────────────

alter table public.salary_components
  add column category    text not null default 'recurring' check (category in ('base', 'recurring', 'variable', 'adhoc')),
  add column description text check (char_length(description) <= 300);
update public.salary_components set category = 'base' where code = 'BASIC';

create type public.pay_basis as enum ('monthly', 'daily', 'hourly');
create type public.structure_calc as enum ('percent_of_gross', 'percent_of_basic', 'fixed', 'balance');

create table public.salary_structures (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  description      text check (char_length(description) <= 300),
  pay_basis        public.pay_basis not null default 'monthly',
  is_default       boolean not null default false,
  is_system        boolean not null default false,
  archived_at      timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);
create unique index salary_structures_default_uq on public.salary_structures (organization_id) where is_default and archived_at is null;

create table public.salary_structure_lines (
  organization_id  uuid not null,
  structure_id     uuid not null,
  component_id     uuid not null,
  calc             public.structure_calc not null,
  value            numeric(12,2) not null default 0 check (value >= 0),
  position         smallint not null default 0,
  primary key (structure_id, component_id),
  check (calc not in ('percent_of_gross', 'percent_of_basic') or value <= 100),
  foreign key (organization_id, structure_id) references public.salary_structures (organization_id, id) on delete cascade,
  foreign key (organization_id, component_id) references public.salary_components (organization_id, id) on delete cascade
);

create trigger salary_structures_audit after insert or update or delete on public.salary_structures for each row execute function app.audit_row();
create trigger salary_structure_lines_audit after insert or update or delete on public.salary_structure_lines for each row execute function app.audit_row();

alter table public.compensation_records
  add column structure_id uuid,
  add column pay_basis    public.pay_basis not null default 'monthly',
  add foreign key (organization_id, structure_id) references public.salary_structures (organization_id, id) on delete set null (structure_id);

-- Every organization starts with settings, an LTA component and four structures (general, daily, hourly, contractor).
create or replace function app.seed_org_payroll(p_org uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_general uuid; v_daily uuid; v_hourly uuid; v_contract uuid;
  c record;
begin
  insert into public.salary_components (organization_id, code, name, kind, taxable, pf_wage, position, category) values
    (p_org, 'BASIC', 'Basic salary', 'earning', true, true, 1, 'base'),
    (p_org, 'HRA', 'House rent allowance', 'earning', true, false, 2, 'recurring'),
    (p_org, 'LTA', 'Leave travel allowance', 'earning', true, false, 3, 'recurring'),
    (p_org, 'SPECIAL', 'Special allowance', 'earning', true, false, 4, 'recurring')
  on conflict (organization_id, code) do nothing;
  insert into public.payroll_settings (organization_id) values (p_org) on conflict do nothing;
  insert into public.payroll_bank_settings (organization_id) values (p_org) on conflict do nothing;
  if exists (select 1 from public.salary_structures where organization_id = p_org) then return; end if;

  insert into public.salary_structures (organization_id, name, description, pay_basis, is_default, is_system)
  values (p_org, 'General Salary Structure', 'Basic 40% of gross, HRA 40% of basic, the balance as special allowance.', 'monthly', true, true)
  returning id into v_general;
  insert into public.salary_structures (organization_id, name, description, pay_basis, is_system)
  values (p_org, 'Daily Wage', 'A rate per day worked.', 'daily', true) returning id into v_daily;
  insert into public.salary_structures (organization_id, name, description, pay_basis, is_system)
  values (p_org, 'Hourly Wage', 'A rate per hour worked.', 'hourly', true) returning id into v_hourly;
  insert into public.salary_structures (organization_id, name, description, pay_basis, is_system)
  values (p_org, 'Contractor Salary Structure', 'A single fixed monthly fee.', 'monthly', true) returning id into v_contract;

  for c in select id, code from public.salary_components where organization_id = p_org and code in ('BASIC', 'HRA', 'LTA', 'SPECIAL') loop
    insert into public.salary_structure_lines (organization_id, structure_id, component_id, calc, value, position)
    values (p_org, v_general, c.id,
            case c.code when 'BASIC' then 'percent_of_gross' when 'HRA' then 'percent_of_basic' when 'LTA' then 'fixed' else 'balance' end::public.structure_calc,
            case c.code when 'BASIC' then 40 when 'HRA' then 40 else 0 end,
            case c.code when 'BASIC' then 1 when 'HRA' then 2 when 'LTA' then 3 else 4 end);
    if c.code = 'BASIC' then
      insert into public.salary_structure_lines (organization_id, structure_id, component_id, calc, value, position) values
        (p_org, v_daily, c.id, 'fixed', 0, 1), (p_org, v_hourly, c.id, 'fixed', 0, 1), (p_org, v_contract, c.id, 'balance', 0, 1);
    end if;
  end loop;
end $$;
select app.seed_org_payroll(id) from public.organizations;

-- ─── Salary revisions (maker proposes, a payroll approver signs off; arrears for locked months) ─────────────

create type public.revision_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.salary_revisions (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null,
  employee_id             uuid not null,
  effective_from          date not null,
  structure_id            uuid,
  pay_basis               public.pay_basis not null default 'monthly',
  previous_annual_ctc     numeric(14,2),
  annual_ctc              numeric(14,2) not null check (annual_ctc > 0),
  lines                   jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  reason                  text not null check (char_length(reason) between 3 and 500),
  status                  public.revision_status not null default 'pending',
  requested_by            uuid not null default auth.uid(),
  requested_at            timestamptz not null default now(),
  decided_by              uuid,
  decided_at              timestamptz,
  decision_note           text check (char_length(decision_note) <= 500),
  compensation_record_id  uuid,
  arrears                 numeric(12,2) not null default 0,
  unique (organization_id, id),
  check (decided_by is null or decided_by <> requested_by),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, structure_id) references public.salary_structures (organization_id, id) on delete set null (structure_id)
);
create unique index salary_revisions_pending_uq on public.salary_revisions (employee_id) where status = 'pending';
create trigger salary_revisions_audit after insert or update on public.salary_revisions
  for each row execute function app.audit_row('annual_ctc', 'previous_annual_ctc', 'lines', 'arrears');

-- Saves compensation from a structure (first salary, or after sign-off). Closes the current record.
create function app.apply_compensation(p_employee uuid, p_effective_from date, p_structure uuid, p_pay_basis public.pay_basis,
                                       p_annual_ctc numeric, p_lines jsonb, p_note text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org  uuid;
  v_id   uuid;
  v_line jsonb;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one salary component.' using errcode = '22023';
  end if;
  if exists (select 1 from public.compensation_records where employee_id = p_employee and effective_from >= p_effective_from) then
    raise exception 'A salary already starts on or after this date. Choose a later effective date.' using errcode = '22023';
  end if;
  update public.compensation_records set effective_to = p_effective_from - 1 where employee_id = p_employee and effective_to is null;
  insert into public.compensation_records (organization_id, employee_id, effective_from, annual_ctc, note, structure_id, pay_basis)
  values (v_org, p_employee, p_effective_from, p_annual_ctc, p_note, p_structure, p_pay_basis)
  returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ->> 'monthly_amount')::numeric > 0 then
      insert into public.compensation_lines (organization_id, record_id, component_id, monthly_amount)
      select v_org, v_id, c.id, (v_line ->> 'monthly_amount')::numeric
        from public.salary_components c where c.organization_id = v_org and c.id = (v_line ->> 'component_id')::uuid;
      if not found then raise exception 'Unknown salary component.' using errcode = '22023'; end if;
    end if;
  end loop;
  if not exists (select 1 from public.compensation_lines where record_id = v_id) then
    raise exception 'Enter at least one amount above zero.' using errcode = '22023';
  end if;
  return v_id;
end $$;

-- First salary for an employee with none: compensation.update saves it directly.
create function public.assign_salary(p_employee uuid, p_effective_from date, p_structure uuid, p_annual_ctc numeric, p_lines jsonb,
                                     p_note text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org   uuid;
  v_basis public.pay_basis := 'monthly';
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'compensation.update') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.compensation_records where employee_id = p_employee) then
    raise exception 'This employee already has a salary. Propose a salary revision instead.' using errcode = '22023';
  end if;
  if p_structure is not null then
    select pay_basis into v_basis from public.salary_structures where id = p_structure and organization_id = v_org;
    if not found then raise exception 'Unknown salary structure.' using errcode = '22023'; end if;
  end if;
  return app.apply_compensation(p_employee, p_effective_from, p_structure, v_basis, p_annual_ctc, p_lines, p_note);
end $$;

create function public.request_salary_revision(p_employee uuid, p_effective_from date, p_structure uuid, p_annual_ctc numeric,
                                               p_lines jsonb, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org     uuid;
  v_basis   public.pay_basis := 'monthly';
  v_current public.compensation_records;
  v_id      uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'compensation.update') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_current from public.compensation_records where employee_id = p_employee order by effective_from desc limit 1;
  if v_current.id is null then
    raise exception 'This employee has no salary yet. Assign one first.' using errcode = '22023';
  end if;
  if p_effective_from <= v_current.effective_from then
    raise exception 'The revision must start after the current salary (from %).', to_char(v_current.effective_from, 'DD Mon YYYY') using errcode = '22023';
  end if;
  if p_structure is not null then
    select pay_basis into v_basis from public.salary_structures where id = p_structure and organization_id = v_org;
    if not found then raise exception 'Unknown salary structure.' using errcode = '22023'; end if;
  end if;
  begin
    insert into public.salary_revisions (organization_id, employee_id, effective_from, structure_id, pay_basis, previous_annual_ctc,
                                         annual_ctc, lines, reason)
    values (v_org, p_employee, p_effective_from, p_structure, v_basis, v_current.annual_ctc, p_annual_ctc, p_lines, p_reason)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A revision for this employee is already waiting for sign-off.' using errcode = '22023';
  end;
  perform app.notify_permission_holders(v_org, 'payroll.approve', 'payroll.revision', 'A salary revision is waiting for your sign-off',
                                        '/payroll?tab=people&view=revisions', auth.uid());
  return v_id;
end $$;

-- Sign-off: someone with payroll.approve other than the requester. Approval saves the salary and, when it
-- starts in a month already paid (locked run), records the arrears for the next run.
create function public.decide_salary_revision(p_revision uuid, p_approve boolean, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rev     public.salary_revisions;
  v_record  uuid;
  v_new     numeric;
  v_arrears numeric := 0;
  r         record;
  v_user    uuid;
begin
  select * into v_rev from public.salary_revisions where id = p_revision for update;
  if v_rev.id is null or not app.has_permission(v_rev.organization_id, 'payroll.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_rev.status <> 'pending' then
    raise exception 'This revision has already been decided.' using errcode = '22023';
  end if;
  if v_rev.requested_by = auth.uid() then
    raise exception 'You proposed this revision, so someone else must sign it off.' using errcode = '42501';
  end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for rejecting it.' using errcode = '22023'; end if;
    update public.salary_revisions set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_revision;
    perform app.notify(v_rev.organization_id, v_rev.requested_by, 'payroll.revision', 'A salary revision you proposed was rejected', p_note, '/payroll?tab=people&view=revisions');
    return;
  end if;

  v_record := app.apply_compensation(v_rev.employee_id, v_rev.effective_from, v_rev.structure_id, v_rev.pay_basis, v_rev.annual_ctc,
                                     v_rev.lines, 'Salary revision: ' || v_rev.reason);
  select coalesce(sum(monthly_amount), 0) into v_new from public.compensation_lines cl
    join public.salary_components c on c.id = cl.component_id
   where cl.record_id = v_record and c.kind = 'earning';

  -- Arrears: for each locked month from the effective date, the difference in contracted gross, prorated as paid.
  if v_rev.pay_basis = 'monthly' then
    for r in
      select re.payable_days, (re.input ->> 'daysInPeriod')::numeric as days,
             coalesce((select sum((c ->> 'monthly')::numeric) from jsonb_array_elements(re.input -> 'components') c where c ->> 'kind' = 'earning'), 0) as old_gross
        from public.payroll_run_employees re join public.payroll_runs pr on pr.id = re.run_id
       where re.employee_id = v_rev.employee_id and pr.status = 'locked' and pr.period_month >= date_trunc('month', v_rev.effective_from)::date
    loop
      if r.days > 0 then v_arrears := v_arrears + round((v_new - r.old_gross) * r.payable_days / r.days); end if;
    end loop;
  end if;
  if v_arrears > 0 then
    insert into public.payroll_adjustments (organization_id, employee_id, code, name, kind, amount, taxable, reason)
    values (v_rev.organization_id, v_rev.employee_id, 'ARREAR', 'Salary arrears', 'earning', v_arrears, true,
            'Revision from ' || to_char(v_rev.effective_from, 'DD Mon YYYY') || ' for months already paid');
  end if;
  update public.salary_revisions set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
         compensation_record_id = v_record, arrears = greatest(v_arrears, 0)
   where id = p_revision;
  perform app.notify(v_rev.organization_id, v_rev.requested_by, 'payroll.revision', 'A salary revision you proposed was approved', null, '/payroll?tab=people&view=revisions');
  select user_id into v_user from public.employees where id = v_rev.employee_id;
  if v_user is not null then
    perform app.notify(v_rev.organization_id, v_user, 'payroll.revision', 'Your salary has been revised from ' || to_char(v_rev.effective_from, 'DD Mon YYYY'),
                       null, '/payslips');
  end if;
end $$;

create function public.cancel_salary_revision(p_revision uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.salary_revisions set status = 'cancelled', decided_at = now()
   where id = p_revision and status = 'pending' and requested_by = auth.uid()
     and app.has_permission(organization_id, 'compensation.update');
  if not found then raise exception 'Only the person who proposed a pending revision can withdraw it.' using errcode = '22023'; end if;
end $$;

-- ─── Per-month run inputs ───────────────────────────────────────────────────

create table public.payroll_employee_inputs (
  organization_id  uuid not null,
  period_month     date not null check (extract(day from period_month) = 1),
  employee_id      uuid not null,
  lop_days         numeric(5,2) check (lop_days >= 0 and lop_days <= 31),   -- replaces the computed loss of pay
  tds_override     numeric(12,2) check (tds_override >= 0),
  units            numeric(7,2) check (units >= 0),                          -- days or hours for wage-based pay
  on_hold          boolean not null default false,
  hold_reason      text check (char_length(hold_reason) <= 300),
  note             text check (char_length(note) <= 300),
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  primary key (employee_id, period_month),
  check (not on_hold or hold_reason is not null),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index payroll_employee_inputs_month_idx on public.payroll_employee_inputs (organization_id, period_month);
create trigger payroll_employee_inputs_touch before update on public.payroll_employee_inputs for each row execute function app.touch_updated_at();
create trigger payroll_employee_inputs_audit after insert or update or delete on public.payroll_employee_inputs
  for each row execute function app.audit_row('tds_override');

-- Inputs for a month are frozen once its run is approved or locked.
create function app.guard_month_inputs() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if exists (select 1 from public.payroll_runs r where r.organization_id = coalesce(new.organization_id, old.organization_id)
              and r.period_month = coalesce(new.period_month, old.period_month) and r.status in ('approved', 'locked')) then
    raise exception 'This month’s payroll is already approved; its inputs can’t change.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_employee_inputs_guard before insert or update or delete on public.payroll_employee_inputs
  for each row execute function app.guard_month_inputs();

-- ─── Tax declarations ───────────────────────────────────────────────────────

create type public.declaration_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.declaration_section as enum
  ('hra', '80C', '80CCD1B', '80D_self', '80D_parents', '80E', '80G', '80TTA', '24B', 'lta', 'prev_employer', 'reimbursement', 'other');

create table public.tax_declarations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  fy               text not null check (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  regime           text not null default 'new' check (regime in ('old', 'new')),
  status           public.declaration_status not null default 'draft',
  metro            boolean not null default false,
  senior_self      boolean not null default false,
  senior_parents   boolean not null default false,
  submitted_at     timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  review_note      text check (char_length(review_note) <= 500),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (employee_id, fy),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

create table public.tax_declaration_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  declaration_id   uuid not null,
  section          public.declaration_section not null,
  label            text not null check (char_length(label) between 2 and 120),
  declared         numeric(12,2) not null check (declared >= 0 and declared < 100000000),
  approved         numeric(12,2) check (approved >= 0),
  tds              numeric(12,2) check (tds >= 0),   -- previous employer: TDS already deducted
  details          jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note             text check (char_length(note) <= 300),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, declaration_id) references public.tax_declarations (organization_id, id) on delete cascade
);
create index tax_declaration_items_decl_idx on public.tax_declaration_items (declaration_id);
create trigger tax_declarations_touch before update on public.tax_declarations for each row execute function app.touch_updated_at();
create trigger tax_declarations_audit after insert or update on public.tax_declarations for each row execute function app.audit_row();
create trigger tax_declaration_items_audit after insert or update or delete on public.tax_declaration_items
  for each row execute function app.audit_row('declared', 'approved', 'tds', 'details');

-- The employee saves (and optionally submits) their declaration while the window is open. Approved items stay.
create function public.save_tax_declaration(p_org uuid, p_fy text, p_regime text, p_metro boolean, p_senior_self boolean,
                                            p_senior_parents boolean, p_items jsonb, p_submit boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp  uuid;
  v_set  public.payroll_settings;
  v_decl public.tax_declarations;
  v_item jsonb;
begin
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid() and app.is_member(p_org);
  if v_emp is null then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_set from public.payroll_settings where organization_id = p_org;
  if not coalesce(v_set.declaration_open, false) or (v_set.declaration_until is not null and app.org_today(p_org) > v_set.declaration_until) then
    raise exception 'The declaration window is closed. Ask payroll to reopen it.' using errcode = '22023';
  end if;
  if p_regime not in ('old', 'new') or p_fy !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Choose a tax regime.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Invalid items.' using errcode = '22023'; end if;
  insert into public.tax_declarations (organization_id, employee_id, fy, regime, metro, senior_self, senior_parents)
  values (p_org, v_emp, p_fy, p_regime, p_metro, p_senior_self, p_senior_parents)
  on conflict (employee_id, fy) do update set regime = excluded.regime, metro = excluded.metro, senior_self = excluded.senior_self,
    senior_parents = excluded.senior_parents
  returning * into v_decl;
  delete from public.tax_declaration_items where declaration_id = v_decl.id and status <> 'approved';
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce((v_item ->> 'declared')::numeric, 0) > 0 or coalesce((v_item ->> 'tds')::numeric, 0) > 0 then
      insert into public.tax_declaration_items (organization_id, declaration_id, section, label, declared, tds, details)
      values (p_org, v_decl.id, (v_item ->> 'section')::public.declaration_section, coalesce(nullif(trim(v_item ->> 'label'), ''), v_item ->> 'section'),
              coalesce((v_item ->> 'declared')::numeric, 0), nullif((v_item ->> 'tds')::numeric, 0), coalesce(v_item -> 'details', '{}'));
    end if;
  end loop;
  if p_submit then
    update public.tax_declarations set status = 'submitted', submitted_at = now(), decided_by = null, decided_at = null where id = v_decl.id;
    perform app.notify_permission_holders(p_org, 'payroll.prepare', 'payroll.declaration', 'A tax declaration was submitted for review',
                                          '/payroll?tab=declarations', auth.uid());
  elsif v_decl.status = 'approved' then
    update public.tax_declarations set status = 'draft' where id = v_decl.id;
  end if;
  return v_decl.id;
end $$;

-- Payroll reviews: approves amounts item by item (approved ≤ declared), or rejects with a note.
create function public.review_tax_declaration(p_declaration uuid, p_approve boolean, p_items jsonb, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_decl public.tax_declarations;
  v_item jsonb;
  v_user uuid;
begin
  select * into v_decl from public.tax_declarations where id = p_declaration for update;
  if v_decl.id is null or not app.has_permission(v_decl.organization_id, 'payroll.prepare') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_decl.status not in ('submitted', 'approved', 'rejected') then
    raise exception 'Only a submitted declaration can be reviewed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.employees where id = v_decl.employee_id and user_id = auth.uid()) then
    raise exception 'You can’t review your own declaration.' using errcode = '42501';
  end if;
  if p_approve then
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
      update public.tax_declaration_items
         set approved = least(declared, greatest(0, (v_item ->> 'approved')::numeric)),
             status = case when (v_item ->> 'approved')::numeric > 0 then 'approved' else 'rejected' end,
             note = nullif(trim(v_item ->> 'note'), '')
       where id = (v_item ->> 'id')::uuid and declaration_id = p_declaration;
    end loop;
    update public.tax_declaration_items set approved = declared, status = 'approved'
     where declaration_id = p_declaration and status = 'pending';
    update public.tax_declarations set status = 'approved', decided_by = auth.uid(), decided_at = now(), review_note = p_note where id = p_declaration;
  else
    if coalesce(trim(p_note), '') = '' then raise exception 'Say what needs to change.' using errcode = '22023'; end if;
    update public.tax_declarations set status = 'rejected', decided_by = auth.uid(), decided_at = now(), review_note = p_note where id = p_declaration;
  end if;
  select user_id into v_user from public.employees where id = v_decl.employee_id;
  if v_user is not null then
    perform app.notify(v_decl.organization_id, v_user, 'payroll.declaration',
                       case when p_approve then 'Your tax declaration was approved' else 'Your tax declaration needs changes' end, p_note, '/payslips?tab=tax');
  end if;
end $$;

-- ─── Payouts ────────────────────────────────────────────────────────────────

create type public.payout_status as enum ('pending', 'paid', 'failed', 'on_hold');

create table public.payroll_payouts (
  organization_id  uuid not null,
  run_id           uuid not null,
  employee_id      uuid not null,
  amount           numeric(12,2) not null,
  status           public.payout_status not null default 'pending',
  reference        text check (char_length(reference) <= 60),
  paid_on          date,
  note             text check (char_length(note) <= 300),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  primary key (run_id, employee_id),
  foreign key (organization_id, run_id) references public.payroll_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id)
);
create trigger payroll_payouts_touch before update on public.payroll_payouts for each row execute function app.touch_updated_at();
create trigger payroll_payouts_audit after insert or update on public.payroll_payouts for each row execute function app.audit_row();

create function public.update_payouts(p_run uuid, p_employees uuid[], p_status public.payout_status, p_reference text default null,
                                      p_paid_on date default null, p_note text default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.payroll_runs;
  v_n   integer;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.has_permission(v_run.organization_id, 'payroll.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status = 'paid' and p_paid_on is null then raise exception 'Enter the payment date.' using errcode = '22023'; end if;
  if p_status = 'on_hold' and coalesce(trim(p_note), '') = '' then raise exception 'Say why the salary is on hold.' using errcode = '22023'; end if;
  update public.payroll_payouts set status = p_status, reference = nullif(trim(p_reference), ''), paid_on = case when p_status = 'paid' then p_paid_on end,
         note = nullif(trim(p_note), ''), updated_by = auth.uid()
   where run_id = p_run and employee_id = any (p_employees) and status <> 'paid';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─── Inputs, results and locking ────────────────────────────────────────────

-- The engine's inputs, extended: org statutory switches, wage-based pay, LOP and TDS overrides, the tax
-- declaration, and approved leave encashments (paid at basic ÷ 30 a day).
create or replace function public.payroll_run_inputs(p_run uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base jsonb;
  v_run  public.payroll_runs;
  v_set  public.payroll_settings;
  v_end  date;
  v_fy   text;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.is_payroll_staff(v_run.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_set from public.payroll_settings where organization_id = v_run.organization_id;
  v_end := (v_run.period_month + interval '1 month - 1 day')::date;
  v_fy := case when extract(month from v_run.period_month) >= 4 then to_char(v_run.period_month, 'YYYY') || '-' || to_char(v_run.period_month + interval '1 year', 'YY')
               else to_char(v_run.period_month - interval '1 year', 'YYYY') || '-' || to_char(v_run.period_month, 'YY') end;
  v_base := app.payroll_run_inputs_base(p_run);
  return jsonb_set(v_base, '{employees}', coalesce((
    select jsonb_agg(
             (e - 'payableDays' - 'statutory') || jsonb_build_object(
               'reimbursements', coalesce((select sum(c.total) from public.expense_claims c
                                            where c.employee_id = emp_id and c.status = 'approved'), 0),
               'reimbursementClaims', coalesce((select jsonb_agg(c.id order by c.id) from public.expense_claims c
                                                 where c.employee_id = emp_id and c.status = 'approved'), '[]'::jsonb),
               'adjustments', coalesce((select jsonb_agg(x.adj order by x.ord, x.id) from (
                   select jsonb_build_object('code', a.code, 'name', a.name, 'kind', a.kind, 'amount', a.amount, 'taxable', a.taxable) as adj,
                          1 as ord, a.created_at::text || a.id::text as id
                     from public.payroll_adjustments a where a.employee_id = emp_id and a.applied_run_id is null
                   union all
                   select jsonb_build_object('code', 'LEAVE_ENC', 'name', 'Leave encashment', 'kind', 'earning',
                                             'amount', round(le.days * basic.monthly / 30), 'taxable', true),
                          2, le.created_at::text || le.id::text
                     from public.leave_encashments le
                    where le.employee_id = emp_id and le.status = 'approved' and le.payroll_run_id is null and basic.monthly > 0
                 ) x), '[]'::jsonb),
               'adjustmentIds', coalesce((select jsonb_agg(a.id order by a.created_at, a.id) from public.payroll_adjustments a
                                           where a.employee_id = emp_id and a.applied_run_id is null), '[]'::jsonb),
               'encashmentIds', coalesce((select jsonb_agg(le.id order by le.created_at, le.id) from public.leave_encashments le
                                           where le.employee_id = emp_id and le.status = 'approved' and le.payroll_run_id is null and basic.monthly > 0), '[]'::jsonb),
               'penaltyDays', p.days,
               'payableDays', case when i.lop_days is not null then greatest(0, (e ->> 'daysInPeriod')::numeric - i.lop_days)
                                   else greatest(0, (e ->> 'payableDays')::numeric - p.days) end,
               'lopOverride', i.lop_days,
               'statutory', jsonb_build_object(
                  'pf', coalesce(v_set.pf_enabled, true) and coalesce((e -> 'statutory' ->> 'pf')::boolean, true),
                  'esi', case when coalesce(v_set.esi_enabled, true) then e -> 'statutory' -> 'esi' else 'false'::jsonb end,
                  'ptState', case when coalesce(v_set.pt_enabled, true) then e -> 'statutory' -> 'ptState' else 'null'::jsonb end),
               'payBasis', coalesce(comp.pay_basis::text, 'monthly'),
               'units', case comp.pay_basis
                          when 'hourly' then coalesce(i.units, round(att.minutes / 60.0, 2))
                          when 'daily' then coalesce(i.units, att.days_worked)
                          else null end,
               'tdsOverride', i.tds_override,
               'onHold', coalesce(i.on_hold, false),
               'declaration', (
                 select jsonb_strip_nulls(jsonb_build_object(
                   'regime', d.regime, 'metro', d.metro, 'seniorSelf', d.senior_self, 'seniorParents', d.senior_parents,
                   'rentPaidAnnual', sum(amt) filter (where it.section = 'hra'),
                   'sec80C', sum(amt) filter (where it.section = '80C'),
                   'sec80CCD1B', sum(amt) filter (where it.section = '80CCD1B'),
                   'sec80DSelf', sum(amt) filter (where it.section = '80D_self'),
                   'sec80DParents', sum(amt) filter (where it.section = '80D_parents'),
                   'sec80E', sum(amt) filter (where it.section = '80E'),
                   'sec80G', sum(amt) filter (where it.section = '80G'),
                   'sec80TTA', sum(amt) filter (where it.section = '80TTA'),
                   'homeLoanInterest', sum(amt) filter (where it.section = '24B'),
                   'lta', sum(amt) filter (where it.section = 'lta'),
                   'otherDeductions', sum(amt) filter (where it.section = 'other'),
                   'prevEmployerTaxable', sum(amt) filter (where it.section = 'prev_employer'),
                   'prevEmployerTds', sum(it.tds) filter (where it.section = 'prev_employer')))
                   from public.tax_declarations d
                   left join lateral (select ti.section, ti.tds, coalesce(ti.approved, ti.declared) as amt from public.tax_declaration_items ti
                                       where ti.declaration_id = d.id and ti.status <> 'rejected') it on true
                  where d.employee_id = emp_id and d.fy = v_fy and d.status in ('submitted', 'approved')
                  group by d.id, d.regime, d.metro, d.senior_self, d.senior_parents)
             ) || case when coalesce(v_set.default_regime, 'new') = 'old'
                         and not exists (select 1 from public.tax_declarations d where d.employee_id = emp_id and d.fy = v_fy and d.status in ('submitted', 'approved'))
                       then jsonb_build_object('declaration', jsonb_build_object('regime', 'old')) else '{}'::jsonb end
             order by e ->> 'employeeCode')
      from jsonb_array_elements(v_base -> 'employees') e
      cross join lateral (select (e ->> 'employeeId')::uuid as emp_id) ids
      cross join lateral (
        select coalesce(sum(ap.days), 0) as days from public.attendance_penalties ap
         where ap.employee_id = emp_id and ap.cycle_month = v_run.period_month and ap.reverted_at is null) p
      left join public.payroll_employee_inputs i on i.employee_id = emp_id and i.period_month = v_run.period_month
      left join lateral (
        select r.pay_basis from public.compensation_records r
         where r.employee_id = emp_id and r.effective_from <= v_end and (r.effective_to is null or r.effective_to >= v_end)) comp on true
      cross join lateral (
        select coalesce(sum((c ->> 'monthly')::numeric), 0) as monthly from jsonb_array_elements(e -> 'components') c where c ->> 'code' = 'BASIC') basic
      cross join lateral (
        select coalesce(sum(a.worked_minutes), 0) as minutes,
               coalesce(sum(case when a.status::text in ('present', 'wfh', 'on_duty') then 1 when a.status::text = 'half_day' then 0.5 else 0 end), 0) as days_worked
          from public.attendance_days a where a.employee_id = emp_id and a.work_date between v_run.period_month and v_end) att), '[]'::jsonb));
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
  update public.leave_encashments le set payroll_run_id = p_run
    from public.payroll_run_employees re, jsonb_array_elements_text(coalesce(re.input -> 'encashmentIds', '[]')) enc_id
   where re.run_id = p_run and le.id = enc_id::uuid and le.payroll_run_id is null;
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

-- ─── Bank advice and statutory reports (locked runs; audited) ─────────────────

create function public.payroll_bank_advice(p_run uuid)
returns table (employee_code text, employee_name text, account_holder text, bank_name text, account_number text, ifsc text, amount numeric)
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
    raise exception 'Lock the run before exporting the bank advice.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_run.organization_id, auth.uid(), 'payroll_export', 'payroll_runs', p_run, jsonb_build_object('report', 'bank_advice'));
  return query
    select e.employee_code, trim(concat_ws(' ', e.first_name, e.last_name)), b.account_holder_name, b.bank_name, b.account_number, b.ifsc, po.amount
      from public.payroll_payouts po
      join public.employees e on e.id = po.employee_id
      left join restricted.employee_bank_accounts b on b.employee_id = po.employee_id and b.archived_at is null
     where po.run_id = p_run and po.status in ('pending', 'failed')
     order by e.employee_code;
end $$;

-- One row per employee with the figures each statutory file needs; identity numbers in full (payroll staff
-- with identity access only), and every download is recorded.
create function public.payroll_statutory_rows(p_run uuid, p_report text)
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
           round(coalesce(sum(li.amount) filter (where li.code = 'PF'), 0) / 0.12),
           coalesce(sum(li.amount) filter (where li.code = 'PF'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'EPS_ER'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'EPF_ER'), 0),
           case when bool_or(li.code = 'ESI') then re.gross - coalesce(sum(li.amount) filter (where li.kind = 'earning' and li.code in ('REIMB', 'ARREAR', 'BONUS', 'LEAVE_ENC')), 0) else 0 end,
           coalesce(sum(li.amount) filter (where li.code = 'ESI'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'ESI_ER'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'PT'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'TDS'), 0)
      from public.payroll_run_employees re
      join public.employees e on e.id = re.employee_id
      left join restricted.employee_identity i on i.employee_id = re.employee_id
      left join public.payroll_line_items li on li.run_id = re.run_id and li.employee_id = re.employee_id
     where re.run_id = p_run
     group by re.employee_id, e.employee_code, e.first_name, e.last_name, i.pan, i.uan, i.esic_number, re.input, re.payable_days, re.lop_days, re.gross, re.taxable
     order by e.employee_code;
end $$;

-- Readiness for the pay register and the hub's "needs attention": which statutory numbers and bank details are
-- on file (masked), never the numbers themselves.
create function public.payroll_readiness(p_org uuid)
returns table (employee_id uuid, pan text, uan text, esic_number text, bank_name text, ifsc text, account_last4 text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_payroll_staff(p_org) then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select e.id, app.mask(i.pan), app.mask(i.uan), app.mask(i.esic_number), b.bank_name, b.ifsc, right(b.account_number, 4)
      from public.employees e
      left join restricted.employee_identity i on i.employee_id = e.id
      left join restricted.employee_bank_accounts b on b.employee_id = e.id and b.archived_at is null
     where e.organization_id = p_org and e.status <> 'pre_joining';
end $$;

-- The compliance screen's audit log: who downloaded which payroll file.
create function public.payroll_export_log(p_org uuid, p_days integer default 30)
returns table (at timestamptz, action text, report text, actor text, run_id uuid, employees integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_payroll_staff(p_org) then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select a.occurred_at, a.action, coalesce(a.metadata ->> 'report', a.action),
           coalesce((select trim(concat_ws(' ', e.first_name, e.last_name)) from public.employees e where e.organization_id = p_org and e.user_id = a.actor_user_id limit 1), 'Someone'),
           a.entity_id, (a.metadata ->> 'employees')::integer
      from public.audit_events a
     where a.organization_id = p_org and a.action in ('payroll_export', 'bank_file_export') and a.occurred_at > now() - make_interval(days => p_days)
     order by a.occurred_at desc limit 200;
end $$;

-- ─── RLS and grants ─────────────────────────────────────────────────────────

alter table public.payroll_settings enable row level security;
alter table public.payroll_bank_settings enable row level security;
alter table public.salary_structures enable row level security;
alter table public.salary_structure_lines enable row level security;
alter table public.salary_revisions enable row level security;
alter table public.payroll_employee_inputs enable row level security;
alter table public.tax_declarations enable row level security;
alter table public.tax_declaration_items enable row level security;
alter table public.payroll_payouts enable row level security;

create policy payroll_settings_select on public.payroll_settings for select to authenticated using (app.is_member(organization_id));
create policy payroll_settings_update on public.payroll_settings for update to authenticated
  using (app.has_permission(organization_id, 'payroll.prepare')) with check (app.has_permission(organization_id, 'payroll.prepare'));
create policy payroll_bank_settings_select on public.payroll_bank_settings for select to authenticated using (app.is_payroll_staff(organization_id));
create policy payroll_bank_settings_update on public.payroll_bank_settings for update to authenticated
  using (app.has_permission(organization_id, 'payroll.approve')) with check (app.has_permission(organization_id, 'payroll.approve'));
create policy salary_structures_select on public.salary_structures for select to authenticated using (app.is_member(organization_id));
create policy salary_structures_write on public.salary_structures for all to authenticated
  using (app.has_permission(organization_id, 'compensation.update')) with check (app.has_permission(organization_id, 'compensation.update'));
create policy salary_structure_lines_select on public.salary_structure_lines for select to authenticated using (app.is_member(organization_id));
create policy salary_structure_lines_write on public.salary_structure_lines for all to authenticated
  using (app.has_permission(organization_id, 'compensation.update')) with check (app.has_permission(organization_id, 'compensation.update'));
create policy salary_revisions_select on public.salary_revisions for select to authenticated
  using (app.is_payroll_staff(organization_id) or app.has_permission(organization_id, 'compensation.update'));
create policy payroll_employee_inputs_select on public.payroll_employee_inputs for select to authenticated using (app.is_payroll_staff(organization_id));
create policy payroll_employee_inputs_write on public.payroll_employee_inputs for all to authenticated
  using (app.has_permission(organization_id, 'payroll.prepare')) with check (app.has_permission(organization_id, 'payroll.prepare'));
create policy tax_declarations_select on public.tax_declarations for select to authenticated
  using (app.is_own_employee(employee_id) or app.is_payroll_staff(organization_id));
create policy tax_declaration_items_select on public.tax_declaration_items for select to authenticated
  using (exists (select 1 from public.tax_declarations d where d.id = declaration_id
                  and (app.is_own_employee(d.employee_id) or app.is_payroll_staff(d.organization_id))));
create policy payroll_payouts_select on public.payroll_payouts for select to authenticated using (app.can_read_payslip(run_id, employee_id));

grant select on public.payroll_settings, public.payroll_bank_settings, public.salary_structures, public.salary_structure_lines,
                public.salary_revisions, public.payroll_employee_inputs, public.tax_declarations, public.tax_declaration_items,
                public.payroll_payouts to authenticated;
grant update (pay_day, lop_from_absence, pf_enabled, esi_enabled, pt_enabled, default_regime, declaration_open, declaration_mode,
              declaration_until, proof_from, proof_until, payslip_template, payslip_show_ytd, updated_by) on public.payroll_settings to authenticated;
grant update (bank_name, account_number, ifsc, file_format, updated_by) on public.payroll_bank_settings to authenticated;
grant insert, update, delete on public.salary_structures, public.salary_structure_lines, public.payroll_employee_inputs to authenticated;
grant all on public.payroll_settings, public.payroll_bank_settings, public.salary_structures, public.salary_structure_lines,
             public.salary_revisions, public.payroll_employee_inputs, public.tax_declarations, public.tax_declaration_items,
             public.payroll_payouts to service_role;

revoke all on function app.apply_compensation(uuid, date, uuid, public.pay_basis, numeric, jsonb, text) from public;
revoke all on function app.guard_month_inputs() from public;
revoke all on function public.assign_salary(uuid, date, uuid, numeric, jsonb, text) from public, anon;
revoke all on function public.request_salary_revision(uuid, date, uuid, numeric, jsonb, text) from public, anon;
revoke all on function public.decide_salary_revision(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_salary_revision(uuid) from public, anon;
revoke all on function public.save_tax_declaration(uuid, text, text, boolean, boolean, boolean, jsonb, boolean) from public, anon;
revoke all on function public.review_tax_declaration(uuid, boolean, jsonb, text) from public, anon;
revoke all on function public.update_payouts(uuid, uuid[], public.payout_status, text, date, text) from public, anon;
revoke all on function public.payroll_bank_advice(uuid) from public, anon;
revoke all on function public.payroll_statutory_rows(uuid, text) from public, anon;
revoke all on function public.payroll_readiness(uuid) from public, anon;
revoke all on function public.payroll_export_log(uuid, integer) from public, anon;
grant execute on function public.assign_salary(uuid, date, uuid, numeric, jsonb, text) to authenticated, service_role;
grant execute on function public.request_salary_revision(uuid, date, uuid, numeric, jsonb, text) to authenticated, service_role;
grant execute on function public.decide_salary_revision(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.cancel_salary_revision(uuid) to authenticated, service_role;
grant execute on function public.save_tax_declaration(uuid, text, text, boolean, boolean, boolean, jsonb, boolean) to authenticated, service_role;
grant execute on function public.review_tax_declaration(uuid, boolean, jsonb, text) to authenticated, service_role;
grant execute on function public.update_payouts(uuid, uuid[], public.payout_status, text, date, text) to authenticated, service_role;
grant execute on function public.payroll_bank_advice(uuid) to authenticated, service_role;
grant execute on function public.payroll_statutory_rows(uuid, text) to authenticated, service_role;
grant execute on function public.payroll_readiness(uuid) to authenticated, service_role;
grant execute on function public.payroll_export_log(uuid, integer) to authenticated, service_role;
