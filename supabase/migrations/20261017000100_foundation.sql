-- PeopleCore · Foundation: tenancy, RBAC, audit.
-- See docs/04-data-model.md and docs/05-permissions.md.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
comment on schema app is 'Private helpers (authorization, audit, counters). Not exposed through PostgREST.';

-- ─── Generic helpers ────────────────────────────────────────────────────────

create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function app.prevent_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

-- ─── Types ──────────────────────────────────────────────────────────────────

create type public.org_status as enum ('active', 'suspended', 'archived');
create type public.member_status as enum ('invited', 'active', 'suspended');
create type public.permission_scope as enum ('org', 'team', 'self');

-- ─── Tenancy ────────────────────────────────────────────────────────────────

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 200),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  status        public.org_status not null default 'active',
  country_code  char(2) not null default 'IN',
  timezone      text not null default 'Asia/Kolkata',
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.organizations.is_demo is 'Clearly-marked demo tenant containing synthetic data only.';

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  status           public.member_status not null default 'invited',
  invited_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- ─── RBAC ───────────────────────────────────────────────────────────────────

create table public.permissions (
  key           text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  module        text not null,
  description   text not null,
  is_sensitive  boolean not null default false
);

create table public.roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  key              text not null check (key ~ '^[a-z_]{2,40}$'),
  name             text not null,
  description      text,
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, key),
  unique (organization_id, id)
);

create table public.role_permissions (
  organization_id  uuid not null,
  role_id          uuid not null,
  permission_key   text not null references public.permissions (key) on delete cascade,
  scope            public.permission_scope not null default 'org',
  primary key (role_id, permission_key),
  foreign key (organization_id, role_id) references public.roles (organization_id, id) on delete cascade
);

create table public.member_roles (
  organization_id  uuid not null,
  member_id        uuid not null,
  role_id          uuid not null,
  granted_by       uuid references auth.users (id) on delete set null,
  valid_until      timestamptz,
  created_at       timestamptz not null default now(),
  primary key (member_id, role_id),
  foreign key (organization_id, member_id) references public.organization_members (organization_id, id) on delete cascade,
  foreign key (organization_id, role_id) references public.roles (organization_id, id) on delete cascade
);
create index member_roles_role_idx on public.member_roles (role_id);
comment on column public.member_roles.valid_until is 'Time-boxed grants: delegation and platform support access.';

-- Templates copied into each new organization (data seeded in the rbac_seed migration).
create table app.role_templates (
  role_key     text primary key,
  name         text not null,
  description  text not null
);
create table app.role_template_permissions (
  role_key        text not null references app.role_templates (role_key) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  scope           public.permission_scope not null,
  primary key (role_key, permission_key)
);

-- ─── Audit ──────────────────────────────────────────────────────────────────

-- No FK to organizations: audit history must outlive the rows it describes.
create table public.audit_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid,
  occurred_at      timestamptz not null default now(),
  actor_user_id    uuid,
  action           text not null,
  entity_type      text not null,
  entity_id        uuid,
  changes          jsonb,
  metadata         jsonb not null default '{}'
);
create index audit_events_org_time_idx on public.audit_events (organization_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events (organization_id, entity_type, entity_id, occurred_at desc);

create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function app.prevent_mutation();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function app.prevent_mutation();

-- Row-change audit. Trigger args name columns whose values must be masked (e.g. bank numbers).
create function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new     jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old     jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row     jsonb;
  v_changes jsonb;
  v_col     text;
begin
  foreach v_col in array coalesce(tg_argv::text[], '{}') loop
    if v_new ? v_col then v_new := jsonb_set(v_new, array[v_col], '"[redacted]"'); end if;
    if v_old ? v_col then v_old := jsonb_set(v_old, array[v_col], '"[redacted]"'); end if;
  end loop;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', v_old -> n.key, 'to', n.value))
      into v_changes
      from jsonb_each(v_new) n
     where n.key not in ('updated_at', 'search_text')
       and (v_old -> n.key) is distinct from n.value;
    if v_changes is null then
      return null;  -- no meaningful change
    end if;
  else
    v_changes := v_row - 'search_text';
  end if;

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  values (
    coalesce((v_row ->> 'organization_id')::uuid,
             case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end),
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_changes
  );
  return null;
end $$;

-- ─── Authorization helpers ──────────────────────────────────────────────────

create function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members
     where organization_id = p_org and user_id = auth.uid() and status = 'active'
  );
$$;

create function app.permission_scopes(p_org uuid, p_permission text)
returns setof public.permission_scope
language sql stable security definer set search_path = '' as $$
  select distinct rp.scope
    from public.organization_members m
    join public.member_roles mr
      on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
    join public.role_permissions rp
      on rp.role_id = mr.role_id and rp.permission_key = p_permission
   where m.organization_id = p_org
     and m.user_id = auth.uid()
     and m.status = 'active';
