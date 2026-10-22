-- PeopleCore · Two-step sign-in is off unless it is switched on. An owner turns it on for their organization in
-- Settings › Controls, and it then applies to everyone there, whatever their role; platform admins have their own
-- switch in the console. Anyone can still turn it on for themselves (Account settings). Nobody is asked for a code at
-- sign-up or at first sign-in unless one of those switches says so.

alter table public.org_controls alter column require_mfa set default false;
update public.org_controls set require_mfa = false;
alter table public.platform_settings alter column require_mfa_for_admins set default false;
update public.platform_settings set require_mfa_for_admins = false;

-- Role grants apply in a password-only session unless the organization requires two-step; then everyone there needs
-- the code (aal2). p_requires (the role's flag under the old rule) stays in the signature and no longer matters.
create or replace function app.role_mfa_ok(p_requires boolean, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.current_aal() = 'aal2'
      or not coalesce((select c.require_mfa from public.org_controls c where c.organization_id = p_org), false);
$$;

create or replace function app.platform_mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.current_aal() = 'aal2'
      or not coalesce((select s.require_mfa_for_admins from public.platform_settings s), false);
$$;

-- Does the caller belong anywhere that requires a code? (Ignores the session's aal, so the app can ask for it.)
create or replace function public.my_mfa_requirement() returns boolean
language sql stable security definer set search_path = '' as $$
  select (exists (select 1 from public.platform_admins where user_id = auth.uid())
          and coalesce((select s.require_mfa_for_admins from public.platform_settings s), false))
      or exists (
        select 1
          from public.organization_members m
          join public.organizations o on o.id = m.organization_id and o.status = 'active'
          join public.org_controls c on c.organization_id = m.organization_id and c.require_mfa
         where m.user_id = auth.uid() and m.status = 'active');
$$;

-- Switching it on needs the person doing it to use it already (a two-step session), so nobody turns it on and locks
-- themselves out half way. Switching it off needs role.manage, which while it is on also means a two-step session.
create or replace function public.set_org_require_mfa(p_org uuid, p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'role.manage') then raise exception 'Only owners can change two-step sign-in.' using errcode = '42501'; end if;
  if p_on and app.current_aal() <> 'aal2' then
    raise exception 'Turn on two-step sign-in for yourself first (Account settings), then for everyone.' using errcode = '22023';
  end if;
  insert into public.org_controls (organization_id, require_mfa) values (p_org, p_on)
  on conflict (organization_id) do update set require_mfa = excluded.require_mfa;
end $$;

create or replace function public.set_platform_require_mfa(p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'Only platform administrators can change this.' using errcode = '42501'; end if;
  if p_on and app.current_aal() <> 'aal2' then
    raise exception 'Turn on two-step sign-in for yourself first, then for every platform administrator.' using errcode = '22023';
  end if;
  update public.platform_settings set require_mfa_for_admins = p_on, updated_at = now(), updated_by = auth.uid();
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  values (null, auth.uid(), 'update', 'platform_settings', null, jsonb_build_object('require_mfa_for_admins', p_on));
end $$;
