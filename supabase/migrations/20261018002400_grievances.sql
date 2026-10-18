-- PeopleCore · Grievances (Phase 5, employee relations). Restricted by design.
--
-- * An employee raises a concern (POSH, discrimination, bullying, conduct, pay, safety, ethics, other), optionally
--   naming the people involved. It is confidential, not anonymous: the people handling it know who raised it.
-- * Who can see a case:
--     - the person who raised it (never internal notes);
--     - case managers (`grievance.manage`, owners and HR by default), unless they are named in it;
--     - investigators the case manager adds: members holding `grievance.read` org-wide who are on the case's access
--       list (necessary but not sufficient, docs/05-permissions.md note ⁴), unless named in it.
--   Anyone named in a case can never see it or be added to it, and naming someone later removes their access.
-- * The description, outcome and messages are not readable through the tables at all: they come only from
--   `grievance_case` / `grievance_thread`, which record a 'view' audit event whenever a handler opens a case.
-- * Audit rows redact who raised it, who is named and what was written; notifications never carry details.

insert into public.permissions (key, module, description, is_sensitive) values
  ('grievance.manage', 'employee_relations', 'Triage grievance cases and choose who investigates', true);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'grievance.manage', 'org'), ('hr_admin', 'grievance.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'grievance.manage'
on conflict (role_id, permission_key) do nothing;

create type public.grievance_category as enum ('posh', 'discrimination', 'bullying', 'conduct', 'pay', 'safety', 'ethics', 'other');
create type public.grievance_status as enum ('submitted', 'in_review', 'investigating', 'resolved', 'closed', 'withdrawn');

create table public.grievances (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  number           bigint not null,
  reporter_id      uuid not null,
  category         public.grievance_category not null,
  subject          text not null check (char_length(subject) between 3 and 160),
  description      text not null check (char_length(description) between 20 and 10000),
  incident_on      date,
  status           public.grievance_status not null default 'submitted',
  outcome          text check (char_length(outcome) <= 5000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  closed_at        timestamptz,
  unique (organization_id, number),
  unique (organization_id, id),
  -- No cascade: an employee with a grievance on record can't be hard-deleted.
  foreign key (organization_id, reporter_id) references public.employees (organization_id, id)
);
create index grievances_org_idx on public.grievances (organization_id, status, created_at desc);

create table public.grievance_respondents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  grievance_id     uuid not null,
  employee_id      uuid not null,
  added_by         uuid default auth.uid(),
  added_at         timestamptz not null default now(),
  unique (grievance_id, employee_id),
  foreign key (organization_id, grievance_id) references public.grievances (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id)
);

create table public.grievance_access (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  grievance_id     uuid not null,
  user_id          uuid not null,
  added_by         uuid default auth.uid(),
  added_at         timestamptz not null default now(),
  unique (grievance_id, user_id),
  foreign key (organization_id, grievance_id) references public.grievances (organization_id, id) on delete cascade
);

create table public.grievance_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  grievance_id     uuid not null,
  author_user_id   uuid not null default auth.uid(),
  body             text not null check (char_length(body) between 1 and 5000),
  internal         boolean not null default false,
  created_at       timestamptz not null default clock_timestamp(),
  foreign key (organization_id, grievance_id) references public.grievances (organization_id, id) on delete cascade
);
create index grievance_notes_case_idx on public.grievance_notes (grievance_id, created_at);

create trigger grievances_touch before update on public.grievances for each row execute function app.touch_updated_at();
create trigger grievances_audit after insert or update on public.grievances
  for each row execute function app.audit_row('reporter_id', 'subject', 'description', 'outcome');
create trigger grievance_respondents_audit after insert or delete on public.grievance_respondents
  for each row execute function app.audit_row('employee_id');
create trigger grievance_access_audit after insert or delete on public.grievance_access for each row execute function app.audit_row();
create trigger grievance_notes_audit after insert on public.grievance_notes for each row execute function app.audit_row('body');

-- ─── Who sees a case ────────────────────────────────────────────────────────

