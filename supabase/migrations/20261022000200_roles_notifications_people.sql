-- PeopleCore · Kredily second pass, batch 3: roles, notifications and people (docs/12-kredily-gap-list.md).
--
-- * Standard roles: HR executive (people operations without payroll), Finance administrator (approves payroll, sees
--   salaries and bank details, pays expenses and vendors), Partner (an external partner such as a CA firm, read-only)
--   and Attendance device admin (biometric devices and their punches, through the new attendance.device.manage).
--   "Payroll / finance administrator" becomes "Payroll administrator" (the maker; finance approves).
-- * Email notifications per event and role: attendance regularization, leave and expense applications, birthdays and
--   work anniversaries, to owners, HR administrators, HR executives, finance or payroll administrators and the
--   person's own manager, as each organization chooses (all off until switched on). Emails wait in an outbox that the
--   worker sends over SMTP; unsent ones expire after two days.
-- * Company proofs: PAN, TAN, CIN, GST, incorporation, PF and ESI certificates, kept in a private bucket (org.manage
--   uploads; auditors read).
-- * Profiles: the A1/A2 blood groups and previous work experience (months before joining).
-- * Leave: Event leave is a standard type for new organizations; HR can nudge people with unused leave (once a week)
--   and see what the leave-year close will carry forward and lapse.

-- ─── Roles ──────────────────────────────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('attendance.device.manage', 'attendance', 'Register biometric devices and import their punches', false);

insert into app.role_templates (role_key, name, description, assignment_permission, requires_mfa) values
  ('hr_executive', 'HR executive', 'People operations without payroll: employee records, onboarding, attendance and leave', 'role.manage', true),
  ('finance_admin', 'Finance administrator', 'Approves payroll, sees salaries and bank details, approves expenses and pays vendors', 'role.manage', true),
  ('partner', 'Partner (read-only)', 'An external partner such as a CA firm: reads employee profiles, IDs and salaries', 'role.manage', true),
  ('attendance_device_admin', 'Attendance device admin', 'Sets up biometric devices and imports their punches', 'role.manage', true);
update app.role_templates set name = 'Payroll administrator' where role_key = 'payroll_admin';
update public.roles set name = 'Payroll administrator' where key = 'payroll_admin' and is_system and name = 'Payroll / finance administrator';

insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'attendance.device.manage', 'org'), ('hr_admin', 'attendance.device.manage', 'org'),
  ('hr_executive', 'org.read', 'org'), ('hr_executive', 'employee.read', 'org'), ('hr_executive', 'employee.create', 'org'),
  ('hr_executive', 'employee.update', 'org'), ('hr_executive', 'onboarding.manage', 'org'), ('hr_executive', 'attendance.read', 'org'),
  ('hr_executive', 'leave.read', 'org'), ('hr_executive', 'ai.use', 'org'),
  ('finance_admin', 'org.read', 'org'), ('finance_admin', 'employee.read', 'org'), ('finance_admin', 'employee.identity.read', 'org'),
  ('finance_admin', 'employee.bank.read', 'org'), ('finance_admin', 'compensation.read', 'org'), ('finance_admin', 'payroll.approve', 'org'),
  ('finance_admin', 'expense.approve', 'org'), ('finance_admin', 'expense.manage', 'org'), ('finance_admin', 'vendor.manage', 'org'),
  ('finance_admin', 'statutory.manage', 'org'), ('finance_admin', 'ai.use', 'org'),
  ('partner', 'org.read', 'org'), ('partner', 'employee.read', 'org'), ('partner', 'employee.identity.read', 'org'), ('partner', 'compensation.read', 'org'),
  ('attendance_device_admin', 'org.read', 'org'), ('attendance_device_admin', 'employee.read', 'org'),
  ('attendance_device_admin', 'attendance.read', 'org'), ('attendance_device_admin', 'attendance.device.manage', 'org');

-- Existing organizations get the new roles and grants (new ones get them from the templates).
insert into public.roles (organization_id, key, name, description, is_system, assignment_permission, requires_mfa)
select o.id, t.role_key, t.name, t.description, true, t.assignment_permission, t.requires_mfa
  from public.organizations o cross join app.role_templates t
 where t.role_key in ('hr_executive', 'finance_admin', 'partner', 'attendance_device_admin')
