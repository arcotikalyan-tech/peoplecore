-- PeopleCore · Kredily second pass, batch 1: controls and payroll settings (docs/12-kredily-gap-list.md).
--
-- * Directory access: everyone, managers (people with reports or team/org employee access) or HR only; colleagues'
--   birthdays (day and month, never the year) and marital status can be shown in the directory.
-- * Company data changes: owners and HR can be told when the company profile, addresses or salary bank account change.
-- * Closing the company: an owner asks, typing the company name; 30 days later the worker closes the organization
--   (status archived, nobody can sign in to it). Payroll and statutory records are kept for their legal retention
--   period; erasure after that is a support request. The owner can cancel until the day.
-- * Payroll: pay-day basis (calendar days, working days with or without holidays, or a fixed 30), an attendance
--   and leave input cycle that can start on another day of the month, overtime pay at a multiple of the hourly
--   rate (optionally part of ESI and PT wages), a joiner cut-off day (later joiners are paid the next month as
--   joining arrears), show paise on payslips, and whether employees see their tax projection and computation.
-- * Payouts: a payment mode per payout (bank transfer, cheque, cash); only bank transfers go in the bank advice.
--   Statuses with a UTR per employee can be imported in bulk.

-- ─── Directory access ───────────────────────────────────────────────────────

alter table public.directory_settings
  add column access              text not null default 'everyone' check (access in ('everyone', 'managers', 'hr')),
  add column show_birthday       boolean not null default false,
  add column show_marital_status boolean not null default false;
grant update (access, show_birthday, show_marital_status) on public.directory_settings to authenticated;

