-- PeopleCore · Company profile (Kredily parity): company details and statutory identifiers, offices, directors /
-- auditors / company secretary, employee custom fields, and grades for designations.
--
-- Company details and offices are readable by every member (they appear on letters and payslips). Officers' contact
-- details are readable by org.manage and auditors only. Custom fields: definitions are org-wide; values follow the
-- employee's own access (employee.read on them) and the employee may edit fields marked editable_by_employee.

create table public.company_profiles (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  legal_name       text check (char_length(legal_name) between 2 and 200),
  brand_name       text check (char_length(brand_name) <= 120),
  email            text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            text check (phone ~ '^\+?[0-9 ()-]{7,20}$'),
  website          text check (char_length(website) <= 200),
  industry         text check (char_length(industry) <= 80),
  social           jsonb not null default '{}' check (jsonb_typeof(social) = 'object'),
  entity_type      text check (entity_type in ('private_limited', 'public_limited', 'llp', 'partnership', 'proprietorship', 'opc', 'section_8', 'trust', 'society', 'other')),
  cin              text check (cin ~ '^[A-Z0-9]{21}$'),
  llpin            text check (llpin ~ '^[A-Z]{3}-[0-9]{4}$'),
  incorporated_on  date,
  pan              text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  tan              text check (tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  gstin            text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  pf_code          text check (char_length(pf_code) <= 30),
  esi_code         text check (char_length(esi_code) <= 30),
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now()
);
create trigger company_profiles_touch before update on public.company_profiles for each row execute function app.touch_updated_at();
create trigger company_profiles_audit after insert or update on public.company_profiles for each row execute function app.audit_row();
insert into public.company_profiles (organization_id, legal_name) select id, name from public.organizations on conflict do nothing;

create table public.company_addresses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  kind             text not null check (kind in ('registered', 'corporate', 'branch', 'custom')),
  label            text check (char_length(label) <= 80),
  line1            text not null check (char_length(line1) between 2 and 200),
  line2            text check (char_length(line2) <= 200),
  city             text not null check (char_length(city) between 2 and 100),
  state            text check (char_length(state) <= 100),
  country          text not null default 'India' check (char_length(country) <= 80),
  pincode          text check (pincode ~ '^[0-9A-Z -]{3,10}$'),
  created_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index company_addresses_registered_uq on public.company_addresses (organization_id) where kind = 'registered';
create unique index company_addresses_corporate_uq on public.company_addresses (organization_id) where kind = 'corporate';
create trigger company_addresses_audit after insert or update or delete on public.company_addresses for each row execute function app.audit_row();

create table public.company_officers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  kind             text not null check (kind in ('director', 'auditor', 'secretary')),
  name             text not null check (char_length(name) between 2 and 120),
  email            text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            text check (phone ~ '^\+?[0-9 ()-]{7,20}$'),
  identifier       text check (char_length(identifier) <= 40),   -- DIN, ICAI membership / FRN, ICSI membership
  firm             text check (char_length(firm) <= 120),
  created_at       timestamptz not null default now()
);
create trigger company_officers_audit after insert or update or delete on public.company_officers for each row execute function app.audit_row('email', 'phone');

-- ─── Grades ─────────────────────────────────────────────────────────────────

create table public.grades (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 40),
  rank             smallint not null default 0,
  description      text check (char_length(description) <= 200),
  unique (organization_id, name),
  unique (organization_id, id)
);
create trigger grades_audit after insert or update or delete on public.grades for each row execute function app.audit_row();
alter table public.designations add column grade_id uuid;
alter table public.designations add foreign key (organization_id, grade_id) references public.grades (organization_id, id) on delete set null (grade_id);

-- ─── Employee custom fields ─────────────────────────────────────────────────

create table public.employee_custom_fields (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  label                 text not null check (char_length(label) between 2 and 60),
  field_type            text not null check (field_type in ('text', 'number', 'date', 'select', 'boolean')),
  options               text[] not null default '{}',
  required              boolean not null default false,
  editable_by_employee  boolean not null default false,
  position              smallint not null default 0,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  unique (organization_id, label),
  unique (organization_id, id),
  check (field_type <> 'select' or cardinality(options) between 1 and 50)
);
create trigger employee_custom_fields_audit after insert or update or delete on public.employee_custom_fields for each row execute function app.audit_row();

