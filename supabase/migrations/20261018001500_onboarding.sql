-- PeopleCore · Onboarding and policies (Phase 3).
--
-- * Templates list tasks for the joiner, their manager, or the template's owner (e.g. IT or HR), each due a
--   number of days before or after the joining date.
-- * A plan instantiates a template for one employee: its tasks go into the shared task system (so they show
--   in each person's Inbox) and the plan completes itself when every task is done or cancelled.
-- * Plans start automatically when someone is hired (the worker consumes `employee.hired`), or by HR.
-- * Policies are versioned documents every member can read; acknowledgements are append-only records
--   ("this person acknowledged version N on this date").

-- ─── Permissions ────────────────────────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('onboarding.manage', 'onboarding', 'Manage onboarding templates and plans', false),
  ('policy.manage', 'onboarding', 'Publish policies and see acknowledgements', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'onboarding.manage', 'org'), ('owner', 'policy.manage', 'org'),
  ('hr_admin', 'onboarding.manage', 'org'), ('hr_admin', 'policy.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key in ('onboarding.manage', 'policy.manage')
on conflict (role_id, permission_key) do nothing;

-- ─── Templates and plans ────────────────────────────────────────────────────

create type public.onboarding_assignee as enum ('joiner', 'manager', 'owner');
create type public.onboarding_status as enum ('in_progress', 'completed', 'cancelled');

create table public.onboarding_templates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  name               text not null check (char_length(name) between 2 and 80),
  owner_employee_id  uuid,  -- receives 'owner' tasks; the joiner's manager when empty
  is_default         boolean not null default false,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, owner_employee_id) references public.employees (organization_id, id) on delete set null
);
create unique index onboarding_templates_default_uq on public.onboarding_templates (organization_id) where is_default;

create table public.onboarding_template_tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  template_id      uuid not null,
  position         smallint not null default 0,
  title            text not null check (char_length(title) between 2 and 200),
  details          text check (char_length(details) <= 2000),
  assignee         public.onboarding_assignee not null,
  due_offset_days  smallint not null default 0 check (due_offset_days between -90 and 365),
  foreign key (organization_id, template_id) references public.onboarding_templates (organization_id, id) on delete cascade
);

create table public.onboarding_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  template_id      uuid,
  status           public.onboarding_status not null default 'in_progress',
  started_by       uuid default auth.uid(),
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, template_id) references public.onboarding_templates (organization_id, id) on delete set null
);
create unique index onboarding_plans_active_uq on public.onboarding_plans (employee_id) where status = 'in_progress';

create trigger onboarding_templates_audit after insert or update or delete on public.onboarding_templates for each row execute function app.audit_row();
create trigger onboarding_template_tasks_audit after insert or update or delete on public.onboarding_template_tasks for each row execute function app.audit_row();
create trigger onboarding_plans_audit after insert or update on public.onboarding_plans for each row execute function app.audit_row();

-- ─── Policies ───────────────────────────────────────────────────────────────

create table public.policy_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (char_length(title) between 2 and 120),
  version          int not null default 1 check (version >= 1),
  body             text not null check (char_length(body) between 10 and 50000),
  requires_acknowledgement boolean not null default true,
  published_at     timestamptz not null default now(),
  published_by     uuid default auth.uid(),
  retired_at       timestamptz,
  unique (organization_id, title, version),
  unique (organization_id, id)
);

create table public.policy_acknowledgements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  policy_id        uuid not null,
  employee_id      uuid not null,
  acknowledged_at  timestamptz not null default now(),
  unique (policy_id, employee_id),
  foreign key (organization_id, policy_id) references public.policy_documents (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

create trigger policy_documents_audit after insert or update on public.policy_documents for each row execute function app.audit_row('body');

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.onboarding_templates enable row level security;
alter table public.onboarding_template_tasks enable row level security;
alter table public.onboarding_plans enable row level security;
alter table public.policy_documents enable row level security;
alter table public.policy_acknowledgements enable row level security;

do $$
declare t text;
begin
  foreach t in array array['onboarding_templates', 'onboarding_template_tasks'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.has_permission(organization_id, ''onboarding.manage''))', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (app.has_permission(organization_id, ''onboarding.manage'')) with check (app.has_permission(organization_id, ''onboarding.manage''))', t);
  end loop;
end $$;
create policy onboarding_plans_select on public.onboarding_plans for select to authenticated
  using (app.has_permission(organization_id, 'onboarding.manage') or app.can_access_employee(organization_id, employee_id, 'employee.read'));