on conflict (organization_id, key) do nothing;
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.role_key in ('hr_executive', 'finance_admin', 'partner', 'attendance_device_admin') or t.permission_key = 'attendance.device.manage'
on conflict (role_id, permission_key) do nothing;

-- Device admins register devices and import their punches (attendance admins still can).
alter policy biometric_devices_write on public.biometric_devices
  using (organization_id in (select app.orgs_with_scope('attendance.manage', 'org'))
         or organization_id in (select app.orgs_with_scope('attendance.device.manage', 'org')))
  with check (organization_id in (select app.orgs_with_scope('attendance.manage', 'org'))
              or organization_id in (select app.orgs_with_scope('attendance.device.manage', 'org')));

create or replace function public.import_device_punches(p_device uuid, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_dev      public.biometric_devices;
  v_row      jsonb;
  v_emp      uuid;
  v_inserted int := 0;
  v_skipped  int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_id       uuid;
  v_tz       text;
  v_at       timestamptz;
begin
  select * into v_dev from public.biometric_devices where id = p_device;
  if v_dev.id is null or not (app.has_permission(v_dev.organization_id, 'attendance.manage')
                              or app.has_permission(v_dev.organization_id, 'attendance.device.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'Import at most 20,000 records at a time.' using errcode = '22023';
  end if;
  select timezone into v_tz from public.organizations where id = v_dev.organization_id;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    select id into v_emp from public.employees where organization_id = v_dev.organization_id and employee_code = v_row ->> 'employee_code';
    if v_emp is null then
      v_errors := v_errors || jsonb_build_object('line', v_row -> 'line', 'message', format('Unknown employee code “%s”.', v_row ->> 'employee_code'));
      continue;
    end if;
    begin
      -- Devices export local wall-clock times: without an explicit offset, read them in the org's time zone.
      v_at := case when (v_row ->> 'punched_at') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
                   then (v_row ->> 'punched_at')::timestamptz
                   else (v_row ->> 'punched_at')::timestamp at time zone v_tz end;
      insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key, device_id)
      values (v_dev.organization_id, v_emp, v_at, 'biometric',
              'device:' || v_dev.serial_number || ':' || (v_row ->> 'record_id'), v_dev.id)
      on conflict (organization_id, source_key) do nothing
      returning id into v_id;
      if v_id is null then v_skipped := v_skipped + 1; else v_inserted := v_inserted + 1; end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('line', v_row -> 'line', 'message', 'Invalid date or record.');
    end;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_skipped, 'errors', v_errors);
end $$;

-- ─── Email notifications ────────────────────────────────────────────────────

-- Which events email which audience (a standard role's holders, or the person's own manager).
create table public.notification_email_rules (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  event            text not null check (event in ('regularization', 'leave', 'expense', 'birthday', 'anniversary')),
  audience         text not null check (audience in ('owner', 'hr_admin', 'hr_executive', 'finance_admin', 'payroll_admin', 'line_manager')),
  enabled          boolean not null default true,
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  primary key (organization_id, event, audience)
);
create trigger notification_email_rules_audit after insert or update or delete on public.notification_email_rules
  for each row execute function app.audit_row();

-- Emails waiting for the worker (and what became of them). Admins see the delivery log; only functions write.
create table public.email_outbox (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete set null,
  to_email         text not null check (to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  event            text not null check (event ~ '^[a-z_]{2,40}$'),
  subject          text not null check (char_length(subject) between 1 and 200),
  body             text not null check (char_length(body) between 1 and 4000),
  link             text check (link ~ '^/[A-Za-z0-9/_?=&%.-]*$'),
  status           text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'expired')),
  attempts         smallint not null default 0,
  claimed_at       timestamptz,
  last_error       text check (char_length(last_error) <= 500),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index email_outbox_queue_idx on public.email_outbox (created_at) where status in ('queued', 'sending');
create index email_outbox_org_idx on public.email_outbox (organization_id, created_at desc);

alter table public.notification_email_rules enable row level security;
alter table public.email_outbox enable row level security;
create policy notification_email_rules_select on public.notification_email_rules for select to authenticated
  using (organization_id in (select app.orgs_with_scope('org.manage', 'org')));
create policy notification_email_rules_write on public.notification_email_rules for all to authenticated
  using (organization_id in (select app.orgs_with_scope('org.manage', 'org')))
  with check (organization_id in (select app.orgs_with_scope('org.manage', 'org')));
create policy email_outbox_select on public.email_outbox for select to authenticated
  using (organization_id in (select app.orgs_with_scope('org.manage', 'org')));
grant select, insert, update, delete on public.notification_email_rules to authenticated;
grant select on public.email_outbox to authenticated;
grant all on public.notification_email_rules, public.email_outbox to service_role;

-- Queues one email per person in the event's audiences; never to the person the event is about.
create function app.queue_role_emails(p_org uuid, p_event text, p_employee uuid, p_subject text, p_body text, p_link text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  insert into public.email_outbox (organization_id, user_id, to_email, event, subject, body, link)
  select p_org, u.id, u.email, p_event, left(p_subject, 200), left(p_body, 4000), p_link
    from (
      select om.user_id
        from public.notification_email_rules r
        join public.roles ro on ro.organization_id = r.organization_id and ro.key = r.audience and ro.is_system
        join public.member_roles mr on mr.role_id = ro.id and (mr.valid_until is null or mr.valid_until > now())
        join public.organization_members om on om.id = mr.member_id and om.status = 'active'
       where r.organization_id = p_org and r.event = p_event and r.enabled and r.audience <> 'line_manager'
      union
      select m.user_id
        from public.notification_email_rules r
        join public.employees e on e.id = p_employee
        join public.employees m on m.id = e.manager_employee_id
       where r.organization_id = p_org and r.event = p_event and r.enabled and r.audience = 'line_manager' and m.user_id is not null
    ) x
    join auth.users u on u.id = x.user_id
   where u.email is not null
     and not exists (select 1 from public.employees me where me.id = p_employee and me.user_id = x.user_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function app.queue_role_emails(uuid, text, uuid, text, text, text) from public;

create function app.person_name(p_employee uuid) returns text
language sql stable security definer set search_path = '' as $$
  select trim(concat_ws(' ', first_name, last_name)) from public.employees where id = p_employee;
$$;
revoke all on function app.person_name(uuid) from public;

-- Emails are a side effect: a problem queueing one never blocks the request itself.
create function app.email_on_regularization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform app.queue_role_emails(new.organization_id, 'regularization', new.employee_id,
      format('Regularization request: %s, %s', app.person_name(new.employee_id), to_char(new.work_date, 'FMDD Mon YYYY')),
      format('%s asked to correct their attendance for %s (%s). Reason: %s', app.person_name(new.employee_id), to_char(new.work_date, 'FMDD Mon YYYY'),
             concat_ws(' – ', to_char(new.check_in, 'HH24:MI'), to_char(new.check_out, 'HH24:MI')), new.reason),
      '/attendance?tab=approvals');
  exception when others then null;
  end;
  return null;
end $$;
create trigger regularization_requests_email after insert on public.regularization_requests
  for each row execute function app.email_on_regularization();

create function app.email_on_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
begin
  begin
    select name into v_type from public.leave_types where id = new.leave_type_id;
    perform app.queue_role_emails(new.organization_id, 'leave', new.employee_id,
      format('Leave application: %s, %s day%s of %s', app.person_name(new.employee_id), trim_scale(new.days), case when new.days = 1 then '' else 's' end, v_type),
      format('%s applied for %s from %s to %s (%s day%s).%s', app.person_name(new.employee_id), v_type, to_char(new.start_date, 'FMDD Mon YYYY'),
             to_char(new.end_date, 'FMDD Mon YYYY'), trim_scale(new.days), case when new.days = 1 then '' else 's' end,
             case when nullif(btrim(new.reason), '') is not null then ' Reason: ' || new.reason else '' end),
      '/leave');
  exception when others then null;
  end;
  return null;
end $$;
create trigger leave_requests_email after insert on public.leave_requests
  for each row when (new.status = 'pending') execute function app.email_on_leave();

create function app.email_on_expense() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform app.queue_role_emails(new.organization_id, 'expense', new.employee_id,
      format('Expense claim: %s, ₹%s', app.person_name(new.employee_id), to_char(new.total, 'FM999999999990.00')),
      format('%s submitted the expense claim “%s” for ₹%s.', app.person_name(new.employee_id), new.title, to_char(new.total, 'FM999999999990.00')),
      '/expenses');
  exception when others then null;
  end;
  return null;
end $$;
create trigger expense_claims_email after insert on public.expense_claims
  for each row when (new.status = 'pending') execute function app.email_on_expense();
create trigger expense_claims_email_submitted after update of status on public.expense_claims
  for each row when (new.status = 'pending' and old.status is distinct from new.status) execute function app.email_on_expense();

-- Once a day per organization (from 9 am local time): birthdays and work anniversaries to the chosen audiences.
create table app.celebration_runs (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  run_date         date not null,
  primary key (organization_id, run_date)
);
alter table app.celebration_runs enable row level security;  -- only the worker's function touches it

create function public.worker_celebration_emails(p_now timestamptz default now()) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  o       record;
  e       record;
  v_local timestamp;
  v_today date;
  v_leap  boolean;
  v_years int;
  v_birth int := 0;
  v_anniv int := 0;
begin
  for o in select org.id, org.name, org.timezone from public.organizations org
            where org.status = 'active'
              and exists (select 1 from public.notification_email_rules r where r.organization_id = org.id and r.enabled and r.event in ('birthday', 'anniversary')) loop
    v_local := p_now at time zone o.timezone;
    v_today := v_local::date;
    continue when extract(hour from v_local) < 9;
    insert into app.celebration_runs (organization_id, run_date) values (o.id, v_today) on conflict do nothing;
    continue when not found;
    -- In a year without 29 February, those birthdays are marked on the 28th.
    v_leap := extract(day from (make_date(extract(year from v_today)::int, 3, 1) - 1)) = 29;
    for e in select emp.id from public.employees emp join public.employee_personal p on p.employee_id = emp.id
              where emp.organization_id = o.id and emp.status in ('active', 'on_notice') and p.date_of_birth is not null
                and (to_char(p.date_of_birth, 'MM-DD') = to_char(v_today, 'MM-DD')
                     or (not v_leap and to_char(v_today, 'MM-DD') = '02-28' and to_char(p.date_of_birth, 'MM-DD') = '02-29')) loop
      v_birth := v_birth + app.queue_role_emails(o.id, 'birthday', e.id, format('🎂 Today is %s’s birthday', app.person_name(e.id)),
        format('%s has a birthday today. A good day to wish them well.', app.person_name(e.id)), '/employees/' || e.id);
    end loop;
    for e in select emp.id, emp.date_of_joining from public.employees emp
              where emp.organization_id = o.id and emp.status in ('active', 'on_notice') and emp.date_of_joining < v_today
                and to_char(emp.date_of_joining, 'MM-DD') = to_char(v_today, 'MM-DD') loop
      v_years := extract(year from age(v_today, e.date_of_joining))::int;
      continue when v_years < 1;
      v_anniv := v_anniv + app.queue_role_emails(o.id, 'anniversary', e.id,
        format('🎉 %s completes %s year%s at %s today', app.person_name(e.id), v_years, case when v_years = 1 then '' else 's' end, o.name),
        format('%s joined %s on %s: %s year%s today.', app.person_name(e.id), o.name, to_char(e.date_of_joining, 'FMDD Mon YYYY'), v_years,
               case when v_years = 1 then '' else 's' end), '/employees/' || e.id);
    end loop;
  end loop;
  return jsonb_build_object('birthday_emails', v_birth, 'anniversary_emails', v_anniv);
end $$;

-- The worker takes a batch to send (unsent mail older than two days expires; a send cut off mid-way is retried).
create function public.worker_claim_emails(p_limit integer default 25)
returns table (id uuid, to_email text, subject text, body text, link text, org_slug text, org_name text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.email_outbox x set status = 'expired' where x.status = 'queued' and x.created_at < now() - interval '2 days';
  update public.email_outbox x set status = 'queued' where x.status = 'sending' and x.claimed_at < now() - interval '15 minutes';
  return query
    with picked as (
      select x.id from public.email_outbox x where x.status = 'queued' order by x.created_at
       limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked),
    claimed as (
      update public.email_outbox x set status = 'sending', attempts = x.attempts + 1, claimed_at = now()
        from picked where x.id = picked.id
      returning x.id, x.to_email, x.subject, x.body, x.link, x.organization_id)
    select c.id, c.to_email, c.subject, c.body, c.link, o.slug, o.name
      from claimed c join public.organizations o on o.id = c.organization_id;
end $$;

create function public.worker_email_result(p_id uuid, p_ok boolean, p_error text default null) returns void
language sql volatile security definer set search_path = '' as $$
  update public.email_outbox
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end, last_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id and status = 'sending';
$$;

-- ─── Company proofs ─────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-documents', 'company-documents', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create table public.company_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  kind             text not null check (kind in ('pan', 'tan', 'cin', 'gst', 'incorporation', 'pf', 'esi', 'other')),
  file_name        text not null check (char_length(file_name) between 1 and 200),
  storage_path     text not null check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  content_type     text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes       integer not null check (size_bytes between 1 and 5242880),
  uploaded_by      uuid default auth.uid(),
  uploaded_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (storage_path),
  check (split_part(storage_path, '/', 1) = organization_id::text)
);
create trigger company_documents_audit after insert or delete on public.company_documents for each row execute function app.audit_row();
alter table public.company_documents enable row level security;
create policy company_documents_select on public.company_documents for select to authenticated
  using (organization_id in (select app.orgs_with_scope('org.manage', 'org')) or organization_id in (select app.orgs_with_scope('audit.read', 'org')));
create policy company_documents_insert on public.company_documents for insert to authenticated
  with check (organization_id in (select app.orgs_with_scope('org.manage', 'org')));
create policy company_documents_delete on public.company_documents for delete to authenticated
  using (organization_id in (select app.orgs_with_scope('org.manage', 'org')));
grant select, insert, delete on public.company_documents to authenticated;
grant all on public.company_documents to service_role;

-- ─── Profiles ───────────────────────────────────────────────────────────────

alter table public.employee_personal drop constraint employee_personal_blood_group_check;
alter table public.employee_personal add constraint employee_personal_blood_group_check
  check (blood_group in ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'A1+', 'A1-', 'A2+', 'A2-', 'A1B+', 'A1B-', 'A2B+', 'A2B-'));

-- Work experience before joining, in months (Kredily's years + months).
alter table public.employees add column prior_experience_months smallint check (prior_experience_months between 0 and 720);

-- ─── Leave ──────────────────────────────────────────────────────────────────

-- New organizations also start with Event leave (3 days a year, credited at the start of the leave year).
create or replace function app.seed_org_leave(p_org uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_type uuid;
begin
  insert into public.holiday_calendars (organization_id, name) values (p_org, 'Default calendar') on conflict do nothing;
  if exists (select 1 from public.leave_types where organization_id = p_org) then return; end if;

  insert into public.leave_types (organization_id, code, name) values (p_org, 'CL', 'Casual leave') returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max)
  values (p_org, v_type, '2000-01-01', 'monthly', 1, 0);

  insert into public.leave_types (organization_id, code, name) values (p_org, 'SL', 'Sick leave') returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max)
  values (p_org, v_type, '2000-01-01', 'monthly', 1, 0);

  insert into public.leave_types (organization_id, code, name, allow_half_day) values (p_org, 'EL', 'Earned leave', false) returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max, accrue_during_probation)
  values (p_org, v_type, '2000-01-01', 'monthly', 1.25, 30, false);

  insert into public.leave_types (organization_id, code, name, category, description) values
    (p_org, 'EVL', 'Event leave', 'event', 'For personal occasions such as a wedding or a bereavement in the family.') returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max, annual_days)
  values (p_org, v_type, '2000-01-01', 'yearly', 3, 0, 3);

  insert into public.leave_types (organization_id, code, name, is_paid, allow_negative) values (p_org, 'LOP', 'Leave without pay', false, true) returning id into v_type;
  insert into public.leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days)
  values (p_org, v_type, '2000-01-01', 'none', 0);
