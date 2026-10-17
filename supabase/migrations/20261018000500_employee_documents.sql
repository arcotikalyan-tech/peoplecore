-- PeopleCore · Core HR: employee documents in private storage.
--
-- Files live in the private `employee-documents` bucket. storage.objects gets NO policies for
-- authenticated users, so browsers can never list, read or write objects directly. The app server:
--   1. checks the caller's permission, stores the file with the service role under
--      <org>/<employee>/<document id>, then records it with add_employee_document (which re-checks the
--      permission as the caller and is the authority; on refusal the server removes the file);
--   2. downloads through document_download (permission check + audit event) and a 60-second signed URL;
--   3. deletes through delete_employee_document (soft delete, audited), then removes the stored file.
-- Rows are kept after deletion so the audit trail still says what existed.

-- ─── Permission catalog additions ───────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('employee.document.read', 'core_hr', 'View and download employee documents', true),
  ('employee.document.upload', 'core_hr', 'Upload employee documents', true),
  ('employee.document.delete', 'core_hr', 'Delete employee documents', true);

insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'employee.document.read', 'org'),
  ('owner', 'employee.document.upload', 'org'),
  ('owner', 'employee.document.delete', 'org'),
  ('hr_admin', 'employee.document.read', 'org'),
  ('hr_admin', 'employee.document.upload', 'org'),
  ('hr_admin', 'employee.document.delete', 'org'),
  ('employee', 'employee.document.read', 'self'),
  ('employee', 'employee.document.upload', 'self');

insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t
  join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key in ('employee.document.read', 'employee.document.upload', 'employee.document.delete')
on conflict (role_id, permission_key) do nothing;

-- ─── Bucket ─────────────────────────────────────────────────────────────────
-- Limits are enforced by Storage as well as by the app (which also checks the file's actual bytes).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-documents', 'employee-documents', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ─── Table ──────────────────────────────────────────────────────────────────

create type public.document_category as enum
  ('identity', 'address', 'education', 'employment', 'contract', 'medical', 'other');

create table public.employee_documents (
  id               uuid primary key,
  organization_id  uuid not null,
  employee_id      uuid not null,
  category         public.document_category not null,
  title            text not null check (char_length(title) between 1 and 120),
  file_name        text not null check (char_length(file_name) between 1 and 200),
  content_type     text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes       integer not null check (size_bytes between 1 and 5242880),
  storage_path     text not null unique,
  uploaded_by      uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid,
  unique (organization_id, id),
  check (storage_path = organization_id::text || '/' || employee_id::text || '/' || id::text),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index employee_documents_employee_idx on public.employee_documents (organization_id, employee_id, created_at desc)
  where deleted_at is null;

create trigger employee_documents_audit after insert or update or delete on public.employee_documents
  for each row execute function app.audit_row();

alter table public.employee_documents enable row level security;

-- Reads only; every write goes through the functions below.
create policy employee_documents_select on public.employee_documents for select to authenticated
  using (deleted_at is null and app.can_access_employee(organization_id, employee_id, 'employee.document.read'));

grant select on public.employee_documents to authenticated;
grant all on public.employee_documents to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

-- Records a stored file. The id is chosen by the server before storing, and fixes the path.
create function public.add_employee_document(
  p_employee     uuid,
  p_id           uuid,
  p_category     public.document_category,
  p_title        text,
  p_file_name    text,
  p_content_type text,
  p_size_bytes   integer
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org  uuid := app.employee_org_or_deny(p_employee, 'employee.document.upload');
  v_path text := v_org::text || '/' || p_employee::text || '/' || p_id::text;
begin
  insert into public.employee_documents
    (id, organization_id, employee_id, category, title, file_name, content_type, size_bytes, storage_path)
  values (p_id, v_org, p_employee, p_category, btrim(p_title), btrim(p_file_name), p_content_type, p_size_bytes, v_path);
  return v_path;
end $$;

-- What the server needs to sign a download. Refuses without saying whether the document exists.
create function public.document_download(p_document uuid)
returns table (storage_path text, file_name text, content_type text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_doc public.employee_documents;
begin
  select * into v_doc from public.employee_documents d where d.id = p_document and d.deleted_at is null;
  if v_doc.id is null or not app.can_access_employee(v_doc.organization_id, v_doc.employee_id, 'employee.document.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_doc.organization_id, auth.uid(), 'download', 'employee_documents', v_doc.id,
          jsonb_build_object('employee_id', v_doc.employee_id));
  return query select v_doc.storage_path, v_doc.file_name, v_doc.content_type;
end $$;

-- Soft delete; returns the storage path so the server can remove the file.
create function public.delete_employee_document(p_document uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_doc public.employee_documents;
begin
  select * into v_doc from public.employee_documents d where d.id = p_document and d.deleted_at is null for update;
  if v_doc.id is null or not app.can_access_employee(v_doc.organization_id, v_doc.employee_id, 'employee.document.delete') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.employee_documents set deleted_at = now(), deleted_by = auth.uid() where id = v_doc.id;
  return v_doc.storage_path;
end $$;

revoke all on function public.add_employee_document(uuid, uuid, public.document_category, text, text, text, integer) from public, anon;
revoke all on function public.document_download(uuid) from public, anon;
revoke all on function public.delete_employee_document(uuid) from public, anon;
grant execute on function public.add_employee_document(uuid, uuid, public.document_category, text, text, text, integer) to authenticated, service_role;
grant execute on function public.document_download(uuid) to authenticated, service_role;
grant execute on function public.delete_employee_document(uuid) to authenticated, service_role;
