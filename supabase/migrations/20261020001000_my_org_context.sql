-- PeopleCore · One round trip for the page shell.
--
-- Every app page needed five sequential requests before its own queries: the organization by slug, my_permissions,
-- the platform-admin check, the two-factor requirement and the switched-off modules. my_org_context returns all of
-- them at once. It runs as the caller (security invoker), so the organization is still found through RLS — a slug
-- the user can't see returns null, exactly like the direct select — and each part keeps its own rules
-- (my_permissions withholds privileged roles at aal1, org_modules is members-only).

create function public.my_org_context(p_slug text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with o as (
    select id, name, slug, is_demo, timezone, status from public.organizations where slug = p_slug
  )
  select jsonb_build_object(
    'org', (select to_jsonb(o) from o),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('permission_key', g.permission_key, 'scope', g.scope))
                          from o, public.my_permissions(o.id) g), '[]'::jsonb),
    'platform_admin', exists (select 1 from public.platform_admins where user_id = auth.uid()),
    'needs_mfa', public.my_mfa_requirement(),
    'disabled_modules', coalesce((select jsonb_agg(m.module order by m.module)
                                    from o join public.org_modules m on m.organization_id = o.id and not m.enabled), '[]'::jsonb)
  );
$$;
revoke all on function public.my_org_context(text) from public;
grant execute on function public.my_org_context(text) to authenticated;
