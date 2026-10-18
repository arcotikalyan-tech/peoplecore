-- PeopleCore · Workflow engine v1 (ADR-008, Phase 5).
--
-- * HR (`workflow.manage`) builds automations: a trigger (a domain event), optional conditions on the employee it is
--   about (department, location, designation, employment type), and up to 20 steps: notify someone, create a task,
--   assign a course, ask for an approval (the run pauses until it is decided), or wait N days.
-- * Definitions are versioned: saving creates a new immutable version; a run keeps the version it started with.
-- * Runs start from the event's job in the worker (once per workflow and event) and execute in the database, so
--   each step and its effect commit together. A failing step stops the run with the error recorded; nothing is
--   retried silently. Approval steps create ordinary approval requests (the employee's manager decides, or HR
--   without one), so people act through the same permission model and inbox.

insert into public.permissions (key, module, description, is_sensitive) values
  ('workflow.manage', 'platform', 'Build and switch on automated workflows', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'workflow.manage', 'org'), ('hr_admin', 'workflow.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'workflow.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Catalog of triggers ────────────────────────────────────────────────────

-- The events workflows can start from, and what their subject is (which decides whether there is an employee).
create table app.workflow_triggers (
  event_type    text primary key,
  label         text not null,
  subject_kind  text not null check (subject_kind in ('employee', 'leave_request', 'none'))
);
insert into app.workflow_triggers (event_type, label, subject_kind) values
  ('employee.hired', 'Someone is hired (before they join)', 'employee'),
  ('employee.joined', 'An employee’s joining date arrives', 'employee'),
  ('leave.approved', 'Leave is approved', 'leave_request'),
  ('payroll.locked', 'A payroll run is locked', 'none');

create function public.workflow_trigger_catalog()
returns table (event_type text, label text, about_employee boolean)
language sql stable security definer set search_path = '' as $$
  select t.event_type, t.label, t.subject_kind <> 'none' from app.workflow_triggers t order by t.label;
$$;

-- ─── Definitions, versions, runs ────────────────────────────────────────────

create type public.workflow_run_status as enum ('running', 'waiting', 'completed', 'failed', 'stopped');

create table public.workflow_definitions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  name                text not null check (char_length(name) between 3 and 120),
  trigger_event       text not null references app.workflow_triggers (event_type),
  is_active           boolean not null default false,
  current_version_id  uuid,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.workflow_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  definition_id    uuid not null,
  version          int not null check (version > 0),
  conditions       jsonb not null default '[]',
  steps            jsonb not null,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (definition_id, version),
  unique (organization_id, id),
  foreign key (organization_id, definition_id) references public.workflow_definitions (organization_id, id) on delete cascade
);
alter table public.workflow_definitions
  add foreign key (organization_id, current_version_id) references public.workflow_versions (organization_id, id);
create trigger workflow_versions_immutable before update on public.workflow_versions for each row execute function app.prevent_mutation();

create table public.workflow_runs (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  definition_id        uuid not null,
  version_id           uuid not null,
  event_id             bigint not null,
  event_type           text not null,
  subject_id           uuid,
  subject_employee_id  uuid,
  status               public.workflow_run_status not null default 'running',
  current_step         int not null default 0,
  resume_at            timestamptz,
  error                text,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  unique (definition_id, event_id),
  unique (organization_id, id),
  foreign key (organization_id, definition_id) references public.workflow_definitions (organization_id, id) on delete cascade,
  foreign key (organization_id, version_id) references public.workflow_versions (organization_id, id),
  foreign key (organization_id, subject_employee_id) references public.employees (organization_id, id) on delete cascade
);
create index workflow_runs_definition_idx on public.workflow_runs (definition_id, started_at desc);
create index workflow_runs_waiting_idx on public.workflow_runs (resume_at) where status = 'waiting' and resume_at is not null;

create table public.workflow_run_steps (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  run_id               uuid not null,
  step_no              int not null,
  kind                 text not null,
  status               text not null check (status in ('done', 'skipped', 'waiting', 'failed', 'rejected')),
  detail               text check (char_length(detail) <= 500),
  approval_request_id  uuid,
  started_at           timestamptz not null default clock_timestamp(),
  finished_at          timestamptz,
  unique (run_id, step_no),
  unique (organization_id, id),
  foreign key (organization_id, run_id) references public.workflow_runs (organization_id, id) on delete cascade
);

