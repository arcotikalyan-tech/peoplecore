-- PeopleCore · Everyone added to an organization gets an employee record (owner's choice, on by default).
--
-- Settings › Controls has "Add an employee record for everyone added" (org_controls.auto_employee_record, on unless
-- switched off). While it's on, whoever is added gets an employee record linked to their sign-in, so they can punch
-- in, apply for leave and be paid. That covers people invited by HR, owners added in the platform console, and the
-- owner a new organization is created with. A record HR already added with their work email (and no sign-in yet) is
-- linked; otherwise a new one is created: the name from their sign-up request, else from their email,
-- joining today, permanent. HR fills in the rest under Employees.
--
-- An invitation can leave the record out for people who don't work for the organization (an accountant, an auditor):
-- organization_members.without_employee_record, which add_member takes as p_without_record. Adding someone never fails
-- over their record (the plan's employee limit, say): it's left for HR to add.
-- add_missing_employee_records(org) does the same for people added before (Users & roles › Add their employee records).

alter table public.org_controls add column auto_employee_record boolean not null default true;
grant update (auto_employee_record) on public.org_controls to authenticated;
alter table public.organization_members add column without_employee_record boolean not null default false;

-- Linking a sign-in to a record stays with people who manage members, and with these functions, which decide it
-- themselves (a platform admin adding an owner isn't a member of the organization). They set app.linking_member for the
-- one statement; it can't be set through the API.
create or replace function app.guard_employee_user_id() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Signed-in requests run as the authenticated role; the worker, the seed and the database owner don't.
  if current_setting('role', true) = 'authenticated' and auth.uid() is not null
     and coalesce(current_setting('app.linking_member', true), '') <> 'on'
     and ((tg_op = 'INSERT' and new.user_id is not null) or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id))
     and not app.has_permission(new.organization_id, 'member.manage') then
    raise exception 'Only people who manage members can change whose sign-in an employee record uses.' using errcode = '42501';
  end if;
  return new;
end $$;

-- "asha.rao@…" → Asha / Rao. Digits and separators become spaces; nothing left gives "New" / "Employee".
create function app.name_from_email(p_email text) returns text[]
language sql immutable set search_path = '' as $$
  select case when w = '' then array['New', 'Employee']
              else array[initcap(split_part(w, ' ', 1)), nullif(initcap(btrim(substr(w, length(split_part(w, ' ', 1)) + 1))), '')] end
    from (select btrim(regexp_replace(regexp_replace(split_part(coalesce(p_email, ''), '@', 1), '[^A-Za-z]+', ' ', 'g'), '\s+', ' ', 'g')) as w) s;
$$;

-- The member's employee record: theirs already, an unlinked one with their work email, or a new one. Null when they
-- shouldn't have one (marked as not an employee, removed, or the organization switched the rule off and p_force isn't
-- set), or when it can't be made (the plan's employee limit): never an error, so adding someone always works.
create function app.ensure_member_employee(p_member uuid, p_force boolean default false) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.organization_members;
  v_email text;
  v_name text;
  v_parts text[];
  v_id uuid;
  v_today date;
begin
  select * into v_m from public.organization_members where id = p_member;
  if v_m.id is null or v_m.status not in ('active', 'invited') or v_m.without_employee_record then
    return null;
  end if;
  -- Only for people who add members there (and platform admins); the worker and the database owner aren't asked.
  if current_setting('role', true) = 'authenticated' and auth.uid() is not null
     and not (app.is_platform_admin() or app.has_permission(v_m.organization_id, 'member.manage')) then
    return null;
  end if;
  select e.id into v_id from public.employees e where e.organization_id = v_m.organization_id and e.user_id = v_m.user_id;
  if v_id is not null then
    return v_id;
  end if;
  if not p_force and not coalesce((select c.auto_employee_record from public.org_controls c where c.organization_id = v_m.organization_id), true) then
    return null;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_m.user_id;
  if v_email is null then
    return null;
  end if;

  begin
    perform set_config('app.linking_member', 'on', true);
    -- A record HR added before they joined, with their work email and no sign-in, is theirs.
    update public.employees set user_id = v_m.user_id
     where id = (select e.id from public.employees e
                  where e.organization_id = v_m.organization_id and e.user_id is null and lower(e.work_email) = v_email and e.status <> 'exited'
                  order by e.created_at limit 1)
    returning id into v_id;
    if v_id is null then
      v_name := (select r.contact_name from public.access_requests r where lower(r.work_email) = v_email order by r.created_at desc limit 1);
      v_parts := case when v_name is null then app.name_from_email(v_email)
                      else array[split_part(btrim(v_name), ' ', 1), nullif(btrim(substr(btrim(v_name), length(split_part(btrim(v_name), ' ', 1)) + 1)), '')] end;
      v_today := app.org_today(v_m.organization_id);
      insert into public.employees (organization_id, employee_code, first_name, last_name, work_email, user_id, status, employment_type, date_of_joining)
      values (v_m.organization_id, 'EMP' || lpad(app.next_counter(v_m.organization_id, 'employee_code')::text, 5, '0'),
              left(v_parts[1], 100), left(v_parts[2], 100), v_email, v_m.user_id, 'active', 'permanent', v_today)
      returning id into v_id;
      insert into public.employment_records (organization_id, employee_id, effective_from, employment_type, change_reason)
      values (v_m.organization_id, v_id, v_today, 'permanent', 'joining');
    end if;
    perform set_config('app.linking_member', 'off', true);
    return v_id;
  exception when others then
    -- The subtransaction's changes, the setting included, are undone; HR can add the record later.
    return null;
  end;
