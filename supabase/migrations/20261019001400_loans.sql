-- PeopleCore · Loans and salary advances (Kredily's Loans: payroll-native).
--
-- * Settings per organization: on/off, interest rate, the most anyone can borrow (a cap and a multiple of monthly
--   gross), the longest tenure, the largest share of monthly gross that EMIs may take, minimum service, and whether
--   someone may hold more than one loan.
-- * Eligibility is computed for the signed-in employee from their current salary, service and open loans; the
--   simulator uses the same EMI formula as the schedule (reducing balance; a salary advance is interest-free and
--   repaid in at most 3 months).
-- * Applying starts an approval: reporting manager, then payroll. Payroll disburses an approved loan (bank, cash or
--   with the next payroll run as an earning), which fixes the repayment schedule from the first EMI month.
-- * EMIs are recovered through payroll: when a run is created for a month, every scheduled EMI due by then becomes
--   a LOAN_EMI deduction (a payroll adjustment). Locking the run marks the EMI paid; when the last one is paid the
--   loan closes. Deleting the queued adjustment puts the EMI back on the schedule. Foreclosure settles the rest.

-- ─── Settings ───────────────────────────────────────────────────────────────

create table public.loan_settings (
  organization_id     uuid primary key references public.organizations (id) on delete cascade,
  enabled             boolean not null default true,
  interest_rate       numeric(5,2) not null default 0 check (interest_rate between 0 and 36),
  max_amount          numeric(12,2) not null default 500000 check (max_amount > 0),
  salary_multiple     numeric(4,1) not null default 3 check (salary_multiple > 0 and salary_multiple <= 24),
  max_tenure_months   smallint not null default 24 check (max_tenure_months between 1 and 120),
  max_emi_percent     smallint not null default 40 check (max_emi_percent between 5 and 100),
  min_service_months  smallint not null default 6 check (min_service_months between 0 and 120),
  allow_multiple      boolean not null default false,
  updated_at          timestamptz not null default now()
);
create trigger loan_settings_touch before update on public.loan_settings for each row execute function app.touch_updated_at();
create trigger loan_settings_audit after insert or update on public.loan_settings for each row execute function app.audit_row();
insert into public.loan_settings (organization_id) select id from public.organizations on conflict do nothing;

create function app.loan_settings_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.loan_settings (organization_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function app.loan_settings_default() from public;
create trigger organizations_zz_loan_settings after insert on public.organizations for each row execute function app.loan_settings_default();

alter table public.loan_settings enable row level security;
create policy loan_settings_select on public.loan_settings for select to authenticated using (app.is_member(organization_id));
create policy loan_settings_write on public.loan_settings for update to authenticated
  using (app.has_permission(organization_id, 'payroll.approve')) with check (app.has_permission(organization_id, 'payroll.approve'));
grant select, update on public.loan_settings to authenticated;
grant all on public.loan_settings to service_role;

-- ─── Loans and their schedules ──────────────────────────────────────────────

create table public.loans (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  employee_id          uuid not null,
  kind                 text not null check (kind in ('loan', 'advance')),
  amount               numeric(12,2) not null check (amount > 0),
  interest_rate        numeric(5,2) not null check (interest_rate between 0 and 36),
  tenure_months        smallint not null check (tenure_months between 1 and 120),
  emi                  numeric(12,2) not null check (emi > 0),
  purpose              text not null check (char_length(purpose) between 3 and 500),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'active', 'closed')),
  approval_request_id  uuid references public.approval_requests (id) on delete set null,
  decided_at           timestamptz,
  disbursed_on         date,
  disbursal_mode       text check (disbursal_mode in ('bank', 'cash', 'payroll')),
  disbursal_reference  text check (char_length(disbursal_reference) <= 80),
  disbursed_by         uuid,
  first_emi_month      date check (extract(day from first_emi_month) = 1),
  closed_at            timestamptz,
  closure_note         text check (char_length(closure_note) <= 200),
  created_at           timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  check (kind = 'loan' or (tenure_months <= 3 and interest_rate = 0))
);
create index loans_org_idx on public.loans (organization_id, status, created_at desc);
create index loans_employee_idx on public.loans (organization_id, employee_id);
create trigger loans_audit after insert or update or delete on public.loans for each row execute function app.audit_row('amount', 'emi');

