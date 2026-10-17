-- PeopleCore · Org structure and Core HR (employees, effective-dated employment records).
-- Composite (organization_id, x_id) foreign keys make cross-tenant links impossible.

create type public.employment_type as enum ('permanent', 'contract', 'intern', 'temporary', 'consultant');
create type public.employee_status as enum ('pre_joining', 'active', 'on_notice', 'exited');
create type public.assignment_change_reason as enum
  ('joining', 'transfer', 'promotion', 'manager_change', 'type_change', 'correction', 'other');

-- ─── Org structure ──────────────────────────────────────────────────────────

create table public.legal_entities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 200),
  pan              text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  tan              text check (tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.locations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  code             text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name             text not null,
  city             text,
  state_code       text,
  country_code     char(2) not null default 'IN',
  timezone         text not null default 'Asia/Kolkata',
  latitude         numeric(9, 6) check (latitude between -90 and 90),
  longitude        numeric(9, 6) check (longitude between -180 and 180),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.cost_centres (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  code             text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name             text not null,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.departments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  code               text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name               text not null check (char_length(name) between 2 and 120),
  parent_id          uuid,
  head_employee_id   uuid,
  cost_centre_id     uuid,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  check (parent_id is null or parent_id <> id),
  foreign key (organization_id, parent_id) references public.departments (organization_id, id),
  foreign key (organization_id, cost_centre_id) references public.cost_centres (organization_id, id)
);

create table public.designations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (char_length(title) between 2 and 120),
  level            smallint check (level between 0 and 50),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, title),
  unique (organization_id, id)
);

-- ─── Employees ──────────────────────────────────────────────────────────────

create table public.employees (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  employee_code         text not null check (employee_code ~ '^[A-Za-z0-9/_-]{1,30}$'),
  user_id               uuid references auth.users (id) on delete set null,
  first_name            text not null check (char_length(first_name) between 1 and 100),
  middle_name           text check (char_length(middle_name) <= 100),
  last_name             text check (char_length(last_name) <= 100),
  work_email            text check (work_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  work_phone            text check (work_phone ~ '^\+?[0-9 -]{7,20}$'),
  status                public.employee_status not null default 'pre_joining',
  employment_type       public.employment_type not null,
  date_of_joining       date not null,
  probation_end_date    date,
  date_of_exit          date,
  -- Current-assignment snapshot; history lives in employment_records.
  department_id         uuid,
  designation_id        uuid,
  location_id           uuid,
  legal_entity_id       uuid,
  cost_centre_id        uuid,
  manager_employee_id   uuid,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  search_text           text generated always as (
    lower(coalesce(first_name, '') || ' ' || coalesce(middle_name, '') || ' ' || coalesce(last_name, '')
          || ' ' || employee_code || ' ' || coalesce(work_email, ''))
  ) stored,
  unique (organization_id, employee_code),
  unique (organization_id, user_id),
  unique (organization_id, id),
  check (manager_employee_id is null or manager_employee_id <> id),
  check (date_of_exit is null or date_of_exit >= date_of_joining),
  check (probation_end_date is null or probation_end_date >= date_of_joining),
  foreign key (organization_id, department_id) references public.departments (organization_id, id),
  foreign key (organization_id, designation_id) references public.designations (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, legal_entity_id) references public.legal_entities (organization_id, id),
  foreign key (organization_id, cost_centre_id) references public.cost_centres (organization_id, id),
  foreign key (organization_id, manager_employee_id) references public.employees (organization_id, id)
);
create unique index employees_work_email_uq on public.employees (organization_id, lower(work_email));
create index employees_org_status_idx on public.employees (organization_id, status, last_name, first_name);
create index employees_manager_idx on public.employees (organization_id, manager_employee_id);
create index employees_department_idx on public.employees (organization_id, department_id);
create index employees_user_idx on public.employees (user_id) where user_id is not null;
create index employees_search_idx on public.employees using gin (search_text extensions.gin_trgm_ops);

alter table public.departments
  add foreign key (organization_id, head_employee_id) references public.employees (organization_id, id);

create table public.employment_records (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  employee_id           uuid not null,
  effective_from        date not null,
  effective_to          date,
  department_id         uuid,
  designation_id        uuid,
  location_id           uuid,
  manager_employee_id   uuid,
  employment_type       public.employment_type not null,
  change_reason         public.assignment_change_reason not null,
  notes                 text check (char_length(notes) <= 2000),
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, department_id) references public.departments (organization_id, id),
  foreign key (organization_id, designation_id) references public.designations (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, manager_employee_id) references public.employees (organization_id, id),
  exclude using gist (employee_id with =, daterange(effective_from, effective_to, '[]') with &&)
);
create index employment_records_employee_idx on public.employment_records (organization_id, employee_id, effective_from desc);

-- ─── Counters (per-org sequences for human-readable codes) ──────────────────

