-- PeopleCore · Explicit table privileges (least privilege).
--
-- Supabase projects may or may not auto-grant ALL on new public tables to anon/authenticated. Granting
-- explicitly makes behaviour identical either way and drops privileges RLS cannot police (TRUNCATE,
-- REFERENCES, TRIGGER). The test database starts with NO default grants, so a table that a migration
-- forgets to grant fails the test suite instead of failing in production.

-- Future objects created by this role get no automatic API privileges; every migration grants explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- Read-only to signed-in users (writes happen through security-definer functions or not at all).
grant select on public.permissions, public.platform_admins, public.audit_events to authenticated;

-- Updated in place (org settings); created only through create_organization().
grant select, update on public.organizations to authenticated;

-- Full CRUD, constrained by RLS policies.
grant select, insert, update, delete on
  public.organization_members, public.roles, public.role_permissions, public.member_roles,
  public.legal_entities, public.locations, public.cost_centres, public.departments, public.designations
  to authenticated;

-- Never hard-deleted by users (exits and retention handle removal).
grant select, insert, update on public.employees, public.employment_records to authenticated;