create function app.is_grievance_respondent(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.grievance_respondents r join public.employees e on e.id = r.employee_id
                  where r.grievance_id = p_case and e.user_id = auth.uid());
$$;

-- The caller's relationship to a case: 'reporter', 'manager', 'investigator', or null (no access).
create function app.grievance_role(p_case uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
           when app.is_own_employee(g.reporter_id) then 'reporter'
           when app.is_grievance_respondent(g.id) then null
           when app.has_permission(g.organization_id, 'grievance.manage') then 'manager'
           when app.has_permission(g.organization_id, 'grievance.read')
                and exists (select 1 from public.grievance_access a where a.grievance_id = g.id and a.user_id = auth.uid()) then 'investigator'
         end
    from public.grievances g where g.id = p_case;
$$;

-- Does a member hold an org-wide permission through an active role? (For choosing investigators; the session-level
-- check, including two-step sign-in, still applies whenever they open the case.)
create function app.member_holds_permission(p_org uuid, p_user uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members om
      join public.member_roles mr on mr.member_id = om.id and (mr.valid_until is null or mr.valid_until > now())
      join public.role_permissions rp on rp.role_id = mr.role_id and rp.permission_key = p_permission and rp.scope = 'org'
     where om.organization_id = p_org and om.user_id = p_user and om.status = 'active');
$$;

-- Notify a case's handlers (case managers and its investigators), never the reporter or anyone named in it.
create function app.notify_grievance_handlers(p_case uuid, p_kind text, p_title text) returns void
language sql volatile security definer set search_path = '' as $$
  with g as (select * from public.grievances where id = p_case),
  named as (select e.user_id from public.grievance_respondents r join public.employees e on e.id = r.employee_id
             where r.grievance_id = p_case and e.user_id is not null),
  handlers as (
    select om.user_id from g
      join public.organization_members om on om.organization_id = g.organization_id and om.status = 'active'
     where app.member_holds_permission(g.organization_id, om.user_id, 'grievance.manage')
    union
    select a.user_id from public.grievance_access a where a.grievance_id = p_case)
  select app.notify(g.organization_id, h.user_id, p_kind, p_title, null, '/grievances/' || p_case)
    from g, handlers h
   where h.user_id not in (select user_id from named)
     and h.user_id is distinct from (select user_id from public.employees where id = g.reporter_id);
$$;

alter table public.grievances enable row level security;
alter table public.grievance_respondents enable row level security;
alter table public.grievance_access enable row level security;
alter table public.grievance_notes enable row level security;

create policy grievances_select on public.grievances for select to authenticated using (app.grievance_role(id) is not null);
create policy grievance_respondents_select on public.grievance_respondents for select to authenticated
  using (app.grievance_role(grievance_id) is not null);
create policy grievance_access_select on public.grievance_access for select to authenticated
  using (app.grievance_role(grievance_id) in ('manager', 'investigator'));
-- Notes: no table privileges for signed-in users at all; read them through grievance_thread.

-- Everything except what was written (description, outcome): that comes only through the audited grievance_case.
grant select (id, organization_id, number, reporter_id, category, subject, incident_on, status, created_at, updated_at, resolved_at, closed_at)
  on public.grievances to authenticated;
grant select on public.grievance_respondents, public.grievance_access to authenticated;
grant all on public.grievances, public.grievance_respondents, public.grievance_access, public.grievance_notes to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

create function public.raise_grievance(p_org uuid, p_category public.grievance_category, p_subject text, p_description text,
                                       p_incident_on date default null, p_respondents uuid[] default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp    uuid;
  v_id     uuid;
  v_number bigint;
  v_named  uuid[] := array(select distinct x from unnest(coalesce(p_respondents, '{}')) x where x is not null);
begin
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid() and status <> 'exited';
  if v_emp is null or not app.is_member(p_org) then
    raise exception 'Your account isn’t linked to an employee record.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) not between 3 and 160 then
    raise exception 'Give it a short title.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 20 and 10000 then
    raise exception 'Describe what happened in a few sentences.' using errcode = '22023';
  end if;
  if p_incident_on > app.org_today(p_org) then
    raise exception 'The date can’t be in the future.' using errcode = '22023';
  end if;
  if v_emp = any (v_named) then
    raise exception 'You can’t name yourself.' using errcode = '22023';
  end if;
  if (select count(*) from public.employees where organization_id = p_org and id = any (v_named)) <> cardinality(v_named) then
    raise exception 'Choose people from your organization.' using errcode = '22023';
  end if;
  v_number := app.next_counter(p_org, 'grievance_number');
  insert into public.grievances (organization_id, number, reporter_id, category, subject, description, incident_on)
  values (p_org, v_number, v_emp, p_category, btrim(p_subject), btrim(p_description), p_incident_on)
  returning id into v_id;
  insert into public.grievance_respondents (organization_id, grievance_id, employee_id)
  select p_org, v_id, x from unnest(v_named) x;
  perform app.notify_grievance_handlers(v_id, 'grievance.new', 'New grievance case #' || v_number);
  return v_id;
end $$;

-- The case with what was written, for its reporter and handlers. A handler's read is recorded in the audit log.
create function public.grievance_case(p_case uuid)
returns table (id uuid, number bigint, category public.grievance_category, subject text, description text, incident_on date,
               status public.grievance_status, outcome text, created_at timestamptz, resolved_at timestamptz, closed_at timestamptz,
               reporter_id uuid, reporter_name text, my_role text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text := app.grievance_role(p_case);
begin
  if v_role is null then
    return;
  end if;
  if v_role in ('manager', 'investigator') then
    insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    select g.organization_id, auth.uid(), 'view', 'grievances', g.id, jsonb_build_object('role', v_role)
      from public.grievances g where g.id = p_case;
  end if;
  return query
    select g.id, g.number, g.category, g.subject, g.description, g.incident_on, g.status, g.outcome, g.created_at, g.resolved_at,
           g.closed_at, g.reporter_id, concat_ws(' ', e.first_name, e.last_name), v_role
      from public.grievances g join public.employees e on e.id = g.reporter_id
     where g.id = p_case;
end $$;

-- Messages on a case: handlers see all, the reporter everything but internal notes.
create function public.grievance_thread(p_case uuid)
returns table (id uuid, author_name text, mine boolean, body text, internal boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, coalesce(nullif(concat_ws(' ', e.first_name, e.last_name), ''), 'HR'), n.author_user_id = auth.uid(), n.body, n.internal, n.created_at
    from public.grievance_notes n
    left join public.employees e on e.organization_id = n.organization_id and e.user_id = n.author_user_id
   where n.grievance_id = p_case
     and (app.grievance_role(p_case) in ('manager', 'investigator') or (not n.internal and app.grievance_role(p_case) = 'reporter'))
   order by n.created_at, n.id;
$$;

create function public.add_grievance_note(p_case uuid, p_body text, p_internal boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text := app.grievance_role(p_case);
  v_g    public.grievances;
begin
  select * into v_g from public.grievances where id = p_case;
  if v_role is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_internal and v_role = 'reporter' then
    raise exception 'Only the people handling the case can add internal notes.' using errcode = '42501';
  end if;
  if v_g.status in ('closed', 'withdrawn') then
    raise exception 'This case is closed.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Write a message.' using errcode = '22023';
  end if;
  insert into public.grievance_notes (organization_id, grievance_id, body, internal)
  values (v_g.organization_id, p_case, btrim(p_body), coalesce(p_internal, false));
  if v_role = 'reporter' then
    perform app.notify_grievance_handlers(p_case, 'grievance.message', 'New message on grievance case #' || v_g.number);
  elsif not coalesce(p_internal, false) then
    perform app.notify(v_g.organization_id, (select user_id from public.employees where id = v_g.reporter_id), 'grievance.message',
      'New message on your grievance #' || v_g.number, null, '/grievances/' || p_case);
  end if;
end $$;

-- Handlers move a case along. Resolving or closing needs an outcome, which the reporter sees.
create function public.update_grievance(p_case uuid, p_status public.grievance_status, p_outcome text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_g       public.grievances;
  v_outcome text := nullif(btrim(coalesce(p_outcome, '')), '');
begin
  select * into v_g from public.grievances where id = p_case for update;
  if app.grievance_role(p_case) is distinct from 'manager' and app.grievance_role(p_case) is distinct from 'investigator' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_g.status in ('closed', 'withdrawn') then
    raise exception 'This case is closed.' using errcode = '22023';
  end if;
  if p_status not in ('in_review', 'investigating', 'resolved', 'closed') then
    raise exception 'Choose a status.' using errcode = '22023';
  end if;
  if p_status in ('resolved', 'closed') and coalesce(v_outcome, v_g.outcome) is null then
    raise exception 'Write the outcome to share with the person who raised it.' using errcode = '22023';
  end if;
  update public.grievances set
    status = p_status,
    outcome = coalesce(v_outcome, outcome),
    resolved_at = case when p_status = 'resolved' then coalesce(resolved_at, now()) when p_status = 'closed' then resolved_at end,
    closed_at = case when p_status = 'closed' then now() end
   where id = p_case;
  if p_status is distinct from v_g.status or v_outcome is distinct from v_g.outcome then
    perform app.notify(v_g.organization_id, (select user_id from public.employees where id = v_g.reporter_id), 'grievance.update',
      'Update on your grievance #' || v_g.number, null, '/grievances/' || p_case);
  end if;
end $$;

create function public.withdraw_grievance(p_case uuid, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_g public.grievances;
begin
  select * into v_g from public.grievances where id = p_case for update;
  if app.grievance_role(p_case) is distinct from 'reporter' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_g.status in ('resolved', 'closed', 'withdrawn') then
    raise exception 'This case can no longer be withdrawn.' using errcode = '22023';
  end if;
  update public.grievances set status = 'withdrawn', closed_at = now() where id = p_case;
  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    insert into public.grievance_notes (organization_id, grievance_id, body) values (v_g.organization_id, p_case, 'Withdrawn: ' || btrim(p_reason));
  end if;
  perform app.notify_grievance_handlers(p_case, 'grievance.update', 'Grievance case #' || v_g.number || ' was withdrawn');
end $$;

-- Case managers choose investigators: members holding grievance.read org-wide, never the reporter or anyone named.
create function public.set_grievance_access(p_case uuid, p_user uuid, p_allow boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_g public.grievances;
begin
  select * into v_g from public.grievances where id = p_case;
  if app.grievance_role(p_case) is distinct from 'manager' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not p_allow then
    delete from public.grievance_access where grievance_id = p_case and user_id = p_user;
    return;
  end if;
  if v_g.status in ('closed', 'withdrawn') then
    raise exception 'This case is closed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.employees where id = v_g.reporter_id and user_id = p_user) then
    raise exception 'The person who raised it can’t investigate it.' using errcode = '22023';
  end if;
  if exists (select 1 from public.grievance_respondents r join public.employees e on e.id = r.employee_id
              where r.grievance_id = p_case and e.user_id = p_user) then
    raise exception 'Someone named in the case can’t investigate it.' using errcode = '22023';
  end if;
  if not app.member_holds_permission(v_g.organization_id, p_user, 'grievance.read') then
    raise exception 'Choose someone with access to grievances.' using errcode = '22023';
  end if;
  insert into public.grievance_access (organization_id, grievance_id, user_id) values (v_g.organization_id, p_case, p_user)
  on conflict (grievance_id, user_id) do nothing;
  perform app.notify(v_g.organization_id, p_user, 'grievance.assigned', 'You’ve been added to grievance case #' || v_g.number, null, '/grievances/' || p_case);
end $$;

-- Name someone involved (case managers). They lose any access they had to the case.
create function public.add_grievance_respondent(p_case uuid, p_employee uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_g public.grievances;
begin
  select * into v_g from public.grievances where id = p_case;
  if app.grievance_role(p_case) is distinct from 'manager' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee and organization_id = v_g.organization_id) then
    raise exception 'Choose someone from your organization.' using errcode = '22023';
  end if;
  if p_employee = v_g.reporter_id then
    raise exception 'The person who raised it can’t be named in it.' using errcode = '22023';
  end if;
  insert into public.grievance_respondents (organization_id, grievance_id, employee_id) values (v_g.organization_id, p_case, p_employee)
  on conflict (grievance_id, employee_id) do nothing;
  delete from public.grievance_access a using public.employees e
   where a.grievance_id = p_case and e.id = p_employee and a.user_id = e.user_id;
end $$;

-- Names for a case's people: whom it names (for its reporter and handlers) and its investigators (handlers only).
create function public.grievance_people(p_case uuid)
returns table (kind text, user_id uuid, employee_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select 'named', e.user_id, e.id, concat_ws(' ', e.first_name, e.last_name)
    from public.grievance_respondents r join public.employees e on e.id = r.employee_id
   where r.grievance_id = p_case and app.grievance_role(p_case) is not null
  union all
  select 'investigator', a.user_id, e.id, coalesce(nullif(concat_ws(' ', e.first_name, e.last_name), ''), 'Member')
    from public.grievance_access a
    join public.grievances g on g.id = a.grievance_id
    left join public.employees e on e.organization_id = g.organization_id and e.user_id = a.user_id
   where a.grievance_id = p_case and app.grievance_role(p_case) in ('manager', 'investigator')
  order by 1, 4;
$$;

-- Members a case manager may add as investigators.
create function public.grievance_investigator_options(p_org uuid)
returns table (user_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select om.user_id, coalesce(nullif(concat_ws(' ', e.first_name, e.last_name), ''), 'Member')
    from public.organization_members om
    left join public.employees e on e.organization_id = om.organization_id and e.user_id = om.user_id
   where app.has_permission(p_org, 'grievance.manage') and om.organization_id = p_org and om.status = 'active'
     and app.member_holds_permission(p_org, om.user_id, 'grievance.read')
   order by 2;
$$;

revoke all on function app.is_grievance_respondent(uuid) from public;
revoke all on function app.grievance_role(uuid) from public;
revoke all on function app.member_holds_permission(uuid, uuid, text) from public;
revoke all on function app.notify_grievance_handlers(uuid, text, text) from public;
grant execute on function app.is_grievance_respondent(uuid) to authenticated, service_role;
grant execute on function app.grievance_role(uuid) to authenticated, service_role;
revoke all on function public.raise_grievance(uuid, public.grievance_category, text, text, date, uuid[]) from public, anon;
revoke all on function public.grievance_case(uuid) from public, anon;
revoke all on function public.grievance_thread(uuid) from public, anon;
revoke all on function public.add_grievance_note(uuid, text, boolean) from public, anon;
revoke all on function public.update_grievance(uuid, public.grievance_status, text) from public, anon;
revoke all on function public.withdraw_grievance(uuid, text) from public, anon;
revoke all on function public.set_grievance_access(uuid, uuid, boolean) from public, anon;
revoke all on function public.add_grievance_respondent(uuid, uuid) from public, anon;
revoke all on function public.grievance_people(uuid) from public, anon;
revoke all on function public.grievance_investigator_options(uuid) from public, anon;
grant execute on function public.raise_grievance(uuid, public.grievance_category, text, text, date, uuid[]) to authenticated, service_role;
grant execute on function public.grievance_case(uuid) to authenticated, service_role;
grant execute on function public.grievance_thread(uuid) to authenticated, service_role;
grant execute on function public.add_grievance_note(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.update_grievance(uuid, public.grievance_status, text) to authenticated, service_role;
grant execute on function public.withdraw_grievance(uuid, text) to authenticated, service_role;
grant execute on function public.set_grievance_access(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.add_grievance_respondent(uuid, uuid) to authenticated, service_role;
grant execute on function public.grievance_people(uuid) to authenticated, service_role;
grant execute on function public.grievance_investigator_options(uuid) to authenticated, service_role;
