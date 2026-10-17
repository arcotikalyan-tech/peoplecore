-- PeopleCore · Phase 1b (1/3): suspended organizations, last-owner protection, platform-controlled fields.

-- ─── Suspended organizations lose all tenant access ─────────────────────────
-- Membership and permissions now also require organizations.status = 'active'. Every policy and RPC
-- builds on these helpers, so suspension takes effect everywhere at once.

create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id and o.status = 'active'
     where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function app.permission_scopes(p_org uuid, p_permission text)
returns setof public.permission_scope
language sql stable security definer set search_path = '' as $$
  select distinct rp.scope
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.member_roles mr
      on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
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
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active';
$$;

-- The caller's own organizations, including suspended ones, so the app can explain why access stopped.
create function public.my_organizations()
returns table (id uuid, name text, slug text, is_demo boolean, status public.org_status)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.slug, o.is_demo, o.status
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = auth.uid() and m.status = 'active'
   order by o.name;
$$;

-- ─── Platform-controlled organization fields ────────────────────────────────
-- Organization admins may edit descriptive fields only. Slug, status and the demo flag belong to the
-- platform; status changes go through this audited RPC.

revoke update on public.organizations from authenticated;
grant update (name, timezone, country_code) on public.organizations to authenticated;

create function public.set_organization_status(p_org uuid, p_status public.org_status) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can change an organization''s status' using errcode = '42501';
  end if;
  update public.organizations set status = p_status where id = p_org;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
end $$;

-- ─── Every organization keeps at least one active, permanent owner ──────────
-- Deferred to commit so ownership can be handed over inside one transaction in any order.

create function app.assert_org_has_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := old.organization_id;
begin
  if tg_table_name = 'member_roles' then
    -- Only removing (or changing away from) an owner grant can break the rule.
    if not exists (select 1 from public.roles where id = old.role_id and key = 'owner') then
      return null;
    end if;
  else
    -- organization_members: only an owner leaving active status (or being removed) can break it.
    if old.status <> 'active' or (tg_op = 'UPDATE' and new.status = 'active') then
      return null;
    end if;
    if not exists (
      select 1 from public.member_roles mr
        join public.roles r on r.id = mr.role_id and r.key = 'owner'
       where mr.member_id = old.id
    ) then
      return null;
    end if;
  end if;

  -- The whole organization is being deleted: nothing left to protect.
  if not exists (select 1 from public.organizations where id = v_org) then
    return null;
  end if;

  if not exists (
    select 1
      from public.member_roles mr
      join public.roles r on r.id = mr.role_id and r.key = 'owner'
      join public.organization_members m on m.id = mr.member_id and m.status = 'active'
     where mr.organization_id = v_org and mr.valid_until is null
  ) then
    raise exception 'An organization must keep at least one active owner. Add another owner first.'
      using errcode = '22023';
  end if;
  return null;
end $$;

create constraint trigger member_roles_keep_owner
  after delete or update on public.member_roles
  deferrable initially deferred
  for each row execute function app.assert_org_has_owner();

create constraint trigger organization_members_keep_owner
  after delete or update of status on public.organization_members
  deferrable initially deferred
  for each row execute function app.assert_org_has_owner();

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

revoke execute on function public.my_organizations() from public, anon;
revoke execute on function public.set_organization_status(uuid, public.org_status) from public, anon;
grant execute on function public.my_organizations() to authenticated, service_role;
grant execute on function public.set_organization_status(uuid, public.org_status) to authenticated, service_role;
