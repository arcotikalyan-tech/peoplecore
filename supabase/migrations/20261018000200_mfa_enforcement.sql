-- PeopleCore · Phase 1b (3/3): two-factor sign-in for privileged roles, enforced in the database.
--
-- Roles flagged requires_mfa (owner, HR admin, payroll admin, auditor) and platform-admin status only
-- take effect when the session's JWT carries aal2, i.e. the user completed a second factor (TOTP).
-- A stolen password alone therefore yields at most the everyday roles, even through the raw API.

alter table app.role_templates add column requires_mfa boolean not null default false;
update app.role_templates set requires_mfa = true where role_key in ('owner', 'hr_admin', 'payroll_admin', 'auditor');

alter table public.roles add column requires_mfa boolean not null default false;
update public.roles r set requires_mfa = t.requires_mfa
  from app.role_templates t
 where r.is_system and r.key = t.role_key;

create or replace function app.seed_org_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.roles (organization_id, key, name, description, is_system, assignment_permission, requires_mfa)
  select new.id, t.role_key, t.name, t.description, true, t.assignment_permission, t.requires_mfa
    from app.role_templates t;

  insert into public.role_permissions (organization_id, role_id, permission_key, scope)
  select new.id, r.id, tp.permission_key, tp.scope
    from app.role_template_permissions tp
    join public.roles r on r.organization_id = new.id and r.key = tp.role_key;
  return null;
end $$;

-- Authenticator assurance level of the current request ('aal1' password only, 'aal2' second factor).
create function app.current_aal() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;

create or replace function app.permission_scopes(p_org uuid, p_permission text)
returns setof public.permission_scope
language sql stable security definer set search_path = '' as $$
  select distinct rp.scope
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.member_roles mr
      on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
    join public.roles r
      on r.id = mr.role_id and (not r.requires_mfa or app.current_aal() = 'aal2')
    join public.role_permissions rp
      on rp.role_id = mr.role_id and rp.permission_key = p_permission
   where m.organization_id = p_org
     and m.user_id = auth.uid()
     and m.status = 'active';
$$;

create or replace function public.my_permissions(p_org uuid)
returns table (permission_key text, scope public.permission_scope)
language sql stable security definer set search_path = '' as $$
  select distinct rp.permission_key, rp.scope
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.member_roles mr
      on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
    join public.roles r
      on r.id = mr.role_id and (not r.requires_mfa or app.current_aal() = 'aal2')
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.current_aal() = 'aal2'
     and exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Does the caller hold anything that needs a second factor? (Ignores aal, so the app can ask for it.)
create function public.my_mfa_requirement() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
      or exists (
        select 1
          from public.organization_members m
          join public.organizations o on o.id = m.organization_id and o.status = 'active'
          join public.member_roles mr
            on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
          join public.roles r on r.id = mr.role_id and r.requires_mfa
         where m.user_id = auth.uid() and m.status = 'active'
      );
$$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function public.my_mfa_requirement() from public, anon;
grant execute on function public.my_mfa_requirement() to authenticated, service_role;