create table app.org_counters (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  counter_key      text not null,
  next_value       bigint not null default 1,
  primary key (organization_id, counter_key)
);

create function app.next_counter(p_org uuid, p_key text) returns bigint
language sql volatile security definer set search_path = '' as $$
  insert into app.org_counters as c (organization_id, counter_key, next_value)
  values (p_org, p_key, 2)
  on conflict (organization_id, counter_key) do update set next_value = c.next_value + 1
  returning next_value - 1;
$$;

-- ─── Scoped access to employees ─────────────────────────────────────────────

-- Is the target employee in the caller's reporting line (direct or indirect)? Depth-capped to stop cycles.
create function app.is_in_reporting_line(p_org uuid, p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive chain as (
    select e.manager_employee_id as manager_id, 1 as depth
      from public.employees e
     where e.organization_id = p_org and e.id = p_employee
    union all
    select e.manager_employee_id, c.depth + 1
      from chain c
      join public.employees e on e.organization_id = p_org and e.id = c.manager_id
     where c.depth < 30
  )
  select exists (
    select 1 from chain c
      join public.employees m on m.organization_id = p_org and m.id = c.manager_id
     where m.user_id = auth.uid()
  );
$$;

create function app.can_access_employee(p_org uuid, p_employee uuid, p_permission text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scopes public.permission_scope[];
begin
  select array_agg(s) into v_scopes from app.permission_scopes(p_org, p_permission) s;
  if v_scopes is null then
    return false;
  end if;
  if 'org' = any (v_scopes) then
    return true;
  end if;
  if 'self' = any (v_scopes) and exists (
       select 1 from public.employees where id = p_employee and organization_id = p_org and user_id = auth.uid()) then
    return true;
  end if;
  if 'team' = any (v_scopes) and app.is_in_reporting_line(p_org, p_employee) then
    return true;
  end if;
  return false;
end $$;

-- ─── RPCs (security invoker: RLS still applies to every statement) ──────────

create function public.create_employee(
  p_organization_id     uuid,
  p_first_name          text,
  p_employment_type     public.employment_type,
  p_date_of_joining     date,
  p_employee_code       text default null,
  p_middle_name         text default null,
  p_last_name           text default null,
  p_work_email          text default null,
  p_work_phone          text default null,
  p_department_id       uuid default null,
  p_designation_id      uuid default null,
  p_location_id         uuid default null,
  p_legal_entity_id     uuid default null,
  p_manager_employee_id uuid default null,
  p_probation_end_date  date default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id   uuid;
  v_code text := nullif(trim(p_employee_code), '');
begin
  if not app.has_permission(p_organization_id, 'employee.create') then
    raise exception 'not authorized to create employees' using errcode = '42501';
  end if;
  if v_code is null then
    v_code := 'EMP' || lpad(app.next_counter(p_organization_id, 'employee_code')::text, 5, '0');
  end if;

  insert into public.employees (
    organization_id, employee_code, first_name, middle_name, last_name, work_email, work_phone,
    status, employment_type, date_of_joining, probation_end_date,
    department_id, designation_id, location_id, legal_entity_id, manager_employee_id)
  values (
    p_organization_id, v_code, trim(p_first_name), nullif(trim(p_middle_name), ''), nullif(trim(p_last_name), ''),
    nullif(lower(trim(p_work_email)), ''), nullif(trim(p_work_phone), ''),
    case when p_date_of_joining > current_date then 'pre_joining' else 'active' end::public.employee_status,
    p_employment_type, p_date_of_joining, p_probation_end_date,
    p_department_id, p_designation_id, p_location_id, p_legal_entity_id, p_manager_employee_id)
  returning id into v_id;

  insert into public.employment_records (
    organization_id, employee_id, effective_from, department_id, designation_id, location_id,
    manager_employee_id, employment_type, change_reason)
  values (
    p_organization_id, v_id, p_date_of_joining, p_department_id, p_designation_id, p_location_id,
    p_manager_employee_id, p_employment_type, 'joining');

  return v_id;
end $$;

-- Closes the open employment record and opens a new one. The snapshot on `employees` is updated
-- immediately when the change is effective today or earlier; future-dated changes are applied by
-- the daily snapshot job (Phase 3, see BUILD_STATUS known issues).
create function public.change_employee_assignment(
  p_employee_id         uuid,
  p_effective_from      date,
  p_change_reason       public.assignment_change_reason,
  p_department_id       uuid default null,
  p_designation_id      uuid default null,
  p_location_id         uuid default null,
  p_manager_employee_id uuid default null,
  p_notes               text default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_emp     public.employees;
  v_current public.employment_records;
  v_id      uuid;
begin
  -- Permission check before the row lock: FOR UPDATE applies UPDATE policies, which would turn
  -- "not authorized" into a misleading "not found" for people who can see but not edit the employee.
  select * into v_emp from public.employees where id = p_employee_id;
  if not found then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if not app.has_permission(v_emp.organization_id, 'employee.update') then
    raise exception 'not authorized to change assignments' using errcode = '42501';
  end if;
  perform 1 from public.employees where id = p_employee_id for update;
  if p_change_reason = 'joining' then
    raise exception 'joining records are created with the employee' using errcode = '22023';
  end if;
  if p_manager_employee_id = p_employee_id then
    raise exception 'an employee cannot report to themselves' using errcode = '22023';
  end if;

  select * into v_current from public.employment_records
   where employee_id = p_employee_id and effective_to is null
   for update;
  if found then
    if p_effective_from <= v_current.effective_from then
      raise exception 'effective date must be after %', v_current.effective_from using errcode = '22023';
    end if;
    update public.employment_records set effective_to = p_effective_from - 1 where id = v_current.id;
  end if;

  insert into public.employment_records (
    organization_id, employee_id, effective_from, department_id, designation_id, location_id,
    manager_employee_id, employment_type, change_reason, notes)
  values (
    v_emp.organization_id, p_employee_id, p_effective_from, p_department_id, p_designation_id, p_location_id,
    p_manager_employee_id, v_emp.employment_type, p_change_reason, nullif(trim(p_notes), ''))
  returning id into v_id;

  if p_effective_from <= current_date then
    update public.employees
       set department_id = p_department_id, designation_id = p_designation_id,
           location_id = p_location_id, manager_employee_id = p_manager_employee_id
     where id = p_employee_id;
  end if;
  return v_id;
end $$;

-- ─── Triggers ───────────────────────────────────────────────────────────────

create trigger legal_entities_touch before update on public.legal_entities for each row execute function app.touch_updated_at();
create trigger locations_touch before update on public.locations for each row execute function app.touch_updated_at();
create trigger cost_centres_touch before update on public.cost_centres for each row execute function app.touch_updated_at();
create trigger departments_touch before update on public.departments for each row execute function app.touch_updated_at();
create trigger designations_touch before update on public.designations for each row execute function app.touch_updated_at();
create trigger employees_touch before update on public.employees for each row execute function app.touch_updated_at();

create trigger legal_entities_audit after insert or update or delete on public.legal_entities for each row execute function app.audit_row();
create trigger locations_audit after insert or update or delete on public.locations for each row execute function app.audit_row();
create trigger cost_centres_audit after insert or update or delete on public.cost_centres for each row execute function app.audit_row();
create trigger departments_audit after insert or update or delete on public.departments for each row execute function app.audit_row();
create trigger designations_audit after insert or update or delete on public.designations for each row execute function app.audit_row();
create trigger employees_audit after insert or update or delete on public.employees for each row execute function app.audit_row();
create trigger employment_records_audit after insert or update or delete on public.employment_records for each row execute function app.audit_row();

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.legal_entities enable row level security;
alter table public.locations enable row level security;
alter table public.cost_centres enable row level security;
alter table public.departments enable row level security;
alter table public.designations enable row level security;
alter table public.employees enable row level security;
alter table public.employment_records enable row level security;

-- Structure tables: visible to members, managed with org.manage. Same four policies each.
do $$
declare t text;
begin
  foreach t in array array['legal_entities', 'locations', 'cost_centres', 'departments', 'designations'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.is_member(organization_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.has_permission(organization_id, ''org.manage''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (app.has_permission(organization_id, ''org.manage'')) with check (app.has_permission(organization_id, ''org.manage''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (app.has_permission(organization_id, ''org.manage''))', t);
  end loop;
end $$;

create policy employees_select on public.employees for select to authenticated
  using (app.can_access_employee(organization_id, id, 'employee.read'));
create policy employees_insert on public.employees for insert to authenticated
  with check (app.has_permission(organization_id, 'employee.create'));
create policy employees_update on public.employees for update to authenticated
  using (app.has_permission(organization_id, 'employee.update'))
  with check (app.has_permission(organization_id, 'employee.update'));
-- No delete policy: employees are exited and archived by retention jobs, never deleted by users.

create policy employment_records_select on public.employment_records for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'employee.read'));
create policy employment_records_insert on public.employment_records for insert to authenticated
  with check (app.has_permission(organization_id, 'employee.create') or app.has_permission(organization_id, 'employee.update'));
create policy employment_records_update on public.employment_records for update to authenticated
  using (app.has_permission(organization_id, 'employee.update'))
  with check (app.has_permission(organization_id, 'employee.update'));

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on public.legal_entities, public.locations, public.cost_centres, public.departments,
  public.designations, public.employees, public.employment_records from anon;
revoke delete, truncate on public.employees, public.employment_records from authenticated;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function public.create_employee from public, anon;
revoke execute on function public.change_employee_assignment from public, anon;
grant execute on function public.create_employee to authenticated;
grant execute on function public.change_employee_assignment to authenticated;
