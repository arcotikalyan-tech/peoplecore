-- PeopleCore · Timesheet (Kredily's Timesheet: dashboard, time tracker, approvals, workspace, finance, reports, settings).
--
-- * A workspace of members (employees who log time, each with a default hourly rate), clients, projects (external
--   for a client or internal; budget in hours or fees; members) and tasks.
-- * Time entries are written only through functions that apply the organization's rules: entry methods, who may
--   create entries, rounding, blocked days (future, past periods, weekly offs, holidays, leave), the lock date,
--   overlapping entries, the billable cap and allowed networks. The rate is fixed when the entry is logged
--   (task → project → client → member), so invoices keep the rate in force on each log's date.
-- * Approval: the employee's reporting manager or a timesheet admin ("manager or admin"), or the manager and then an
--   admin. Approved entries lock when auto-lock is on.
-- * Invoices gather approved billable entries of one client (optionally one project) for a period.
-- * Timer entries: who may change them follows the timer-edit setting (self: delete own; manager/admin: correct).
-- * Reminders: missing hours at 6 pm on working days, and the weekly log reminder on Friday at 4 pm (worker).
-- New permission timesheet.manage (owners, HR, payroll/finance).

insert into public.permissions (key, module, description, is_sensitive) values
  ('timesheet.manage', 'timesheet', 'Manage the timesheet workspace, approve any time logs and invoice clients', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'timesheet.manage', 'org'), ('hr_admin', 'timesheet.manage', 'org'), ('payroll_admin', 'timesheet.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'timesheet.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Settings ───────────────────────────────────────────────────────────────

create table public.timesheet_settings (
  organization_id            uuid primary key references public.organizations (id) on delete cascade,
  methods                    text[] not null default '{start_end,total,timer}' check (cardinality(methods) > 0 and methods <@ '{start_end,total,timer}'::text[]),
  timer_edit                 text[] not null default '{self,manager,admin}' check (timer_edit <@ '{self,manager,admin}'::text[]),
  capture_location           boolean not null default false,
  max_billable               text not null default 'none' check (max_billable in ('day', 'week', 'none')),
  max_billable_hours         numeric(5,1) not null default 8 check (max_billable_hours > 0 and max_billable_hours <= 168),
  restrict_days              text[] not null default '{future}' check (restrict_days <@ '{future,past,weekend,holidays,leave}'::text[]),
  period                     text not null default 'weeks' check (period in ('days', 'weeks', 'months')),
  overlap                    text not null default 'warn' check (overlap in ('allow', 'warn', 'restrict')),
  rounding                   smallint not null default 15 check (rounding in (0, 6, 15)),
  lock_before                date,
  auto_lock                  boolean not null default true,
  default_billable           boolean not null default true,
  creators                   text[] not null default '{self,manager,admin}' check (cardinality(creators) > 0 and creators <@ '{self,manager,admin}'::text[]),
  approval_flow              text not null default 'manager_or_admin' check (approval_flow in ('manager_or_admin', 'manager_then_admin')),
  approver_can_edit          boolean not null default true,
  rejection_reason_required  boolean not null default true,
  remind_submit              boolean not null default true,
  remind_missing             boolean not null default true,
  daily_target_minutes       smallint not null default 480 check (daily_target_minutes between 30 and 1440),
  restrict_networks          boolean not null default false,
  allowed_ips                text[] not null default '{}' check (cardinality(allowed_ips) <= 50),
  last_missing_reminder      date,
  last_submit_reminder       date,
  updated_by                 uuid default auth.uid(),
  updated_at                 timestamptz not null default now()
);
create trigger timesheet_settings_touch before update on public.timesheet_settings for each row execute function app.touch_updated_at();
create trigger timesheet_settings_audit after insert or update on public.timesheet_settings for each row execute function app.audit_row();

-- Settings with defaults for organizations that never saved any.
create function app.ts_settings(p_org uuid) returns public.timesheet_settings
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.timesheet_settings;
begin
  select * into s from public.timesheet_settings where organization_id = p_org;
  if not found then
    -- Same values as the column defaults.
    s := row(p_org, '{start_end,total,timer}', '{self,manager,admin}', false, 'none', 8, '{future}', 'weeks', 'warn', 15, null, true, true,
             '{self,manager,admin}', 'manager_or_admin', true, true, true, true, 480, false, '{}', null, null, null, now())::public.timesheet_settings;
  end if;
  return s;
end $$;

-- ─── Workspace ──────────────────────────────────────────────────────────────

create table public.ts_members (
  organization_id  uuid not null,
  employee_id      uuid primary key,
  rate             numeric(10,2) check (rate >= 0),
  active           boolean not null default true,
  added_by         uuid default auth.uid(),
  added_at         timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create trigger ts_members_audit after insert or update or delete on public.ts_members for each row execute function app.audit_row('rate');

create table public.ts_clients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 120),
  organisation     text check (char_length(organisation) <= 200),
  email            text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country          char(2) not null default 'IN' check (country ~ '^[A-Z]{2}$'),
  currency         char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  gstin            text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  finance_poc      text check (char_length(finance_poc) <= 120),
  rate             numeric(10,2) check (rate >= 0),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);
create trigger ts_clients_audit after insert or update or delete on public.ts_clients for each row execute function app.audit_row();

create table public.ts_projects (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  name                 text not null check (char_length(name) between 2 and 120),
  client_id            uuid,
  kind                 text not null default 'external' check (kind in ('external', 'internal')),
  budget_type          text not null default 'none' check (budget_type in ('hours', 'fees', 'none')),
  budget_amount        numeric(14,2) check (budget_amount > 0),
  manager_employee_id  uuid,
  rate                 numeric(10,2) check (rate >= 0),
  status               text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at           timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.ts_clients (organization_id, id),
  foreign key (organization_id, manager_employee_id) references public.employees (organization_id, id),
  check (kind = 'external' or client_id is null),
  check ((budget_type = 'none') = (budget_amount is null))
);
create trigger ts_projects_audit after insert or update or delete on public.ts_projects for each row execute function app.audit_row();

create table public.ts_project_members (
  organization_id  uuid not null,
  project_id       uuid not null,
  employee_id      uuid not null,
  primary key (project_id, employee_id),
  foreign key (organization_id, project_id) references public.ts_projects (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index ts_project_members_employee_idx on public.ts_project_members (employee_id);
create trigger ts_project_members_audit after insert or delete on public.ts_project_members for each row execute function app.audit_row();

create table public.ts_tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  project_id       uuid not null,
  name             text not null check (char_length(name) between 2 and 120),
  billable         boolean not null default true,
  rate             numeric(10,2) check (rate >= 0),
  archived_at      timestamptz,
  unique (project_id, name),
  unique (organization_id, id),
  foreign key (organization_id, project_id) references public.ts_projects (organization_id, id) on delete cascade
);
create trigger ts_tasks_audit after insert or update or delete on public.ts_tasks for each row execute function app.audit_row();

create table public.ts_invoices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  number           text not null check (number ~ '^INV-[0-9]{4,}$'),
  client_id        uuid not null,
  project_id       uuid,
  period_from      date not null,
  period_to        date not null,
  currency         char(3) not null,
  minutes          integer not null check (minutes > 0),
  total            numeric(14,2) not null check (total >= 0),
  status           text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  paid_at          timestamptz,
  unique (organization_id, number),
  unique (organization_id, id),
  check (period_to >= period_from),
  foreign key (organization_id, client_id) references public.ts_clients (organization_id, id),
  foreign key (organization_id, project_id) references public.ts_projects (organization_id, id)
);
create trigger ts_invoices_audit after insert or update on public.ts_invoices for each row execute function app.audit_row();

-- ─── Time entries and timers ─────────────────────────────────────────────────

create table public.ts_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  project_id       uuid not null,
  task_id          uuid,
  work_date        date not null,
  start_time       time,
  end_time         time,
  minutes          integer not null check (minutes between 1 and 1440),
  description      text check (char_length(description) <= 500),
  billable         boolean not null default true,
  rate             numeric(10,2),
  currency         char(3) not null default 'INR',
  status           text not null default 'pending' check (status in ('pending', 'manager_approved', 'approved', 'rejected')),
  reject_reason    text check (char_length(reject_reason) <= 300),
  decided_by       uuid,
  decided_at       timestamptz,
  invoice_id       uuid,
  source           text not null default 'manual' check (source in ('manual', 'timer', 'copy')),
  created_ip       text check (char_length(created_ip) <= 64),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  check ((start_time is null) = (end_time is null)),
  check (end_time is null or end_time > start_time),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, project_id) references public.ts_projects (organization_id, id),
  foreign key (organization_id, task_id) references public.ts_tasks (organization_id, id),
  foreign key (organization_id, invoice_id) references public.ts_invoices (organization_id, id)
);
create index ts_entries_employee_date_idx on public.ts_entries (employee_id, work_date);
create index ts_entries_org_status_idx on public.ts_entries (organization_id, status, work_date);
create index ts_entries_project_idx on public.ts_entries (project_id, work_date);
create trigger ts_entries_touch before update on public.ts_entries for each row execute function app.touch_updated_at();
create trigger ts_entries_audit after insert or update or delete on public.ts_entries for each row execute function app.audit_row();