-- May the caller browse the directory? HR (org-wide employee access) always; managers when access allows managers.
create function app.directory_allowed(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_member(p_org) and (
    exists (select 1 from app.permission_scopes(p_org, 'employee.read') s where s = 'org')
    or case coalesce((select access from public.directory_settings where organization_id = p_org), 'everyone')
         when 'everyone' then true
         when 'managers' then exists (select 1 from app.permission_scopes(p_org, 'employee.read') s where s = 'team')
                           or exists (select 1 from public.employees r join public.employees me on me.id = r.manager_employee_id
                                       where me.organization_id = p_org and me.user_id = auth.uid() and r.status in ('active', 'on_notice'))
         else false end);
$$;
revoke all on function app.directory_allowed(uuid) from public;
grant execute on function app.directory_allowed(uuid) to authenticated, service_role;

drop function public.people_directory(uuid, text, integer);
-- People outside the allowed audience see only themselves.
create function public.people_directory(p_org uuid, p_query text default null, p_limit integer default 500)
returns table (id uuid, name text, department text, designation text, location text, work_email text, work_phone text,
               tenure_years numeric, manager_id uuid, birthday text, marital_status text)
language sql stable security definer set search_path = '' as $$
  select e.id, concat_ws(' ', e.first_name, e.middle_name, e.last_name),
         case when s.show_department then d.name end,
         case when s.show_designation then g.title end,
         case when s.show_location then l.name end,
         case when s.show_email then e.work_email end,
         case when s.show_phone then e.work_phone end,
         round(greatest(0, app.org_today(p_org) - e.date_of_joining) / 365.25, 1),
         e.manager_employee_id,
         case when s.show_birthday and p.date_of_birth is not null then to_char(p.date_of_birth, 'FMDD Mon') end,
         case when s.show_marital_status then p.marital_status end
    from public.employees e
    join public.directory_settings s on s.organization_id = e.organization_id
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
    left join public.locations l on l.id = e.location_id
    left join public.employee_personal p on p.employee_id = e.id
   where app.is_member(p_org) and e.organization_id = p_org and e.status in ('active', 'on_notice')
     and (app.directory_allowed(p_org) or e.user_id = auth.uid())
     and (coalesce(btrim(p_query), '') = ''
          or lower(concat_ws(' ', e.first_name, e.middle_name, e.last_name, d.name, g.title)) like '%' || lower(btrim(p_query)) || '%')
   order by e.first_name, e.last_name
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;
revoke all on function public.people_directory(uuid, text, integer) from public, anon;
grant execute on function public.people_directory(uuid, text, integer) to authenticated, service_role;

-- ─── Notify admins when company data changes ────────────────────────────────

alter table public.org_controls add column notify_data_changes boolean not null default false;
grant update (notify_data_changes) on public.org_controls to authenticated;

-- One notice per organization every 10 minutes at most, to org.manage holders other than whoever made the change.
create function app.notify_company_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (to_jsonb(new) ->> case when tg_table_name = 'organizations' then 'id' else 'organization_id' end)::uuid;
  v_what text := case tg_table_name when 'organizations' then 'company details' when 'company_profiles' then 'the company profile'
                                    when 'company_addresses' then 'a company address' else 'the salary bank account' end;
begin
  if coalesce((select notify_data_changes from public.org_controls where organization_id = v_org), false)
     and not exists (select 1 from public.notifications n where n.organization_id = v_org and n.kind = 'company.changed'
                      and n.created_at > now() - interval '10 minutes') then
    perform app.notify_permission_holders(v_org, 'org.manage', 'company.changed', 'Someone changed ' || v_what, '/app/' ||
      (select slug from public.organizations where id = v_org) || '/company', auth.uid());
  end if;
  return null;
end $$;
revoke all on function app.notify_company_change() from public;
create trigger organizations_notify_change after update of name, timezone on public.organizations
  for each row when (old is distinct from new) execute function app.notify_company_change();
create trigger company_profiles_notify_change after insert or update on public.company_profiles for each row execute function app.notify_company_change();
create trigger company_addresses_notify_change after insert or update on public.company_addresses for each row execute function app.notify_company_change();
create trigger payroll_bank_settings_notify_change after update on public.payroll_bank_settings
  for each row when (old.account_number is distinct from new.account_number or old.ifsc is distinct from new.ifsc or old.bank_name is distinct from new.bank_name)
  execute function app.notify_company_change();

-- ─── Closing the company ────────────────────────────────────────────────────

alter table public.organizations
  add column closure_requested_at timestamptz,
  add column closure_requested_by uuid,
  add column closes_on            date;

create function public.request_org_closure(p_org uuid, p_confirm_name text) returns date
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org public.organizations;
  v_on  date;
begin
  select * into v_org from public.organizations where id = p_org for update;
  if v_org.id is null or not app.has_permission(p_org, 'role.manage') then
    raise exception 'Only owners can close the company.' using errcode = '42501';
  end if;
  if v_org.is_demo then raise exception 'The demo company can’t be closed.' using errcode = '22023'; end if;
  if btrim(coalesce(p_confirm_name, '')) <> v_org.name then
    raise exception 'Type the company name exactly as shown to confirm.' using errcode = '22023';
  end if;
  if v_org.closes_on is not null then return v_org.closes_on; end if;
  v_on := app.org_today(p_org) + 30;
  update public.organizations set closure_requested_at = now(), closure_requested_by = auth.uid(), closes_on = v_on where id = p_org;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  values (p_org, auth.uid(), 'update', 'organizations', p_org, jsonb_build_object('closes_on', v_on));
  perform app.notify_permission_holders(p_org, 'role.manage', 'company.closing',
    'The company is set to close on ' || to_char(v_on, 'FMDD Mon YYYY') || '. An owner can cancel until then.', '/app/' || v_org.slug || '/settings?tab=controls');
  return v_on;
end $$;

create function public.cancel_org_closure(p_org uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'role.manage') then
    raise exception 'Only owners can cancel closing the company.' using errcode = '42501';
  end if;
  update public.organizations set closure_requested_at = null, closure_requested_by = null, closes_on = null
   where id = p_org and closes_on is not null and status = 'active';
  if found then
    insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
    values (p_org, auth.uid(), 'update', 'organizations', p_org, jsonb_build_object('closes_on', null));
  end if;
end $$;

-- Worker: organizations whose closing day has come are archived (no one can open them).
create function public.worker_close_organizations() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.organizations set status = 'archived'
   where status = 'active' and closes_on is not null and closes_on <= app.org_today(id);
  get diagnostics v_n = row_count;
  return jsonb_build_object('closed', v_n);
end $$;

revoke all on function public.request_org_closure(uuid, text), public.cancel_org_closure(uuid) from public, anon;
grant execute on function public.request_org_closure(uuid, text), public.cancel_org_closure(uuid) to authenticated, service_role;
revoke all on function public.worker_close_organizations() from public, anon, authenticated;
grant execute on function public.worker_close_organizations() to service_role;

-- ─── Payroll settings ───────────────────────────────────────────────────────

alter table public.payroll_settings
  add column pay_days_basis        text not null default 'calendar' check (pay_days_basis in ('calendar', 'working', 'fixed_30')),
  add column holidays_paid         boolean not null default true,     -- with 'working': holidays count as pay days
  add column input_cycle_start_day smallint not null default 1 check (input_cycle_start_day between 1 and 28),
  add column joiner_cutoff_day     smallint check (joiner_cutoff_day between 1 and 31),  -- null: everyone joins this month's run
  add column overtime_multiplier   numeric(3,2) check (overtime_multiplier between 1 and 3), -- null: approved overtime isn't paid
  add column overtime_in_esi       boolean not null default false,
  add column payslip_show_paise    boolean not null default true,      -- payslips have always shown paise
  add column show_tax_projection   boolean not null default true,
  add column show_tax_computation  boolean not null default true;
grant update (pay_days_basis, holidays_paid, input_cycle_start_day, joiner_cutoff_day, overtime_multiplier, overtime_in_esi,
              payslip_show_paise, show_tax_projection, show_tax_computation) on public.payroll_settings to authenticated;

-- A pay day for the employee under the organization's basis: not a weekly off, and (unless holidays are paid) not a holiday.
create function app.is_pay_day(p_employee uuid, p_date date, p_holidays_paid boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_week text[] := app.work_week_for(p_employee, p_date);
  v_cal  uuid := app.employee_calendar(p_employee);
  v_off  boolean;
begin
  if v_week is not null then
    v_off := substr(v_week[least(5, (extract(day from p_date)::int - 1) / 7 + 1)], extract(isodow from p_date)::int, 1) = 'O';
  else
    select coalesce(extract(dow from p_date)::smallint = any (weekly_offs), false) into v_off from public.holiday_calendars where id = v_cal;
  end if;
  if coalesce(v_off, false) then return false; end if;
  return p_holidays_paid or not exists (select 1 from public.holidays where calendar_id = v_cal and holiday_date = p_date and not is_optional);
end $$;
revoke all on function app.is_pay_day(uuid, date, boolean) from public;

-- The engine inputs so far become the base; this layer applies the organization's pay-day basis, input cycle,
-- overtime pay and joiner cut-off. With the defaults it returns the base unchanged.
alter function public.payroll_run_inputs(uuid) set schema app;
alter function app.payroll_run_inputs(uuid) rename to payroll_run_inputs_v2;
revoke all on function app.payroll_run_inputs_v2(uuid) from public, anon, authenticated;

create function public.payroll_run_inputs(p_run uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base    jsonb := app.payroll_run_inputs_v2(p_run);
  v_run     public.payroll_runs;
  v_set     public.payroll_settings;
  v_start   date;
  v_end     date;
  v_cal     int;
  v_from    date;
  v_to      date;
  v_out     jsonb := '[]'::jsonb;
  v_e       jsonb;
  v_emp     public.employees;
  v_days    numeric;
  v_gone    numeric;
  v_att     numeric;
  v_pen     numeric;
  v_gross   numeric;
  v_ot      numeric;
  v_prev_s  date;
  v_prev_e  date;
  v_prev_d  numeric;
  v_worked  numeric;
  v_adj     jsonb;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  select * into v_set from public.payroll_settings where organization_id = v_run.organization_id;
  if v_set.organization_id is null
     or (v_set.pay_days_basis = 'calendar' and v_set.input_cycle_start_day = 1 and v_set.joiner_cutoff_day is null and v_set.overtime_multiplier is null) then
    return v_base;
  end if;
  v_start := v_run.period_month;
  v_end := (v_start + interval '1 month - 1 day')::date;
  v_cal := v_end - v_start + 1;
  -- Attendance and leave inputs: from day N of the previous month to day N-1 of this one (N = 1: the month itself).
  v_from := case when v_set.input_cycle_start_day = 1 then v_start else (v_start - interval '1 month')::date + v_set.input_cycle_start_day - 1 end;
  v_to := case when v_set.input_cycle_start_day = 1 then v_end else v_start + v_set.input_cycle_start_day - 2 end;
  v_prev_s := (v_start - interval '1 month')::date;
  v_prev_e := v_start - 1;

  for v_e in select * from jsonb_array_elements(v_base -> 'employees') loop
    select * into v_emp from public.employees where id = (v_e ->> 'employeeId')::uuid;
    -- Joined after the cut-off: paid from next month's run.
    if v_set.joiner_cutoff_day is not null and v_emp.date_of_joining between v_start and v_end
       and extract(day from v_emp.date_of_joining) > v_set.joiner_cutoff_day then
      continue;
    end if;
    v_gross := coalesce((select sum((c ->> 'monthly')::numeric) from jsonb_array_elements(v_e -> 'components') c where c ->> 'kind' = 'earning'), 0);

    -- Pay days in the month and those before joining / after leaving, under the basis.
    if v_set.pay_days_basis = 'working' then
      select count(*) filter (where app.is_pay_day(v_emp.id, d::date, v_set.holidays_paid)),
             count(*) filter (where app.is_pay_day(v_emp.id, d::date, v_set.holidays_paid)
                                and (d::date < v_emp.date_of_joining or (v_emp.date_of_exit is not null and d::date > v_emp.date_of_exit)))
        into v_days, v_gone
        from generate_series(v_start, v_end, interval '1 day') d;
    else
      v_gone := greatest(0, v_emp.date_of_joining - v_start)
                + case when v_emp.date_of_exit is not null and v_emp.date_of_exit < v_end then v_end - v_emp.date_of_exit else 0 end;
      v_days := v_cal;
      if v_set.pay_days_basis = 'fixed_30' then v_days := 30; v_gone := round(v_gone * 30.0 / v_cal, 1); end if;
    end if;
    -- Unpaid leave (and absences when the run counts them) in the input cycle; penalty days as before.
    select coalesce(sum(a.leave_days) filter (where a.leave_paid = false), 0)
           + case when v_run.lop_from_absence then coalesce(sum(case when a.status = 'absent' then 1
                     when a.status = 'half_day' and coalesce(a.leave_paid, false) = false and a.leave_days = 0 then 0.5 else 0 end), 0) else 0 end
      into v_att from public.attendance_days a where a.employee_id = v_emp.id and a.work_date between v_from and v_to;
    v_pen := coalesce((v_e ->> 'penaltyDays')::numeric, 0);
    v_e := v_e || jsonb_build_object('daysInPeriod', v_days, 'payableDays',
      case when v_e ->> 'lopOverride' is not null then greatest(0, v_days - (v_e ->> 'lopOverride')::numeric)
           else least(v_days, greatest(0, v_days - v_gone - v_att - v_pen)) end);

    v_adj := coalesce(v_e -> 'adjustments', '[]'::jsonb);
    -- Approved overtime in the input cycle, at the multiple of the hourly rate (monthly earnings ÷ pay days ÷ 8 hours).
    if v_set.overtime_multiplier is not null and v_days > 0 then
      select coalesce(sum(o.minutes), 0) into v_ot from public.overtime_records o
       where o.employee_id = v_emp.id and o.status = 'approved' and o.work_date between v_from and v_to;
      if v_ot > 0 and v_gross > 0 then
        v_adj := v_adj || jsonb_build_array(jsonb_build_object('code', 'OT', 'name', 'Overtime (' || round(v_ot / 60.0, 1) || ' h)', 'kind', 'earning',
          'amount', round(v_gross / v_days / 8 * (v_ot / 60.0) * v_set.overtime_multiplier), 'taxable', true, 'esiWage', v_set.overtime_in_esi));
      end if;
    end if;
    -- Joined last month after the cut-off: last month's days are paid now as joining arrears.
    if v_set.joiner_cutoff_day is not null and v_emp.date_of_joining between v_prev_s and v_prev_e
       and extract(day from v_emp.date_of_joining) > v_set.joiner_cutoff_day and v_gross > 0 then
      v_prev_d := v_prev_e - v_prev_s + 1;
      v_worked := v_prev_e - v_emp.date_of_joining + 1;
      v_adj := v_adj || jsonb_build_array(jsonb_build_object('code', 'JOIN_ARREARS', 'name', 'Joining arrears (' || v_worked || ' days)', 'kind', 'earning',
        'amount', round(v_gross * v_worked / v_prev_d), 'taxable', true));
    end if;
    v_out := v_out || jsonb_build_array(v_e || jsonb_build_object('adjustments', v_adj));
  end loop;
  return jsonb_set(v_base, '{employees}', v_out);
end $$;
revoke all on function public.payroll_run_inputs(uuid) from public, anon;
grant execute on function public.payroll_run_inputs(uuid) to authenticated, service_role;

-- ESI wages in the statutory rows leave out overtime that isn't an ESI wage, and joining arrears.
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
           round(coalesce(sum(li.amount) filter (where li.code = 'PF'), 0) / 0.12),
           coalesce(sum(li.amount) filter (where li.code = 'PF'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'EPS_ER'), 0),
           coalesce(sum(li.amount) filter (where li.code = 'EPF_ER'), 0),
           case when bool_or(li.code = 'ESI') then re.gross - coalesce(sum(li.amount) filter (where li.kind = 'earning' and
             (li.code in ('REIMB', 'ARREAR', 'BONUS', 'LEAVE_ENC', 'JOIN_ARREARS')
              or (li.code = 'OT' and not coalesce(re.input -> 'adjustments' @> '[{"code": "OT", "esiWage": true}]'::jsonb, false)))), 0) else 0 end,
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

-- ─── Payout modes and bulk status import ────────────────────────────────────

create type public.payout_mode as enum ('bank_transfer', 'cheque', 'cash');
alter table public.payroll_payouts add column mode public.payout_mode not null default 'bank_transfer';

create function public.set_payout_mode(p_run uuid, p_employees uuid[], p_mode public.payout_mode) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.payroll_runs;
  v_n   integer;
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.has_permission(v_run.organization_id, 'payroll.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.payroll_payouts set mode = p_mode, updated_by = auth.uid()
   where run_id = p_run and employee_id = any (p_employees) and status <> 'paid';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Rows: [{code, status, reference, paid_on, note}] by employee code. Unknown codes and paid payouts are skipped;
-- returns how many were updated and the codes that were skipped.
create function public.import_payout_statuses(p_run uuid, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run     public.payroll_runs;
  r         jsonb;
  v_emp     uuid;
  v_status  public.payout_status;
  v_paid_on date;
  v_n       integer := 0;
  v_skipped text[] := '{}';
begin
  select * into v_run from public.payroll_runs where id = p_run;
  if v_run.id is null or not app.has_permission(v_run.organization_id, 'payroll.approve') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Upload at most 5,000 rows.' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select e.id into v_emp from public.employees e where e.organization_id = v_run.organization_id and e.employee_code = btrim(r ->> 'code');
    begin
      v_status := lower(btrim(r ->> 'status'))::public.payout_status;
    exception when invalid_text_representation then v_status := null;
    end;
    v_paid_on := case when coalesce(btrim(r ->> 'paid_on'), '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'paid_on')::date end;
    if v_emp is null or v_status is null or (v_status = 'paid' and v_paid_on is null)
       or (v_status = 'on_hold' and coalesce(btrim(r ->> 'note'), '') = '') then
      v_skipped := v_skipped || coalesce(r ->> 'code', '?');
      continue;
    end if;
    update public.payroll_payouts set status = v_status, reference = nullif(left(btrim(r ->> 'reference'), 60), ''),
           paid_on = case when v_status = 'paid' then v_paid_on end, note = nullif(left(btrim(r ->> 'note'), 300), ''), updated_by = auth.uid()
     where run_id = p_run and employee_id = v_emp and status <> 'paid';
    if found then v_n := v_n + 1; else v_skipped := v_skipped || (r ->> 'code'); end if;
  end loop;
  return jsonb_build_object('updated', v_n, 'skipped', to_jsonb(v_skipped));
end $$;

-- Bank advice: bank transfers only.
create or replace function public.payroll_bank_advice(p_run uuid)
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
     where po.run_id = p_run and po.status in ('pending', 'failed') and po.mode = 'bank_transfer'
     order by e.employee_code;
end $$;

alter table public.payroll_bank_settings drop constraint payroll_bank_settings_file_format_check;
alter table public.payroll_bank_settings add constraint payroll_bank_settings_file_format_check
  check (file_format in ('generic', 'hdfc', 'icici', 'sbi', 'axis', 'bob'));

revoke all on function public.set_payout_mode(uuid, uuid[], public.payout_mode), public.import_payout_statuses(uuid, jsonb) from public, anon;
grant execute on function public.set_payout_mode(uuid, uuid[], public.payout_mode), public.import_payout_statuses(uuid, jsonb) to authenticated, service_role;
