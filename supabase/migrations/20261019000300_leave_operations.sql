-- PeopleCore · Leave operations, part 2 (Kredily parity).
--
-- * Leave rules: each leave type is one rule with a category, short name and description; the versioned policy
--   now says how many days a year it gives, how they accrue (monthly, quarterly, half-yearly or upfront; at the
--   start or end of the period; optionally in proportion to days present), carry-forward, probation and notice
--   period, monthly and continuous limits, future-dated and backdated requests, and requests into next year.
--   Weekends and holidays inside a request count separately.
-- * Rules apply to everyone or only to employees they are assigned to (assignments are effective-dated).
-- * Leave settings per organization: the leave year (January or April), carry-forward expiry, skip-level approval
--   (a second step for the manager's manager) and peer-to-peer donation.
-- * Accrual catches up every period of the current leave year since accrual started for the organization (never
--   before: opening balances were entered by hand), is idempotent per period, and can be run on demand by HR
--   ("Recalculate", "Run carry-forward"). Closing a leave year records what carried forward, lapses anything above
--   the cap and, when carried leave expires, lapses what was carried a year earlier and not used.
-- * Balances by bucket (carried, credited, applied, penalty, other) for the leave year; HR edits buckets, which
--   writes ledger rows for the difference. Encashment requests (approved by HR) and donation write ledger rows too.
-- * Team calendar: who in your team is away, without the leave type or reason.

-- ─── Leave types: rule identity ─────────────────────────────────────────────

alter table public.leave_types
  add column category        text not null default 'custom'
    check (category in ('casual', 'sick', 'earned', 'comp_off', 'event', 'maternity', 'paternity', 'on_duty', 'wfh', 'lop', 'custom')),
  add column short_name      text check (short_name ~ '^[A-Z0-9]{1,2}$'),
  add column description     text check (char_length(description) <= 300),
  add column count_weekends  boolean not null default false,
  add column count_holidays  boolean not null default false,
  add column applies_to      text not null default 'everyone' check (applies_to in ('everyone', 'assigned'));

update public.leave_types set count_weekends = count_all_days, count_holidays = count_all_days;
update public.leave_types set category = case code
    when 'CL' then 'casual' when 'SL' then 'sick' when 'EL' then 'earned' when 'PL' then 'earned'
    when 'LOP' then 'lop' when 'COMP_OFF' then 'comp_off' else 'custom' end,
  short_name = case code when 'CL' then 'CL' when 'SL' then 'SL' when 'EL' then 'EL' when 'PL' then 'PL'
    when 'LOP' then 'LP' when 'COMP_OFF' then 'CO' end;

-- ─── Policies: the rule's numbers ───────────────────────────────────────────

alter table public.leave_policies
  add column annual_days             numeric(6,2) check (annual_days >= 0 and annual_days <= 366),
  add column accrual_timing          text not null default 'start' check (accrual_timing in ('start', 'end')),
  add column credit_on_present_days  boolean not null default false,
  add column allowed_on_notice       boolean not null default true,
  add column max_per_month           numeric(4,1) check (max_per_month > 0 and max_per_month <= 31),
  add column max_continuous          numeric(5,1) check (max_continuous > 0 and max_continuous <= 366),
  add column allow_future            boolean not null default true,
  add column future_notice_days      smallint not null default 0 check (future_notice_days between 0 and 365),
  add column allow_backdated         boolean not null default true,
  add column backdated_max_days      smallint check (backdated_max_days between 0 and 366),
  add column next_year_until         smallint check (next_year_until between 1 and 12);

update public.leave_policies set annual_days = case accrual_period::text
    when 'monthly' then least(366, accrual_days * 12) when 'yearly' then accrual_days else 0 end;

-- Types and policies created any other way (organization defaults, the comp-off type, imports) get the same
-- category, short name and annual days as the backfill above.
create function app.leave_types_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.category = 'custom' then
    new.category := case new.code when 'CL' then 'casual' when 'SL' then 'sick' when 'EL' then 'earned' when 'PL' then 'earned'
                                  when 'LOP' then 'lop' when 'COMP_OFF' then 'comp_off' else 'custom' end;
  end if;
  new.short_name := coalesce(new.short_name, case new.code when 'CL' then 'CL' when 'SL' then 'SL' when 'EL' then 'EL' when 'PL' then 'PL'
                                                           when 'LOP' then 'LP' when 'COMP_OFF' then 'CO' end);
  return new;
end $$;
create trigger leave_types_defaults before insert on public.leave_types for each row execute function app.leave_types_defaults();

create function app.leave_policies_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.annual_days := coalesce(new.annual_days, case new.accrual_period::text
    when 'monthly' then least(366, new.accrual_days * 12) when 'quarterly' then least(366, new.accrual_days * 4)
    when 'half_yearly' then least(366, new.accrual_days * 2) when 'yearly' then new.accrual_days else 0 end);
  return new;
end $$;
create trigger leave_policies_defaults before insert on public.leave_policies for each row execute function app.leave_policies_defaults();

-- ─── Settings ───────────────────────────────────────────────────────────────

create table public.leave_settings (
  organization_id       uuid primary key references public.organizations (id) on delete cascade,
  year_start_month      smallint not null default 1 check (year_start_month between 1 and 12),
  carry_forward_expiry  text not null default 'never' check (carry_forward_expiry in ('year_end', 'never', '12_months')),
  skip_level_approval   boolean not null default false,
  donation_enabled      boolean not null default false,
  -- Accrual never credits periods that ended before this date (balances before it were entered as openings).
  accrual_start         date not null default date_trunc('month', current_date)::date,
  updated_by            uuid default auth.uid(),
  updated_at            timestamptz not null default now()
);
create trigger leave_settings_touch before update on public.leave_settings for each row execute function app.touch_updated_at();
create trigger leave_settings_audit after update on public.leave_settings for each row execute function app.audit_row();

insert into public.leave_settings (organization_id) select id from public.organizations on conflict do nothing;

-- ─── Assignments, carry-forwards, encashments ───────────────────────────────

create table public.leave_type_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  leave_type_id    uuid not null,
  effective_from   date not null,
  assigned_by      uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (employee_id, leave_type_id),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, leave_type_id) references public.leave_types (organization_id, id) on delete cascade
);
create index leave_type_assignments_type_idx on public.leave_type_assignments (leave_type_id);
create trigger leave_type_assignments_audit after insert or update or delete on public.leave_type_assignments
  for each row execute function app.audit_row();

-- What carried into a leave year (written when the year is closed; used to expire unused carried leave).
create table public.leave_carry_forwards (
  organization_id  uuid not null,
  employee_id      uuid not null,
  leave_type_id    uuid not null,
  cycle_start      date not null,
  days             numeric(6,2) not null check (days >= 0),
  created_at       timestamptz not null default now(),
  primary key (employee_id, leave_type_id, cycle_start),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, leave_type_id) references public.leave_types (organization_id, id) on delete cascade
);

