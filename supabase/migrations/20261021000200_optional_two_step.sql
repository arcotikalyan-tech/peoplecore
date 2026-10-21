-- PeopleCore · Two-step sign-in becomes a setting (the owner's decision, 2026-10-21).
--
-- * Per organization: org_controls.require_mfa (default on). When an owner turns it off, roles flagged
--   requires_mfa (owner, HR, payroll, auditor, custom roles) work in password-only (aal1) sessions in that
--   organization. Only owners (role.manage) change it, through set_org_require_mfa; turning it off therefore
--   itself needs a two-step session while it is on.
-- * Platform-wide: platform_settings.require_mfa_for_admins (default on). When off, platform admins' powers
--   apply in aal1 sessions too. Only a platform admin changes it.
-- * Everything that granted privileged roles "only in aal2" now asks app.role_mfa_ok(requires_mfa, org).

alter table public.org_controls add column require_mfa boolean not null default true;
revoke update on public.org_controls from authenticated;
grant update (block_self_edit, salary_history_visible, birthdays_visible) on public.org_controls to authenticated;

create table public.platform_settings (
  id                      boolean primary key default true check (id),
  require_mfa_for_admins  boolean not null default true,
  updated_at              timestamptz not null default now(),
  updated_by              uuid
);
insert into public.platform_settings default values;
alter table public.platform_settings enable row level security;
create policy platform_settings_select on public.platform_settings for select to authenticated using (true);
grant select on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;

-- A role flagged requires_mfa is usable in this session: second factor done, or the organization doesn't require it.
create function app.role_mfa_ok(p_requires boolean, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not p_requires
      or app.current_aal() = 'aal2'
      or not coalesce((select c.require_mfa from public.org_controls c where c.organization_id = p_org), true);
$$;

create function app.platform_mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.current_aal() = 'aal2'
      or not coalesce((select s.require_mfa_for_admins from public.platform_settings s), true);
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
      on r.id = mr.role_id and app.role_mfa_ok(r.requires_mfa, m.organization_id)
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
      on r.id = mr.role_id and app.role_mfa_ok(r.requires_mfa, m.organization_id)
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function app.orgs_with_scope(p_permission text, p_scope public.permission_scope) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct m.organization_id
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.member_roles mr
      on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
    join public.roles r
      on r.id = mr.role_id and app.role_mfa_ok(r.requires_mfa, m.organization_id)
    join public.role_permissions rp
      on rp.role_id = mr.role_id and rp.permission_key = p_permission and rp.scope = p_scope
   where m.user_id = auth.uid()
     and m.status = 'active';
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.platform_mfa_ok()
     and exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Does the caller hold anything that still needs a second factor? (Ignores aal, so the app can ask for it.)
create or replace function public.my_mfa_requirement() returns boolean
language sql stable security definer set search_path = '' as $$
  select (exists (select 1 from public.platform_admins where user_id = auth.uid())
          and coalesce((select s.require_mfa_for_admins from public.platform_settings s), true))
      or exists (
        select 1
          from public.organization_members m
          join public.organizations o on o.id = m.organization_id and o.status = 'active'
          join public.member_roles mr
            on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
          join public.roles r on r.id = mr.role_id and r.requires_mfa
          left join public.org_controls c on c.organization_id = m.organization_id
         where m.user_id = auth.uid() and m.status = 'active' and coalesce(c.require_mfa, true)
      );
$$;

create function public.set_org_require_mfa(p_org uuid, p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'role.manage') then raise exception 'Only owners can change two-step sign-in.' using errcode = '42501'; end if;
  insert into public.org_controls (organization_id, require_mfa) values (p_org, p_on)
  on conflict (organization_id) do update set require_mfa = excluded.require_mfa;
end $$;

create function public.set_platform_require_mfa(p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'Only platform administrators can change this.' using errcode = '42501'; end if;
  update public.platform_settings set require_mfa_for_admins = p_on, updated_at = now(), updated_by = auth.uid();
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  values (null, auth.uid(), 'update', 'platform_settings', null, jsonb_build_object('require_mfa_for_admins', p_on));
end $$;

revoke all on function app.role_mfa_ok(boolean, uuid), app.platform_mfa_ok() from public;
grant execute on function app.role_mfa_ok(boolean, uuid), app.platform_mfa_ok() to authenticated, service_role;
revoke all on function public.set_org_require_mfa(uuid, boolean), public.set_platform_require_mfa(boolean) from public;
grant execute on function public.set_org_require_mfa(uuid, boolean), public.set_platform_require_mfa(boolean) to authenticated;