create table public.ts_timers (
  organization_id  uuid not null,
  employee_id      uuid primary key,
  project_id       uuid not null,
  task_id          uuid,
  description      text check (char_length(description) <= 500),
  billable         boolean not null default true,
  started_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, project_id) references public.ts_projects (organization_id, id) on delete cascade,
  foreign key (organization_id, task_id) references public.ts_tasks (organization_id, id) on delete cascade
);

-- ─── Access helpers ─────────────────────────────────────────────────────────

create function app.ts_me(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.employees where organization_id = p_org and user_id = auth.uid();
$$;

-- The caller is the employee's reporting manager.
create function app.ts_manages(p_org uuid, p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e where e.id = p_employee and e.organization_id = p_org
                    and e.manager_employee_id is not null and e.manager_employee_id = app.ts_me(p_org));
$$;

create function app.ts_sees_project(p_org uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_org, 'timesheet.manage')
      or exists (select 1 from public.ts_project_members m where m.project_id = p_project and m.employee_id = app.ts_me(p_org))
      or exists (select 1 from public.ts_projects p where p.id = p_project and p.manager_employee_id = app.ts_me(p_org));
$$;

alter table public.timesheet_settings enable row level security;
alter table public.ts_members enable row level security;
alter table public.ts_clients enable row level security;
alter table public.ts_projects enable row level security;
alter table public.ts_project_members enable row level security;
alter table public.ts_tasks enable row level security;
alter table public.ts_invoices enable row level security;
alter table public.ts_entries enable row level security;
alter table public.ts_timers enable row level security;

create policy timesheet_settings_select on public.timesheet_settings for select to authenticated using (app.is_member(organization_id));
create policy timesheet_settings_write on public.timesheet_settings for all to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage')) with check (app.has_permission(organization_id, 'timesheet.manage'));
create policy ts_members_select on public.ts_members for select to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage') or employee_id = app.ts_me(organization_id) or app.ts_manages(organization_id, employee_id));
create policy ts_members_write on public.ts_members for all to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage')) with check (app.has_permission(organization_id, 'timesheet.manage'));
create policy ts_clients_select on public.ts_clients for select to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage')
         or exists (select 1 from public.ts_projects p where p.client_id = ts_clients.id and app.ts_sees_project(p.organization_id, p.id)));