create table public.loan_installments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  seq              smallint not null check (seq >= 1),
  due_month        date not null check (extract(day from due_month) = 1),
  opening_balance  numeric(12,2) not null,
  principal        numeric(12,2) not null check (principal >= 0),
  interest         numeric(12,2) not null check (interest >= 0),
  emi              numeric(12,2) not null check (emi > 0),
  status           text not null default 'scheduled' check (status in ('scheduled', 'queued', 'paid', 'foreclosed')),
  adjustment_id    uuid,
  paid_run_id      uuid,
  paid_at          timestamptz,
  unique (organization_id, id),
  unique (loan_id, seq),
  foreign key (organization_id, loan_id) references public.loans (organization_id, id) on delete cascade
);
create index loan_installments_due_idx on public.loan_installments (organization_id, due_month) where status = 'scheduled';
create index loan_installments_adjustment_idx on public.loan_installments (adjustment_id) where adjustment_id is not null;

alter table public.loans enable row level security;
alter table public.loan_installments enable row level security;
-- Payroll, the borrower, and anyone who may see the application's approval (its approvers, past and current).
create policy loans_select on public.loans for select to authenticated
  using (app.is_payroll_staff(organization_id) or app.is_own_employee(employee_id)
         or (approval_request_id is not null and app.can_view_approval(approval_request_id)));
create policy loan_installments_select on public.loan_installments for select to authenticated
  using (app.is_payroll_staff(organization_id)
         or exists (select 1 from public.loans l where l.id = loan_installments.loan_id and app.is_own_employee(l.employee_id)));
grant select on public.loans, public.loan_installments to authenticated;
grant all on public.loans, public.loan_installments to service_role;

-- Reducing-balance EMI, to the paisa (an interest-free loan is simply split evenly).
create function app.loan_emi(p_amount numeric, p_rate numeric, p_months int) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_rate = 0 then round(p_amount / p_months, 2)
              else round(p_amount * (p_rate / 1200) * power(1 + p_rate / 1200, p_months) / (power(1 + p_rate / 1200, p_months) - 1), 2) end;
$$;

-- What the signed-in employee may borrow now, and why not if they can't.
create function public.loan_eligibility(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp     public.employees;
  v_set     public.loan_settings;
  v_today   date;
  v_gross   numeric;
  v_service int;
  v_emi     numeric;
  v_open    int;
  v_max     numeric;
  v_reasons text[] := '{}';
begin
  select * into v_emp from public.employees where organization_id = p_org and user_id = auth.uid() and app.is_member(p_org);
  if v_emp.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_set from public.loan_settings where organization_id = p_org;
  v_today := app.org_today(p_org);
  select coalesce(sum(l.monthly_amount), 0) into v_gross
    from public.compensation_records r join public.compensation_lines l on l.record_id = r.id
   where r.employee_id = v_emp.id and r.effective_from <= v_today and (r.effective_to is null or r.effective_to >= v_today);
  v_service := coalesce((extract(year from age(v_today, v_emp.date_of_joining)) * 12 + extract(month from age(v_today, v_emp.date_of_joining)))::int, 0);
  select coalesce(sum(emi) filter (where status = 'active'), 0), count(*) filter (where status in ('pending', 'approved', 'active'))
    into v_emi, v_open from public.loans where employee_id = v_emp.id;
  v_max := least(v_set.max_amount, round(v_gross * v_set.salary_multiple, -2));

  if not v_set.enabled then v_reasons := array_append(v_reasons, 'Loans are not offered right now.'); end if;
  if v_emp.status not in ('active') then v_reasons := array_append(v_reasons, 'Only active employees can apply.'); end if;
  if v_gross <= 0 then v_reasons := array_append(v_reasons, 'Your salary isn’t set up yet.'); end if;
  if v_service < v_set.min_service_months then
    v_reasons := array_append(v_reasons, format('You need %s months of service (you have %s).', v_set.min_service_months, v_service));
  end if;
  if v_open > 0 and not v_set.allow_multiple then v_reasons := array_append(v_reasons, 'You already have a loan open.'); end if;
  if v_gross > 0 and v_emi >= round(v_gross * v_set.max_emi_percent / 100, 2) then
    v_reasons := array_append(v_reasons, 'Your current EMIs already use your repayment limit.');
  end if;

  return jsonb_build_object(
    'eligible', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons),
    'monthlyGross', v_gross, 'serviceMonths', v_service, 'maxAmount', greatest(v_max, 0),
    'maxTenure', v_set.max_tenure_months, 'interestRate', v_set.interest_rate,
    'maxEmi', greatest(round(v_gross * v_set.max_emi_percent / 100, 2) - v_emi, 0), 'currentEmi', v_emi,
    'maxEmiPercent', v_set.max_emi_percent, 'salaryMultiple', v_set.salary_multiple);