create table public.leave_encashments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  employee_id          uuid not null,
  leave_type_id        uuid not null,
  days                 numeric(6,2) not null check (days > 0 and days * 2 = round(days * 2)),
  reason               text check (char_length(reason) <= 500),
  status               public.leave_status not null default 'pending',
  approval_request_id  uuid,
  payroll_run_id       uuid,  -- set when payroll pays it out
  requested_by         uuid not null default auth.uid(),
  created_at           timestamptz not null default now(),
  decided_at           timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, leave_type_id) references public.leave_types (organization_id, id)
);
create unique index leave_encashments_pending_uq on public.leave_encashments (employee_id, leave_type_id) where status = 'pending';
create trigger leave_encashments_audit after insert or update on public.leave_encashments for each row execute function app.audit_row();

-- ─── RLS and grants ─────────────────────────────────────────────────────────

alter table public.leave_settings enable row level security;
alter table public.leave_type_assignments enable row level security;
alter table public.leave_carry_forwards enable row level security;
alter table public.leave_encashments enable row level security;

create policy leave_settings_select on public.leave_settings for select to authenticated using (app.is_member(organization_id));
create policy leave_settings_update on public.leave_settings for update to authenticated
  using (organization_id in (select app.orgs_with_scope('leave.manage', 'org')))
  with check (organization_id in (select app.orgs_with_scope('leave.manage', 'org')));

create policy leave_type_assignments_select on public.leave_type_assignments for select to authenticated
  using (organization_id in (select app.orgs_with_scope('leave.read', 'org')) or employee_id in (select app.employees_in_scope('leave.read')));
create policy leave_type_assignments_insert on public.leave_type_assignments for insert to authenticated
  with check (organization_id in (select app.orgs_with_scope('leave.manage', 'org')));
create policy leave_type_assignments_update on public.leave_type_assignments for update to authenticated
  using (organization_id in (select app.orgs_with_scope('leave.manage', 'org')))
  with check (organization_id in (select app.orgs_with_scope('leave.manage', 'org')));
create policy leave_type_assignments_delete on public.leave_type_assignments for delete to authenticated
  using (organization_id in (select app.orgs_with_scope('leave.manage', 'org')));

create policy leave_carry_forwards_select on public.leave_carry_forwards for select to authenticated
  using (organization_id in (select app.orgs_with_scope('leave.read', 'org')) or employee_id in (select app.employees_in_scope('leave.read')));
create policy leave_encashments_select on public.leave_encashments for select to authenticated
  using (organization_id in (select app.orgs_with_scope('leave.read', 'org')) or employee_id in (select app.employees_in_scope('leave.read'))
         or (approval_request_id is not null and app.can_view_approval(approval_request_id)));

grant select, update on public.leave_settings to authenticated;
grant select, insert, update, delete on public.leave_type_assignments to authenticated;
grant select on public.leave_carry_forwards, public.leave_encashments to authenticated;
grant all on public.leave_settings, public.leave_type_assignments, public.leave_carry_forwards, public.leave_encashments to service_role;

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- First day of the leave year containing p_date.
create function app.leave_cycle_start(p_org uuid, p_date date) returns date
language sql stable security definer set search_path = '' as $$
  select case when extract(month from p_date)::int >= m
              then make_date(extract(year from p_date)::int, m, 1)
              else make_date(extract(year from p_date)::int - 1, m, 1) end
    from (select coalesce((select year_start_month from public.leave_settings where organization_id = p_org), 1)::int as m) s;
$$;

-- The policy version in force on a date (the earliest one if the date is before every version).
create function app.leave_policy_on(p_type uuid, p_date date) returns public.leave_policies
language sql stable security definer set search_path = '' as $$
  select p.* from public.leave_policies p where p.leave_type_id = p_type
   order by (p.effective_from <= p_date) desc, case when p.effective_from <= p_date then p.effective_from end desc nulls last, p.effective_from
   limit 1;
$$;

-- Does a leave rule apply to an employee on a date?
create function app.leave_type_applies(p_employee uuid, p_type uuid, p_on date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select t.is_active and (t.applies_to = 'everyone'
                     or exists (select 1 from public.leave_type_assignments a
                                 where a.employee_id = p_employee and a.leave_type_id = t.id and a.effective_from <= p_on))
                     from public.leave_types t where t.id = p_type), false);
$$;

-- Days a request takes: working days (the employee's work-week pattern, else the calendar's weekly offs) minus
-- half days; weekends and holidays count only where the rule says so. Half working days count as half.
create or replace function app.leave_days(p_employee uuid, p_type uuid, p_start date, p_end date, p_half_start boolean, p_half_end boolean)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_weekends boolean;
  v_holidays boolean;
  v_calendar uuid := app.employee_calendar(p_employee);
  v_offs     smallint[];
  v_week     text[];
  v_code     text;
  v_days     numeric := 0;
  v_day      date;
  v_unit     numeric;
begin
  select count_weekends or count_all_days, count_holidays or count_all_days into v_weekends, v_holidays
    from public.leave_types where id = p_type;
  select weekly_offs into v_offs from public.holiday_calendars where id = v_calendar;
  v_offs := coalesce(v_offs, '{0,6}');
  for v_day in select generate_series(p_start, p_end, interval '1 day')::date loop
    v_unit := 1;
    v_week := app.work_week_for(p_employee, v_day);
    if v_week is not null then
      v_code := substr(v_week[least(5, (extract(day from v_day)::int - 1) / 7 + 1)], extract(isodow from v_day)::int, 1);
    else
      v_code := case when extract(dow from v_day)::smallint = any (v_offs) then 'O' else 'W' end;
    end if;
    if v_code = 'O' then
      continue when not coalesce(v_weekends, false);
    elsif v_code = 'H' and not coalesce(v_weekends, false) then
      v_unit := 0.5;
    end if;
    continue when not coalesce(v_holidays, false)
      and exists (select 1 from public.holidays h where h.calendar_id = v_calendar and h.holiday_date = v_day and not h.is_optional);
    if (v_day = p_start and p_half_start) or (v_day = p_end and p_half_end) then
      v_unit := least(v_unit, 0.5);
    end if;
    v_days := v_days + v_unit;
  end loop;
  return v_days;
end $$;

-- A leave year's balance by bucket for one employee and type. balance = the whole ledger.
create function app.leave_buckets(p_employee uuid, p_type uuid, p_cycle date,
  out carried numeric, out credited numeric, out applied numeric, out penalty numeric, out other numeric, out balance numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(days) filter (where entry_date < p_cycle or (kind = 'lapse' and entry_date = p_cycle) or (kind = 'opening' and entry_date >= p_cycle)), 0),
         coalesce(sum(days) filter (where entry_date >= p_cycle and (kind in ('accrual', 'adjust') or (kind = 'donation' and days > 0))), 0),
         -coalesce(sum(days) filter (where entry_date >= p_cycle and kind in ('debit', 'reversal')), 0),
         -coalesce(sum(days) filter (where entry_date >= p_cycle and kind = 'penalty'), 0),
         -coalesce(sum(days) filter (where entry_date >= p_cycle and (kind = 'encashment' or (kind = 'donation' and days < 0) or (kind = 'lapse' and entry_date > p_cycle))), 0),
         coalesce(sum(days), 0)
    from public.leave_ledger where employee_id = p_employee and leave_type_id = p_type;