$$;

-- True only for organization-wide grants. Team/self scopes are resolved per subject
-- (see app.can_access_employee in the core_hr migration).
create function app.has_permission(p_org uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.permission_scopes(p_org, p_permission) s where s = 'org');
$$;

-- ─── Org lifecycle ──────────────────────────────────────────────────────────

create function app.seed_org_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.roles (organization_id, key, name, description, is_system)
  select new.id, t.role_key, t.name, t.description, true from app.role_templates t;

  insert into public.role_permissions (organization_id, role_id, permission_key, scope)
  select new.id, r.id, tp.permission_key, tp.scope
    from app.role_template_permissions tp
    join public.roles r on r.organization_id = new.id and r.key = tp.role_key;
  return null;
end $$;

create trigger organizations_seed_roles after insert on public.organizations
  for each row execute function app.seed_org_roles();

-- Platform admins create tenants; optionally attaches an existing user as owner.
create function public.create_organization(p_name text, p_slug text, p_owner_user_id uuid default null)
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
  end if;
  return v_org;
end $$;

-- The caller's own effective permissions, for UI gating. Authorization is still enforced by RLS.
create function public.my_permissions(p_org uuid)
returns table (permission_key text, scope public.permission_scope)
language sql stable security definer set search_path = '' as $$
  select distinct rp.permission_key, rp.scope
    from public.organization_members m
    join public.member_roles mr
      on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active';
$$;

-- ─── Triggers ───────────────────────────────────────────────────────────────

create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();
create trigger organization_members_touch before update on public.organization_members
  for each row execute function app.touch_updated_at();
create trigger roles_touch before update on public.roles
  for each row execute function app.touch_updated_at();

create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function app.audit_row();
create trigger organization_members_audit after insert or update or delete on public.organization_members
  for each row execute function app.audit_row();
create trigger roles_audit after insert or update or delete on public.roles
  for each row execute function app.audit_row();
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function app.audit_row();
create trigger member_roles_audit after insert or update or delete on public.member_roles
  for each row execute function app.audit_row();

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.organizations enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organization_members enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.member_roles enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (app.is_member(id) or app.is_platform_admin());
create policy organizations_update on public.organizations for update to authenticated
  using (app.has_permission(id, 'org.manage'))
  with check (app.has_permission(id, 'org.manage'));

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or app.is_platform_admin());

create policy members_select on public.organization_members for select to authenticated
  using (user_id = auth.uid() or app.has_permission(organization_id, 'member.manage'));
create policy members_insert on public.organization_members for insert to authenticated
  with check (app.has_permission(organization_id, 'member.manage'));
create policy members_update on public.organization_members for update to authenticated
  using (app.has_permission(organization_id, 'member.manage'))
  with check (app.has_permission(organization_id, 'member.manage'));
create policy members_delete on public.organization_members for delete to authenticated
  using (app.has_permission(organization_id, 'member.manage'));

create policy permissions_select on public.permissions for select to authenticated using (true);

create policy roles_select on public.roles for select to authenticated
  using (app.is_member(organization_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (app.has_permission(organization_id, 'role.manage') and not is_system);
create policy roles_update on public.roles for update to authenticated
  using (app.has_permission(organization_id, 'role.manage') and not is_system)
  with check (app.has_permission(organization_id, 'role.manage') and not is_system);
create policy roles_delete on public.roles for delete to authenticated
  using (app.has_permission(organization_id, 'role.manage') and not is_system);

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (app.is_member(organization_id));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (app.has_permission(organization_id, 'role.manage')
         and not exists (select 1 from public.roles r where r.id = role_id and r.key = 'owner'))
  with check (app.has_permission(organization_id, 'role.manage')
         and not exists (select 1 from public.roles r where r.id = role_id and r.key = 'owner'));

create policy member_roles_select on public.member_roles for select to authenticated
  using (
    exists (select 1 from public.organization_members m where m.id = member_id and m.user_id = auth.uid())
    or app.has_permission(organization_id, 'member.manage')
    or app.has_permission(organization_id, 'role.manage')
  );
create policy member_roles_write on public.member_roles for all to authenticated
  using (app.has_permission(organization_id, 'role.manage'))
  with check (app.has_permission(organization_id, 'role.manage'));

create policy audit_events_select on public.audit_events for select to authenticated
  using (organization_id is not null and app.has_permission(organization_id, 'audit.read'));

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
revoke insert, update, delete, truncate on public.permissions from anon, authenticated;
revoke all on public.organizations, public.platform_admins, public.organization_members,
  public.permissions, public.roles, public.role_permissions, public.member_roles from anon;

revoke all on all functions in schema app from public;
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

revoke execute on function public.create_organization(text, text, uuid) from public, anon;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant execute on function public.create_organization(text, text, uuid) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
