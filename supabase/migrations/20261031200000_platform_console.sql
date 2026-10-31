-- PeopleCore · Platform console: plans and subscriptions, editing organizations, platform administrators, and emails
-- when someone is added to an organization (or made a platform administrator).
--
-- * platform_plans: the catalogue (monthly price per employee, flat monthly price, annual discount, employee limit,
--   included modules, trial length). Anyone signed in may read it (prices aren't secret); only platform admins change
--   it, and a plan is retired (is_active off) rather than deleted.
-- * organization_subscriptions: one per organization: plan, status (trialing, active, past_due, cancelled), billing
--   cycle, overrides (employee limit, price), trial end, paid-until date, billing email and internal notes. Only
--   platform admins read it; an organization's owners see their own plan through my_subscription (no notes). Changes
--   go through platform_set_subscription and are audited (notes redacted in the tenant's audit log).
-- * The plan applies: modules outside it are off for the organization (as with Settings › Modules: navigation and
--   pages), and adding an employee beyond its limit is refused. An organization without a subscription has no limits;
--   existing tenants get one below with no limit they could reach (demo tenants: Enterprise; others: Growth).
-- * Platform admins edit an organization's name, URL, time zone and country, add or remove owners, and add or remove
--   other platform admins (not themselves). Everything is audited and listed in the console's activity log.
-- * Emails: add_member (inviting someone, giving an employee a sign-in) emails the person; a new organization's
--   owner gets "your workspace is ready"; a new owner or platform admin is told too.

create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled');
create type public.billing_cycle as enum ('monthly', 'annual');

-- ─── Plans ──────────────────────────────────────────────────────────────────

create table public.platform_plans (
  code                 text primary key check (code ~ '^[a-z0-9][a-z0-9_-]{1,29}$'),
  name                 text not null unique check (char_length(btrim(name)) between 2 and 60),
  description          text check (char_length(description) <= 300),
  price_per_employee   numeric(10,2) check (price_per_employee >= 0),
  base_price           numeric(12,2) not null default 0 check (base_price >= 0),
  annual_discount_pct  numeric(5,2) not null default 0 check (annual_discount_pct between 0 and 90),
  max_employees        integer check (max_employees > 0),
  modules              text[] check (modules is null or array_to_string(modules, ',') ~ '^([a-z_]{2,30}(,[a-z_]{2,30})*)?$'),
  trial_days           integer not null default 14 check (trial_days between 0 and 90),
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid default auth.uid()
);
comment on column public.platform_plans.price_per_employee is 'Monthly price per employee in rupees; null: priced per customer (set on the subscription).';
comment on column public.platform_plans.modules is 'Optional modules included (keys from apps/web/src/lib/modules.ts); null: every module.';

create function app.stamp_platform_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke all on function app.stamp_platform_change() from public;

create trigger platform_plans_stamp before update on public.platform_plans for each row execute function app.stamp_platform_change();
create trigger platform_plans_audit after insert or update or delete on public.platform_plans for each row execute function app.audit_row();

insert into public.platform_plans (code, name, description, price_per_employee, base_price, annual_discount_pct, max_employees, modules, trial_days, sort_order) values
  ('free', 'Free', 'Attendance, leave, holidays, policies and a helpdesk for small teams.', 0, 0, 0, 10,
   array['attendance', 'leave', 'holidays', 'policies', 'knowledge', 'helpdesk'], 0, 1),
  ('starter', 'Starter', 'Adds payroll, compliance, expenses, loans, letters, onboarding, assets and reports.', 49, 0, 15, 50,
   array['attendance', 'leave', 'holidays', 'timesheet', 'payroll', 'expenses', 'loans', 'statutory', 'letters', 'onboarding',
         'policies', 'knowledge', 'helpdesk', 'assets', 'idstudio', 'reports'], 14, 2),
  ('growth', 'Growth', 'Every module, including hiring, performance, learning and engagement.', 99, 0, 15, 500, null, 14, 3),
  ('enterprise', 'Enterprise', 'Every module and no employee limit; the price is agreed with each customer.', null, 0, 0, null, null, 30, 4);

-- ─── Subscriptions ──────────────────────────────────────────────────────────

create table public.organization_subscriptions (
  organization_id     uuid primary key references public.organizations (id) on delete cascade,
  plan_code           text not null references public.platform_plans (code) on update cascade,
  status              public.subscription_status not null default 'trialing',
  billing_cycle       public.billing_cycle not null default 'monthly',
  employee_limit      integer check (employee_limit > 0),
  price_per_employee  numeric(10,2) check (price_per_employee >= 0),
  trial_ends_at       date,
  paid_until          date,
  billing_email       text check (billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes               text check (char_length(notes) <= 2000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid default auth.uid(),
  check (status <> 'trialing' or trial_ends_at is not null)
);
comment on column public.organization_subscriptions.employee_limit is 'Overrides the plan''s employee limit for this organization.';
comment on column public.organization_subscriptions.price_per_employee is 'Overrides the plan''s price per employee for this organization.';
create index organization_subscriptions_plan_idx on public.organization_subscriptions (plan_code);
create trigger organization_subscriptions_stamp before update on public.organization_subscriptions for each row execute function app.stamp_platform_change();
-- The tenant's own audit log records plan changes, without the platform's internal notes.
create trigger organization_subscriptions_audit after insert or update or delete on public.organization_subscriptions
  for each row execute function app.audit_row('notes');

insert into public.organization_subscriptions (organization_id, plan_code, status, updated_by)
select id, case when is_demo then 'enterprise' else 'growth' end, 'active', null from public.organizations
on conflict do nothing;

alter table public.platform_settings add column default_plan_code text not null default 'starter'
  references public.platform_plans (code) on update cascade;

alter table public.platform_plans enable row level security;
alter table public.organization_subscriptions enable row level security;
create policy platform_plans_select on public.platform_plans for select to authenticated using (true);
create policy platform_plans_insert on public.platform_plans for insert to authenticated with check (app.is_platform_admin());
create policy platform_plans_update on public.platform_plans for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy organization_subscriptions_select on public.organization_subscriptions for select to authenticated using (app.is_platform_admin());
grant select, insert on public.platform_plans to authenticated;
-- A plan's code is its identity (subscriptions point at it): it never changes once created.
grant update (name, description, price_per_employee, base_price, annual_discount_pct, max_employees, modules, trial_days, is_active, sort_order)
  on public.platform_plans to authenticated;
grant select on public.organization_subscriptions to authenticated;
grant all on public.platform_plans, public.organization_subscriptions to service_role;

-- Audit log reads for the console's activity page (platform-level rows only).
create index audit_events_platform_idx on public.audit_events (occurred_at desc)
  where entity_type in ('organizations', 'organization_subscriptions', 'platform_plans', 'platform_settings', 'platform_admins', 'support_access_windows');

-- ─── The plan applies ───────────────────────────────────────────────────────

-- Modules the organization's plan includes; null: every module (or no subscription). Members and platform admins only.
create function public.org_plan_modules(p_org uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select p.modules
    from public.organization_subscriptions s
    join public.platform_plans p on p.code = s.plan_code
   where s.organization_id = p_org and (app.is_member(p_org) or app.is_platform_admin());
$$;

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
                                    from o join public.org_modules m on m.organization_id = o.id and not m.enabled), '[]'::jsonb),
    'plan_modules', (select to_jsonb(public.org_plan_modules(o.id)) from o)
  );
$$;

create function app.enforce_employee_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
begin
  if new.status = 'exited' or (tg_op = 'UPDATE' and old.status <> 'exited') then
    return new;
  end if;
  select coalesce(s.employee_limit, p.max_employees) into v_limit
    from public.organization_subscriptions s
    join public.platform_plans p on p.code = s.plan_code
   where s.organization_id = new.organization_id;
  if v_limit is not null and (select count(*) from public.employees e
                               where e.organization_id = new.organization_id and e.status <> 'exited' and e.id <> new.id) >= v_limit then
    raise exception 'Your plan allows up to % employees. Ask PeopleCore to move you to a bigger plan.', v_limit using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function app.enforce_employee_limit() from public;
create trigger employees_plan_limit before insert or update of status on public.employees
  for each row execute function app.enforce_employee_limit();

-- An organization's own plan, for its owners and admins (Settings). No prices or platform notes.
create function public.my_subscription(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plan', p.name, 'plan_code', p.code, 'description', p.description, 'status', s.status, 'billing_cycle', s.billing_cycle,
    'trial_ends_at', s.trial_ends_at, 'paid_until', s.paid_until,
    'employee_limit', coalesce(s.employee_limit, p.max_employees),
    'employees', (select count(*) from public.employees e where e.organization_id = p_org and e.status <> 'exited'),
    'modules', p.modules)
    from public.organization_subscriptions s
    join public.platform_plans p on p.code = s.plan_code
   where s.organization_id = p_org and app.has_permission(p_org, 'org.manage');
$$;

-- ─── Emails when people are added ───────────────────────────────────────────

alter table public.email_outbox drop constraint email_outbox_platform_check;
alter table public.email_outbox add constraint email_outbox_platform_check
  check (organization_id is not null or event in ('signup_received', 'signup_alert', 'platform_admin_added'));

-- "You've been added to <organization>": to the person, right after whoever added them (add_member, platform
-- console). Someone who has never signed in is pointed at the separate invitation email that sets their password.
-- A side effect: a problem queueing it never blocks adding the person.
create function app.email_added_member(p_member uuid, p_as_owner boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
begin
  select m.organization_id, m.user_id, u.email, u.last_sign_in_at, o.name as org_name,
         (select string_agg(r.name, ', ' order by r.name) from public.member_roles mr
            join public.roles r on r.id = mr.role_id where mr.member_id = m.id) as roles
    into v
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join auth.users u on u.id = m.user_id
   where m.id = p_member
     -- Only for the person who just added them (or a platform admin), never as a way to email anyone.
     and (app.is_platform_admin() or (m.invited_by = auth.uid() and m.created_at > now() - interval '10 minutes'));
  if not found or v.email is null then
    return;
  end if;
  begin
    insert into public.email_outbox (organization_id, user_id, to_email, event, subject, body, link)
    values (v.organization_id, v.user_id, v.email, 'member_added',
      left(case when p_as_owner then format('You’re now an owner of %s on PeopleCore', v.org_name)
                else format('You’ve been added to %s on PeopleCore', v.org_name) end, 200),
      left(concat_ws(E'\n\n', 'Hi,',
        case when p_as_owner then format('You’re now an owner of %s on PeopleCore: you can manage its settings, people and plan.', v.org_name)
             else format('You now have access to %s on PeopleCore%s.', v.org_name, coalesce(' as ' || v.roles, '')) end,
        case when v.last_sign_in_at is null
             then 'We’ve also sent you a separate email with a link to choose your password. Use it first; after that, sign in any time with your email and password.'
             else 'Sign in with your usual email and password to get started.' end), 4000),
      '/');
  exception when others then null;
  end;
end $$;
revoke all on function app.email_added_member(uuid, boolean) from public;
-- add_member runs as the caller, so the caller needs to run this (it checks they just added the person).
grant execute on function app.email_added_member(uuid, boolean) to authenticated;

create or replace function public.add_member(p_org uuid, p_user_id uuid, p_role_ids uuid[], p_employee_id uuid default null)
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

  perform app.email_added_member(v_member);
  return v_member;
end $$;

-- ─── Organizations (platform admins) ────────────────────────────────────────

-- A new organization with its plan (trial from the plan unless given) and, optionally, an owner who is emailed.
create function public.platform_create_organization(p_name text, p_slug text, p_owner_user_id uuid, p_plan text,
  p_trial_days integer default null, p_billing_email text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
  v_plan public.platform_plans;
  v_trial integer;
  v_owner record;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;  -- the console's working day
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can create organizations' using errcode = '42501';
  end if;
  select * into v_plan from public.platform_plans where code = p_plan and is_active;
  if not found then
    raise exception 'Choose an active plan.' using errcode = '22023';
  end if;
  v_trial := coalesce(p_trial_days, v_plan.trial_days);
  if v_trial < 0 or v_trial > 365 then
    raise exception 'A trial lasts 0 to 365 days.' using errcode = '22023';
  end if;

  v_org := public.create_organization(btrim(p_name), lower(btrim(p_slug)), p_owner_user_id);
  insert into public.organization_subscriptions (organization_id, plan_code, status, trial_ends_at, billing_email)
  values (v_org, v_plan.code, case when v_trial > 0 then 'trialing' else 'active' end::public.subscription_status,
          case when v_trial > 0 then v_today + v_trial end, nullif(btrim(p_billing_email), ''));

  if p_owner_user_id is not null then
    select u.id, u.email, u.last_sign_in_at into v_owner from auth.users u where u.id = p_owner_user_id;
    begin
      insert into public.email_outbox (organization_id, user_id, to_email, event, subject, body, link)
      select v_org, v_owner.id, v_owner.email, 'workspace_ready',
        left(format('Your PeopleCore workspace for %s is ready', btrim(p_name)), 200),
        left(concat_ws(E'\n\n', 'Hi,',
          format('PeopleCore is ready for %s, and you’re its owner.', btrim(p_name)),
          format('Plan: %s%s.', v_plan.name, case when v_trial > 0 then format(', free trial until %s', to_char(v_today + v_trial, 'FMDD Mon YYYY')) else '' end),
          case when v_owner.last_sign_in_at is null
               then 'We’ve also sent you a separate email with a link to choose your password. Use it first, then sign in with your email and password.'
               else 'Sign in with your usual email and password.' end,
          'The setup checklist on your dashboard walks you through your company details, locations, holidays, leave and attendance rules, adding employees and payroll.'), 4000),
        '/'
       where v_owner.email is not null;
    exception when others then null;
    end;
  end if;
  return v_org;
end $$;

-- Name, URL, time zone and country. A new URL changes every link to the workspace (old bookmarks stop working).
create function public.platform_update_organization(p_org uuid, p_name text, p_slug text, p_timezone text, p_country_code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can edit organizations' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid time zone.' using errcode = '22023';
  end if;
  if coalesce(p_country_code, '') !~ '^[A-Z]{2}$' then
    raise exception 'Choose a country.' using errcode = '22023';
  end if;
  update public.organizations
     set name = btrim(p_name), slug = lower(btrim(p_slug)), timezone = p_timezone, country_code = p_country_code
   where id = p_org;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
end $$;

create function public.platform_set_subscription(p_org uuid, p_plan text, p_status public.subscription_status,
  p_billing_cycle public.billing_cycle, p_employee_limit integer, p_price_per_employee numeric, p_trial_ends_at date,
  p_paid_until date, p_billing_email text, p_notes text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_current text;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can change a plan' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  select plan_code into v_current from public.organization_subscriptions where organization_id = p_org;
  -- A retired plan stays possible for organizations already on it.
  if not exists (select 1 from public.platform_plans where code = p_plan and (is_active or code = v_current)) then
    raise exception 'Choose an active plan.' using errcode = '22023';
  end if;
  if p_status = 'trialing' and p_trial_ends_at is null then
    raise exception 'Give the trial an end date.' using errcode = '22023';
  end if;
  insert into public.organization_subscriptions (organization_id, plan_code, status, billing_cycle, employee_limit,
    price_per_employee, trial_ends_at, paid_until, billing_email, notes)
  values (p_org, p_plan, p_status, p_billing_cycle, p_employee_limit, p_price_per_employee, p_trial_ends_at, p_paid_until,
    nullif(btrim(p_billing_email), ''), nullif(btrim(p_notes), ''))
  on conflict (organization_id) do update set
    plan_code = excluded.plan_code, status = excluded.status, billing_cycle = excluded.billing_cycle,
    employee_limit = excluded.employee_limit, price_per_employee = excluded.price_per_employee,
    trial_ends_at = excluded.trial_ends_at, paid_until = excluded.paid_until,
    billing_email = excluded.billing_email, notes = excluded.notes;
end $$;

-- Makes an existing account an owner (adding them to the organization when needed) and tells them.
create function public.platform_add_owner(p_org uuid, p_user uuid) returns void
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
  perform app.email_added_member(v_member, true);
end $$;

-- Takes the owner role away (the organization must keep another active owner: see app.assert_org_has_owner).
create function public.platform_remove_owner(p_org uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can do this' using errcode = '42501';
  end if;
  delete from public.member_roles mr
   using public.roles r, public.organization_members m
   where r.id = mr.role_id and r.key = 'owner' and m.id = mr.member_id
     and mr.organization_id = p_org and m.user_id = p_user;
  if not found then
    raise exception 'They aren’t an owner of this organization.' using errcode = '22023';
  end if;
  -- The owner rule is checked at commit; check now so the message comes back with this call.
  if not exists (
    select 1 from public.member_roles mr
      join public.roles r on r.id = mr.role_id and r.key = 'owner'
      join public.organization_members m on m.id = mr.member_id and m.status = 'active'
     where mr.organization_id = p_org and mr.valid_until is null) then
    raise exception 'An organization must keep at least one active owner. Add another owner first.' using errcode = '22023';
  end if;
end $$;

-- ─── What the console shows ─────────────────────────────────────────────────

-- Every organization with its plan and usage: counts and owners' emails, nothing from inside the tenant.
create function public.platform_org_overview()
returns table (
  id uuid, name text, slug text, status public.org_status, is_demo boolean, created_at timestamptz, timezone text, country_code text,
  plan_code text, plan_name text, subscription_status public.subscription_status, billing_cycle public.billing_cycle,
  trial_ends_at date, paid_until date, employee_limit integer, price_per_employee numeric, base_price numeric,
  annual_discount_pct numeric, billing_email text, employees integer, members integer, active_members_30d integer,
  last_sign_in_at timestamptz, owner_emails text[])
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.slug, o.status, o.is_demo, o.created_at, o.timezone, o.country_code::text,
         s.plan_code, p.name, s.status, s.billing_cycle, s.trial_ends_at, s.paid_until,
         coalesce(s.employee_limit, p.max_employees), coalesce(s.price_per_employee, p.price_per_employee), p.base_price,
         p.annual_discount_pct, s.billing_email,
         coalesce(e.n, 0)::integer, coalesce(m.n, 0)::integer, coalesce(m.recent, 0)::integer, m.last_sign_in_at,
         coalesce(ow.emails, '{}')
    from public.organizations o
    left join public.organization_subscriptions s on s.organization_id = o.id
    left join public.platform_plans p on p.code = s.plan_code
    left join lateral (select count(*) as n from public.employees x where x.organization_id = o.id and x.status <> 'exited') e on true
    left join lateral (
      select count(*) as n, count(*) filter (where u.last_sign_in_at > now() - interval '30 days') as recent,
             max(u.last_sign_in_at) as last_sign_in_at
        from public.organization_members om join auth.users u on u.id = om.user_id
       where om.organization_id = o.id and om.status <> 'suspended') m on true
    left join lateral (
      select array_agg(distinct u.email) as emails
        from public.member_roles mr
        join public.roles r on r.id = mr.role_id and r.key = 'owner'
        join public.organization_members om on om.id = mr.member_id
        join auth.users u on u.id = om.user_id
       where mr.organization_id = o.id and (mr.valid_until is null or mr.valid_until > now())) ow on true
   where app.is_platform_admin()
   order by o.created_at desc;
$$;

-- One organization's owners, people counts, switched-off modules and last activity.
create function public.platform_org_detail(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'owners', (select coalesce(jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email, 'last_sign_in_at', u.last_sign_in_at,
                                                            'member_status', om.status) order by u.email), '[]'::jsonb)
                 from public.member_roles mr
                 join public.roles r on r.id = mr.role_id and r.key = 'owner'
                 join public.organization_members om on om.id = mr.member_id
                 join auth.users u on u.id = om.user_id
                where mr.organization_id = p_org and (mr.valid_until is null or mr.valid_until > now())),
    'employees_by_status', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                              from (select e.status, count(*) as n from public.employees e where e.organization_id = p_org group by e.status) x),
    'members_by_status', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                            from (select m.status, count(*) as n from public.organization_members m where m.organization_id = p_org group by m.status) x),
    'disabled_modules', (select coalesce(jsonb_agg(m.module order by m.module), '[]'::jsonb)
                           from public.org_modules m where m.organization_id = p_org and not m.enabled),
    'last_activity_at', (select max(a.occurred_at) from public.audit_events a where a.organization_id = p_org),
    'support_open', exists (select 1 from public.support_access_windows w
                             where w.organization_id = p_org and w.revoked_at is null and w.expires_at > now()))
   where app.is_platform_admin();
$$;

-- Platform-level changes (organizations, plans, subscriptions, settings, administrators, support windows), newest first.
create function public.platform_activity(p_org uuid default null, p_limit integer default 100)
returns table (id bigint, occurred_at timestamptz, organization_id uuid, actor_email text, action text, entity_type text,
               entity_id uuid, changes jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, a.occurred_at, a.organization_id, u.email, a.action, a.entity_type, a.entity_id, a.changes
    from public.audit_events a
    left join auth.users u on u.id = a.actor_user_id
   where app.is_platform_admin()
     and a.entity_type in ('organizations', 'organization_subscriptions', 'platform_plans', 'platform_settings', 'platform_admins', 'support_access_windows')
     and (p_org is null or a.organization_id = p_org)
   order by a.occurred_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- ─── Platform administrators and settings ───────────────────────────────────

create function public.platform_admin_list()
returns table (user_id uuid, email text, added_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select pa.user_id, u.email, pa.created_at, u.last_sign_in_at
    from public.platform_admins pa
    join auth.users u on u.id = pa.user_id
   where app.is_platform_admin()
   order by pa.created_at;
$$;

-- Makes an existing account a platform admin (they must have signed up or been invited somewhere first) and tells them.
create function public.platform_add_admin(p_email text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid;
  v_email text;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can do this' using errcode = '42501';
  end if;
  select id, email into v_user, v_email from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then
    raise exception 'No PeopleCore account uses that email yet. Add them to an organization first, then try again.' using errcode = '22023';
  end if;
  insert into public.platform_admins (user_id) values (v_user) on conflict do nothing;
  if not found then
    raise exception 'They’re already a platform administrator.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  values (null, auth.uid(), 'insert', 'platform_admins', v_user, jsonb_build_object('email', v_email));
  begin
    insert into public.email_outbox (organization_id, user_id, to_email, event, subject, body, link)
    values (null, v_user, v_email, 'platform_admin_added', 'You’re now a PeopleCore platform administrator',
      E'Hi,\n\nYou’ve been made a platform administrator of PeopleCore. You can now create and manage organizations, plans and subscriptions in the platform console.\n\nSign in with your usual email and password, then open the console. If you weren’t expecting this, tell the PeopleCore team.',
      '/platform');
  exception when others then null;
  end;
  return v_user;
end $$;

create function public.platform_remove_admin(p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can do this' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can’t remove yourself. Ask another platform administrator.' using errcode = '22023';
  end if;
  delete from public.platform_admins where user_id = p_user;
  if not found then
    raise exception 'They aren’t a platform administrator.' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = p_user;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  values (null, auth.uid(), 'delete', 'platform_admins', p_user, jsonb_build_object('email', v_email));
end $$;

create function public.set_platform_default_plan(p_plan text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators can change this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.platform_plans where code = p_plan and is_active) then
    raise exception 'Choose an active plan.' using errcode = '22023';
  end if;
  update public.platform_settings set default_plan_code = p_plan, updated_at = now(), updated_by = auth.uid() where id;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  values (null, auth.uid(), 'update', 'platform_settings', null, jsonb_build_object('default_plan_code', p_plan));
end $$;

-- Hosted Supabase loads pg-safeupdate for API requests: an UPDATE without a WHERE fails (21000), even inside a
-- function. platform_settings has one row (id is always true), so `where id` names it.
create or replace function public.set_platform_require_mfa(p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'Only platform administrators can change this.' using errcode = '42501'; end if;
  if p_on and app.current_aal() <> 'aal2' then
    raise exception 'Turn on two-step sign-in for yourself first, then for every platform administrator.' using errcode = '22023';
  end if;
  update public.platform_settings set require_mfa_for_admins = p_on, updated_at = now(), updated_by = auth.uid() where id;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  values (null, auth.uid(), 'update', 'platform_settings', null, jsonb_build_object('require_mfa_for_admins', p_on));
end $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function public.org_plan_modules(uuid), public.my_subscription(uuid),
  public.platform_create_organization(text, text, uuid, text, integer, text),
  public.platform_update_organization(uuid, text, text, text, text),
  public.platform_set_subscription(uuid, text, public.subscription_status, public.billing_cycle, integer, numeric, date, date, text, text),
  public.platform_add_owner(uuid, uuid), public.platform_remove_owner(uuid, uuid),
  public.platform_org_overview(), public.platform_org_detail(uuid), public.platform_activity(uuid, integer),
  public.platform_admin_list(), public.platform_add_admin(text), public.platform_remove_admin(uuid),
  public.set_platform_default_plan(text)
  from public, anon;
grant execute on function public.org_plan_modules(uuid), public.my_subscription(uuid),
  public.platform_create_organization(text, text, uuid, text, integer, text),
  public.platform_update_organization(uuid, text, text, text, text),
  public.platform_set_subscription(uuid, text, public.subscription_status, public.billing_cycle, integer, numeric, date, date, text, text),
  public.platform_add_owner(uuid, uuid), public.platform_remove_owner(uuid, uuid),
  public.platform_org_overview(), public.platform_org_detail(uuid), public.platform_activity(uuid, integer),
  public.platform_admin_list(), public.platform_add_admin(text), public.platform_remove_admin(uuid),
  public.set_platform_default_plan(text)
  to authenticated, service_role;