create policy ts_clients_write on public.ts_clients for all to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage')) with check (app.has_permission(organization_id, 'timesheet.manage'));
create policy ts_projects_select on public.ts_projects for select to authenticated using (app.ts_sees_project(organization_id, id));
create policy ts_projects_write on public.ts_projects for all to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage')) with check (app.has_permission(organization_id, 'timesheet.manage'));
create policy ts_project_members_select on public.ts_project_members for select to authenticated using (app.ts_sees_project(organization_id, project_id));
create policy ts_project_members_write on public.ts_project_members for all to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage')) with check (app.has_permission(organization_id, 'timesheet.manage'));
create policy ts_tasks_select on public.ts_tasks for select to authenticated using (app.ts_sees_project(organization_id, project_id));
create policy ts_tasks_write on public.ts_tasks for all to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage')) with check (app.has_permission(organization_id, 'timesheet.manage'));
create policy ts_invoices_select on public.ts_invoices for select to authenticated using (app.has_permission(organization_id, 'timesheet.manage'));
create policy ts_entries_select on public.ts_entries for select to authenticated
  using (app.has_permission(organization_id, 'timesheet.manage') or employee_id = app.ts_me(organization_id) or app.ts_manages(organization_id, employee_id));
create policy ts_timers_select on public.ts_timers for select to authenticated using (employee_id = app.ts_me(organization_id));

grant select on public.timesheet_settings to authenticated;
grant insert, update on public.timesheet_settings to authenticated;
grant select, insert, update, delete on public.ts_members, public.ts_clients, public.ts_projects, public.ts_project_members, public.ts_tasks to authenticated;
grant select on public.ts_invoices, public.ts_entries, public.ts_timers to authenticated;
grant all on public.timesheet_settings, public.ts_members, public.ts_clients, public.ts_projects, public.ts_project_members, public.ts_tasks,
  public.ts_invoices, public.ts_entries, public.ts_timers to service_role;
revoke all on function app.ts_settings(uuid), app.ts_me(uuid), app.ts_manages(uuid, uuid), app.ts_sees_project(uuid, uuid) from public;
grant execute on function app.ts_settings(uuid), app.ts_me(uuid), app.ts_manages(uuid, uuid), app.ts_sees_project(uuid, uuid) to authenticated, service_role;

-- ─── Logging time ───────────────────────────────────────────────────────────