create policy policy_documents_select on public.policy_documents for select to authenticated using (app.is_member(organization_id));
create policy policy_documents_write on public.policy_documents for all to authenticated
  using (app.has_permission(organization_id, 'policy.manage')) with check (app.has_permission(organization_id, 'policy.manage'));
create policy policy_acknowledgements_select on public.policy_acknowledgements for select to authenticated
  using (app.has_permission(organization_id, 'policy.manage') or app.can_access_employee(organization_id, employee_id, 'employee.read'));

grant select, insert, update, delete on public.onboarding_templates, public.onboarding_template_tasks to authenticated;
grant select on public.onboarding_plans, public.policy_acknowledgements to authenticated;
grant select, insert, update on public.policy_documents to authenticated;
grant all on public.onboarding_templates, public.onboarding_template_tasks, public.onboarding_plans,
             public.policy_documents, public.policy_acknowledgements to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

-- Creates the plan and its tasks. Internal: callers check permissions (HR) or are the worker (hires).
create function app.start_onboarding(p_employee uuid, p_template uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp     public.employees;
  v_tpl     public.onboarding_templates;
  v_plan    uuid;
  v_task    public.onboarding_template_tasks;
  v_mgr     uuid;
  v_target  uuid;
begin
  select * into v_emp from public.employees where id = p_employee;
  select * into v_tpl from public.onboarding_templates
   where organization_id = v_emp.organization_id and is_active and (id = p_template or (p_template is null and is_default));
  if v_emp.id is null or v_tpl.id is null then
    raise exception 'Choose an onboarding template.' using errcode = '22023';
  end if;
  if exists (select 1 from public.onboarding_plans where employee_id = p_employee and status = 'in_progress') then
    raise exception 'This person already has onboarding in progress.' using errcode = '22023';
  end if;
  insert into public.onboarding_plans (organization_id, employee_id, template_id) values (v_emp.organization_id, p_employee, v_tpl.id)
  returning id into v_plan;
  v_mgr := v_emp.manager_employee_id;
  for v_task in select * from public.onboarding_template_tasks where template_id = v_tpl.id order by position, title loop
    v_target := case v_task.assignee when 'joiner' then v_emp.id when 'manager' then coalesce(v_mgr, v_tpl.owner_employee_id)
                                     else coalesce(v_tpl.owner_employee_id, v_mgr) end;
    continue when v_target is null;
    insert into public.tasks (organization_id, assignee_employee_id, title, details, due_on, subject_type, subject_id, created_by)
    values (v_emp.organization_id, v_target,
            case when v_task.assignee = 'joiner' then v_task.title
                 else v_task.title || ' — ' || trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)) end,
            v_task.details, v_emp.date_of_joining + v_task.due_offset_days, 'onboarding_plan', v_plan, auth.uid());
  end loop;
  return v_plan;
end $$;

