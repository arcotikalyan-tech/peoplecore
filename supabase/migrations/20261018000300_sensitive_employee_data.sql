-- PeopleCore · Core HR: personal details, emergency contacts, identity numbers and bank accounts.
--
-- Personal details and emergency contacts are ordinary RLS tables (employees may edit their own).
-- Identity numbers and bank accounts live in the `restricted` schema, which the API cannot reach at all:
-- they are read and written only through security-definer functions that check permissions, and every
-- unmasked read ("reveal") is written to the audit log. Aadhaar: only the last 4 digits are stored.

-- ─── Permission catalog additions ───────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('employee.personal.update', 'core_hr', 'Edit personal details and emergency contacts', true),
  ('employee.identity.update', 'core_hr', 'Edit identity numbers (PAN, UAN, ESIC, passport)', true),
  ('employee.bank.update', 'core_hr', 'Change bank accounts', true);

insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'employee.personal.update', 'org'),
  ('owner', 'employee.identity.update', 'org'),
  ('owner', 'employee.bank.update', 'org'),
  ('hr_admin', 'employee.personal.update', 'org'),
  ('hr_admin', 'employee.identity.update', 'org'),
  ('payroll_admin', 'employee.bank.update', 'org'),
  ('employee', 'employee.personal.update', 'self');

-- Existing organizations' system roles receive the same grants.
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t
  join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key in ('employee.personal.update', 'employee.identity.update', 'employee.bank.update')
on conflict (role_id, permission_key) do nothing;

-- ─── Audit trigger fix: diff first, redact after ────────────────────────────
-- The original masked redacted columns *before* comparing old and new, so a change confined to
-- redacted columns compared equal and produced no audit event at all. Now the diff uses real values and
-- only the stored entry is masked. Rows that belong to an employee also record metadata.employee_id.

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new     jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old     jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_redact  text[] := coalesce(tg_argv::text[], '{}');
  v_changes jsonb;
  v_col     text;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(
             n.key,
             case when n.key = any (v_redact)
                  then jsonb_build_object('from', '[redacted]', 'to', '[redacted]')
                  else jsonb_build_object('from', v_old -> n.key, 'to', n.value) end)
      into v_changes
      from jsonb_each(v_new) n
     where n.key not in ('updated_at', 'search_text')
       and (v_old -> n.key) is distinct from n.value;
    if v_changes is null then
      return null;  -- no meaningful change
    end if;
  else
    v_changes := v_row - 'search_text';
    foreach v_col in array v_redact loop
      if v_changes ? v_col and v_changes -> v_col <> 'null'::jsonb then
        v_changes := jsonb_set(v_changes, array[v_col], '"[redacted]"');
      end if;
    end loop;
  end if;

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes, metadata)
  values (
    coalesce((v_row ->> 'organization_id')::uuid,
             case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end),
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_changes,
    case when v_row ? 'employee_id' then jsonb_build_object('employee_id', v_row ->> 'employee_id') else '{}'::jsonb end
  );
  return null;
end $$;

create index audit_events_employee_idx on public.audit_events (organization_id, (metadata ->> 'employee_id'), occurred_at desc)
  where metadata ? 'employee_id';

-- ─── Personal details & emergency contacts (RLS tables) ─────────────────────

create type public.gender as enum ('female', 'male', 'non_binary', 'undisclosed');