$$;

-- ─── Accrual, carry-forward and lapse ───────────────────────────────────────

create function app.process_leave(p_org uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r          record;
  v_set      public.leave_settings;
  v_today    date;
  v_cycle    date;
  v_prev     date;
  v_pol      public.leave_policies;
  v_len      int;
  v_k        int;
  v_ps       date;
  v_pe       date;
  v_on       date;
  v_days     numeric;
  v_annual   numeric;
  v_months   int;
  v_ratio    numeric;
  v_balance  numeric;
  v_carry    numeric;
  v_used     numeric;
  v_key      text;
  v_credited int := 0;
  v_lapsed   int := 0;
begin
  -- 1. Close the previous leave year: expire unused carried leave, lapse above the cap, record what carries.
  for r in
    select e.id as employee_id, e.organization_id, t.id as leave_type_id
      from public.employees e
      join public.leave_types t on t.organization_id = e.organization_id and t.is_active and not t.allow_negative
      join public.organizations o on o.id = e.organization_id and o.status = 'active'
     where e.status <> 'exited' and (p_org is null or e.organization_id = p_org)
       and e.date_of_joining < app.leave_cycle_start(e.organization_id, app.org_today(e.organization_id))
  loop
    v_today := app.org_today(r.organization_id);
    v_cycle := app.leave_cycle_start(r.organization_id, v_today);
    continue when exists (select 1 from public.leave_carry_forwards where employee_id = r.employee_id and leave_type_id = r.leave_type_id and cycle_start = v_cycle);
    select * into v_set from public.leave_settings where organization_id = r.organization_id;
    v_pol := app.leave_policy_on(r.leave_type_id, v_cycle - 1);
    continue when v_pol.id is null or v_pol.effective_from > v_cycle - 1;

    v_prev := (v_cycle - interval '1 year')::date;
    if coalesce(v_set.carry_forward_expiry, 'never') <> 'never' then
      select days into v_carry from public.leave_carry_forwards where employee_id = r.employee_id and leave_type_id = r.leave_type_id and cycle_start = v_prev;
      if coalesce(v_carry, 0) > 0 then
        select -coalesce(sum(days), 0) into v_used from public.leave_ledger
         where employee_id = r.employee_id and leave_type_id = r.leave_type_id and entry_date >= v_prev and entry_date < v_cycle
           and (kind in ('debit', 'reversal', 'encashment', 'penalty') or (kind = 'donation' and days < 0));
        select coalesce(sum(days), 0) into v_balance from public.leave_ledger
         where employee_id = r.employee_id and leave_type_id = r.leave_type_id and entry_date < v_cycle;
        v_days := least(v_carry - greatest(v_used, 0), v_balance);
        if v_days > 0 then
          insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
          values (r.organization_id, r.employee_id, r.leave_type_id, v_cycle - 1, 'lapse', -v_days, 'Carried-forward leave expired',
                  'cf-expire:' || r.leave_type_id || ':' || r.employee_id || ':' || v_cycle)
          on conflict (idempotency_key) do nothing;
          v_lapsed := v_lapsed + 1;
        end if;
      end if;
    end if;

    select coalesce(sum(days), 0) into v_balance from public.leave_ledger
     where employee_id = r.employee_id and leave_type_id = r.leave_type_id and entry_date < v_cycle;
    v_key := 'lapse:' || r.leave_type_id || ':' || r.employee_id || ':'
             || case when extract(month from v_cycle) = 1 then extract(year from v_cycle - 1)::text else v_cycle::text end;
    if v_pol.carry_forward_max is not null and v_balance > v_pol.carry_forward_max
       and not exists (select 1 from public.leave_ledger where idempotency_key = v_key) then
      insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
      values (r.organization_id, r.employee_id, r.leave_type_id, v_cycle, 'lapse', v_pol.carry_forward_max - v_balance,
              'Leave-year lapse above the carry-forward limit', v_key)
      on conflict (idempotency_key) do nothing;
      v_lapsed := v_lapsed + 1;
    end if;
    insert into public.leave_carry_forwards (organization_id, employee_id, leave_type_id, cycle_start, days)
    values (r.organization_id, r.employee_id, r.leave_type_id, v_cycle,
            greatest(0, case when v_pol.carry_forward_max is null then v_balance else least(v_balance, v_pol.carry_forward_max) end))
    on conflict do nothing;
  end loop;

  -- 2. Accrual for every period of the current leave year that has come due.
  for r in
    select e.id as employee_id, e.organization_id, e.date_of_joining, e.probation_end_date, e.employment_type, t.id as leave_type_id
      from public.employees e
      join public.leave_types t on t.organization_id = e.organization_id and t.is_active
      join public.organizations o on o.id = e.organization_id and o.status = 'active'
     where e.status in ('active', 'on_notice') and (p_org is null or e.organization_id = p_org)
  loop
    v_today := app.org_today(r.organization_id);
    v_cycle := app.leave_cycle_start(r.organization_id, v_today);
    select * into v_set from public.leave_settings where organization_id = r.organization_id;
    v_pol := app.leave_policy_on(r.leave_type_id, v_today);
    continue when v_pol.id is null or v_pol.accrual_period = 'none';
    v_len := case v_pol.accrual_period when 'monthly' then 1 when 'quarterly' then 3 when 'half_yearly' then 6 else 12 end;
    for v_k in 0 .. (12 / v_len) - 1 loop
      v_ps := (v_cycle + make_interval(months => v_k * v_len))::date;
      v_pe := (v_ps + make_interval(months => v_len))::date - 1;
      exit when v_ps > v_today;
      continue when v_pe < coalesce(v_set.accrual_start, v_cycle);
      v_pol := app.leave_policy_on(r.leave_type_id, v_ps);
      continue when v_pol.id is null or v_pol.accrual_period = 'none' or v_pol.effective_from > v_pe;
      v_on := case when v_pol.accrual_timing = 'end' or v_pol.credit_on_present_days then v_pe else v_ps end;
      continue when v_on > v_today;
      continue when r.date_of_joining > v_pe;
      -- Joiners after the 15th of the period's first month start accruing from the next month.
      continue when v_len = 1 and r.date_of_joining > v_ps + 14;
      continue when v_pol.eligible_employment_types is not null and not (r.employment_type = any (v_pol.eligible_employment_types));
      continue when not v_pol.accrue_during_probation and r.probation_end_date is not null and r.probation_end_date >= v_on;
      continue when not app.leave_type_applies(r.employee_id, r.leave_type_id, least(v_pe, v_today));
      v_key := 'accrual:' || r.leave_type_id || ':' || r.employee_id || ':' || v_ps;
      continue when exists (select 1 from public.leave_ledger where idempotency_key = v_key)
        or exists (select 1 from public.leave_ledger where employee_id = r.employee_id and leave_type_id = r.leave_type_id
                    and kind = 'accrual' and entry_date between v_ps and v_pe);

      v_annual := coalesce(v_pol.annual_days, v_pol.accrual_days * (12 / v_len));
      v_days := v_annual * v_len / 12;
      if r.date_of_joining > v_ps and v_len > 1 then
        -- Pro-rated by whole months left in the period (the joining month counts if they joined by the 15th).
        v_months := v_len - (extract(year from age(date_trunc('month', r.date_of_joining)::date, v_ps)) * 12
                             + extract(month from age(date_trunc('month', r.date_of_joining)::date, v_ps)))::int
                    - case when extract(day from r.date_of_joining) > 15 then 1 else 0 end;
        v_days := round(v_annual * greatest(v_months, 0) / 12 * 2) / 2;
      end if;
      if v_pol.credit_on_present_days then
        select coalesce(sum(case when status in ('present', 'wfh', 'on_duty') then 1 when status = 'half_day' then 0.5 else 0 end), 0)
               / nullif(count(*) filter (where status not in ('weekly_off', 'holiday')), 0)
          into v_ratio
          from public.attendance_days where employee_id = r.employee_id and work_date between v_ps and v_pe;
        v_days := round(v_days * coalesce(v_ratio, 0), 2);
      else
        v_days := round(v_days, 2);
      end if;
      continue when v_days <= 0;
      insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, idempotency_key)
      values (r.organization_id, r.employee_id, r.leave_type_id, greatest(v_on, r.date_of_joining), 'accrual', v_days, v_key)
      on conflict (idempotency_key) do nothing;
      v_credited := v_credited + 1;
    end loop;
  end loop;
  return jsonb_build_object('credited', v_credited, 'lapsed', v_lapsed);
