-- PeopleCore · Account basics: every sign-in has a password, admins see who still has to set one, and employees see
-- how complete their profile is.
--
-- * my_needs_password(): the signed-in person has no password yet (invited, or only ever used email links). The app
--   asks them to choose one before anything else; my_org_context carries it so the shell needs no extra round trip.
-- * member_sign_in_status(org): for people with member.manage, each member's sign-in email, whether they have set a
--   password, when they were invited and last signed in, and the employee record their sign-in is linked to.
-- * my_profile_completeness(org): which parts of their own profile the signed-in employee has filled in (personal
--   details, blood group, address, emergency contact, PAN, bank account). Yes or no only; never the values.

create function public.my_needs_password() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(u.encrypted_password, '') = '' from auth.users u where u.id = auth.uid()), false);
$$;
revoke all on function public.my_needs_password() from public, anon;
grant execute on function public.my_needs_password() to authenticated, service_role;

create or replace function public.my_org_context(p_slug text) returns jsonb
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
    'needs_password', public.my_needs_password(),
    'disabled_modules', coalesce((select jsonb_agg(m.module order by m.module)
                                    from o join public.org_modules m on m.organization_id = o.id and not m.enabled), '[]'::jsonb)
  );
$$;

create function public.member_sign_in_status(p_org uuid)
returns table (member_id uuid, user_id uuid, email text, has_password boolean, invited_at timestamptz, last_sign_in_at timestamptz,
               employee_id uuid, employee_name text)
language sql stable security definer set search_path = '' as $$
  select om.id, om.user_id, u.email, coalesce(u.encrypted_password, '') <> '', u.invited_at, u.last_sign_in_at,
         e.id, nullif(trim(concat_ws(' ', e.first_name, e.last_name)), '')
    from public.organization_members om
    join auth.users u on u.id = om.user_id
    left join public.employees e on e.organization_id = om.organization_id and e.user_id = om.user_id
   where om.organization_id = p_org and app.has_permission(p_org, 'member.manage');
$$;
revoke all on function public.member_sign_in_status(uuid) from public, anon;
grant execute on function public.member_sign_in_status(uuid) to authenticated, service_role;

create function public.my_profile_completeness(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'employee_id', e.id,
    'personal', coalesce(p.date_of_birth is not null and p.gender is not null and p.personal_phone is not null, false),
    'blood_group', coalesce(p.blood_group is not null, false),
    'address', coalesce(p.address_line1 is not null and p.city is not null and p.postal_code is not null, false),
    'emergency', exists (select 1 from public.emergency_contacts c where c.employee_id = e.id),
    'identity', exists (select 1 from restricted.employee_identity i where i.employee_id = e.id and i.pan is not null),
    'bank', exists (select 1 from restricted.employee_bank_accounts b where b.employee_id = e.id and b.archived_at is null))
    from public.employees e
    left join public.employee_personal p on p.employee_id = e.id
   where e.organization_id = p_org and e.user_id = auth.uid() and app.is_member(p_org);
$$;
revoke all on function public.my_profile_completeness(uuid) from public, anon;
grant execute on function public.my_profile_completeness(uuid) to authenticated, service_role;