create table public.employee_personal (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null unique,
  date_of_birth    date check (date_of_birth > '1900-01-01'),
  gender           public.gender,
  personal_email   text check (personal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  personal_phone   text check (personal_phone ~ '^\+?[0-9 -]{7,20}$'),
  address_line1    text check (char_length(address_line1) <= 200),
  address_line2    text check (char_length(address_line2) <= 200),
  city             text check (char_length(city) <= 100),
  state_code       text check (char_length(state_code) <= 10),
  postal_code      text check (postal_code ~ '^[0-9A-Za-z -]{3,10}$'),
  country_code     char(2) not null default 'IN',
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

create table public.emergency_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  name             text not null check (char_length(name) between 1 and 120),
  relationship     text not null check (char_length(relationship) between 1 and 60),
  phone            text not null check (phone ~ '^\+?[0-9 -]{7,20}$'),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index emergency_contacts_employee_idx on public.emergency_contacts (organization_id, employee_id);

create trigger employee_personal_touch before update on public.employee_personal
  for each row execute function app.touch_updated_at();
create trigger employee_personal_audit after insert or update or delete on public.employee_personal
  for each row execute function app.audit_row('date_of_birth', 'gender', 'personal_email', 'personal_phone',
                                              'address_line1', 'address_line2', 'city', 'state_code', 'postal_code');
create trigger emergency_contacts_audit after insert or update or delete on public.emergency_contacts
  for each row execute function app.audit_row('name', 'relationship', 'phone');

alter table public.employee_personal enable row level security;
alter table public.emergency_contacts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['employee_personal', 'emergency_contacts'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.can_access_employee(organization_id, employee_id, ''employee.personal.read''))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.can_access_employee(organization_id, employee_id, ''employee.personal.update''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (app.can_access_employee(organization_id, employee_id, ''employee.personal.update'')) with check (app.can_access_employee(organization_id, employee_id, ''employee.personal.update''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (app.can_access_employee(organization_id, employee_id, ''employee.personal.update''))', t);
  end loop;
end $$;

grant select, insert, update, delete on public.employee_personal, public.emergency_contacts to authenticated;
grant all on public.employee_personal, public.emergency_contacts to service_role;

-- ─── Identity numbers & bank accounts (restricted schema) ───────────────────

create schema restricted;
comment on schema restricted is
  'Highly sensitive records (identity numbers, bank accounts). Not exposed through the API; accessed only through audited security-definer functions.';
revoke all on schema restricted from public;

create type public.bank_account_type as enum ('savings', 'current', 'salary');

create table restricted.employee_identity (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null unique,
  pan              text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  aadhaar_last4    text check (aadhaar_last4 ~ '^[0-9]{4}$'),
  uan              text check (uan ~ '^[0-9]{12}$'),
  esic_number      text check (esic_number ~ '^[0-9]{10,17}$'),
  passport_number  text check (passport_number ~ '^[A-Z0-9]{6,12}$'),
  passport_expiry  date,
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
comment on column restricted.employee_identity.aadhaar_last4 is
  'Only the last 4 digits. Full Aadhaar numbers are deliberately not stored (UIDAI Aadhaar Data Vault rules).';

create table restricted.employee_bank_accounts (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  employee_id          uuid not null,
  account_holder_name  text not null check (char_length(account_holder_name) between 2 and 120),
  bank_name            text not null check (char_length(bank_name) between 2 and 120),
  account_number       text not null check (account_number ~ '^[0-9]{6,18}$'),
  ifsc                 text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_type         public.bank_account_type not null default 'savings',
  created_by           uuid,
  created_at           timestamptz not null default now(),
  archived_at          timestamptz,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
-- One current account per employee; replaced accounts are archived, never deleted (payment history).
create unique index employee_bank_accounts_current on restricted.employee_bank_accounts (employee_id) where archived_at is null;

create trigger employee_identity_touch before update on restricted.employee_identity
  for each row execute function app.touch_updated_at();
create trigger employee_identity_audit after insert or update or delete on restricted.employee_identity
  for each row execute function app.audit_row('pan', 'aadhaar_last4', 'uan', 'esic_number', 'passport_number', 'passport_expiry');
create trigger employee_bank_accounts_audit after insert or update or delete on restricted.employee_bank_accounts
  for each row execute function app.audit_row('account_holder_name', 'bank_name', 'account_number', 'ifsc');

grant usage on schema restricted to service_role;
grant all on all tables in schema restricted to service_role;

-- ─── Access functions ───────────────────────────────────────────────────────

-- Masks all but the last `p_visible` characters.
create function app.mask(p_value text, p_visible int default 4) returns text
language sql immutable set search_path = '' as $$
  select case
           when p_value is null then null
           when char_length(p_value) <= p_visible then p_value
           else repeat('•', char_length(p_value) - p_visible) || right(p_value, p_visible)
         end;
$$;

-- Organization of an employee, or a permission error that doesn't reveal whether the employee exists.
create function app.employee_org_or_deny(p_employee uuid, p_permission text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.can_access_employee(v_org, p_employee, p_permission) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return v_org;
end $$;

create function public.employee_identity_summary(p_employee uuid)
returns table (
  pan text, aadhaar_last4 text, uan text, esic_number text, passport_number text, passport_expiry date,
  updated_at timestamptz, can_edit boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := app.employee_org_or_deny(p_employee, 'employee.identity.read');
begin
  return query
    select app.mask(i.pan), i.aadhaar_last4, app.mask(i.uan), app.mask(i.esic_number), app.mask(i.passport_number, 3),
           i.passport_expiry, i.updated_at, app.has_permission(v_org, 'employee.identity.update')
      from (select 1) as one
      left join restricted.employee_identity i on i.employee_id = p_employee;
end $$;

create function public.reveal_employee_identity(p_employee uuid)
returns table (pan text, aadhaar_last4 text, uan text, esic_number text, passport_number text, passport_expiry date)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid := app.employee_org_or_deny(p_employee, 'employee.identity.read');
begin
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'reveal', 'employee_identity', p_employee, jsonb_build_object('employee_id', p_employee));
  return query
    select i.pan, i.aadhaar_last4, i.uan, i.esic_number, i.passport_number, i.passport_expiry
      from restricted.employee_identity i where i.employee_id = p_employee;
end $$;

-- Replaces the identity record (callers send every field; blanks clear a value).
create function public.set_employee_identity(
  p_employee        uuid,
  p_pan             text default null,
  p_aadhaar_last4   text default null,
  p_uan             text default null,
  p_esic_number     text default null,
  p_passport_number text default null,
  p_passport_expiry date default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'employee.identity.update') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into restricted.employee_identity as i
    (organization_id, employee_id, pan, aadhaar_last4, uan, esic_number, passport_number, passport_expiry, updated_by)
  values
    (v_org, p_employee, upper(nullif(trim(p_pan), '')), nullif(trim(p_aadhaar_last4), ''), nullif(trim(p_uan), ''),
     nullif(trim(p_esic_number), ''), upper(nullif(trim(p_passport_number), '')), p_passport_expiry, auth.uid())
  on conflict (employee_id) do update
     set pan = excluded.pan, aadhaar_last4 = excluded.aadhaar_last4, uan = excluded.uan,
         esic_number = excluded.esic_number, passport_number = excluded.passport_number,
         passport_expiry = excluded.passport_expiry, updated_by = auth.uid();
end $$;

create function public.employee_bank_summary(p_employee uuid)
returns table (
  account_holder_name text, bank_name text, account_number text, ifsc text,
  account_type public.bank_account_type, since timestamptz, previous_accounts bigint, can_edit boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := app.employee_org_or_deny(p_employee, 'employee.bank.read');
begin
  return query
    select b.account_holder_name, b.bank_name, app.mask(b.account_number), b.ifsc, b.account_type, b.created_at,
           (select count(*) from restricted.employee_bank_accounts h where h.employee_id = p_employee and h.archived_at is not null),
           app.has_permission(v_org, 'employee.bank.update')
      from (select 1) as one
      left join restricted.employee_bank_accounts b on b.employee_id = p_employee and b.archived_at is null;
end $$;

create function public.reveal_employee_bank_account(p_employee uuid)
returns table (account_holder_name text, bank_name text, account_number text, ifsc text, account_type public.bank_account_type)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid := app.employee_org_or_deny(p_employee, 'employee.bank.read');
begin
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'reveal', 'employee_bank_accounts', p_employee, jsonb_build_object('employee_id', p_employee));
  return query
    select b.account_holder_name, b.bank_name, b.account_number, b.ifsc, b.account_type
      from restricted.employee_bank_accounts b where b.employee_id = p_employee and b.archived_at is null;
end $$;

-- Replaces the current account; the previous one is archived (kept for payment history).
create function public.set_employee_bank_account(
  p_employee            uuid,
  p_account_holder_name text,
  p_bank_name           text,
  p_account_number      text,
  p_ifsc                text,
  p_account_type        public.bank_account_type
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'employee.bank.update') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update restricted.employee_bank_accounts set archived_at = now()
   where employee_id = p_employee and archived_at is null;
  insert into restricted.employee_bank_accounts
    (organization_id, employee_id, account_holder_name, bank_name, account_number, ifsc, account_type, created_by)
  values
    (v_org, p_employee, trim(p_account_holder_name), trim(p_bank_name), regexp_replace(p_account_number, '[\s-]', '', 'g'),
     upper(trim(p_ifsc)), p_account_type, auth.uid());
end $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

revoke execute on function public.employee_identity_summary(uuid) from public, anon;
revoke execute on function public.reveal_employee_identity(uuid) from public, anon;
revoke execute on function public.set_employee_identity(uuid, text, text, text, text, text, date) from public, anon;
revoke execute on function public.employee_bank_summary(uuid) from public, anon;
revoke execute on function public.reveal_employee_bank_account(uuid) from public, anon;
revoke execute on function public.set_employee_bank_account(uuid, text, text, text, text, public.bank_account_type) from public, anon;
grant execute on function public.employee_identity_summary(uuid) to authenticated, service_role;
grant execute on function public.reveal_employee_identity(uuid) to authenticated, service_role;
grant execute on function public.set_employee_identity(uuid, text, text, text, text, text, date) to authenticated, service_role;
grant execute on function public.employee_bank_summary(uuid) to authenticated, service_role;
grant execute on function public.reveal_employee_bank_account(uuid) to authenticated, service_role;
grant execute on function public.set_employee_bank_account(uuid, text, text, text, text, public.bank_account_type) to authenticated, service_role;
