-- PeopleCore · My Profile (Kredily parity): fuller personal details (blood group, marital status, disability,
-- alternate phone, permanent address), job title and billing status, education, family members, document proofs
-- and verification, and the signed-in user's own file history ("File Manager").
--
-- Education and family follow the personal-details rules: employee.personal.read / .update on that employee
-- (HR org-wide, the employee on their own record). Document verification is HR's (employee.document.delete on the
-- employee) and never on one's own documents.

-- ─── Personal details ───────────────────────────────────────────────────────

alter table public.employee_personal
  add column blood_group        text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  add column marital_status     text check (marital_status in ('single', 'married', 'divorced', 'widowed', 'separated')),
  add column is_disabled        boolean not null default false,
  add column alternate_phone    text check (alternate_phone ~ '^\+?[0-9 -]{7,20}$'),
  add column perm_same_as_current boolean not null default false,
  add column perm_address_line1 text check (char_length(perm_address_line1) <= 200),
  add column perm_address_line2 text check (char_length(perm_address_line2) <= 200),
  add column perm_city          text check (char_length(perm_city) <= 100),
  add column perm_state_code    text check (char_length(perm_state_code) <= 10),
  add column perm_postal_code   text check (perm_postal_code ~ '^[0-9A-Za-z -]{3,10}$');

-- The audit trail masks personal values; include the new columns.
drop trigger employee_personal_audit on public.employee_personal;
create trigger employee_personal_audit after insert or update or delete on public.employee_personal
  for each row execute function app.audit_row('date_of_birth', 'gender', 'personal_email', 'personal_phone',
                                              'address_line1', 'address_line2', 'city', 'state_code', 'postal_code',
                                              'blood_group', 'marital_status', 'is_disabled', 'alternate_phone',
                                              'perm_address_line1', 'perm_address_line2', 'perm_city', 'perm_state_code', 'perm_postal_code');

-- ─── Work details ───────────────────────────────────────────────────────────

alter table public.employees
  add column job_title text check (char_length(job_title) between 2 and 120),
  add column billable  boolean not null default false;

-- ─── Education ──────────────────────────────────────────────────────────────

create table public.employee_qualifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  level            text not null check (level in ('secondary', 'higher_secondary', 'diploma', 'bachelors', 'masters', 'doctorate', 'certificate', 'other')),
  degree           text not null check (char_length(degree) between 2 and 120),
  specialization   text check (char_length(specialization) <= 120),
  institution      text not null check (char_length(institution) between 2 and 160),
  start_year       smallint check (start_year between 1950 and 2100),
  end_year         smallint check (end_year between 1950 and 2100),
  score            text check (char_length(score) <= 20),
  created_at       timestamptz not null default now(),
  check (end_year is null or start_year is null or end_year >= start_year),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index employee_qualifications_employee_idx on public.employee_qualifications (organization_id, employee_id);
create trigger employee_qualifications_audit after insert or update or delete on public.employee_qualifications
  for each row execute function app.audit_row();

-- ─── Family ─────────────────────────────────────────────────────────────────

create table public.employee_family_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  name             text not null check (char_length(name) between 1 and 120),
  relationship     text not null check (relationship in ('spouse', 'child', 'father', 'mother', 'sibling', 'father_in_law', 'mother_in_law', 'other')),
  date_of_birth    date check (date_of_birth > '1900-01-01'),
  gender           public.gender,
  phone            text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  occupation       text check (char_length(occupation) <= 80),
  is_dependent     boolean not null default false,
  created_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index employee_family_members_employee_idx on public.employee_family_members (organization_id, employee_id);
create trigger employee_family_members_audit after insert or update or delete on public.employee_family_members
  for each row execute function app.audit_row('name', 'date_of_birth', 'phone');

alter table public.employee_qualifications enable row level security;
alter table public.employee_family_members enable row level security;

do $$
declare t text;
begin
  foreach t in array array['employee_qualifications', 'employee_family_members'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.can_access_employee(organization_id, employee_id, ''employee.personal.read''))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.can_access_employee(organization_id, employee_id, ''employee.personal.update''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (app.can_access_employee(organization_id, employee_id, ''employee.personal.update'')) with check (app.can_access_employee(organization_id, employee_id, ''employee.personal.update''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (app.can_access_employee(organization_id, employee_id, ''employee.personal.update''))', t);
  end loop;
end $$;

grant select, insert, update, delete on public.employee_qualifications, public.employee_family_members to authenticated;
grant all on public.employee_qualifications, public.employee_family_members to service_role;

-- ─── Document proofs and verification ───────────────────────────────────────

alter table public.employee_documents
  add column proves       text[] not null default '{}'
    check (proves <@ array['photo_id', 'date_of_birth', 'current_address', 'permanent_address']::text[]),
  add column verified_at  timestamptz,
  add column verified_by  uuid;

-- What a document is proof of. Whoever may upload for the employee may say so; a change clears verification.
create function public.set_document_proofs(p_document uuid, p_proves text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_doc public.employee_documents;
  v_new text[];
begin
  select * into v_doc from public.employee_documents d where d.id = p_document and d.deleted_at is null for update;
  if v_doc.id is null or not app.can_access_employee(v_doc.organization_id, v_doc.employee_id, 'employee.document.upload') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not coalesce(p_proves, '{}') <@ array['photo_id', 'date_of_birth', 'current_address', 'permanent_address']::text[] then
    raise exception 'Unknown proof type.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_new from unnest(coalesce(p_proves, '{}')) x;
  if v_new is distinct from v_doc.proves then
    update public.employee_documents set proves = v_new, verified_at = null, verified_by = null where id = v_doc.id;
  end if;
end $$;

-- HR verifies (or un-verifies) a document. Never one's own.
create function public.verify_employee_document(p_document uuid, p_verified boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_doc public.employee_documents;
begin
  select * into v_doc from public.employee_documents d where d.id = p_document and d.deleted_at is null for update;
  if v_doc.id is null or not app.can_access_employee(v_doc.organization_id, v_doc.employee_id, 'employee.document.delete')
     or app.is_own_employee(v_doc.employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.employee_documents
     set verified_at = case when p_verified then now() end,
         verified_by = case when p_verified then auth.uid() end
   where id = v_doc.id;
end $$;

revoke all on function public.set_document_proofs(uuid, text[]) from public, anon;
revoke all on function public.verify_employee_document(uuid, boolean) from public, anon;
grant execute on function public.set_document_proofs(uuid, text[]) to authenticated, service_role;
grant execute on function public.verify_employee_document(uuid, boolean) to authenticated, service_role;

-- ─── File Manager ───────────────────────────────────────────────────────────

-- The files the signed-in user generated or downloaded in this organization (exports, statutory files, bank
-- advice, document downloads), newest first. Only their own history; nothing about anyone else.
create function public.my_file_activity(p_org uuid, p_limit integer default 100)
returns table (occurred_at timestamptz, action text, entity_type text, entity_id uuid, metadata jsonb)
language sql stable security definer set search_path = '' as $$
  select a.occurred_at, a.action, a.entity_type, a.entity_id, a.metadata
    from public.audit_events a
   where app.is_member(p_org) and a.organization_id = p_org and a.actor_user_id = auth.uid()
     and a.action in ('export', 'payroll_export', 'bank_file_export', 'download')
   order by a.occurred_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
revoke all on function public.my_file_activity(uuid, integer) from public, anon;
grant execute on function public.my_file_activity(uuid, integer) to authenticated, service_role;