end $$;

create function public.apply_loan(p_org uuid, p_kind text, p_amount numeric, p_tenure int, p_purpose text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_el    jsonb := public.loan_eligibility(p_org);
  v_emp   public.employees;
  v_rate  numeric;
  v_emi   numeric;
  v_id    uuid;
  v_req   uuid;
  v_ten   int;
begin
  if not (v_el ->> 'eligible')::boolean then
    raise exception '%', v_el -> 'reasons' ->> 0 using errcode = '22023';
  end if;
  if p_kind not in ('loan', 'advance') then
    raise exception 'Choose a loan or a salary advance.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount.' using errcode = '22023';
  end if;
  if p_amount > (v_el ->> 'maxAmount')::numeric then
    raise exception 'You can borrow up to ₹%.', trim_scale((v_el ->> 'maxAmount')::numeric) using errcode = '22023';
  end if;
  v_ten := case when p_kind = 'advance' then 3 else (v_el ->> 'maxTenure')::int end;
  if p_tenure is null or p_tenure < 1 or p_tenure > v_ten then
    raise exception '%', case when p_kind = 'advance' then 'A salary advance is repaid within 3 months.'
                              else format('Choose a tenure of 1 to %s months.', v_el ->> 'maxTenure') end using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_purpose, ''))) < 3 then
    raise exception 'Say what the loan is for.' using errcode = '22023';
  end if;
  v_rate := case when p_kind = 'advance' then 0 else (v_el ->> 'interestRate')::numeric end;
  v_emi := app.loan_emi(round(p_amount, 2), v_rate, p_tenure);
  if v_emi > (v_el ->> 'maxEmi')::numeric then
    raise exception 'The EMI of ₹% is more than you can repay each month (₹%). Borrow less or over a longer tenure.',
      trim_scale(v_emi), trim_scale((v_el ->> 'maxEmi')::numeric) using errcode = '22023';
  end if;
  select * into v_emp from public.employees where organization_id = p_org and user_id = auth.uid();
  insert into public.loans (organization_id, employee_id, kind, amount, interest_rate, tenure_months, emi, purpose)
  values (p_org, v_emp.id, p_kind, round(p_amount, 2), v_rate, p_tenure, v_emi, btrim(p_purpose))
  returning id into v_id;
  v_req := app.request_approval(p_org, 'loan', v_id, v_emp.id,
    format('%s: %s of ₹%s over %s month%s', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)),
           case p_kind when 'advance' then 'salary advance' else 'loan' end, trim_scale(round(p_amount, 2)), p_tenure, case when p_tenure = 1 then '' else 's' end),
    '/loans/' || v_id);
  update public.loans set approval_request_id = v_req where id = v_id;
  return v_id;
end $$;

