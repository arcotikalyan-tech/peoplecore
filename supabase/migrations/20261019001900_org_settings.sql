-- PeopleCore · Organization settings (Kredily's Settings and the CEO's settings): module selector, controls,
-- notification categories and a time-boxed support access window. (The salary bank file format already lives in
-- payroll_bank_settings.)
--
-- * Modules: an organization can switch optional modules off; the app hides them from navigation and their pages.
-- * Controls: whether people may edit their own HR records (HR included; owners excepted) — enforced here on
--   employee records and compensation — whether employees see their salary revision history, and birthdays.
-- * Notification categories: a muted category (the part of a notification kind before the first dot, e.g. 'loan')
--   is not delivered in the app for that organization.
-- * Support access: owners open a window (hours, reason) during which PeopleCore support may look at a summary
--   of the tenant; it closes on its own or when revoked. Platform admins see the windows; nothing else changes.

create table public.org_modules (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  module           text not null check (module ~ '^[a-z_]{2,30}$'),
  enabled          boolean not null default true,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, module)
);
create trigger org_modules_audit after insert or update on public.org_modules for each row execute function app.audit_row();

create table public.org_controls (
  organization_id         uuid primary key references public.organizations (id) on delete cascade,
  block_self_edit         boolean not null default false,
  salary_history_visible  boolean not null default true,
  birthdays_visible       boolean not null default true,
  updated_at              timestamptz not null default now()
);
create trigger org_controls_touch before update on public.org_controls for each row execute function app.touch_updated_at();
create trigger org_controls_audit after insert or update on public.org_controls for each row execute function app.audit_row();
insert into public.org_controls (organization_id) select id from public.organizations on conflict do nothing;

create table public.notification_settings (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  category         text not null check (category ~ '^[a-z_]{2,30}$'),
  enabled          boolean not null default true,
  primary key (organization_id, category)
);
create trigger notification_settings_audit after insert or update on public.notification_settings for each row execute function app.audit_row();

create table public.support_access_windows (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  granted_by       uuid not null default auth.uid(),
  reason           text not null check (char_length(reason) between 5 and 300),
  starts_at        timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  check (expires_at > starts_at and expires_at <= starts_at + interval '7 days')
);
create index support_access_windows_org_idx on public.support_access_windows (organization_id, expires_at desc);
create trigger support_access_windows_audit after insert or update on public.support_access_windows for each row execute function app.audit_row();

create function app.org_settings_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.org_controls (organization_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function app.org_settings_defaults() from public;
create trigger organizations_zz_org_settings after insert on public.organizations for each row execute function app.org_settings_defaults();

alter table public.org_modules enable row level security;
alter table public.org_controls enable row level security;
alter table public.notification_settings enable row level security;
alter table public.support_access_windows enable row level security;
create policy org_modules_select on public.org_modules for select to authenticated using (app.is_member(organization_id));
create policy org_modules_write on public.org_modules for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
create policy org_controls_select on public.org_controls for select to authenticated using (app.is_member(organization_id));
create policy org_controls_write on public.org_controls for update to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
create policy notification_settings_select on public.notification_settings for select to authenticated using (app.is_member(organization_id));
create policy notification_settings_write on public.notification_settings for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
create policy support_access_windows_select on public.support_access_windows for select to authenticated
  using (app.has_permission(organization_id, 'role.manage') or app.is_platform_admin());
grant select, insert, update on public.org_modules, public.notification_settings to authenticated;
grant select, update on public.org_controls to authenticated;
grant select on public.support_access_windows to authenticated;
grant all on public.org_modules, public.org_controls, public.notification_settings, public.support_access_windows to service_role;

-- Muted notification categories are not delivered.
create or replace function app.notify(p_org uuid, p_user uuid, p_kind text, p_title text, p_body text default null, p_link text default null)
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.notifications (organization_id, user_id, kind, title, body, link)
  select p_org, p_user, p_kind, left(p_title, 200), left(p_body, 1000), p_link
   where p_user is not null
     and not exists (select 1 from public.notification_settings s
                      where s.organization_id = p_org and s.category = split_part(p_kind, '.', 1) and not s.enabled);
$$;

-- Owners (the only holders of role.manage) are exempt; everyone else is blocked from editing their own record when the control is on.
create function app.block_self_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_org uuid := (v_row ->> 'organization_id')::uuid;
  v_emp uuid := (v_row ->> case when tg_table_name = 'employees' then 'id' else 'employee_id' end)::uuid;
begin
  if auth.uid() is not null and app.is_own_employee(v_emp) and not app.has_permission(v_org, 'role.manage')
     and coalesce((select block_self_edit from public.org_controls where organization_id = v_org), false) then
    raise exception 'Your organization doesn’t allow editing your own HR record. Ask a colleague in HR.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function app.block_self_edit() from public;
create trigger employees_block_self_edit before update on public.employees for each row execute function app.block_self_edit();
create trigger compensation_records_block_self_edit before insert or update or delete on public.compensation_records for each row execute function app.block_self_edit();

-- Support access: owners open and close windows; platform admins see a summary while one is open.
create function public.grant_support_access(p_org uuid, p_hours int, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not app.has_permission(p_org, 'role.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'Open support access for 1 hour to 7 days.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say what support is helping with.' using errcode = '22023';
  end if;
  update public.support_access_windows set revoked_at = now() where organization_id = p_org and revoked_at is null and expires_at > now();
  insert into public.support_access_windows (organization_id, reason, expires_at) values (p_org, btrim(p_reason), now() + make_interval(hours => p_hours))
  returning id into v_id;
  return v_id;
end $$;

create function public.revoke_support_access(p_org uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n int;
begin
  if not app.has_permission(p_org, 'role.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.support_access_windows set revoked_at = now() where organization_id = p_org and revoked_at is null and expires_at > now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.support_overview(p_org uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.support_access_windows where organization_id = p_org and revoked_at is null and now() between starts_at and expires_at) then
    raise exception 'This organization hasn’t opened support access.' using errcode = '42501';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, metadata)
  values (p_org, auth.uid(), 'support_view', 'organization', '{}'::jsonb);
  return jsonb_build_object(
    'employees', (select count(*) from public.employees where organization_id = p_org and status <> 'exited'),
    'members', (select count(*) from public.organization_members where organization_id = p_org),
    'payrollRuns', (select count(*) from public.payroll_runs where organization_id = p_org),
    'openApprovals', (select count(*) from public.approval_requests where organization_id = p_org and status = 'pending'),
    'modulesOff', (select coalesce(jsonb_agg(module), '[]'::jsonb) from public.org_modules where organization_id = p_org and not enabled));
end $$;

revoke all on function public.grant_support_access(uuid, int, text) from public, anon;
revoke all on function public.revoke_support_access(uuid) from public, anon;
revoke all on function public.support_overview(uuid) from public, anon;
grant execute on function public.grant_support_access(uuid, int, text) to authenticated, service_role;
grant execute on function public.revoke_support_access(uuid) to authenticated, service_role;
grant execute on function public.support_overview(uuid) to authenticated, service_role;
