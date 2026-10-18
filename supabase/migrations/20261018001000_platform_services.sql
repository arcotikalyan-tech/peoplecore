-- PeopleCore · Platform services: jobs, domain events, notifications, tasks and a generic approvals engine.
--
-- Jobs (ADR-007): a Postgres-backed queue. Business changes enqueue jobs in the same transaction
--   (transactional outbox); the worker (apps/worker, service role) claims them with FOR UPDATE SKIP
--   LOCKED, retries with exponential backoff and marks them dead after max_attempts.
-- Domain events (02-module-map): modules record facts (employee.joined, approval.approved, …) with an
--   idempotency key; each event enqueues an `event:<type>` job for the worker.
-- Notifications: an in-app inbox per user; users can only mark their own as read. Links are relative to
--   the organization (e.g. /inbox); the app prefixes /app/<org>.
-- Tasks: assigned to employees (onboarding, offboarding, …); visible to the assignee, their managers
--   and HR (task.manage).
-- Approvals (ADR-008): flows per subject type (leave_request, offer, …) with ordered steps. A step is
--   decided by the subject's reporting manager (falling back to a permission) or by holders of a
--   permission. Whoever raised a request, and the person it is about, can never approve it, and nobody
--   approves two steps of the same request. Modules register a handler that is called when a request
--   is approved, rejected or cancelled.

-- ─── Permission catalog ─────────────────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('task.manage', 'platform', 'Create and manage tasks for others', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'task.manage', 'org'), ('hr_admin', 'task.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'task.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Jobs ───────────────────────────────────────────────────────────────────

create type app.job_status as enum ('queued', 'running', 'done', 'dead');

create table app.jobs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete cascade,
  kind             text not null check (kind ~ '^[a-z0-9_.:-]{1,80}$'),
  payload          jsonb not null default '{}',
  idempotency_key  text not null unique check (char_length(idempotency_key) between 1 and 300),
  status           app.job_status not null default 'queued',
  run_at           timestamptz not null default now(),
  attempts         int not null default 0,
  max_attempts     int not null default 8 check (max_attempts between 1 and 50),
  locked_until     timestamptz,
  locked_by        text,
  last_error       text,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index jobs_ready_idx on app.jobs (run_at, id) where status in ('queued', 'running');

-- Enqueue once per idempotency key; returns the job id (existing or new).
create function app.enqueue_job(p_org uuid, p_kind text, p_payload jsonb, p_key text, p_run_at timestamptz default now())
returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  insert into app.jobs (organization_id, kind, payload, idempotency_key, run_at)
  values (p_org, p_kind, coalesce(p_payload, '{}'), p_key, coalesce(p_run_at, now()))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from app.jobs where idempotency_key = p_key;
  end if;
  return v_id;
end $$;

-- Worker API (service role only). Expired leases are reclaimed, so a crashed worker loses nothing.
create function public.worker_claim_jobs(p_worker text, p_limit int default 10, p_lease_seconds int default 300)
returns table (id bigint, organization_id uuid, kind text, payload jsonb, attempts int)
language sql volatile security definer set search_path = '' as $$
  with picked as (
    select j.id from app.jobs j
     where (j.status = 'queued' and j.run_at <= now())
        or (j.status = 'running' and j.locked_until < now())
     order by j.run_at, j.id
     limit least(greatest(p_limit, 1), 100)
     for update skip locked
  )
  update app.jobs j
     set status = 'running', attempts = j.attempts + 1, locked_by = p_worker,
         locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 10))
    from picked
   where j.id = picked.id
  returning j.id, j.organization_id, j.kind, j.payload, j.attempts;
$$;

create function public.worker_complete_job(p_id bigint, p_worker text) returns boolean
language sql volatile security definer set search_path = '' as $$
  update app.jobs set status = 'done', finished_at = now(), locked_until = null, last_error = null
   where id = p_id and status = 'running' and locked_by = p_worker
  returning true;
$$;