-- Every rule a new or copied entry must pass. Returns the minutes after rounding, or raises.
create function app.ts_check_entry(p_org uuid, p_employee uuid, p_project uuid, p_task uuid, p_date date,
                                   p_start time, p_end time, p_minutes integer, p_billable boolean, p_ip text, p_exclude uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s          public.timesheet_settings := app.ts_settings(p_org);
  v_today    date := app.org_today(p_org);
  v_minutes  integer;
  v_cal      uuid;
  v_from     date;
  v_used     integer;
  v_warning  text;
  v_status   text;
begin
  if not exists (select 1 from public.ts_members m where m.employee_id = p_employee and m.organization_id = p_org and m.active) then
    raise exception 'Only timesheet workspace members can log time. Ask an admin to add them under Workspace › Members.' using errcode = '42501';
  end if;
  select status into v_status from public.ts_projects where id = p_project and organization_id = p_org;
  if v_status is null then raise exception 'Project not found.' using errcode = 'P0002'; end if;
  if v_status <> 'active' then raise exception 'This project is closed for time logging.' using errcode = '22023'; end if;
  if not exists (select 1 from public.ts_project_members m where m.project_id = p_project and m.employee_id = p_employee) then
    raise exception 'They aren''t a member of this project.' using errcode = '42501';
  end if;
  if p_task is not null and not exists (select 1 from public.ts_tasks t where t.id = p_task and t.project_id = p_project and t.archived_at is null) then
    raise exception 'That task isn''t part of the project.' using errcode = '22023';
  end if;

  if p_start is not null then
    if not ('start_end' = any (s.methods)) then raise exception 'Start and end times are switched off; enter total hours.' using errcode = '22023'; end if;
    if p_end is null or p_end <= p_start then raise exception 'The end time must be after the start time.' using errcode = '22023'; end if;
    v_minutes := (extract(epoch from (p_end - p_start)) / 60)::integer;
  else
    if not ('total' = any (s.methods)) and not ('timer' = any (s.methods)) then raise exception 'Total hours are switched off; enter start and end times.' using errcode = '22023'; end if;
    v_minutes := p_minutes;
  end if;
  if v_minutes is null or v_minutes < 1 or v_minutes > 1440 then raise exception 'Enter between 1 minute and 24 hours.' using errcode = '22023'; end if;
  if s.rounding > 0 then v_minutes := greatest(s.rounding, (round(v_minutes::numeric / s.rounding) * s.rounding)::integer); end if;

  if s.lock_before is not null and p_date < s.lock_before then
    raise exception 'Timesheets before % are locked.', to_char(s.lock_before, 'DD Mon YYYY') using errcode = '42501';
  end if;
  if 'future' = any (s.restrict_days) and p_date > v_today then raise exception 'Time can''t be logged for future days.' using errcode = '22023'; end if;
  if 'past' = any (s.restrict_days) then
    v_from := case s.period when 'days' then v_today when 'weeks' then date_trunc('week', v_today)::date else date_trunc('month', v_today)::date end;
    if p_date < v_from then raise exception 'Time can only be logged for the current % now.', left(s.period, -1) using errcode = '22023'; end if;
  end if;
  v_cal := app.employee_calendar(p_employee);
  if 'weekend' = any (s.restrict_days)
     and extract(dow from p_date)::smallint = any (coalesce((select weekly_offs from public.holiday_calendars where id = v_cal), '{0,6}'::smallint[])) then
    raise exception 'Time can''t be logged on a weekly off.' using errcode = '22023';
  end if;
  if 'holidays' = any (s.restrict_days) and exists (select 1 from public.holidays h where h.calendar_id = v_cal and h.holiday_date = p_date and not h.is_optional) then
    raise exception 'Time can''t be logged on a holiday.' using errcode = '22023';
  end if;
  if 'leave' = any (s.restrict_days) and exists (select 1 from public.leave_requests l where l.employee_id = p_employee and l.status = 'approved'
                                                    and p_date between l.start_date and l.end_date) then
    raise exception 'Time can''t be logged on a day of approved leave.' using errcode = '22023';
  end if;

  if s.restrict_networks and cardinality(s.allowed_ips) > 0 and (p_ip is null or not (p_ip = any (s.allowed_ips))) then
    raise exception 'Time can only be logged from the company''s allowed networks.' using errcode = '42501';
  end if;

  if p_start is not null and s.overlap <> 'allow' and exists (
       select 1 from public.ts_entries e where e.employee_id = p_employee and e.work_date = p_date and e.start_time is not null
          and e.id is distinct from p_exclude and e.status <> 'rejected' and e.start_time < p_end and e.end_time > p_start) then
    if s.overlap = 'restrict' then raise exception 'This overlaps another entry on the same day.' using errcode = '23P01'; end if;
    v_warning := 'This overlaps another entry on the same day.';
  end if;

  if p_billable and s.max_billable <> 'none' then
    select coalesce(sum(e.minutes), 0) into v_used from public.ts_entries e
     where e.employee_id = p_employee and e.billable and e.status <> 'rejected' and e.id is distinct from p_exclude
       and e.work_date between (case s.max_billable when 'day' then p_date else date_trunc('week', p_date)::date end)
                           and (case s.max_billable when 'day' then p_date else date_trunc('week', p_date)::date + 6 end);
    if v_used + v_minutes > s.max_billable_hours * 60 then
      raise exception 'That goes over the billable limit of % hours a %.', s.max_billable_hours, s.max_billable using errcode = '22023';
    end if;
  end if;
  return jsonb_build_object('minutes', v_minutes, 'warning', v_warning);
end $$;

-- The caller may create an entry for this employee: themselves, as their manager, or as an admin (per the setting).
create function app.ts_may_create(p_org uuid, p_employee uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.timesheet_settings := app.ts_settings(p_org);
begin
  return (p_employee = app.ts_me(p_org) and 'self' = any (s.creators))
      or ('manager' = any (s.creators) and app.ts_manages(p_org, p_employee))
      or ('admin' = any (s.creators) and app.has_permission(p_org, 'timesheet.manage'));
end $$;

create function public.ts_log_time(p_project uuid, p_task uuid, p_date date, p_start time, p_end time, p_minutes integer,
                                   p_description text, p_billable boolean, p_employee uuid default null, p_ip text default null, p_source text default 'manual')
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org      uuid;
  v_emp      uuid;
  v_check    jsonb;
  v_rate     numeric;
  v_currency char(3);
  v_id       uuid;
  v_billable boolean;
begin
  select organization_id into v_org from public.ts_projects where id = p_project;
  if v_org is null or not app.is_member(v_org) then raise exception 'Project not found.' using errcode = 'P0002'; end if;
  v_emp := coalesce(p_employee, app.ts_me(v_org));
  if v_emp is null or not app.ts_may_create(v_org, v_emp) then raise exception 'You can''t log time for them.' using errcode = '42501'; end if;
  if p_source not in ('manual', 'timer', 'copy') then raise exception 'Unknown source.' using errcode = '22023'; end if;
  v_billable := coalesce(p_billable, (select t.billable from public.ts_tasks t where t.id = p_task), (app.ts_settings(v_org)).default_billable);
  if (select kind from public.ts_projects where id = p_project) = 'internal' then v_billable := false; end if;
  v_check := app.ts_check_entry(v_org, v_emp, p_project, p_task, p_date, p_start, p_end, p_minutes, v_billable, p_ip);

  select coalesce(t.rate, p.rate, c.rate, m.rate), coalesce(c.currency, 'INR') into v_rate, v_currency
    from public.ts_projects p
    left join public.ts_clients c on c.id = p.client_id
    left join public.ts_tasks t on t.id = p_task
    left join public.ts_members m on m.employee_id = v_emp
   where p.id = p_project;

  insert into public.ts_entries (organization_id, employee_id, project_id, task_id, work_date, start_time, end_time, minutes, description,
                                 billable, rate, currency, source, created_ip)
  values (v_org, v_emp, p_project, p_task, p_date, p_start, p_end, (v_check ->> 'minutes')::integer, nullif(trim(p_description), ''),
          v_billable, case when v_billable then v_rate end, v_currency, p_source,
          case when (app.ts_settings(v_org)).capture_location then left(p_ip, 64) end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'minutes', (v_check ->> 'minutes')::integer, 'warning', v_check ->> 'warning');
end $$;

-- The employee deletes their own entry while it is pending or rejected (admins: any entry not locked or invoiced).
create function public.ts_delete_entry(p_entry uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.ts_entries;
  s public.timesheet_settings;
begin
  select * into e from public.ts_entries where id = p_entry;
  if e.id is null or not app.is_member(e.organization_id) then raise exception 'Entry not found.' using errcode = 'P0002'; end if;
  s := app.ts_settings(e.organization_id);
  if e.invoice_id is not null then raise exception 'This entry is on an invoice.' using errcode = '42501'; end if;
  if s.lock_before is not null and e.work_date < s.lock_before then raise exception 'Timesheets before % are locked.', to_char(s.lock_before, 'DD Mon YYYY') using errcode = '42501'; end if;
  if app.has_permission(e.organization_id, 'timesheet.manage') then
    if e.status = 'approved' and s.auto_lock then raise exception 'Approved entries are locked.' using errcode = '42501'; end if;
  elsif e.employee_id = app.ts_me(e.organization_id) then
    if e.status not in ('pending', 'rejected') then raise exception 'Only pending or rejected entries can be deleted.' using errcode = '42501'; end if;
    if e.source = 'timer' and not ('self' = any (s.timer_edit)) then raise exception 'Timer entries can''t be changed by the employee.' using errcode = '42501'; end if;
  else
    raise exception 'You can''t delete this entry.' using errcode = '42501';
  end if;
  delete from public.ts_entries where id = p_entry;
end $$;

-- An approver corrects an entry before deciding (when the setting allows).
create function public.ts_adjust_entry(p_entry uuid, p_minutes integer, p_billable boolean, p_description text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.ts_entries;
  s public.timesheet_settings;
  v_check jsonb;
begin
  select * into e from public.ts_entries where id = p_entry for update;
  if e.id is null or not app.is_member(e.organization_id) then raise exception 'Entry not found.' using errcode = 'P0002'; end if;
  s := app.ts_settings(e.organization_id);
  if not s.approver_can_edit then raise exception 'Approvers can''t edit entries.' using errcode = '42501'; end if;
  if not (app.has_permission(e.organization_id, 'timesheet.manage') or app.ts_manages(e.organization_id, e.employee_id)) or e.employee_id = app.ts_me(e.organization_id) then
    raise exception 'You can''t edit this entry.' using errcode = '42501';
  end if;
  if e.status not in ('pending', 'manager_approved') then raise exception 'Only entries awaiting approval can be edited.' using errcode = '42501'; end if;
  if e.source = 'timer' and not ((app.has_permission(e.organization_id, 'timesheet.manage') and 'admin' = any (s.timer_edit))
                                  or (app.ts_manages(e.organization_id, e.employee_id) and 'manager' = any (s.timer_edit))) then
    raise exception 'Timer entries can''t be edited by you (Timesheet settings).' using errcode = '42501';
  end if;
  v_check := app.ts_check_entry(e.organization_id, e.employee_id, e.project_id, e.task_id, e.work_date, null, null, p_minutes, p_billable, null, e.id);
  update public.ts_entries set minutes = (v_check ->> 'minutes')::integer, billable = p_billable, start_time = null, end_time = null,
         rate = case when p_billable then coalesce(e.rate, (select coalesce(t.rate, p.rate, c.rate, m.rate) from public.ts_projects p
                     left join public.ts_clients c on c.id = p.client_id left join public.ts_tasks t on t.id = e.task_id
                     left join public.ts_members m on m.employee_id = e.employee_id where p.id = e.project_id)) end,
         description = nullif(trim(p_description), '')
   where id = p_entry;
end $$;

-- Approve or reject entries. Managers decide for their reports; admins for anyone; nobody for themselves.
create function public.ts_decide(p_entries uuid[], p_decision text, p_reason text default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  e        public.ts_entries;
  s        public.timesheet_settings;
  v_admin  boolean;
  v_mgr    boolean;
  v_next   text;
  n        integer := 0;
  v_user   uuid;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'Unknown decision.' using errcode = '22023'; end if;
  for e in select * from public.ts_entries where id = any (p_entries) for update loop
    if not app.is_member(e.organization_id) then raise exception 'Entry not found.' using errcode = 'P0002'; end if;
    s := app.ts_settings(e.organization_id);
    v_admin := app.has_permission(e.organization_id, 'timesheet.manage');
    v_mgr := app.ts_manages(e.organization_id, e.employee_id);
    if e.employee_id = app.ts_me(e.organization_id) then raise exception 'You can''t approve your own time.' using errcode = '42501'; end if;
    if not (v_admin or v_mgr) then raise exception 'You can''t decide on this entry.' using errcode = '42501'; end if;
    if e.status not in ('pending', 'manager_approved') then continue; end if;
    if p_decision = 'reject' then
      if s.rejection_reason_required and nullif(trim(p_reason), '') is null then raise exception 'Give a reason for rejecting.' using errcode = '22023'; end if;
      v_next := 'rejected';
    elsif s.approval_flow = 'manager_then_admin' then
      if e.status = 'pending' and v_mgr then v_next := 'manager_approved';
      elsif v_admin then v_next := 'approved';
      else continue;  -- already approved by the manager; waiting for an admin
      end if;
    else
      v_next := 'approved';
    end if;
    update public.ts_entries set status = v_next, decided_by = auth.uid(), decided_at = now(),
           reject_reason = case when v_next = 'rejected' then left(nullif(trim(p_reason), ''), 300) end
     where id = e.id;
    if v_next = 'rejected' then
      select user_id into v_user from public.employees where id = e.employee_id;
      perform app.notify(e.organization_id, v_user, 'timesheet.rejected', 'Time log rejected: ' || to_char(e.work_date, 'DD Mon'),
                         left(coalesce(nullif(trim(p_reason), ''), 'No reason given.'), 300), '/timesheet?tab=tracker&date=' || e.work_date);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ─── Timer ──────────────────────────────────────────────────────────────────

create function public.ts_start_timer(p_project uuid, p_task uuid, p_description text, p_billable boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
  v_emp uuid;
begin
  select organization_id into v_org from public.ts_projects where id = p_project;
  if v_org is null or not app.is_member(v_org) then raise exception 'Project not found.' using errcode = 'P0002'; end if;
  if not ('timer' = any ((app.ts_settings(v_org)).methods)) then raise exception 'The timer is switched off.' using errcode = '22023'; end if;
  v_emp := app.ts_me(v_org);
  if v_emp is null or not exists (select 1 from public.ts_members m where m.employee_id = v_emp and m.active) then
    raise exception 'Only timesheet workspace members can log time.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ts_project_members m where m.project_id = p_project and m.employee_id = v_emp) then
    raise exception 'You aren''t a member of this project.' using errcode = '42501';
  end if;
  if exists (select 1 from public.ts_timers where employee_id = v_emp) then raise exception 'A timer is already running. Stop it first.' using errcode = '23505'; end if;
  insert into public.ts_timers (organization_id, employee_id, project_id, task_id, description, billable)
  values (v_org, v_emp, p_project, p_task, nullif(trim(p_description), ''), coalesce(p_billable, true));
end $$;

-- Stops the caller's timer and logs it (start and end in the organization's time zone).
create function public.ts_stop_timer(p_org uuid, p_ip text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t      public.ts_timers;
  v_tz   text;
  v_from timestamp;
  v_to   timestamp;
begin
  select * into t from public.ts_timers where organization_id = p_org and employee_id = app.ts_me(p_org) for update;
  if t.employee_id is null then raise exception 'No timer is running.' using errcode = 'P0002'; end if;
  select timezone into v_tz from public.organizations where id = p_org;
  v_from := t.started_at at time zone v_tz;
  v_to := least(now() at time zone v_tz, date_trunc('day', v_from) + interval '23 hours 59 minutes');
  delete from public.ts_timers where employee_id = t.employee_id;
  if v_to - v_from < interval '1 minute' then return jsonb_build_object('id', null, 'minutes', 0); end if;
  return public.ts_log_time(t.project_id, t.task_id, v_from::date, v_from::time(0), v_to::time(0), null, t.description, t.billable, null, p_ip, 'timer');
end $$;

create function public.ts_discard_timer(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.ts_timers where organization_id = p_org and employee_id = app.ts_me(p_org);
$$;

-- Copies the caller's entries from the week before into the same weekdays of this week. Entries the rules refuse
-- (a future day, a closed project, …) are skipped.
create function public.ts_copy_last_week(p_org uuid, p_week_start date, p_ip text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  e        public.ts_entries;
  v_emp    uuid := app.ts_me(p_org);
  copied   integer := 0;
  skipped  integer := 0;
begin
  if v_emp is null then raise exception 'You don''t have an employee record here.' using errcode = '42501'; end if;
  for e in select * from public.ts_entries where employee_id = v_emp and status <> 'rejected'
              and work_date between p_week_start - 7 and p_week_start - 1 order by work_date, start_time nulls last loop
    begin
      perform public.ts_log_time(e.project_id, e.task_id, e.work_date + 7, e.start_time, e.end_time, e.minutes, e.description, e.billable, null, p_ip, 'copy');
      copied := copied + 1;
    exception when others then
      skipped := skipped + 1;
    end;
  end loop;
  return jsonb_build_object('copied', copied, 'skipped', skipped);
end $$;

-- ─── Invoices ───────────────────────────────────────────────────────────────

create function public.ts_generate_invoice(p_org uuid, p_client uuid, p_project uuid, p_from date, p_to date) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id       uuid := gen_random_uuid();
  v_currency char(3);
  v_minutes  integer;
  v_total    numeric;
  v_number   text;
begin
  if not app.has_permission(p_org, 'timesheet.manage') then raise exception 'You can''t invoice clients.' using errcode = '42501'; end if;
  if p_to < p_from then raise exception 'The period ends before it starts.' using errcode = '22023'; end if;
  select currency into v_currency from public.ts_clients where id = p_client and organization_id = p_org;
  if v_currency is null then raise exception 'Client not found.' using errcode = 'P0002'; end if;
  select coalesce(sum(e.minutes), 0), coalesce(round(sum(e.minutes / 60.0 * coalesce(e.rate, 0)), 2), 0) into v_minutes, v_total
    from public.ts_entries e join public.ts_projects p on p.id = e.project_id
   where e.organization_id = p_org and p.client_id = p_client and (p_project is null or e.project_id = p_project)
     and e.status = 'approved' and e.billable and e.invoice_id is null and e.work_date between p_from and p_to;
  if v_minutes = 0 then raise exception 'No approved billable time to invoice in that period.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('ts_invoice:' || p_org));
  select 'INV-' || lpad((coalesce(max(substr(number, 5)::integer), 0) + 1)::text, 4, '0') into v_number
    from public.ts_invoices where organization_id = p_org;
  insert into public.ts_invoices (id, organization_id, number, client_id, project_id, period_from, period_to, currency, minutes, total)
  values (v_id, p_org, v_number, p_client, p_project, p_from, p_to, v_currency, v_minutes, v_total);
  update public.ts_entries e set invoice_id = v_id
    from public.ts_projects p
   where p.id = e.project_id and e.organization_id = p_org and p.client_id = p_client and (p_project is null or e.project_id = p_project)
     and e.status = 'approved' and e.billable and e.invoice_id is null and e.work_date between p_from and p_to;
  return v_id;
end $$;

-- sent / paid / void. Voiding releases the entries so they can be invoiced again.
create function public.ts_set_invoice_status(p_invoice uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  i public.ts_invoices;
begin
  select * into i from public.ts_invoices where id = p_invoice for update;
  if i.id is null or not app.has_permission(i.organization_id, 'timesheet.manage') then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
  if p_status not in ('sent', 'paid', 'void') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if i.status in ('paid', 'void') then raise exception 'This invoice is already %.', i.status using errcode = '22023'; end if;
  update public.ts_invoices set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         paid_at = case when p_status = 'paid' then now() else paid_at end
   where id = p_invoice;
  if p_status = 'void' then update public.ts_entries set invoice_id = null where invoice_id = p_invoice; end if;
end $$;

-- ─── Reminders (worker, hourly) ─────────────────────────────────────────────

create function public.worker_timesheet_reminders() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  o         record;
  m         record;
  v_local   timestamp;
  v_today   date;
  missing   integer := 0;
  weekly    integer := 0;
begin
  for o in select org.id, org.timezone, s.remind_missing, s.remind_submit, s.daily_target_minutes, s.last_missing_reminder, s.last_submit_reminder
             from public.organizations org
             cross join lateral (select * from app.ts_settings(org.id)) s
            where exists (select 1 from public.ts_members tm where tm.organization_id = org.id and tm.active) loop
    v_local := now() at time zone o.timezone;
    v_today := v_local::date;
    if o.remind_missing and extract(hour from v_local) >= 18 and extract(isodow from v_today) < 6 and o.last_missing_reminder is distinct from v_today then
      for m in select e.user_id from public.ts_members tm join public.employees e on e.id = tm.employee_id
                where tm.organization_id = o.id and tm.active and e.user_id is not null and e.status in ('active', 'on_notice')
                  and coalesce((select sum(x.minutes) from public.ts_entries x where x.employee_id = e.id and x.work_date = v_today and x.status <> 'rejected'), 0) < o.daily_target_minutes
                  and not exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and v_today between l.start_date and l.end_date)
                  and not exists (select 1 from public.holidays h where h.calendar_id = app.employee_calendar(e.id) and h.holiday_date = v_today and not h.is_optional) loop
        perform app.notify(o.id, m.user_id, 'timesheet.missing', 'Log today''s hours',
                           'You have logged less than ' || round(o.daily_target_minutes / 60.0, 1) || ' hours today.', '/timesheet?tab=tracker');
        missing := missing + 1;
      end loop;
      insert into public.timesheet_settings (organization_id, last_missing_reminder) values (o.id, v_today)
      on conflict (organization_id) do update set last_missing_reminder = v_today;
    end if;
    if o.remind_submit and extract(isodow from v_today) = 5 and extract(hour from v_local) >= 16 and o.last_submit_reminder is distinct from v_today then
      for m in select e.user_id from public.ts_members tm join public.employees e on e.id = tm.employee_id
                where tm.organization_id = o.id and tm.active and e.user_id is not null and e.status in ('active', 'on_notice')
                  and coalesce((select sum(x.minutes) from public.ts_entries x where x.employee_id = e.id and x.status <> 'rejected'
                                  and x.work_date between v_today - 4 and v_today), 0) < o.daily_target_minutes * 5 loop
        perform app.notify(o.id, m.user_id, 'timesheet.weekly', 'Complete this week''s timesheet',
                           'Log the rest of your hours for the week before it closes.', '/timesheet?tab=tracker');
        weekly := weekly + 1;
      end loop;
      insert into public.timesheet_settings (organization_id, last_submit_reminder) values (o.id, v_today)
      on conflict (organization_id) do update set last_submit_reminder = v_today;
    end if;
  end loop;
  return jsonb_build_object('missing', missing, 'weekly', weekly);
end $$;

revoke all on function app.ts_check_entry(uuid, uuid, uuid, uuid, date, time, time, integer, boolean, text, uuid), app.ts_may_create(uuid, uuid) from public;
grant execute on function app.ts_check_entry(uuid, uuid, uuid, uuid, date, time, time, integer, boolean, text, uuid), app.ts_may_create(uuid, uuid) to authenticated, service_role;
revoke all on function public.ts_log_time(uuid, uuid, date, time, time, integer, text, boolean, uuid, text, text), public.ts_delete_entry(uuid),
  public.ts_adjust_entry(uuid, integer, boolean, text), public.ts_decide(uuid[], text, text), public.ts_start_timer(uuid, uuid, text, boolean),
  public.ts_stop_timer(uuid, text), public.ts_discard_timer(uuid), public.ts_copy_last_week(uuid, date, text),
  public.ts_generate_invoice(uuid, uuid, uuid, date, date), public.ts_set_invoice_status(uuid, text) from public;
grant execute on function public.ts_log_time(uuid, uuid, date, time, time, integer, text, boolean, uuid, text, text), public.ts_delete_entry(uuid),
  public.ts_adjust_entry(uuid, integer, boolean, text), public.ts_decide(uuid[], text, text), public.ts_start_timer(uuid, uuid, text, boolean),
  public.ts_stop_timer(uuid, text), public.ts_discard_timer(uuid), public.ts_copy_last_week(uuid, date, text),
  public.ts_generate_invoice(uuid, uuid, uuid, date, date), public.ts_set_invoice_status(uuid, text) to authenticated;
revoke all on function public.worker_timesheet_reminders() from public, anon, authenticated;
grant execute on function public.worker_timesheet_reminders() to service_role;