end $$;
revoke all on function app.name_from_email(text) from public;
revoke all on function app.ensure_member_employee(uuid, boolean) from public;
-- add_member runs as the caller (the app schema isn't exposed through the API).
grant execute on function app.ensure_member_employee(uuid, boolean) to authenticated;

-- add_member takes the invitation's choice: p_without_record for people who don't work here. Otherwise a member
-- without a record (no p_employee_id) gets one while the organization's rule is on.
drop function public.add_member(uuid, uuid, uuid[], uuid);
create function public.add_member(p_org uuid, p_user_id uuid, p_role_ids uuid[], p_employee_id uuid default null,
  p_without_record boolean default false)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_member uuid;
begin
  if coalesce(cardinality(p_role_ids), 0) = 0 then
    raise exception 'Choose at least one role.' using errcode = '22023';
  end if;
  if p_without_record and p_employee_id is not null then
    raise exception 'Choose an employee record or none, not both.' using errcode = '22023';
  end if;

  insert into public.organization_members (organization_id, user_id, status, invited_by, without_employee_record)
  values (p_org, p_user_id, 'invited', auth.uid(), coalesce(p_without_record, false))
  returning id into v_member;

  insert into public.member_roles (organization_id, member_id, role_id, granted_by)
  select p_org, v_member, r, auth.uid() from unnest(p_role_ids) r;

  if p_employee_id is not null then
    update public.employees set user_id = p_user_id
     where id = p_employee_id and organization_id = p_org and user_id is null;
    if not found then
      raise exception 'That employee record is already linked to another account.' using errcode = '22023';
    end if;
  else
    perform app.ensure_member_employee(v_member);
  end if;

  perform app.email_added_member(v_member);
  return v_member;
end $$;
revoke execute on function public.add_member(uuid, uuid, uuid[], uuid, boolean) from public, anon;
grant execute on function public.add_member(uuid, uuid, uuid[], uuid, boolean) to authenticated, service_role;

-- A new organization's owner gets their record too (the console creates organizations through this).
create or replace function public.create_organization(p_name text, p_slug text, p_owner_user_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_member uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can create organizations' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug) values (p_name, p_slug) returning id into v_org;

  if p_owner_user_id is not null then
    insert into public.organization_members (organization_id, user_id, status, invited_by)
    values (v_org, p_owner_user_id, 'active', auth.uid())
    returning id into v_member;

    insert into public.member_roles (organization_id, member_id, role_id, granted_by)
    select v_org, v_member, r.id, auth.uid()
      from public.roles r where r.organization_id = v_org and r.key = 'owner';
    perform app.ensure_member_employee(v_member);
  end if;
  return v_org;
end $$;

-- Makes an existing account an owner (adding them to the organization when needed), gives them a record while the
-- organization's rule is on, and tells them.
create or replace function public.platform_add_owner(p_org uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_member uuid;
  v_status public.member_status;
  v_owner_role uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can do this' using errcode = '42501';
  end if;
  select id into v_owner_role from public.roles where organization_id = p_org and key = 'owner';
  if v_owner_role is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  select id, status into v_member, v_status from public.organization_members where organization_id = p_org and user_id = p_user;
  if v_member is null then
    insert into public.organization_members (organization_id, user_id, status, invited_by)
    values (p_org, p_user, 'active', auth.uid()) returning id into v_member;
  elsif exists (select 1 from public.member_roles where member_id = v_member and role_id = v_owner_role) then
    raise exception 'They’re already an owner.' using errcode = '22023';
  elsif v_status <> 'active' then
    update public.organization_members set status = 'active' where id = v_member;
  end if;
  insert into public.member_roles (organization_id, member_id, role_id, granted_by) values (p_org, v_member, v_owner_role, auth.uid());
  perform app.ensure_member_employee(v_member);
  perform app.email_added_member(v_member, true);
end $$;

-- Users & roles › "Add their employee records": a record for every active or invited member without one who isn't
-- marked as not an employee (whether or not the rule is on: the button is the choice). Needs member.manage and
-- employee.create. Returns how many got one.
create function public.add_missing_employee_records(p_org uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_member uuid;
  v_count integer := 0;
begin
  if not (app.has_permission(p_org, 'member.manage') and app.has_permission(p_org, 'employee.create')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  for v_member in
    select m.id from public.organization_members m
     where m.organization_id = p_org and m.status in ('active', 'invited') and not m.without_employee_record
       and not exists (select 1 from public.employees e where e.organization_id = p_org and e.user_id = m.user_id)
     order by m.created_at
  loop
    if app.ensure_member_employee(v_member, true) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.add_missing_employee_records(uuid) from public, anon;
grant execute on function public.add_missing_employee_records(uuid) to authenticated, service_role;

-- Whether a member is marked as not an employee, changed by people who manage members (Users & roles).
create function public.set_member_without_record(p_member uuid, p_without boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.organization_members where id = p_member;
  if v_org is null or not app.has_permission(v_org, 'member.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.organization_members set without_employee_record = p_without where id = p_member;
end $$;
revoke all on function public.set_member_without_record(uuid, boolean) from public, anon;
grant execute on function public.set_member_without_record(uuid, boolean) to authenticated, service_role;