-- Backoff: 30 s × 2^(attempts-1), capped at one hour. Dead after max_attempts.
create function public.worker_fail_job(p_id bigint, p_worker text, p_error text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_job app.jobs;
begin
  select * into v_job from app.jobs where id = p_id and status = 'running' and locked_by = p_worker for update;
  if v_job.id is null then return null; end if;
  if v_job.attempts >= v_job.max_attempts then
    update app.jobs set status = 'dead', finished_at = now(), locked_until = null, last_error = left(p_error, 2000) where id = p_id;
    return 'dead';
  end if;
  update app.jobs
     set status = 'queued', locked_until = null, last_error = left(p_error, 2000),
         run_at = now() + make_interval(secs => least(3600, 30 * power(2, v_job.attempts - 1)::int))
   where id = p_id;
  return 'retry';
end $$;

-- Lets the worker's scheduler enqueue recurring jobs (idempotent per key, e.g. "daily:2026-10-18").
create function public.worker_enqueue_job(p_org uuid, p_kind text, p_payload jsonb, p_key text, p_run_at timestamptz default now())
returns bigint
language sql volatile security definer set search_path = '' as $$
  select app.enqueue_job(p_org, p_kind, p_payload, p_key, p_run_at);
$$;

-- ─── Domain events ──────────────────────────────────────────────────────────

create table app.domain_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  event_type       text not null check (event_type ~ '^[a-z_]+\.[a-z_.]+$'),
  subject_id       uuid,
  payload          jsonb not null default '{}',
  idempotency_key  text not null unique,
  actor_user_id    uuid default auth.uid(),
  occurred_at      timestamptz not null default now()
);
create index domain_events_org_idx on app.domain_events (organization_id, event_type, occurred_at desc);

-- Records the event once and enqueues its job in the same transaction.
create function app.emit_event(p_org uuid, p_type text, p_subject uuid, p_payload jsonb, p_key text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  insert into app.domain_events (organization_id, event_type, subject_id, payload, idempotency_key)
  values (p_org, p_type, p_subject, coalesce(p_payload, '{}'), p_key)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform app.enqueue_job(p_org, 'event:' || p_type,
      coalesce(p_payload, '{}') || jsonb_build_object('event_id', v_id, 'subject_id', p_subject), 'event:' || p_key);
  end if;
end $$;

-- ─── Notifications ──────────────────────────────────────────────────────────

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  kind             text not null check (kind ~ '^[a-z_.]{1,60}$'),
  title            text not null check (char_length(title) between 1 and 200),
  body             text check (char_length(body) <= 1000),
  link             text check (link ~ '^/[A-Za-z0-9/_?=&%.-]*$'),
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create function app.notify(p_org uuid, p_user uuid, p_kind text, p_title text, p_body text default null, p_link text default null)
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.notifications (organization_id, user_id, kind, title, body, link)
  select p_org, p_user, p_kind, left(p_title, 200), left(p_body, 1000), p_link
   where p_user is not null;
$$;

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and app.is_member(organization_id));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ─── Tasks ──────────────────────────────────────────────────────────────────

create type public.task_status as enum ('open', 'done', 'cancelled');

create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  assignee_employee_id  uuid not null,
  title                 text not null check (char_length(title) between 1 and 200),
  details               text check (char_length(details) <= 2000),
  due_on                date,
  status                public.task_status not null default 'open',
  subject_type          text check (subject_type ~ '^[a-z_]{1,60}$'),
  subject_id            uuid,
  completed_at          timestamptz,
  completed_by          uuid,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, assignee_employee_id) references public.employees (organization_id, id) on delete cascade
);
create index tasks_assignee_idx on public.tasks (organization_id, assignee_employee_id, status, due_on);
create index tasks_subject_idx on public.tasks (organization_id, subject_type, subject_id);

create trigger tasks_touch before update on public.tasks for each row execute function app.touch_updated_at();
create trigger tasks_audit after insert or update or delete on public.tasks for each row execute function app.audit_row();

alter table public.tasks enable row level security;
-- Visible to whoever can see the assignee (themselves, their line managers, HR) and to task managers.
create policy tasks_select on public.tasks for select to authenticated
  using (app.has_permission(organization_id, 'task.manage')
         or app.can_access_employee(organization_id, assignee_employee_id, 'employee.read'));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (app.has_permission(organization_id, 'task.manage'));
