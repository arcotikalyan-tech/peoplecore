-- PeopleCore · Phase 1b (2/3): member invitations and role assignment with safe delegation.
--
-- Rule: a role can be granted or revoked by holders of role.manage (owners), or by holders of the role's
-- `assignment_permission`. Administrative roles keep the default (role.manage = owner-only); everyday
-- roles are assignable with member.manage (HR). Nobody can manage a member who holds a role they could
-- not grant themselves, so HR cannot suspend, remove or re-role an owner or payroll administrator.

alter table app.role_templates
  add column assignment_permission text not null default 'role.manage' references public.permissions (key);
update app.role_templates set assignment_permission = 'member.manage'
 where role_key in ('employee', 'manager', 'department_head', 'recruiter');

alter table public.roles
  add column assignment_permission text not null default 'role.manage' references public.permissions (key);
update public.roles r set assignment_permission = t.assignment_permission
  from app.role_templates t
 where r.is_system and r.key = t.role_key;

create or replace function app.seed_org_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.roles (organization_id, key, name, description, is_system, assignment_permission)
  select new.id, t.role_key, t.name, t.description, true, t.assignment_permission from app.role_templates t;

  insert into public.role_permissions (organization_id, role_id, permission_key, scope)
  select new.id, r.id, tp.permission_key, tp.scope
    from app.role_template_permissions tp
    join public.roles r on r.organization_id = new.id and r.key = tp.role_key;
  return null;
end $$;

-- ─── Delegation helpers ─────────────────────────────────────────────────────

create function app.can_grant_role(p_org uuid, p_role uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.roles r
     where r.id = p_role and r.organization_id = p_org
       and (app.has_permission(p_org, 'role.manage') or app.has_permission(p_org, r.assignment_permission))
  );
$$;

create function app.can_manage_member(p_org uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_org, 'role.manage')
      or (app.has_permission(p_org, 'member.manage')
          and not exists (
            select 1 from public.member_roles mr
             where mr.member_id = p_member and not app.can_grant_role(p_org, mr.role_id)));
$$;

-- ─── Policies ───────────────────────────────────────────────────────────────

drop policy member_roles_write on public.member_roles;
create policy member_roles_insert on public.member_roles for insert to authenticated
  with check (app.can_grant_role(organization_id, role_id) and app.can_manage_member(organization_id, member_id));
create policy member_roles_delete on public.member_roles for delete to authenticated
  using (app.can_grant_role(organization_id, role_id) and app.can_manage_member(organization_id, member_id));
-- Grants are added or removed, never edited in place.
revoke update on public.member_roles from authenticated;

drop policy members_update on public.organization_members;
drop policy members_delete on public.organization_members;
create policy members_update on public.organization_members for update to authenticated
  using (app.can_manage_member(organization_id, id))
  with check (app.can_manage_member(organization_id, id));
create policy members_delete on public.organization_members for delete to authenticated
  using (app.can_manage_member(organization_id, id));
-- Only the status of a membership can change; who and where it belongs to cannot.
revoke update on public.organization_members from authenticated;
grant update (status) on public.organization_members to authenticated;

-- ─── RPCs ───────────────────────────────────────────────────────────────────

-- Member list with sign-in emails (auth.users is not exposed through the API). member.manage only.
create function public.org_members(p_org uuid)
returns table (
  member_id uuid, user_id uuid, email text, status public.member_status, joined_at timestamptz,
  last_sign_in_at timestamptz, role_ids uuid[], employee_id uuid, employee_name text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'member.manage') then
    raise exception 'not authorized to view members' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, u.email::text, m.status, m.created_at, u.last_sign_in_at,
           coalesce(array_agg(mr.role_id) filter (where mr.role_id is not null), '{}'::uuid[]),
           e.id, nullif(concat_ws(' ', e.first_name, e.last_name), '')
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      left join public.member_roles mr on mr.member_id = m.id
      left join public.employees e on e.organization_id = m.organization_id and e.user_id = m.user_id
     where m.organization_id = p_org
     group by m.id, u.email, u.last_sign_in_at, e.id
     order by lower(u.email::text);
end $$;

-- Roles the caller may grant in this organization (for the invite and edit forms).
create function public.grantable_roles(p_org uuid)
returns table (id uuid, key text, name text, description text)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.key, r.name, r.description
    from public.roles r
   where r.organization_id = p_org and app.can_grant_role(p_org, r.id)
   order by r.name;
$$;

-- Adds an existing auth user as an *invited* member with roles, optionally linking their employee
-- record. Security invoker: every statement is checked by RLS, so the delegation rules apply.
create function public.add_member(p_org uuid, p_user_id uuid, p_role_ids uuid[], p_employee_id uuid default null)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_member uuid;
begin
  if coalesce(cardinality(p_role_ids), 0) = 0 then
    raise exception 'Choose at least one role.' using errcode = '22023';
  end if;

  insert into public.organization_members (organization_id, user_id, status, invited_by)
  values (p_org, p_user_id, 'invited', auth.uid())
  returning id into v_member;

  insert into public.member_roles (organization_id, member_id, role_id, granted_by)
  select p_org, v_member, r, auth.uid() from unnest(p_role_ids) r;

  if p_employee_id is not null then
    update public.employees set user_id = p_user_id
     where id = p_employee_id and organization_id = p_org and user_id is null;
    if not found then
      raise exception 'That employee record is already linked to another account.' using errcode = '22023';
    end if;
  end if;
  return v_member;
end $$;

-- Replaces a member's roles. Refuses (rather than half-applying) when the caller may not remove a role.
create function public.set_member_roles(p_member uuid, p_role_ids uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid;
  v_wanted uuid[] := coalesce(p_role_ids, '{}');
begin
  select organization_id into v_org from public.organization_members where id = p_member;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if cardinality(v_wanted) = 0 then
    raise exception 'A member needs at least one role. Remove the member instead.' using errcode = '22023';
  end if;

  delete from public.member_roles where member_id = p_member and not (role_id = any (v_wanted));
  -- RLS silently skips rows the caller may not delete; detect that instead of reporting success.
  if exists (select 1 from public.member_roles where member_id = p_member and not (role_id = any (v_wanted))) then
    raise exception 'you cannot remove one or more of these roles' using errcode = '42501';
  end if;

  insert into public.member_roles (organization_id, member_id, role_id, granted_by)
  select v_org, p_member, r, auth.uid()
    from unnest(v_wanted) r
   where not exists (select 1 from public.member_roles mr where mr.member_id = p_member and mr.role_id = r);
end $$;

-- Activates the caller's pending invitations (called when they first open the app after signing in).
create function public.accept_invitations() returns integer
language sql volatile security definer set search_path = '' as $$
  with accepted as (
    update public.organization_members set status = 'active'
     where user_id = auth.uid() and status = 'invited'
    returning 1
  )
  select count(*)::int from accepted;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

revoke execute on function public.org_members(uuid) from public, anon;
revoke execute on function public.grantable_roles(uuid) from public, anon;
revoke execute on function public.add_member(uuid, uuid, uuid[], uuid) from public, anon;
revoke execute on function public.set_member_roles(uuid, uuid[]) from public, anon;
revoke execute on function public.accept_invitations() from public, anon;
grant execute on function public.org_members(uuid) to authenticated, service_role;
grant execute on function public.grantable_roles(uuid) to authenticated, service_role;
grant execute on function public.add_member(uuid, uuid, uuid[], uuid) to authenticated, service_role;
grant execute on function public.set_member_roles(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.accept_invitations() to authenticated, service_role;