create function public.start_onboarding(p_employee uuid, p_template uuid default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'onboarding.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return app.start_onboarding(p_employee, p_template);
end $$;

-- Worker: every hire gets the default plan (once).
create function public.worker_start_onboarding(p_employee uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.employees where id = p_employee and status <> 'exited') then return 'missing'; end if;
  if exists (select 1 from public.onboarding_plans where employee_id = p_employee) then return 'exists'; end if;
  if not exists (select 1 from public.onboarding_templates t join public.employees e on e.organization_id = t.organization_id
                  where e.id = p_employee and t.is_default and t.is_active) then
    return 'no_template';
  end if;
  perform app.start_onboarding(p_employee, null);
  return 'started';
end $$;

create function public.cancel_onboarding(p_plan uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_plan public.onboarding_plans;
begin
  select * into v_plan from public.onboarding_plans where id = p_plan;
  if v_plan.id is null or not app.has_permission(v_plan.organization_id, 'onboarding.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_plan.status <> 'in_progress' then
    raise exception 'This plan is already %.', v_plan.status using errcode = '22023';
  end if;
  update public.tasks set status = 'cancelled' where subject_type = 'onboarding_plan' and subject_id = p_plan and status = 'open';
  update public.onboarding_plans set status = 'cancelled', completed_at = now() where id = p_plan;
end $$;

-- The plan completes when its last open task is closed.
create function app.complete_onboarding_when_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.subject_type = 'onboarding_plan' and new.status <> 'open' and old.status = 'open'
     and not exists (select 1 from public.tasks t where t.subject_type = 'onboarding_plan' and t.subject_id = new.subject_id and t.status = 'open') then
    update public.onboarding_plans set status = 'completed', completed_at = now() where id = new.subject_id and status = 'in_progress';
  end if;
  return null;
end $$;
create trigger tasks_onboarding_completion after update of status on public.tasks
  for each row execute function app.complete_onboarding_when_done();

-- Members acknowledge a policy for themselves (once per version).
create function public.acknowledge_policy(p_policy uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pol public.policy_documents;
  v_emp uuid;
begin
  select * into v_pol from public.policy_documents where id = p_policy and retired_at is null;
  select id into v_emp from public.employees where organization_id = v_pol.organization_id and user_id = auth.uid();
  if v_pol.id is null or v_emp is null or not app.is_member(v_pol.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.policy_acknowledgements (organization_id, policy_id, employee_id) values (v_pol.organization_id, p_policy, v_emp)
  on conflict (policy_id, employee_id) do nothing;
end $$;

-- Who has (not) acknowledged a policy: for HR.
create function public.policy_acknowledgement_status(p_policy uuid)
returns table (employee_id uuid, employee_code text, employee_name text, acknowledged_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.policy_documents where id = p_policy;
  if v_org is null or not app.has_permission(v_org, 'policy.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select e.id, e.employee_code, trim(concat_ws(' ', e.first_name, e.last_name)), a.acknowledged_at
      from public.employees e
      left join public.policy_acknowledgements a on a.policy_id = p_policy and a.employee_id = e.id
     where e.organization_id = v_org and e.status in ('active', 'on_notice', 'pre_joining')
     order by a.acknowledged_at nulls first, e.employee_code;
end $$;

-- ─── Defaults ───────────────────────────────────────────────────────────────

create function app.seed_org_onboarding(p_org uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_tpl uuid;
begin
  if exists (select 1 from public.onboarding_templates where organization_id = p_org) then return; end if;
  insert into public.onboarding_templates (organization_id, name, is_default) values (p_org, 'Standard onboarding', true) returning id into v_tpl;
  insert into public.onboarding_template_tasks (organization_id, template_id, position, title, details, assignee, due_offset_days) values
    (p_org, v_tpl, 1, 'Prepare laptop, email and system access', 'Ready before day one.', 'owner', -3),
    (p_org, v_tpl, 2, 'Plan the first week', 'Agenda, a buddy, first tasks and introductions.', 'manager', -2),
    (p_org, v_tpl, 3, 'Complete your personal details', 'Profile → Personal details and emergency contacts.', 'joiner', 0),
    (p_org, v_tpl, 4, 'Upload your identity and education documents', 'Profile → Documents.', 'joiner', 1),
    (p_org, v_tpl, 5, 'Read and acknowledge company policies', 'Policies page.', 'joiner', 3),
    (p_org, v_tpl, 6, 'First-week check-in', 'How is it going? Anything blocking?', 'manager', 5),
    (p_org, v_tpl, 7, '30-day check-in', 'Expectations, feedback and probation goals.', 'manager', 30);
end $$;
create function app.seed_org_onboarding_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_onboarding(new.id);
  return null;
end $$;
create trigger organizations_seed_onboarding after insert on public.organizations
  for each row execute function app.seed_org_onboarding_trigger();
select app.seed_org_onboarding(id) from public.organizations;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function app.start_onboarding(uuid, uuid) from public;
revoke all on function app.complete_onboarding_when_done() from public;
revoke all on function app.seed_org_onboarding(uuid) from public;
revoke all on function app.seed_org_onboarding_trigger() from public;
revoke all on function public.start_onboarding(uuid, uuid) from public, anon;
revoke all on function public.cancel_onboarding(uuid) from public, anon;
revoke all on function public.acknowledge_policy(uuid) from public, anon;
revoke all on function public.policy_acknowledgement_status(uuid) from public, anon;
revoke all on function public.worker_start_onboarding(uuid) from public, anon, authenticated;
grant execute on function public.start_onboarding(uuid, uuid) to authenticated, service_role;
grant execute on function public.cancel_onboarding(uuid) to authenticated, service_role;
grant execute on function public.acknowledge_policy(uuid) to authenticated, service_role;
grant execute on function public.policy_acknowledgement_status(uuid) to authenticated, service_role;
grant execute on function public.worker_start_onboarding(uuid) to service_role;