create function app.on_loan_decided(p_loan uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.loans
     set status = case p_outcome when 'approved' then 'approved' when 'rejected' then 'rejected' else 'cancelled' end,
         decided_at = now()
   where id = p_loan and status = 'pending';
  if p_outcome = 'approved' then
    perform app.notify_permission_holders(l.organization_id, 'payroll.approve', 'loan.approved',
      'Loan approved, ready to disburse', '/loans?tab=tracker')
      from public.loans l where l.id = p_loan;
  end if;
end $$;
revoke all on function app.on_loan_decided(uuid, text) from public;
insert into app.approval_handlers (subject_type, handler) values ('loan', 'app.on_loan_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label, escalate_after_hours) values
  ('loan', 1, 'reporting_manager', null, 'Reporting manager', 72),
  ('loan', 2, 'permission', 'payroll.approve', 'Payroll', 72);
select app.seed_org_flows(o.id, 'loan') from public.organizations o;

-- The applicant withdraws a pending application.
create function public.cancel_loan(p_loan uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_l public.loans;
begin
  select * into v_l from public.loans where id = p_loan;
  if v_l.id is null or not app.is_own_employee(v_l.employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_l.status <> 'pending' or v_l.approval_request_id is null then
    raise exception 'Only a pending application can be withdrawn.' using errcode = '22023';
  end if;
  perform public.cancel_approval(v_l.approval_request_id);
end $$;

-- Payroll disburses an approved loan; the schedule starts at the first EMI month.
create function public.disburse_loan(p_loan uuid, p_mode text, p_reference text default null, p_first_emi date default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_l       public.loans;
  v_today   date;
  v_first   date;
  v_balance numeric;
  v_int     numeric;
  v_prin    numeric;
  v_open    numeric;
  i         int;
begin
  select * into v_l from public.loans where id = p_loan for update;
  if v_l.id is null or not app.has_permission(v_l.organization_id, 'payroll.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_l.status <> 'approved' then
    raise exception 'Only an approved loan can be disbursed.' using errcode = '22023';
  end if;
  if p_mode not in ('bank', 'cash', 'payroll') then
    raise exception 'Choose how the money is paid.' using errcode = '22023';
  end if;
  if p_mode = 'bank' and char_length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception 'Enter the bank reference.' using errcode = '22023';
  end if;
  v_today := app.org_today(v_l.organization_id);
  v_first := coalesce(p_first_emi, (date_trunc('month', v_today) + interval '1 month')::date);
  if extract(day from v_first) <> 1 or v_first < date_trunc('month', v_today)::date then
    raise exception 'The first EMI must be this month or later.' using errcode = '22023';
  end if;

  v_balance := v_l.amount;
  for i in 1 .. v_l.tenure_months loop
    v_open := v_balance;
    v_int := round(v_balance * v_l.interest_rate / 1200, 2);
    v_prin := case when i = v_l.tenure_months then v_balance else least(v_balance, v_l.emi - v_int) end;
    v_balance := v_balance - v_prin;
    insert into public.loan_installments (organization_id, loan_id, seq, due_month, opening_balance, principal, interest, emi)
    values (v_l.organization_id, p_loan, i, (v_first + make_interval(months => i - 1))::date, v_open, v_prin, v_int, v_prin + v_int);
  end loop;

  if p_mode = 'payroll' then
    insert into public.payroll_adjustments (organization_id, employee_id, code, name, kind, amount, taxable, reason)
    values (v_l.organization_id, v_l.employee_id, 'LOAN_DISBURSAL', case v_l.kind when 'advance' then 'Salary advance' else 'Loan disbursal' end,
            'earning', v_l.amount, false, 'Loan ' || left(p_loan::text, 8) || ': ' || left(v_l.purpose, 200));
  end if;
  update public.loans
     set status = 'active', disbursed_on = v_today, disbursal_mode = p_mode, disbursal_reference = nullif(btrim(p_reference), ''),
         disbursed_by = auth.uid(), first_emi_month = v_first
   where id = p_loan;
  perform app.notify(v_l.organization_id, (select user_id from public.employees where id = v_l.employee_id), 'loan.disbursed',
    case v_l.kind when 'advance' then 'Your salary advance has been paid' else 'Your loan has been disbursed' end,
    'EMIs of ₹' || trim_scale(v_l.emi) || ' start in ' || to_char(v_first, 'Mon YYYY') || ', deducted from your salary.', '/loans/' || p_loan);
  -- A run already open for a month the schedule has reached picks the EMIs up now.
  perform app.queue_loan_emis(r.organization_id, r.period_month)
     from public.payroll_runs r where r.organization_id = v_l.organization_id and r.status not in ('locked', 'cancelled') and r.period_month >= v_first;
end $$;

-- Turn every scheduled EMI due by p_month into a LOAN_EMI payroll deduction.
create function app.queue_loan_emis(p_org uuid, p_month date) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  r   record;
  v_adj uuid;
  v_n int := 0;
begin
  for r in select i.id, i.seq, i.emi, i.due_month, l.employee_id, l.id as loan_id, l.tenure_months, l.kind
             from public.loan_installments i join public.loans l on l.id = i.loan_id
            where i.organization_id = p_org and i.status = 'scheduled' and i.due_month <= p_month and l.status = 'active'
            order by i.due_month, i.seq
            for update of i loop
    insert into public.payroll_adjustments (organization_id, employee_id, code, name, kind, amount, taxable, reason)
    values (p_org, r.employee_id, 'LOAN_EMI', case r.kind when 'advance' then 'Advance recovery' else 'Loan EMI' end, 'deduction', r.emi, false,
            format('EMI %s of %s (%s), loan %s', r.seq, r.tenure_months, to_char(r.due_month, 'Mon YYYY'), left(r.loan_id::text, 8)))
    returning id into v_adj;
    update public.loan_installments set status = 'queued', adjustment_id = v_adj where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function app.payroll_runs_queue_loans() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.queue_loan_emis(new.organization_id, new.period_month);
  return new;
end $$;
create trigger payroll_runs_queue_loans after insert on public.payroll_runs for each row execute function app.payroll_runs_queue_loans();

-- A locked run pays the EMI (the loan closes after the last); a removed deduction puts the EMI back on the schedule.
create function app.loan_adjustment_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_loan uuid;
begin
  if tg_op = 'DELETE' then
    update public.loan_installments set status = 'scheduled', adjustment_id = null where adjustment_id = old.id and status = 'queued';
    return old;
  end if;
  if new.applied_run_id is not null and old.applied_run_id is null then
    update public.loan_installments set status = 'paid', paid_run_id = new.applied_run_id, paid_at = now()
     where adjustment_id = new.id and status = 'queued' returning loan_id into v_loan;
    if v_loan is not null and not exists (select 1 from public.loan_installments where loan_id = v_loan and status in ('scheduled', 'queued')) then
      update public.loans set status = 'closed', closed_at = now(), closure_note = 'Repaid through payroll' where id = v_loan and status = 'active';
    end if;
  elsif new.applied_run_id is null and old.applied_run_id is not null then  -- the run was purged (demo)
    update public.loan_installments set status = 'queued', paid_run_id = null, paid_at = null where adjustment_id = new.id and status = 'paid';
  end if;
  return new;
end $$;
create trigger payroll_adjustments_loans after update of applied_run_id or delete on public.payroll_adjustments
  for each row when (old.code = 'LOAN_EMI') execute function app.loan_adjustment_sync();

-- Settle the rest of an active loan outside payroll (the employee repays it, or it is recovered in full and final).
create function public.foreclose_loan(p_loan uuid, p_note text) returns numeric
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_l    public.loans;
  v_due  numeric;
begin
  select * into v_l from public.loans where id = p_loan for update;
  if v_l.id is null or not app.has_permission(v_l.organization_id, 'payroll.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_l.status <> 'active' then
    raise exception 'Only an active loan can be foreclosed.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say how the balance was settled.' using errcode = '22023';
  end if;
  if exists (select 1 from public.loan_installments i join public.payroll_adjustments a on a.id = i.adjustment_id
              where i.loan_id = p_loan and i.status = 'queued') then
    delete from public.payroll_adjustments a using public.loan_installments i
     where i.loan_id = p_loan and i.status = 'queued' and a.id = i.adjustment_id and a.applied_run_id is null;
  end if;
  select coalesce(sum(principal), 0) into v_due from public.loan_installments where loan_id = p_loan and status in ('scheduled', 'queued');
  update public.loan_installments set status = 'foreclosed', adjustment_id = null where loan_id = p_loan and status in ('scheduled', 'queued');
  update public.loans set status = 'closed', closed_at = now(), closure_note = left('Foreclosed: ' || btrim(p_note), 200) where id = p_loan;
  return v_due;
end $$;

revoke all on function app.loan_emi(numeric, numeric, int) from public;
grant execute on function app.loan_emi(numeric, numeric, int) to authenticated, service_role;
revoke all on function app.queue_loan_emis(uuid, date) from public;
revoke all on function app.payroll_runs_queue_loans() from public;
revoke all on function app.loan_adjustment_sync() from public;
revoke all on function public.loan_eligibility(uuid) from public, anon;
revoke all on function public.apply_loan(uuid, text, numeric, int, text) from public, anon;
revoke all on function public.cancel_loan(uuid) from public, anon;
revoke all on function public.disburse_loan(uuid, text, text, date) from public, anon;
revoke all on function public.foreclose_loan(uuid, text) from public, anon;
grant execute on function public.loan_eligibility(uuid) to authenticated, service_role;
grant execute on function public.apply_loan(uuid, text, numeric, int, text) to authenticated, service_role;
grant execute on function public.cancel_loan(uuid) to authenticated, service_role;
grant execute on function public.disburse_loan(uuid, text, text, date) to authenticated, service_role;
grant execute on function public.foreclose_loan(uuid, text) to authenticated, service_role;