create trigger workflow_definitions_touch before update on public.workflow_definitions for each row execute function app.touch_updated_at();
create trigger workflow_definitions_audit after insert or update or delete on public.workflow_definitions for each row execute function app.audit_row();
create trigger workflow_versions_audit after insert on public.workflow_versions for each row execute function app.audit_row();

alter table public.workflow_definitions enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;
create policy workflow_definitions_select on public.workflow_definitions for select to authenticated using (app.has_permission(organization_id, 'workflow.manage'));
create policy workflow_versions_select on public.workflow_versions for select to authenticated using (app.has_permission(organization_id, 'workflow.manage'));
create policy workflow_runs_select on public.workflow_runs for select to authenticated using (app.has_permission(organization_id, 'workflow.manage'));
create policy workflow_run_steps_select on public.workflow_run_steps for select to authenticated using (app.has_permission(organization_id, 'workflow.manage'));
grant select on public.workflow_definitions, public.workflow_versions, public.workflow_runs, public.workflow_run_steps to authenticated;
grant all on public.workflow_definitions, public.workflow_versions, public.workflow_runs, public.workflow_run_steps to service_role;

-- ─── Validation ─────────────────────────────────────────────────────────────

-- Raises a message a person can act on for anything wrong with a definition.
create function app.workflow_validate(p_org uuid, p_trigger text, p_conditions jsonb, p_steps jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind  text;
  v_c     jsonb;
  v_s     jsonb;
  v_i     int := 0;
  v_type  text;
  v_n     int;
begin
  select subject_kind into v_kind from app.workflow_triggers where event_type = p_trigger;
  if v_kind is null then raise exception 'Choose what starts the workflow.' using errcode = '22023'; end if;
  if jsonb_typeof(p_conditions) is distinct from 'array' or jsonb_array_length(p_conditions) > 5 then
    raise exception 'Use at most 5 conditions.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_conditions) > 0 and v_kind = 'none' then
    raise exception 'Conditions only apply to workflows about an employee.' using errcode = '22023';
  end if;
  for v_c in select * from jsonb_array_elements(p_conditions) loop
    case v_c->>'field'
      when 'department_id' then
        if not exists (select 1 from public.departments where organization_id = p_org and id::text = v_c->>'value') then
          raise exception 'A condition names a department that doesn’t exist.' using errcode = '22023'; end if;
      when 'location_id' then
        if not exists (select 1 from public.locations where organization_id = p_org and id::text = v_c->>'value') then
          raise exception 'A condition names a location that doesn’t exist.' using errcode = '22023'; end if;
      when 'designation_id' then
        if not exists (select 1 from public.designations where organization_id = p_org and id::text = v_c->>'value') then
          raise exception 'A condition names a designation that doesn’t exist.' using errcode = '22023'; end if;
      when 'employment_type' then
        if (v_c->>'value') is null or not exists (select 1 from unnest(enum_range(null::public.employment_type)) t where t::text = v_c->>'value') then
          raise exception 'A condition names an unknown employment type.' using errcode = '22023'; end if;
      else
        raise exception 'Conditions can check department, location, designation or employment type.' using errcode = '22023';
    end case;
  end loop;

  v_n := case when jsonb_typeof(p_steps) = 'array' then jsonb_array_length(p_steps) else 0 end;
  if v_n not between 1 and 20 then raise exception 'Add between 1 and 20 steps.' using errcode = '22023'; end if;
  for v_s in select * from jsonb_array_elements(p_steps) loop
    v_i := v_i + 1;
    v_type := v_s->>'type';
    if v_type in ('notify', 'task') and char_length(btrim(coalesce(v_s->>'title', ''))) not between 1 and 150 then
      raise exception 'Step %: give it a title (up to 150 characters).', v_i using errcode = '22023';
    end if;
    case v_type
      when 'notify' then
        if v_s->>'to' not in ('employee', 'manager', 'permission', 'user') or v_s->>'to' is null then
          raise exception 'Step %: choose who to notify.', v_i using errcode = '22023'; end if;
        if v_s->>'to' = 'permission' and not exists (select 1 from public.permissions where key = v_s->>'permission') then
          raise exception 'Step %: choose which people to notify.', v_i using errcode = '22023'; end if;
        if v_s->>'to' = 'user' and not exists (select 1 from public.organization_members where organization_id = p_org and user_id::text = v_s->>'user_id' and status = 'active') then
          raise exception 'Step %: choose a current member to notify.', v_i using errcode = '22023'; end if;
        if v_s->>'to' in ('employee', 'manager') and v_kind = 'none' then
          raise exception 'Step %: this trigger isn’t about an employee.', v_i using errcode = '22023'; end if;
      when 'task' then
        if v_s->>'assignee' not in ('employee', 'manager', 'person') or v_s->>'assignee' is null then
          raise exception 'Step %: choose who gets the task.', v_i using errcode = '22023'; end if;
        if v_s->>'assignee' = 'person' and not exists (select 1 from public.employees where organization_id = p_org and id::text = v_s->>'employee_id' and status <> 'exited') then
          raise exception 'Step %: choose a current employee for the task.', v_i using errcode = '22023'; end if;
        if v_s->>'assignee' in ('employee', 'manager') and v_kind = 'none' then
          raise exception 'Step %: this trigger isn’t about an employee.', v_i using errcode = '22023'; end if;
        if (v_s ? 'due_in_days') and coalesce((v_s->>'due_in_days')::int, -1) not between 0 and 365 then
          raise exception 'Step %: due in 0 to 365 days.', v_i using errcode = '22023'; end if;
      when 'course' then
        if v_kind = 'none' then raise exception 'Step %: this trigger isn’t about an employee.', v_i using errcode = '22023'; end if;
        if not exists (select 1 from public.courses where organization_id = p_org and id::text = v_s->>'course_id' and is_active) then
          raise exception 'Step %: choose a course that is offered.', v_i using errcode = '22023'; end if;
        if (v_s ? 'due_in_days') and coalesce((v_s->>'due_in_days')::int, -1) not between 0 and 365 then
          raise exception 'Step %: due in 0 to 365 days.', v_i using errcode = '22023'; end if;
      when 'approval' then
        if char_length(btrim(coalesce(v_s->>'summary', ''))) not between 1 and 200 then
          raise exception 'Step %: say what is being approved.', v_i using errcode = '22023'; end if;
      when 'wait' then
        if coalesce((v_s->>'days')::int, 0) not between 1 and 90 then
          raise exception 'Step %: wait 1 to 90 days.', v_i using errcode = '22023'; end if;
      else
        raise exception 'Step %: unknown kind of step.', v_i using errcode = '22023';
    end case;
  end loop;
exception
  when invalid_text_representation then
    raise exception 'A step has a number that isn’t a whole number.' using errcode = '22023';
end $$;

-- ─── Saving ─────────────────────────────────────────────────────────────────

-- Creates or updates a workflow; every save is a new version (runs keep theirs). The trigger is fixed once created.
create function public.save_workflow(p_org uuid, p_definition uuid, p_name text, p_trigger text, p_conditions jsonb, p_steps jsonb, p_active boolean)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_def  public.workflow_definitions;
  v_ver  uuid;
  v_no   int;
begin
  if not app.has_permission(p_org, 'workflow.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 120 then
    raise exception 'Name the workflow.' using errcode = '22023';
  end if;
  perform app.workflow_validate(p_org, p_trigger, coalesce(p_conditions, '[]'), p_steps);
  if p_definition is null then
    insert into public.workflow_definitions (organization_id, name, trigger_event, is_active)
    values (p_org, btrim(p_name), p_trigger, coalesce(p_active, false)) returning * into v_def;
  else
    select * into v_def from public.workflow_definitions where id = p_definition and organization_id = p_org for update;
    if v_def.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
    if v_def.trigger_event <> p_trigger then
      raise exception 'The trigger can’t change. Create a new workflow instead.' using errcode = '22023';
    end if;
  end if;
  select coalesce(max(version), 0) + 1 into v_no from public.workflow_versions where definition_id = v_def.id;
  insert into public.workflow_versions (organization_id, definition_id, version, conditions, steps)
  values (p_org, v_def.id, v_no, coalesce(p_conditions, '[]'), p_steps) returning id into v_ver;
  update public.workflow_definitions set name = btrim(p_name), is_active = coalesce(p_active, false), current_version_id = v_ver
   where id = v_def.id;
  return v_def.id;
end $$;

-- ─── Engine ─────────────────────────────────────────────────────────────────

create function app.workflow_text(p_template text, p_employee text) returns text
language sql immutable set search_path = '' as $$
  select replace(btrim(coalesce(p_template, '')), '{{employee}}', coalesce(p_employee, 'someone'));
$$;

-- Like app.request_approval, with an explicit requester (the workflow's author): the worker has no signed-in user.
create function app.request_approval_as(p_requester uuid, p_org uuid, p_subject_type text, p_subject_id uuid, p_subject_employee uuid,
                                        p_summary text, p_link text default null)
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
  insert into public.approval_requests (organization_id, subject_type, subject_id, flow_id, subject_employee_id, summary, link, requested_by)
  values (p_org, p_subject_type, p_subject_id, v_flow, p_subject_employee, left(p_summary, 300), p_link, p_requester)
  returning id into v_id;
  for v_user in select app.current_approvers(v_id) loop
    perform app.notify(p_org, v_user, 'approval.requested', 'Approval needed: ' || left(p_summary, 150), null, '/inbox');
  end loop;
  return v_id;
end $$;

-- Runs a run's steps from its current one until it finishes, pauses (approval, wait) or fails.
create function app.workflow_advance(p_run uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run     public.workflow_runs;
  v_ver     public.workflow_versions;
  v_def     public.workflow_definitions;
  v_emp     public.employees;
  v_mgr     public.employees;
  v_name    text;
  v_step    jsonb;
  v_n       int;
  v_target  uuid;
  v_user    uuid;
  v_detail  text;
  v_status  text;
  v_course  public.courses;
  v_req     uuid;
  v_step_id uuid;
begin
  select * into v_run from public.workflow_runs where id = p_run for update;
  if v_run.id is null or v_run.status <> 'running' then return; end if;
  select * into v_ver from public.workflow_versions where id = v_run.version_id;
  select * into v_def from public.workflow_definitions where id = v_run.definition_id;
  select * into v_emp from public.employees where id = v_run.subject_employee_id;
  select * into v_mgr from public.employees where id = v_emp.manager_employee_id;
  v_name := nullif(btrim(concat_ws(' ', v_emp.first_name, v_emp.last_name)), '');
  v_n := v_run.current_step;

  while v_n < jsonb_array_length(v_ver.steps) loop
    v_step := v_ver.steps -> v_n;
    v_status := 'done';
    v_detail := null;
    begin
      case v_step->>'type'
        when 'notify' then
          v_user := case v_step->>'to' when 'employee' then v_emp.user_id when 'manager' then v_mgr.user_id
                                       when 'user' then (v_step->>'user_id')::uuid end;
          if v_step->>'to' = 'permission' then
            perform app.notify_permission_holders(v_run.organization_id, v_step->>'permission', 'workflow.notice',
              left(app.workflow_text(v_step->>'title', v_name), 200), null);
            v_detail := 'Notified holders of ' || (v_step->>'permission');
          elsif v_user is null then
            v_status := 'skipped';
            v_detail := 'No one to notify (no manager, or no sign-in).';
          else
            perform app.notify(v_run.organization_id, v_user, 'workflow.notice', left(app.workflow_text(v_step->>'title', v_name), 200),
              nullif(left(app.workflow_text(v_step->>'body', v_name), 1000), ''), null);
            v_detail := 'Notified';
          end if;
        when 'task' then
          v_target := case v_step->>'assignee' when 'employee' then v_emp.id when 'manager' then v_mgr.id
                                               else (v_step->>'employee_id')::uuid end;
          if v_target is null then
            v_status := 'skipped';
            v_detail := 'No one to give the task to (no manager).';
          else
            insert into public.tasks (organization_id, assignee_employee_id, title, details, due_on, subject_type, subject_id, created_by)
            values (v_run.organization_id, v_target, left(app.workflow_text(v_step->>'title', v_name), 200),
                    nullif(left(app.workflow_text(v_step->>'details', v_name), 2000), ''),
                    case when v_step ? 'due_in_days' then app.org_today(v_run.organization_id) + (v_step->>'due_in_days')::int end,
                    'workflow_run', v_run.id, v_ver.created_by);
            v_detail := 'Task created';
          end if;
        when 'course' then
          select * into v_course from public.courses where id = (v_step->>'course_id')::uuid and organization_id = v_run.organization_id;
          if v_course.id is null or not v_course.is_active then
            raise exception 'The course is no longer offered.';
          end if;
          if exists (select 1 from public.course_enrollments where course_id = v_course.id and employee_id = v_emp.id and status in ('assigned', 'in_progress')) then
            v_status := 'skipped';
            v_detail := 'Already enrolled';
          else
            insert into public.course_enrollments (organization_id, course_id, employee_id, source, assigned_by, mandatory, due_on)
            values (v_run.organization_id, v_course.id, v_emp.id, 'assigned', v_ver.created_by, coalesce((v_step->>'mandatory')::boolean, true),
                    case when v_step ? 'due_in_days' then app.org_today(v_run.organization_id) + (v_step->>'due_in_days')::int end);
            perform app.notify(v_run.organization_id, v_emp.user_id, 'learning.assigned', 'Training assigned: ' || left(v_course.title, 140), null, '/learning');
            v_detail := 'Assigned ' || left(v_course.title, 100);
          end if;
        when 'approval' then
          insert into public.workflow_run_steps (organization_id, run_id, step_no, kind, status, detail)
          values (v_run.organization_id, v_run.id, v_n, 'approval', 'waiting', 'Waiting for approval') returning id into v_step_id;
          v_req := app.request_approval_as(coalesce(v_ver.created_by, v_def.created_by), v_run.organization_id, 'workflow_step', v_step_id, v_emp.id,
                     left(app.workflow_text(v_step->>'summary', v_name), 300), '/inbox');
          update public.workflow_run_steps set approval_request_id = v_req where id = v_step_id;
          update public.workflow_runs set status = 'waiting', current_step = v_n where id = v_run.id;
          return;
        when 'wait' then
          insert into public.workflow_run_steps (organization_id, run_id, step_no, kind, status, detail)
          values (v_run.organization_id, v_run.id, v_n, 'wait', 'waiting', 'Waiting ' || (v_step->>'days') || ' day(s)');
          update public.workflow_runs set status = 'waiting', current_step = v_n, resume_at = now() + make_interval(days => (v_step->>'days')::int)
           where id = v_run.id;
          return;
        else
          raise exception 'Unknown step %.', v_step->>'type';
      end case;
      insert into public.workflow_run_steps (organization_id, run_id, step_no, kind, status, detail, finished_at)
      values (v_run.organization_id, v_run.id, v_n, v_step->>'type', v_status, v_detail, clock_timestamp());
    exception when others then
      insert into public.workflow_run_steps (organization_id, run_id, step_no, kind, status, detail, finished_at)
      values (v_run.organization_id, v_run.id, v_n, coalesce(v_step->>'type', 'unknown'), 'failed', left(sqlerrm, 500), clock_timestamp());
      update public.workflow_runs set status = 'failed', current_step = v_n, error = left(sqlerrm, 500), finished_at = now() where id = v_run.id;
      return;
    end;
    v_n := v_n + 1;
  end loop;
  update public.workflow_runs set status = 'completed', current_step = v_n, finished_at = now() where id = v_run.id;
end $$;

-- Does the employee meet every condition?
create function app.workflow_matches(p_conditions jsonb, p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_array_length(p_conditions), 0) = 0
      or (p_employee is not null and not exists (
            select 1 from jsonb_array_elements(p_conditions) c, public.employees e
             where e.id = p_employee
               and (case c->>'field'
                      when 'department_id' then e.department_id::text
                      when 'location_id' then e.location_id::text
                      when 'designation_id' then e.designation_id::text
                      when 'employment_type' then e.employment_type::text end) is distinct from c->>'value'));
$$;

-- Worker: start the workflows an event triggers (once per workflow and event) and run them.
create function public.worker_start_workflows(p_event bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_e    record;
  v_kind text;
  v_emp  uuid;
  d      record;
  v_run  uuid;
  v_n    int := 0;
begin
  select * into v_e from app.domain_events where id = p_event;
  select subject_kind into v_kind from app.workflow_triggers where event_type = v_e.event_type;
  if v_e.id is null or v_kind is null then return jsonb_build_object('started', 0); end if;
  v_emp := case v_kind when 'employee' then v_e.subject_id
                       when 'leave_request' then (select employee_id from public.leave_requests where id = v_e.subject_id) end;
  for d in select w.id, w.current_version_id, v.conditions
             from public.workflow_definitions w join public.workflow_versions v on v.id = w.current_version_id
            where w.organization_id = v_e.organization_id and w.trigger_event = v_e.event_type and w.is_active
            order by w.created_at loop
    continue when not app.workflow_matches(d.conditions, v_emp);
    insert into public.workflow_runs (organization_id, definition_id, version_id, event_id, event_type, subject_id, subject_employee_id)
    values (v_e.organization_id, d.id, d.current_version_id, v_e.id, v_e.event_type, v_e.subject_id, v_emp)
    on conflict (definition_id, event_id) do nothing
    returning id into v_run;
    continue when v_run is null;
    v_n := v_n + 1;
    perform app.workflow_advance(v_run);
  end loop;
  return jsonb_build_object('started', v_n);
end $$;

-- Worker: resume runs whose wait is over.
create function public.worker_resume_workflows() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in select id, current_step from public.workflow_runs where status = 'waiting' and resume_at <= now() for update skip locked loop
    update public.workflow_run_steps set status = 'done', detail = 'Waited', finished_at = now() where run_id = r.id and step_no = r.current_step;
    update public.workflow_runs set status = 'running', current_step = r.current_step + 1, resume_at = null where id = r.id;
    perform app.workflow_advance(r.id);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('resumed', v_n);
end $$;

-- Approval steps: the decision continues or stops the run.
create function app.on_workflow_step_decided(p_step uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.workflow_run_steps;
begin
  select * into v_s from public.workflow_run_steps where id = p_step for update;
  if v_s.id is null or v_s.status <> 'waiting' then return; end if;
  if p_outcome = 'approved' then
    update public.workflow_run_steps set status = 'done', detail = 'Approved', finished_at = now() where id = p_step;
    update public.workflow_runs set status = 'running', current_step = v_s.step_no + 1 where id = v_s.run_id;
    perform app.workflow_advance(v_s.run_id);
  else
    update public.workflow_run_steps set status = 'rejected', detail = initcap(p_outcome), finished_at = now() where id = p_step;
    update public.workflow_runs set status = 'stopped', finished_at = now() where id = v_s.run_id;
  end if;
end $$;
insert into app.approval_handlers (subject_type, handler) values ('workflow_step', 'app.on_workflow_step_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label)
values ('workflow_step', 1, 'reporting_manager', 'workflow.manage', 'Manager');
select app.seed_org_flows(id, 'workflow_step') from public.organizations;

-- HR stops a run that is waiting (its pending approval is withdrawn).
create function public.stop_workflow_run(p_run uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run public.workflow_runs;
  v_req uuid;
begin
  select * into v_run from public.workflow_runs where id = p_run for update;
  if v_run.id is null or not app.has_permission(v_run.organization_id, 'workflow.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_run.status not in ('running', 'waiting') then
    raise exception 'This run has already finished.' using errcode = '22023';
  end if;
  select approval_request_id into v_req from public.workflow_run_steps where run_id = p_run and status = 'waiting' and approval_request_id is not null;
  if v_req is not null then
    update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_req and status = 'pending';
  end if;
  update public.workflow_run_steps set status = 'rejected', detail = 'Stopped by HR', finished_at = now() where run_id = p_run and status = 'waiting';
  update public.workflow_runs set status = 'stopped', finished_at = now(), resume_at = null where id = p_run;
end $$;

revoke all on function app.workflow_validate(uuid, text, jsonb, jsonb) from public;
revoke all on function app.workflow_text(text, text) from public;
revoke all on function app.request_approval_as(uuid, uuid, text, uuid, uuid, text, text) from public;
revoke all on function app.workflow_advance(uuid) from public;
revoke all on function app.workflow_matches(jsonb, uuid) from public;
revoke all on function app.on_workflow_step_decided(uuid, text) from public;
revoke all on function public.workflow_trigger_catalog() from public, anon;
revoke all on function public.save_workflow(uuid, uuid, text, text, jsonb, jsonb, boolean) from public, anon;
revoke all on function public.stop_workflow_run(uuid) from public, anon;
revoke all on function public.worker_start_workflows(bigint) from public, anon, authenticated;
revoke all on function public.worker_resume_workflows() from public, anon, authenticated;
grant execute on function public.workflow_trigger_catalog() to authenticated, service_role;
grant execute on function public.save_workflow(uuid, uuid, text, text, jsonb, jsonb, boolean) to authenticated, service_role;
grant execute on function public.stop_workflow_run(uuid) to authenticated, service_role;
grant execute on function public.worker_start_workflows(bigint) to service_role;
grant execute on function public.worker_resume_workflows() to service_role;