end $$;

create or replace function public.worker_leave_accrual() returns jsonb
language sql volatile security definer set search_path = '' as $$
  select app.process_leave(null);
$$;

-- HR: "Recalculate" / "Run carry-forward" for their organization now.
create function public.recalculate_leave(p_org uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_org not in (select app.orgs_with_scope('leave.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return app.process_leave(p_org);
end $$;

-- ─── Balances ───────────────────────────────────────────────────────────────

-- The caller's (or a visible employee's) balances: rules that apply to them, or that still hold a balance.
create or replace function public.leave_balances(p_employee uuid)
returns table (leave_type_id uuid, code text, name text, is_paid boolean, allow_negative boolean, allow_half_day boolean,
               balance numeric, pending numeric, available numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := app.employee_org_or_deny(p_employee, 'leave.read');
  v_today date := app.org_today(v_org);
begin
  return query
    with b as (
      select t.id, t.code, t.name, t.is_paid, t.allow_negative, t.allow_half_day,
             coalesce((select sum(l.days) from public.leave_ledger l where l.employee_id = p_employee and l.leave_type_id = t.id), 0) as balance,
             coalesce((select sum(r.days) from public.leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id and r.status = 'pending'), 0) as pending
        from public.leave_types t
       where t.organization_id = v_org and t.is_active)
    select b.id, b.code, b.name, b.is_paid, b.allow_negative, b.allow_half_day, b.balance, b.pending, b.balance - b.pending
      from b
     where app.leave_type_applies(p_employee, b.id, v_today) or b.balance <> 0 or b.pending <> 0
     order by b.code;
end $$;

-- Everyone's balances for a leave year (the employees the caller may see), by bucket.
create function public.leave_balance_sheet(p_org uuid, p_cycle date default null, p_employee uuid default null)
returns table (employee_id uuid, leave_type_id uuid, applies boolean, carried numeric, credited numeric, applied numeric,
               penalty numeric, other numeric, balance numeric, pending numeric)
language sql stable security definer set search_path = '' as $$
  with cyc as (select coalesce(p_cycle, app.leave_cycle_start(p_org, app.org_today(p_org))) as s, app.org_today(p_org) as today),
  emps as (
    select e.id from public.employees e
     where e.organization_id = p_org and e.status <> 'exited' and (p_employee is null or e.id = p_employee)
       and (p_org in (select app.orgs_with_scope('leave.read', 'org')) or e.id in (select app.employees_in_scope('leave.read'))))
  select e.id, t.id, app.leave_type_applies(e.id, t.id, cyc.today), b.carried, b.credited, b.applied, b.penalty, b.other, b.balance,
         coalesce((select sum(r.days) from public.leave_requests r where r.employee_id = e.id and r.leave_type_id = t.id and r.status = 'pending'), 0)
    from emps e
    cross join cyc
    join public.leave_types t on t.organization_id = p_org and t.is_active
    cross join lateral app.leave_buckets(e.id, t.id, cyc.s) b;
$$;

-- HR sets a leave year's carried, credited and penalty figures; the difference becomes ledger rows.
create function public.set_leave_balance(p_employee uuid, p_type uuid, p_carried numeric, p_credited numeric, p_penalty numeric, p_note text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org   uuid;
  v_today date;
  v_b     record;
  v_key   text := 'balance-edit:' || gen_random_uuid();
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or v_org not in (select app.orgs_with_scope('leave.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.leave_types where id = p_type and organization_id = v_org) then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'Say why the balance is being changed.' using errcode = '22023';
  end if;
  if least(p_carried, p_credited, p_penalty) < 0 or greatest(p_carried, p_credited, p_penalty) > 999
     or p_carried * 2 <> round(p_carried * 2) or p_penalty * 2 <> round(p_penalty * 2) then
    raise exception 'Enter whole or half days between 0 and 999.' using errcode = '22023';
  end if;
  v_today := app.org_today(v_org);
  select * into v_b from app.leave_buckets(p_employee, p_type, app.leave_cycle_start(v_org, v_today));
  if round(p_carried - v_b.carried, 2) <> 0 then
    insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
    values (v_org, p_employee, p_type, v_today, 'opening', round(p_carried - v_b.carried, 2), btrim(p_note), v_key || ':c');
  end if;
  if round(p_credited - v_b.credited, 2) <> 0 then
    insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
    values (v_org, p_employee, p_type, v_today, 'adjust', round(p_credited - v_b.credited, 2), btrim(p_note), v_key || ':a');
  end if;
  if round(p_penalty - v_b.penalty, 2) <> 0 then
    insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
    values (v_org, p_employee, p_type, v_today, 'penalty', -round(p_penalty - v_b.penalty, 2), btrim(p_note), v_key || ':p');
  end if;
end $$;

-- ─── Rules ──────────────────────────────────────────────────────────────────

-- Creates (p_type null) or edits a leave rule: the type's identity plus a policy version from p.effective_from
-- (today by default; a version starting the same day is replaced).
create function public.save_leave_rule(p_org uuid, p_type uuid, p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_type      public.leave_types;
  v_id        uuid := p_type;
  v_name      text := btrim(p->>'name');
  v_category  text := coalesce(nullif(p->>'category', ''), 'custom');
  v_short     text := nullif(upper(btrim(p->>'short_name')), '');
  v_annual    numeric := coalesce((p->>'annual_days')::numeric, 0);
  v_upfront   boolean := not coalesce((p->>'accrue_over_year')::boolean, true);
  v_freq      text := coalesce(nullif(p->>'accrual_frequency', ''), 'monthly');
  v_period    public.accrual_period;
  v_len       int;
  v_from      date := coalesce(nullif(p->>'effective_from', '')::date, app.org_today(p_org));
  v_cf        numeric;
  v_code      text;
  v_n         int := 1;
begin
  if p_org not in (select app.orgs_with_scope('leave.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 60 then
    raise exception 'Give the leave rule a name (2 to 60 characters).' using errcode = '22023';
  end if;
  if v_annual < 0 or v_annual > 366 then
    raise exception 'Allowed in a year must be between 0 and 366 days.' using errcode = '22023';
  end if;
  if v_freq not in ('monthly', 'quarterly', 'half_yearly') then
    raise exception 'Choose monthly, quarterly or half-yearly accrual.' using errcode = '22023';
  end if;
  v_period := case when v_annual = 0 then 'none' when v_upfront then 'yearly' else v_freq end::public.accrual_period;
  v_len := case v_period when 'monthly' then 1 when 'quarterly' then 3 when 'half_yearly' then 6 else 12 end;
  v_cf := case when not coalesce((p->>'carry_forward')::boolean, false) then 0
               when nullif(p->>'carry_forward_max', '') is null then null
               else (p->>'carry_forward_max')::numeric end;

  if v_id is null then
    v_code := left(regexp_replace(upper(coalesce(v_short, v_name)), '[^A-Z0-9]+', '', 'g'), 8);
    if v_code = '' then v_code := 'LT'; end if;
    while exists (select 1 from public.leave_types where organization_id = p_org and code = v_code || case when v_n = 1 then '' else v_n::text end) loop
      v_n := v_n + 1;
    end loop;
    v_code := v_code || case when v_n = 1 then '' else v_n::text end;
    insert into public.leave_types (organization_id, code, name) values (p_org, v_code, v_name) returning id into v_id;
  elsif not exists (select 1 from public.leave_types where id = v_id and organization_id = p_org) then
    raise exception 'Leave rule not found.' using errcode = '22023';
  end if;

  update public.leave_types set
    name = v_name, category = v_category, short_name = v_short, description = nullif(btrim(p->>'description'), ''),
    count_weekends = coalesce((p->>'count_weekends')::boolean, false),
    count_holidays = coalesce((p->>'count_holidays')::boolean, false),
    count_all_days = coalesce((p->>'count_weekends')::boolean, false) and coalesce((p->>'count_holidays')::boolean, false),
    encashable = coalesce((p->>'encashable')::boolean, false),
    allow_negative = coalesce((p->>'allow_negative')::boolean, false),
    allow_half_day = coalesce((p->>'allow_half_day')::boolean, true),
    is_paid = coalesce((p->>'is_paid')::boolean, true),
    applies_to = coalesce(nullif(p->>'applies_to', ''), 'everyone')
  where id = v_id
  returning * into v_type;

  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max,
    accrue_during_probation, annual_days, accrual_timing, credit_on_present_days, allowed_on_notice, max_per_month, max_continuous,
    allow_future, future_notice_days, allow_backdated, backdated_max_days, next_year_until)
  values (p_org, v_id, v_from, v_period, round(v_annual * v_len / 12, 2), v_cf,
    coalesce((p->>'applies_during_probation')::boolean, true), v_annual,
    coalesce(nullif(p->>'accrual_timing', ''), 'start'), coalesce((p->>'credit_on_present_days')::boolean, false),
    coalesce((p->>'allowed_on_notice')::boolean, true), nullif((p->>'max_per_month')::numeric, 0), nullif((p->>'max_continuous')::numeric, 0),
    coalesce((p->>'allow_future')::boolean, true), coalesce((p->>'future_notice_days')::smallint, 0),
    coalesce((p->>'allow_backdated')::boolean, true), (p->>'backdated_max_days')::smallint, nullif((p->>'next_year_until')::smallint, 0))
  on conflict (leave_type_id, effective_from) do update set
    accrual_period = excluded.accrual_period, accrual_days = excluded.accrual_days, carry_forward_max = excluded.carry_forward_max,
    accrue_during_probation = excluded.accrue_during_probation, annual_days = excluded.annual_days, accrual_timing = excluded.accrual_timing,
    credit_on_present_days = excluded.credit_on_present_days, allowed_on_notice = excluded.allowed_on_notice,
    max_per_month = excluded.max_per_month, max_continuous = excluded.max_continuous, allow_future = excluded.allow_future,
    future_notice_days = excluded.future_notice_days, allow_backdated = excluded.allow_backdated,
    backdated_max_days = excluded.backdated_max_days, next_year_until = excluded.next_year_until;
  return v_id;
end $$;

-- ─── Applying: the rule's limits ────────────────────────────────────────────

create or replace function public.apply_leave(
  p_employee   uuid,
  p_type       uuid,
  p_start      date,
  p_end        date,
  p_half_start boolean default false,
  p_half_end   boolean default false,
  p_reason     text default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp       public.employees;
  v_type      public.leave_types;
  v_pol       public.leave_policies;
  v_days      numeric;
  v_available numeric;
  v_id        uuid;
  v_approval  uuid;
  v_hr        boolean;
  v_today     date;
  v_month     date;
  v_part      numeric;
  v_taken     numeric;
  v_limit     date;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null or not app.is_member(v_emp.organization_id)
     or not (v_emp.user_id = auth.uid() or app.has_permission(v_emp.organization_id, 'leave.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- HR applying for someone else isn't held to the timing and size limits (corrections, backdated entries).
  v_hr := v_emp.user_id is distinct from auth.uid();
  v_today := app.org_today(v_emp.organization_id);
  if v_emp.status = 'exited' then
    raise exception 'Leave can’t be requested for someone who has left.' using errcode = '22023';
  end if;
  select * into v_type from public.leave_types where id = p_type and organization_id = v_emp.organization_id;
  if v_type.id is null or not v_type.is_active then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'The leave can’t end before it starts.' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'A single request can cover at most a year.' using errcode = '22023';
  end if;
  if (p_half_start or p_half_end) and not v_type.allow_half_day then
    raise exception '% can’t be taken in half days.', v_type.name using errcode = '22023';
  end if;
  if p_start = p_end and p_half_start and p_half_end then
    raise exception 'Choose either the first or the second half of the day.' using errcode = '22023';
  end if;
  if not app.leave_type_applies(p_employee, p_type, greatest(p_start, v_today)) and not app.leave_type_applies(p_employee, p_type, v_today) then
    raise exception '% isn’t one of the leave rules assigned to %.', v_type.name, trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)) using errcode = '22023';
  end if;

  v_pol := app.leave_policy_on(p_type, p_start);
  if v_pol.id is not null then
    if not v_pol.accrue_during_probation and v_emp.probation_end_date is not null and v_emp.probation_end_date >= p_start then
      raise exception '% can’t be taken during probation (until %).', v_type.name, to_char(v_emp.probation_end_date, 'DD Mon YYYY') using errcode = '22023';
    end if;
    if not v_pol.allowed_on_notice and v_emp.status = 'on_notice' then
      raise exception '% can’t be taken during the notice period.', v_type.name using errcode = '22023';
    end if;
    if not v_hr then
      if p_start > v_today and not v_pol.allow_future then
        raise exception '% can’t be requested for future dates.', v_type.name using errcode = '22023';
      end if;
      if p_start > v_today and p_start - v_today < v_pol.future_notice_days then
        raise exception 'Request % at least % day(s) ahead.', v_type.name, v_pol.future_notice_days using errcode = '22023';
      end if;
      if p_start < v_today and not v_pol.allow_backdated then
        raise exception '% can’t be requested for past dates.', v_type.name using errcode = '22023';
      end if;
      if p_start < v_today and v_pol.backdated_max_days is not null and v_today - p_start > v_pol.backdated_max_days then
        raise exception '% can be requested at most % day(s) back.', v_type.name, v_pol.backdated_max_days using errcode = '22023';
      end if;
      if v_pol.next_year_until is not null then
        v_limit := (app.leave_cycle_start(v_emp.organization_id, v_today) + interval '1 year'
                    + make_interval(months => ((v_pol.next_year_until - extract(month from app.leave_cycle_start(v_emp.organization_id, v_today))::int + 12) % 12) + 1))::date - 1;
        if p_end > v_limit then
          raise exception 'Next year’s % can be requested up to % only.', v_type.name, to_char(v_limit, 'DD Mon YYYY') using errcode = '22023';
        end if;
      end if;
    end if;
  end if;

  v_days := app.leave_days(p_employee, p_type, p_start, p_end, coalesce(p_half_start, false), coalesce(p_half_end, false));
  if v_days <= 0 then
    raise exception 'Those dates are all weekly offs or holidays.' using errcode = '22023';
  end if;
  if v_pol.id is not null and not v_hr then
    if v_pol.max_continuous is not null and v_days > v_pol.max_continuous then
      raise exception 'At most % day(s) of % in one request.', trim_scale(v_pol.max_continuous), v_type.name using errcode = '22023';
    end if;
    if v_pol.max_per_month is not null then
      for v_month in select generate_series(date_trunc('month', p_start), date_trunc('month', p_end), interval '1 month')::date loop
        v_part := app.leave_days(p_employee, p_type, greatest(p_start, v_month), least(p_end, (v_month + interval '1 month')::date - 1),
                                 p_half_start and p_start >= v_month, p_half_end and p_end < (v_month + interval '1 month')::date);
        select coalesce(sum(app.leave_days(p_employee, p_type, greatest(r.start_date, v_month), least(r.end_date, (v_month + interval '1 month')::date - 1),
                                           r.half_day_start and r.start_date >= v_month, r.half_day_end and r.end_date < (v_month + interval '1 month')::date)), 0)
          into v_taken
          from public.leave_requests r
         where r.employee_id = p_employee and r.leave_type_id = p_type and r.status in ('pending', 'approved')
           and r.start_date < (v_month + interval '1 month')::date and r.end_date >= v_month;
        if v_part + v_taken > v_pol.max_per_month then
          raise exception 'At most % day(s) of % a month; % already has %.', trim_scale(v_pol.max_per_month), v_type.name,
            to_char(v_month, 'FMMonth'), trim_scale(v_taken) using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;
  if not v_type.allow_negative then
    select coalesce(sum(days), 0) into v_available from public.leave_ledger where employee_id = p_employee and leave_type_id = p_type;
    v_available := v_available - coalesce((select sum(days) from public.leave_requests
                                            where employee_id = p_employee and leave_type_id = p_type and status = 'pending'), 0);
    if v_days > v_available then
      raise exception 'Only % day(s) of % available; this request needs %.', trim_scale(v_available), v_type.name, trim_scale(v_days)
        using errcode = '22023';
    end if;
  end if;

  begin
    insert into public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, half_day_start, half_day_end, days, reason)
    values (v_emp.organization_id, p_employee, p_type, p_start, p_end, coalesce(p_half_start, false), coalesce(p_half_end, false),
            v_days, nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'This overlaps another leave request.' using errcode = '22023';
  end;

  v_approval := app.request_approval(v_emp.organization_id, 'leave_request', v_id, p_employee,
    format('%s: %s, %s%s (%s day%s)', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)), v_type.name,
           to_char(p_start, 'DD Mon YYYY'), case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else '' end,
           trim_scale(v_days), case when v_days = 1 then '' else 's' end),
    '/leave');
  update public.leave_requests set approval_request_id = v_approval where id = v_id;
  return v_id;
end $$;

-- ─── Encashment ─────────────────────────────────────────────────────────────

create function public.request_leave_encashment(p_employee uuid, p_type uuid, p_days numeric, p_reason text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp       public.employees;
  v_type      public.leave_types;
  v_available numeric;
  v_id        uuid;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null or not app.is_member(v_emp.organization_id)
     or not (v_emp.user_id = auth.uid() or app.has_permission(v_emp.organization_id, 'leave.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_type from public.leave_types where id = p_type and organization_id = v_emp.organization_id;
  if v_type.id is null or not v_type.is_active or not v_type.encashable then
    raise exception 'That leave type can’t be encashed.' using errcode = '22023';
  end if;
  if p_days is null or p_days <= 0 or p_days * 2 <> round(p_days * 2) then
    raise exception 'Enter whole or half days.' using errcode = '22023';
  end if;
  select coalesce(sum(days), 0) into v_available from public.leave_ledger where employee_id = p_employee and leave_type_id = p_type;
  v_available := v_available - coalesce((select sum(days) from public.leave_requests where employee_id = p_employee and leave_type_id = p_type and status = 'pending'), 0);
  if p_days > v_available then
    raise exception 'Only % day(s) of % available to encash.', trim_scale(v_available), v_type.name using errcode = '22023';
  end if;
  begin
    insert into public.leave_encashments (organization_id, employee_id, leave_type_id, days, reason)
    values (v_emp.organization_id, p_employee, p_type, p_days, nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There’s already an encashment request waiting for %.', v_type.name using errcode = '22023';
  end;
  update public.leave_encashments set approval_request_id = app.request_approval(v_emp.organization_id, 'leave_encashment', v_id, p_employee,
    format('%s: encash %s day%s of %s', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)), trim_scale(p_days),
           case when p_days = 1 then '' else 's' end, v_type.name), '/leave?tab=requests')
   where id = v_id;
  return v_id;
end $$;

create function app.on_leave_encashment_decided(p_id uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row       public.leave_encashments;
  v_available numeric;
begin
  select * into v_row from public.leave_encashments where id = p_id for update;
  if v_row.id is null or v_row.status <> 'pending' then return; end if;
  if p_outcome = 'approved' then
    select coalesce(sum(days), 0) into v_available from public.leave_ledger where employee_id = v_row.employee_id and leave_type_id = v_row.leave_type_id;
    if v_row.days > v_available then
      raise exception 'Only % day(s) are left to encash now.', trim_scale(v_available) using errcode = '22023';
    end if;
    insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key)
    values (v_row.organization_id, v_row.employee_id, v_row.leave_type_id, app.org_today(v_row.organization_id), 'encashment', -v_row.days,
            'Encashed', 'encash:' || v_row.id)
    on conflict (idempotency_key) do nothing;
  end if;
  update public.leave_encashments
     set status = case p_outcome when 'approved' then 'approved' when 'rejected' then 'rejected' else 'cancelled' end::public.leave_status,
         decided_at = now()
   where id = p_id;
end $$;

insert into app.approval_handlers (subject_type, handler) values ('leave_encashment', 'app.on_leave_encashment_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label)
values ('leave_encashment', 1, 'permission', 'leave.manage', 'HR');
select app.seed_org_flows(id, 'leave_encashment') from public.organizations;

-- ─── Donation ───────────────────────────────────────────────────────────────

create function public.donate_leave(p_to uuid, p_type uuid, p_days numeric, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_from      public.employees;
  v_to        public.employees;
  v_type      public.leave_types;
  v_available numeric;
  v_key       text := 'donation:' || gen_random_uuid();
begin
  select * into v_to from public.employees where id = p_to;
  select * into v_from from public.employees where user_id = auth.uid() and organization_id = v_to.organization_id;
  if v_from.id is null or v_to.id is null or not app.is_member(v_to.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not coalesce((select donation_enabled from public.leave_settings where organization_id = v_to.organization_id), false) then
    raise exception 'Leave donation isn’t turned on in this organization.' using errcode = '22023';
  end if;
  if v_from.id = v_to.id then
    raise exception 'Choose a colleague to donate to.' using errcode = '22023';
  end if;
  if v_to.status not in ('active', 'on_notice') then
    raise exception 'Leave can only be donated to a current colleague.' using errcode = '22023';
  end if;
  select * into v_type from public.leave_types where id = p_type and organization_id = v_to.organization_id;
  if v_type.id is null or not v_type.is_active or v_type.allow_negative or not v_type.is_paid then
    raise exception 'Choose a paid leave type with a balance.' using errcode = '22023';
  end if;
  if not app.leave_type_applies(v_to.id, p_type, app.org_today(v_to.organization_id)) then
    raise exception '% isn’t one of %’s leave rules.', v_type.name, v_to.first_name using errcode = '22023';
  end if;
  if p_days is null or p_days <= 0 or p_days > 30 or p_days * 2 <> round(p_days * 2) then
    raise exception 'Donate whole or half days, up to 30.' using errcode = '22023';
  end if;
  select coalesce(sum(days), 0) into v_available from public.leave_ledger where employee_id = v_from.id and leave_type_id = p_type;
  v_available := v_available - coalesce((select sum(days) from public.leave_requests where employee_id = v_from.id and leave_type_id = p_type and status = 'pending'), 0);
  if p_days > v_available then
    raise exception 'Only % day(s) of % available to donate.', trim_scale(v_available), v_type.name using errcode = '22023';
  end if;
  insert into public.leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note, idempotency_key, created_by) values
    (v_to.organization_id, v_from.id, p_type, app.org_today(v_to.organization_id), 'donation', -p_days,
     left('Donated to ' || trim(concat_ws(' ', v_to.first_name, v_to.last_name)) || coalesce(': ' || nullif(btrim(p_note), ''), ''), 300), v_key || ':out', auth.uid()),
    (v_to.organization_id, v_to.id, p_type, app.org_today(v_to.organization_id), 'donation', p_days,
     left('Donated by ' || trim(concat_ws(' ', v_from.first_name, v_from.last_name)) || coalesce(': ' || nullif(btrim(p_note), ''), ''), 300), v_key || ':in', auth.uid());
  if v_to.user_id is not null then
    perform app.notify(v_to.organization_id, v_to.user_id, 'leave.donated',
      format('%s donated %s day%s of %s to you', trim(concat_ws(' ', v_from.first_name, v_from.last_name)), trim_scale(p_days),
             case when p_days = 1 then '' else 's' end, v_type.name), null, '/leave');
  end if;
end $$;

-- ─── Team calendar ──────────────────────────────────────────────────────────

-- Approved and pending leave of the caller's team (same manager, their reports, their manager): who and when only.
create function public.team_leave_calendar(p_org uuid, p_from date, p_to date)
returns table (employee_id uuid, name text, start_date date, end_date date, half_day_start boolean, half_day_end boolean, status public.leave_status)
language sql stable security definer set search_path = '' as $$
  with me as (select e.id, e.manager_employee_id from public.employees e
               where e.organization_id = p_org and e.user_id = auth.uid() and app.is_member(p_org)),
  team as (
    select e.id from public.employees e, me
     where e.organization_id = p_org and e.id <> me.id and e.status <> 'exited'
       and ((me.manager_employee_id is not null and e.manager_employee_id = me.manager_employee_id)
            or e.manager_employee_id = me.id or e.id = me.manager_employee_id))
  select r.employee_id, trim(concat_ws(' ', e.first_name, e.last_name)), r.start_date, r.end_date, r.half_day_start, r.half_day_end, r.status
    from public.leave_requests r
    join team t on t.id = r.employee_id
    join public.employees e on e.id = r.employee_id
   where r.organization_id = p_org and r.status in ('pending', 'approved') and r.start_date <= p_to and r.end_date >= p_from
     and p_to - p_from <= 92
   order by r.start_date;
$$;

-- ─── Skip-level approval ────────────────────────────────────────────────────

create or replace function app.current_approvers(p_request uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_req     public.approval_requests;
  v_step    public.approval_flow_steps;
  v_line    record;
  v_subject uuid;
begin
  select * into v_req from public.approval_requests where id = p_request;
  select * into v_step from public.approval_flow_steps where flow_id = v_req.flow_id and step_no = v_req.current_step;
  if v_req.id is null or v_req.status <> 'pending' or v_step.id is null then return; end if;
  select user_id into v_subject from public.employees where id = v_req.subject_employee_id;

  if v_step.approver_rule = 'reporting_manager' then
    select * into v_line from app.approval_line(p_request);
    -- The manager decides, unless there is none who can act (or they raised the request themselves).
    if v_line.manager_user is not null and v_line.manager_user <> v_req.requested_by then
      return next v_line.manager_user;
      return query select d from app.active_delegates(v_req.organization_id, v_line.manager_user) d
                    where d <> v_req.requested_by and d is distinct from v_subject;
      if v_req.escalated_at is null then return; end if;
      if v_line.skip_user is not null and v_line.skip_user <> v_req.requested_by and v_line.skip_user is distinct from v_subject then
        return next v_line.skip_user;
        return;
      end if;
    end if;
    if v_step.permission_key is null then return; end if;
  elsif v_step.approver_rule = 'skip_level_manager' then
    -- The manager's manager (and their delegates); without one, the step's permission holders.
    select * into v_line from app.approval_line(p_request);
    if v_line.skip_user is not null and v_line.skip_user <> v_req.requested_by and v_line.skip_user is distinct from v_subject then
      return next v_line.skip_user;
      return query select d from app.active_delegates(v_req.organization_id, v_line.skip_user) d
                    where d <> v_req.requested_by and d is distinct from v_subject;
      return;
    end if;
  end if;

  -- Org-wide holders of the step's permission.
  return query
    select distinct om.user_id
      from public.organization_members om
      join public.member_roles mr on mr.member_id = om.id and (mr.valid_until is null or mr.valid_until > now())
      join public.role_permissions rp on rp.role_id = mr.role_id and rp.permission_key = v_step.permission_key and rp.scope = 'org'
     where om.organization_id = v_req.organization_id and om.status = 'active'
       and om.user_id <> v_req.requested_by;
end $$;

create or replace function app.can_decide_approval(p_request uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_req  public.approval_requests;
  v_step public.approval_flow_steps;
begin
  select * into v_req from public.approval_requests where id = p_request;
  if v_req.id is null or v_req.status <> 'pending' or not app.is_member(v_req.organization_id) then return false; end if;
  -- Maker ≠ checker; nobody approves their own request or two steps of one request.
  if v_req.requested_by = auth.uid() then return false; end if;
  if exists (select 1 from public.employees e where e.id = v_req.subject_employee_id and e.user_id = auth.uid()) then return false; end if;
  if exists (select 1 from public.approval_actions a where a.request_id = p_request and a.actor_user_id = auth.uid() and a.decision = 'approve') then
    return false;
  end if;

  select * into v_step from public.approval_flow_steps where flow_id = v_req.flow_id and step_no = v_req.current_step;
  if v_step.approver_rule in ('reporting_manager', 'skip_level_manager') then
    return auth.uid() in (select app.current_approvers(p_request));
  end if;
  return app.has_permission(v_req.organization_id, v_step.permission_key)
      or (v_req.subject_employee_id is not null
          and app.can_access_employee(v_req.organization_id, v_req.subject_employee_id, v_step.permission_key));
end $$;

-- Adds or removes the "Manager's manager" step on an organization's active flow for a subject type.
create function app.set_skip_level(p_org uuid, p_subject_type text, p_enabled boolean, p_permission text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_flow uuid;
  v_step smallint;
  v_next uuid;
begin
  select id into v_flow from public.approval_flows where organization_id = p_org and subject_type = p_subject_type and is_active;
  if v_flow is null then return; end if;
  select step_no into v_step from public.approval_flow_steps where flow_id = v_flow and approver_rule = 'skip_level_manager';
  if p_enabled and v_step is null then
    insert into public.approval_flow_steps (organization_id, flow_id, step_no, approver_rule, permission_key, label)
    select p_org, v_flow, coalesce(max(step_no), 0) + 1, 'skip_level_manager', p_permission, 'Manager’s manager'
      from public.approval_flow_steps where flow_id = v_flow;
  elsif not p_enabled and v_step is not null then
    if exists (select 1 from public.approval_requests where flow_id = v_flow and status = 'pending' and current_step = v_step) then
      raise exception 'Some requests are waiting for the manager’s manager. Decide them before turning skip-level approval off.' using errcode = '22023';
    end if;
    delete from public.approval_flow_steps where flow_id = v_flow and step_no = v_step;
    -- One row at a time, lowest first, so step numbers never collide.
    for v_next in select id from public.approval_flow_steps where flow_id = v_flow and step_no > v_step order by step_no loop
      update public.approval_flow_steps set step_no = step_no - 1 where id = v_next;
    end loop;
  end if;
end $$;

create function app.leave_settings_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.skip_level_approval is distinct from old.skip_level_approval then
    perform app.set_skip_level(new.organization_id, 'leave_request', new.skip_level_approval, 'leave.approve');
  end if;
  return null;
end $$;
create trigger leave_settings_sync after insert or update on public.leave_settings for each row execute function app.leave_settings_sync();

create function app.attendance_settings_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.skip_level_approval is distinct from old.skip_level_approval then
    perform app.set_skip_level(new.organization_id, 'regularization', new.skip_level_approval, 'attendance.approve');
    perform app.set_skip_level(new.organization_id, 'attendance_request', new.skip_level_approval, 'attendance.approve');
  end if;
  return null;
end $$;
create trigger attendance_settings_sync after insert or update on public.attendance_settings for each row execute function app.attendance_settings_sync();
select app.set_skip_level(organization_id, 'regularization', true, 'attendance.approve'),
       app.set_skip_level(organization_id, 'attendance_request', true, 'attendance.approve')
  from public.attendance_settings where skip_level_approval;

-- ─── New organizations ──────────────────────────────────────────────────────

create function app.seed_org_leave_settings_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.leave_settings (organization_id) values (new.id) on conflict do nothing;
  return null;
end $$;
-- Fires after organizations_seed_flows (triggers fire in name order), so the flows exist.
create trigger organizations_seed_leave_settings after insert on public.organizations
  for each row execute function app.seed_org_leave_settings_trigger();

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function app.leave_types_defaults() from public;
revoke all on function app.leave_policies_defaults() from public;
revoke all on function app.leave_cycle_start(uuid, date) from public;
revoke all on function app.leave_policy_on(uuid, date) from public;
revoke all on function app.leave_type_applies(uuid, uuid, date) from public;
revoke all on function app.leave_buckets(uuid, uuid, date) from public;
revoke all on function app.process_leave(uuid) from public;
revoke all on function app.on_leave_encashment_decided(uuid, text) from public;
revoke all on function app.set_skip_level(uuid, text, boolean, text) from public;
revoke all on function app.leave_settings_sync() from public;
revoke all on function app.attendance_settings_sync() from public;
revoke all on function app.seed_org_leave_settings_trigger() from public;
revoke all on function public.recalculate_leave(uuid) from public, anon;
revoke all on function public.leave_balance_sheet(uuid, date, uuid) from public, anon;
revoke all on function public.set_leave_balance(uuid, uuid, numeric, numeric, numeric, text) from public, anon;
revoke all on function public.save_leave_rule(uuid, uuid, jsonb) from public, anon;
revoke all on function public.request_leave_encashment(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.donate_leave(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.team_leave_calendar(uuid, date, date) from public, anon;
grant execute on function app.leave_cycle_start(uuid, date) to authenticated, service_role;
grant execute on function app.leave_type_applies(uuid, uuid, date) to authenticated, service_role;
grant execute on function public.recalculate_leave(uuid) to authenticated, service_role;
grant execute on function public.leave_balance_sheet(uuid, date, uuid) to authenticated, service_role;
grant execute on function public.set_leave_balance(uuid, uuid, numeric, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.save_leave_rule(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.request_leave_encashment(uuid, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.donate_leave(uuid, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.team_leave_calendar(uuid, date, date) to authenticated, service_role;