create policy tasks_update on public.tasks for update to authenticated
  using (app.has_permission(organization_id, 'task.manage'))
  with check (app.has_permission(organization_id, 'task.manage'));
grant select, insert, update on public.tasks to authenticated;
grant all on public.tasks to service_role;

-- The assignee (or a task manager) completes or reopens a task.
create function public.set_task_status(p_task uuid, p_status public.task_status) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if v_task.id is null or not (
       app.has_permission(v_task.organization_id, 'task.manage')
       or exists (select 1 from public.employees e where e.id = v_task.assignee_employee_id and e.user_id = auth.uid()
                    and app.is_member(v_task.organization_id))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.tasks
     set status = p_status,
         completed_at = case when p_status = 'done' then now() end,
         completed_by = case when p_status = 'done' then auth.uid() end
   where id = p_task;
end $$;

-- ─── Approvals ──────────────────────────────────────────────────────────────

create type public.approval_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.approver_rule as enum ('reporting_manager', 'permission');

-- Templates every organization starts from (modules add theirs in their own migrations).
create table app.approval_flow_templates (
  subject_type    text not null check (subject_type ~ '^[a-z_]{1,60}$'),
  step_no         smallint not null check (step_no between 1 and 10),
  approver_rule   public.approver_rule not null,
  permission_key  text references public.permissions (key),
  label           text not null,
  primary key (subject_type, step_no),
  check (approver_rule = 'reporting_manager' or permission_key is not null)
);

create table public.approval_flows (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  subject_type     text not null check (subject_type ~ '^[a-z_]{1,60}$'),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index approval_flows_active_uq on public.approval_flows (organization_id, subject_type) where is_active;

create table public.approval_flow_steps (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  flow_id          uuid not null,
  step_no          smallint not null check (step_no between 1 and 10),
  approver_rule    public.approver_rule not null,
  -- For 'permission': who may decide. For 'reporting_manager': who decides when there is no manager.
  permission_key   text references public.permissions (key),
  label            text not null check (char_length(label) between 1 and 80),
  unique (flow_id, step_no),
  foreign key (organization_id, flow_id) references public.approval_flows (organization_id, id) on delete cascade,
  check (approver_rule = 'reporting_manager' or permission_key is not null)
);

create table public.approval_requests (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  subject_type         text not null,
  subject_id           uuid not null,
  flow_id              uuid not null,
  subject_employee_id  uuid,
  summary              text not null check (char_length(summary) between 1 and 300),
  link                 text check (link ~ '^/[A-Za-z0-9/_?=&%.-]*$'),
  status               public.approval_status not null default 'pending',
  current_step         smallint not null default 1,
  requested_by         uuid not null default auth.uid(),
  created_at           timestamptz not null default now(),
  decided_at           timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, flow_id) references public.approval_flows (organization_id, id),
  foreign key (organization_id, subject_employee_id) references public.employees (organization_id, id) on delete cascade
);
create unique index approval_requests_pending_uq on public.approval_requests (subject_type, subject_id) where status = 'pending';
create index approval_requests_org_idx on public.approval_requests (organization_id, status, created_at desc);

create table public.approval_actions (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  request_id       uuid not null,
  step_no          smallint not null,
  actor_user_id    uuid not null,
  decision         text not null check (decision in ('approve', 'reject', 'cancel')),
  comment          text check (char_length(comment) <= 1000),
  acted_at         timestamptz not null default now(),
  foreign key (organization_id, request_id) references public.approval_requests (organization_id, id) on delete cascade
);
create index approval_actions_request_idx on public.approval_actions (request_id, acted_at);
create trigger approval_actions_no_update before update on public.approval_actions
  for each row execute function app.prevent_mutation();

create trigger approval_requests_audit after insert or update on public.approval_requests
  for each row execute function app.audit_row();

-- Handlers: modules register a function (subject_id uuid, outcome text) called on approve/reject/cancel.
create table app.approval_handlers (
  subject_type  text primary key,
  handler       regprocedure not null
);

-- Flows for every organization: seeded on creation, from the templates.
create function app.seed_org_flows(p_org uuid, p_subject_type text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_type text;
  v_flow uuid;
begin
  for v_type in select distinct subject_type from app.approval_flow_templates
                 where p_subject_type is null or subject_type = p_subject_type loop
    continue when exists (select 1 from public.approval_flows where organization_id = p_org and subject_type = v_type and is_active);
    insert into public.approval_flows (organization_id, subject_type) values (p_org, v_type) returning id into v_flow;
    insert into public.approval_flow_steps (organization_id, flow_id, step_no, approver_rule, permission_key, label)
    select p_org, v_flow, t.step_no, t.approver_rule, t.permission_key, t.label
      from app.approval_flow_templates t where t.subject_type = v_type;
  end loop;
end $$;

create function app.seed_org_flows_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_flows(new.id);
  return null;
end $$;
create trigger organizations_seed_flows after insert on public.organizations
  for each row execute function app.seed_org_flows_trigger();

-- Users who may decide the request's current step (used for notifications and the inbox).
create function app.current_approvers(p_request uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_req  public.approval_requests;
  v_step public.approval_flow_steps;
  v_mgr  uuid;
begin
  select * into v_req from public.approval_requests where id = p_request;
  select * into v_step from public.approval_flow_steps where flow_id = v_req.flow_id and step_no = v_req.current_step;
  if v_req.id is null or v_req.status <> 'pending' or v_step.id is null then return; end if;

  if v_step.approver_rule = 'reporting_manager' then
    select m.user_id into v_mgr
      from public.employees e join public.employees m on m.organization_id = e.organization_id and m.id = e.manager_employee_id
      join public.organization_members om on om.organization_id = e.organization_id and om.user_id = m.user_id and om.status = 'active'
     where e.id = v_req.subject_employee_id;
    -- The manager decides, unless there is none who can act (or they raised the request themselves).
    if v_mgr is not null and v_mgr <> v_req.requested_by then
      return query select v_mgr;
      return;
    end if;
    if v_step.permission_key is null then return; end if;
  end if;

  -- Org-wide holders of the step's permission.
  return query
    select distinct om.user_id
      from public.organization_members om
      join public.member_roles mr on mr.member_id = om.id and (mr.valid_until is null or mr.valid_until > now())
      join public.role_permissions rp on rp.role_id = mr.role_id and rp.permission_key = v_step.permission_key and rp.scope = 'org'
     where om.organization_id = v_req.organization_id and om.status = 'active'
       and om.user_id <> v_req.requested_by;
end $$;

-- May the caller decide the request's current step?
create function app.can_decide_approval(p_request uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_req  public.approval_requests;
  v_step public.approval_flow_steps;
begin
  select * into v_req from public.approval_requests where id = p_request;
  if v_req.id is null or v_req.status <> 'pending' or not app.is_member(v_req.organization_id) then return false; end if;
  -- Maker ≠ checker; nobody approves their own request or two steps of one request.
  if v_req.requested_by = auth.uid() then return false; end if;
  if exists (select 1 from public.employees e where e.id = v_req.subject_employee_id and e.user_id = auth.uid()) then return false; end if;
  if exists (select 1 from public.approval_actions a where a.request_id = p_request and a.actor_user_id = auth.uid() and a.decision = 'approve') then
    return false;
  end if;

  select * into v_step from public.approval_flow_steps where flow_id = v_req.flow_id and step_no = v_req.current_step;
  if v_step.approver_rule = 'reporting_manager' then
    -- The subject's manager, or (when there is none who can act) org-wide holders of the step's permission.
    return auth.uid() in (select app.current_approvers(p_request));
  end if;
  return app.has_permission(v_req.organization_id, v_step.permission_key)
      or (v_req.subject_employee_id is not null
          and app.can_access_employee(v_req.organization_id, v_req.subject_employee_id, v_step.permission_key));
end $$;

-- Opens a request (called by module functions). Notifies the first approvers.
create function app.request_approval(p_org uuid, p_subject_type text, p_subject_id uuid, p_subject_employee uuid, p_summary text, p_link text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_flow uuid;
  v_id   uuid;
  v_user uuid;
begin
  select id into v_flow from public.approval_flows where organization_id = p_org and subject_type = p_subject_type and is_active;
  if v_flow is null or not exists (select 1 from public.approval_flow_steps where flow_id = v_flow) then
    raise exception 'No approval flow is set up for %.', p_subject_type using errcode = '22023';
  end if;
  insert into public.approval_requests (organization_id, subject_type, subject_id, flow_id, subject_employee_id, summary, link)
  values (p_org, p_subject_type, p_subject_id, v_flow, p_subject_employee, left(p_summary, 300), p_link)
  returning id into v_id;
  for v_user in select app.current_approvers(v_id) loop
    perform app.notify(p_org, v_user, 'approval.requested', 'Approval needed: ' || left(p_summary, 150), null, '/inbox');
  end loop;
  return v_id;
end $$;

create function app.run_approval_handler(p_req public.approval_requests, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_handler regprocedure;
begin
  select handler into v_handler from app.approval_handlers where subject_type = p_req.subject_type;
  if v_handler is not null then
    execute format('select %s($1, $2)', v_handler::regproc) using p_req.subject_id, p_outcome;
  end if;
  perform app.emit_event(p_req.organization_id, 'approval.' || p_outcome, p_req.id,
    jsonb_build_object('subject_type', p_req.subject_type, 'subject_id', p_req.subject_id),
    'approval:' || p_req.id || ':' || p_outcome);
  perform app.notify(p_req.organization_id, p_req.requested_by, 'approval.' || p_outcome,
    initcap(p_outcome) || ': ' || left(p_req.summary, 150), null, p_req.link);
end $$;

create function public.decide_approval(p_request uuid, p_decision text, p_comment text default null) returns public.approval_status
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req   public.approval_requests;
  v_last  smallint;
  v_user  uuid;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;
  select * into v_req from public.approval_requests where id = p_request for update;
  if v_req.id is null or not app.can_decide_approval(p_request) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision = 'reject' and nullif(btrim(p_comment), '') is null then
    raise exception 'Give a reason when rejecting.' using errcode = '22023';
  end if;
  insert into public.approval_actions (organization_id, request_id, step_no, actor_user_id, decision, comment)
  values (v_req.organization_id, v_req.id, v_req.current_step, auth.uid(), p_decision, nullif(btrim(p_comment), ''));

  if p_decision = 'reject' then
    update public.approval_requests set status = 'rejected', decided_at = now() where id = v_req.id returning * into v_req;
    perform app.run_approval_handler(v_req, 'rejected');
    return 'rejected';
  end if;

  select max(step_no) into v_last from public.approval_flow_steps where flow_id = v_req.flow_id;
  if v_req.current_step < v_last then
    update public.approval_requests set current_step = current_step + 1 where id = v_req.id;
    for v_user in select app.current_approvers(v_req.id) loop
      perform app.notify(v_req.organization_id, v_user, 'approval.requested', 'Approval needed: ' || left(v_req.summary, 150), null, '/inbox');
    end loop;
    return 'pending';
  end if;
  update public.approval_requests set status = 'approved', decided_at = now() where id = v_req.id returning * into v_req;
  perform app.run_approval_handler(v_req, 'approved');
  return 'approved';
end $$;

-- The requester withdraws a pending request.
create function public.cancel_approval(p_request uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req public.approval_requests;
begin
  select * into v_req from public.approval_requests where id = p_request for update;
  if v_req.id is null or v_req.requested_by <> auth.uid() or not app.is_member(v_req.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Only pending requests can be withdrawn.' using errcode = '22023';
  end if;
  insert into public.approval_actions (organization_id, request_id, step_no, actor_user_id, decision)
  values (v_req.organization_id, v_req.id, v_req.current_step, auth.uid(), 'cancel');
  update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_req.id returning * into v_req;
  perform app.run_approval_handler(v_req, 'cancelled');
end $$;

-- The caller's inbox: requests they can decide now.
create function public.my_pending_approvals(p_org uuid)
returns table (id uuid, subject_type text, subject_id uuid, summary text, link text, step_label text,
               requested_by_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.subject_type, r.subject_id, r.summary, r.link, s.label,
         coalesce((select nullif(trim(concat_ws(' ', e.first_name, e.last_name)), '') from public.employees e
                    where e.organization_id = r.organization_id and e.user_id = r.requested_by), 'A colleague'),
         r.created_at
    from public.approval_requests r
    join public.approval_flow_steps s on s.flow_id = r.flow_id and s.step_no = r.current_step
   where r.organization_id = p_org and r.status = 'pending' and app.can_decide_approval(r.id)
   order by r.created_at;
$$;

alter table public.approval_flows enable row level security;
alter table public.approval_flow_steps enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_actions enable row level security;

create policy approval_flows_select on public.approval_flows for select to authenticated using (app.is_member(organization_id));
create policy approval_flow_steps_select on public.approval_flow_steps for select to authenticated using (app.is_member(organization_id));
-- Changing flows is an org setting.
create policy approval_flow_steps_write on public.approval_flow_steps for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));

create function app.can_view_approval(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.approval_requests r
     where r.id = p_request and app.is_member(r.organization_id)
       and (r.requested_by = auth.uid()
            or exists (select 1 from public.employees e where e.id = r.subject_employee_id and e.user_id = auth.uid())
            or exists (select 1 from public.approval_actions a where a.request_id = r.id and a.actor_user_id = auth.uid())
            or app.can_decide_approval(r.id)
            or app.has_permission(r.organization_id, 'audit.read')));
$$;
create policy approval_requests_select on public.approval_requests for select to authenticated using (app.can_view_approval(id));
create policy approval_actions_select on public.approval_actions for select to authenticated using (app.can_view_approval(request_id));

grant select on public.approval_flows, public.approval_flow_steps, public.approval_requests, public.approval_actions to authenticated;
grant insert, update, delete on public.approval_flow_steps to authenticated;
grant all on public.approval_flows, public.approval_flow_steps, public.approval_requests, public.approval_actions to service_role;

-- ─── Grants on functions ────────────────────────────────────────────────────

revoke all on function app.enqueue_job(uuid, text, jsonb, text, timestamptz) from public;
revoke all on function app.emit_event(uuid, text, uuid, jsonb, text) from public;
revoke all on function app.notify(uuid, uuid, text, text, text, text) from public;
revoke all on function app.seed_org_flows(uuid, text) from public;
revoke all on function app.seed_org_flows_trigger() from public;
revoke all on function app.current_approvers(uuid) from public;
revoke all on function app.request_approval(uuid, text, uuid, uuid, text, text) from public;
revoke all on function app.run_approval_handler(public.approval_requests, text) from public;
grant execute on function app.can_decide_approval(uuid) to authenticated, service_role;
grant execute on function app.can_view_approval(uuid) to authenticated, service_role;
grant execute on function app.current_approvers(uuid) to service_role;

revoke all on function public.worker_claim_jobs(text, int, int) from public, anon, authenticated;
revoke all on function public.worker_complete_job(bigint, text) from public, anon, authenticated;
revoke all on function public.worker_fail_job(bigint, text, text) from public, anon, authenticated;
revoke all on function public.worker_enqueue_job(uuid, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.worker_claim_jobs(text, int, int) to service_role;
grant execute on function public.worker_complete_job(bigint, text) to service_role;
grant execute on function public.worker_fail_job(bigint, text, text) to service_role;
grant execute on function public.worker_enqueue_job(uuid, text, jsonb, text, timestamptz) to service_role;

revoke all on function public.set_task_status(uuid, public.task_status) from public, anon;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
revoke all on function public.cancel_approval(uuid) from public, anon;
revoke all on function public.my_pending_approvals(uuid) from public, anon;
grant execute on function public.set_task_status(uuid, public.task_status) to authenticated, service_role;
grant execute on function public.decide_approval(uuid, text, text) to authenticated, service_role;
grant execute on function public.cancel_approval(uuid) to authenticated, service_role;
grant execute on function public.my_pending_approvals(uuid) to authenticated, service_role;