create table public.employee_custom_values (
  organization_id  uuid not null,
  employee_id      uuid not null,
  field_id         uuid not null,
  value            text not null check (char_length(value) <= 500),
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  primary key (employee_id, field_id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, field_id) references public.employee_custom_fields (organization_id, id) on delete cascade
);
create trigger employee_custom_values_touch before update on public.employee_custom_values for each row execute function app.touch_updated_at();
create trigger employee_custom_values_audit after insert or update or delete on public.employee_custom_values for each row execute function app.audit_row();

-- Values must fit their field's type.
create function app.check_custom_value() returns trigger
language plpgsql set search_path = '' as $$
declare
  f public.employee_custom_fields;
begin
  select * into f from public.employee_custom_fields where id = new.field_id;
  if f.archived_at is not null then raise exception 'This field is archived.' using errcode = '22023'; end if;
  if f.field_type = 'number' and new.value !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception '% must be a number.', f.label using errcode = '22023';
  elsif f.field_type = 'date' and new.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception '% must be a date.', f.label using errcode = '22023';
  elsif f.field_type = 'boolean' and new.value not in ('yes', 'no') then
    raise exception '% must be yes or no.', f.label using errcode = '22023';
  elsif f.field_type = 'select' and not (new.value = any (f.options)) then
    raise exception 'Choose one of the options for %.', f.label using errcode = '22023';
  end if;
  return new;
end $$;
create trigger employee_custom_values_check before insert or update on public.employee_custom_values for each row execute function app.check_custom_value();

-- ─── RLS and grants ─────────────────────────────────────────────────────────

alter table public.company_profiles enable row level security;
alter table public.company_addresses enable row level security;
alter table public.company_officers enable row level security;
alter table public.grades enable row level security;
alter table public.employee_custom_fields enable row level security;
alter table public.employee_custom_values enable row level security;

create policy company_profiles_select on public.company_profiles for select to authenticated using (app.is_member(organization_id));
create policy company_profiles_write on public.company_profiles for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
create policy company_addresses_select on public.company_addresses for select to authenticated using (app.is_member(organization_id));
create policy company_addresses_write on public.company_addresses for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
create policy company_officers_select on public.company_officers for select to authenticated
  using (app.has_permission(organization_id, 'org.manage') or app.has_permission(organization_id, 'audit.read'));
create policy company_officers_write on public.company_officers for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
create policy grades_select on public.grades for select to authenticated using (app.is_member(organization_id));
create policy grades_write on public.grades for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
create policy employee_custom_fields_select on public.employee_custom_fields for select to authenticated using (app.is_member(organization_id));
create policy employee_custom_fields_write on public.employee_custom_fields for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
create policy employee_custom_values_select on public.employee_custom_values for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'employee.read'));
create policy employee_custom_values_write on public.employee_custom_values for all to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'employee.update')
         or (app.is_own_employee(employee_id) and exists (select 1 from public.employee_custom_fields f where f.id = field_id and f.editable_by_employee)))
  with check (app.can_access_employee(organization_id, employee_id, 'employee.update')
         or (app.is_own_employee(employee_id) and exists (select 1 from public.employee_custom_fields f where f.id = field_id and f.editable_by_employee)));

grant select, insert, update on public.company_profiles to authenticated;
grant select, insert, update, delete on public.company_addresses, public.company_officers, public.grades, public.employee_custom_fields, public.employee_custom_values to authenticated;
grant all on public.company_profiles, public.company_addresses, public.company_officers, public.grades, public.employee_custom_fields, public.employee_custom_values to service_role;
revoke all on function app.check_custom_value() from public;

-- New organizations start with a profile named after them.
create function app.company_profile_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.company_profiles (organization_id, legal_name) values (new.id, new.name) on conflict do nothing;
  return null;
end $$;
revoke all on function app.company_profile_default() from public;
create trigger organizations_company_profile after insert on public.organizations
  for each row execute function app.company_profile_default();