end $$;

alter table public.leave_settings add column last_nudged_at timestamptz;

-- Tells people with unused paid leave (at least 5 days left and under a quarter of it used this leave year) to plan
-- time off. At most once a week per organization; returns how many were told.
create function public.nudge_leave(p_org uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cycle date;
  v_last  timestamptz;
  v_n     integer := 0;
  r       record;
begin
  if p_org not in (select app.orgs_with_scope('leave.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select last_nudged_at into v_last from public.leave_settings where organization_id = p_org;
  if v_last > now() - interval '7 days' then
    raise exception 'People were nudged on %. Nudge again after a week.', to_char(v_last at time zone (select timezone from public.organizations where id = p_org), 'FMDD Mon')
      using errcode = '22023';
  end if;
  v_cycle := app.leave_cycle_start(p_org, app.org_today(p_org));
  for r in
    select e.user_id, sum(b.balance) as available, sum(b.used) as used
      from public.employees e
      cross join lateral (
        select coalesce(sum(l.days), 0) as balance,
               -coalesce(sum(l.days) filter (where l.kind in ('debit', 'reversal') and l.entry_date >= v_cycle), 0) as used
          from public.leave_ledger l join public.leave_types t on t.id = l.leave_type_id and t.is_paid and t.is_active
         where l.employee_id = e.id) b
     where e.organization_id = p_org and e.status in ('active', 'on_notice') and e.user_id is not null
     group by e.user_id
    having sum(b.balance) >= 5 and sum(b.used) < 0.25 * (sum(b.used) + sum(b.balance))
  loop
    perform app.notify(p_org, r.user_id, 'leave.nudge', format('You have %s days of leave to use', trim_scale(round(r.available, 1))),
                       'Plan some time off: apply for leave whenever suits you and your team.', '/leave');
    v_n := v_n + 1;
  end loop;
  insert into public.leave_settings (organization_id, last_nudged_at) values (p_org, now())
  on conflict (organization_id) do update set last_nudged_at = now();
  return v_n;
end $$;

-- What closing the current leave year would carry forward and lapse, per leave type, as balances stand today.
create function public.leave_year_end_preview(p_org uuid)
returns table (leave_type_id uuid, name text, people integer, balance numeric, carry numeric, lapse numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
begin
  if p_org not in (select app.orgs_with_scope('leave.manage', 'org')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_today := app.org_today(p_org);
  return query
    with b as (
      select t.id, t.name, e.id as employee_id, coalesce(sum(l.days), 0) as balance, (app.leave_policy_on(t.id, v_today)).carry_forward_max as cap
        from public.leave_types t
        join public.employees e on e.organization_id = t.organization_id and e.status in ('active', 'on_notice')
        left join public.leave_ledger l on l.employee_id = e.id and l.leave_type_id = t.id
       where t.organization_id = p_org and t.is_active and t.is_paid
       group by t.id, t.name, e.id)
    select b.id, b.name, count(*) filter (where b.balance > 0)::int, sum(greatest(b.balance, 0)),
           sum(case when b.cap is null then greatest(b.balance, 0) else least(greatest(b.balance, 0), b.cap) end),
           sum(case when b.cap is null then 0 else greatest(b.balance - b.cap, 0) end)
      from b group by b.id, b.name order by b.name;
end $$;

-- ─── Function grants ────────────────────────────────────────────────────────

revoke all on function app.email_on_regularization() from public;
revoke all on function app.email_on_leave() from public;
revoke all on function app.email_on_expense() from public;
revoke all on function public.worker_celebration_emails(timestamptz) from public, anon, authenticated;
revoke all on function public.worker_claim_emails(integer) from public, anon, authenticated;
revoke all on function public.worker_email_result(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.worker_celebration_emails(timestamptz) to service_role;
grant execute on function public.worker_claim_emails(integer) to service_role;
grant execute on function public.worker_email_result(uuid, boolean, text) to service_role;
revoke all on function public.nudge_leave(uuid) from public, anon;
revoke all on function public.leave_year_end_preview(uuid) from public, anon;
grant execute on function public.nudge_leave(uuid) to authenticated, service_role;
grant execute on function public.leave_year_end_preview(uuid) to authenticated, service_role;
