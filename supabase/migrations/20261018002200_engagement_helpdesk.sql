-- PeopleCore · Engagement and services (Phase 5): announcements, helpdesk with SLAs, knowledge base, kudos.
--
-- * Announcements reach everyone, a department or a location; some require acknowledgement (append-only).
-- * Helpdesk: employees raise tickets; agents (helpdesk.manage) triage, assign and reply. A category can route to a
--   default assignee (e.g. the IT person), who works their own tickets without org-wide helpdesk access. Internal
--   notes are never visible to the requester. Each ticket gets an SLA from its priority; the worker flags breaches and escalates
--   (notifies the assignee and HR) once per ticket.
-- * Knowledge base: published articles readable by every member (and, in Phase 7, retrievable by the AI with the
--   reader's permissions).
-- * Kudos: public recognition between colleagues.
-- * Colleague directory: the minimal projection planned in docs/05-permissions.md note ¹ (name, department,
--   designation of current employees, for members only), never the employee row. It lets everyone pick a colleague
--   (kudos, feedback) and lets recruiters choose a hiring manager without employee.read.

insert into public.permissions (key, module, description, is_sensitive) values
  ('announcement.manage', 'engagement', 'Publish announcements and see acknowledgements', false),
  ('helpdesk.manage', 'services', 'Handle helpdesk tickets and the knowledge base', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'announcement.manage', 'org'), ('owner', 'helpdesk.manage', 'org'),
  ('hr_admin', 'announcement.manage', 'org'), ('hr_admin', 'helpdesk.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key in ('announcement.manage', 'helpdesk.manage')
on conflict (role_id, permission_key) do nothing;

-- ─── Announcements ──────────────────────────────────────────────────────────

create table public.announcements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  title             text not null check (char_length(title) between 3 and 160),
  body              text not null check (char_length(body) between 3 and 10000),
  department_id     uuid,
  location_id       uuid,
  requires_ack      boolean not null default false,
  published_at      timestamptz not null default now(),
  expires_at        timestamptz,
  created_by        uuid default auth.uid(),
  unique (organization_id, id),
  foreign key (organization_id, department_id) references public.departments (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  check (expires_at is null or expires_at > published_at)
);

create table public.announcement_acknowledgements (
  organization_id  uuid not null,
  announcement_id  uuid not null,
  employee_id      uuid not null,
  acknowledged_at  timestamptz not null default now(),
  primary key (announcement_id, employee_id),
  foreign key (organization_id, announcement_id) references public.announcements (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

-- Is the caller in an announcement's audience (everyone, or their department / location)? Takes the row's columns,
-- not its id, so the select policy also works for the row being inserted.
create function app.in_audience(p_org uuid, p_department uuid, p_location uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_member(p_org) and exists (
    select 1 from public.employees e
     where e.organization_id = p_org and e.user_id = auth.uid() and e.status <> 'exited'
       and (p_department is null or e.department_id = p_department)
       and (p_location is null or e.location_id = p_location));
$$;

-- ─── Helpdesk ───────────────────────────────────────────────────────────────

create type public.ticket_status as enum ('open', 'in_progress', 'waiting', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');

create table public.ticket_categories (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  name                   text not null check (char_length(name) between 2 and 60),
  default_assignee_id    uuid,
  is_active              boolean not null default true,
  unique (organization_id, name),
  unique (organization_id, id),
  foreign key (organization_id, default_assignee_id) references public.employees (organization_id, id) on delete set null (default_assignee_id)
);

create table public.tickets (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  number             bigint not null,
  requester_id       uuid not null,
  category_id        uuid not null,
  subject            text not null check (char_length(subject) between 3 and 160),
  description        text not null check (char_length(description) between 3 and 5000),
  priority           public.ticket_priority not null default 'normal',
  status             public.ticket_status not null default 'open',
  assignee_id        uuid,
  sla_due_at         timestamptz not null,
  breached_at        timestamptz,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, requester_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, category_id) references public.ticket_categories (organization_id, id),
  foreign key (organization_id, assignee_id) references public.employees (organization_id, id) on delete set null (assignee_id)
);
create index tickets_open_idx on public.tickets (organization_id, status, sla_due_at) where status in ('open', 'in_progress', 'waiting');

create table public.ticket_comments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  ticket_id        uuid not null,
  author_user_id   uuid not null default auth.uid(),
  body             text not null check (char_length(body) between 1 and 5000),
  internal         boolean not null default false,
  created_at       timestamptz not null default clock_timestamp(),  -- orders a thread even within one transaction
  foreign key (organization_id, ticket_id) references public.tickets (organization_id, id) on delete cascade
);

-- ─── Knowledge base and kudos ───────────────────────────────────────────────

create table public.kb_articles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (char_length(title) between 3 and 160),
  body             text not null check (char_length(body) between 10 and 50000),
  category         text check (char_length(category) <= 60),
  published        boolean not null default false,
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  search           tsvector generated always as (to_tsvector('simple', title || ' ' || body)) stored
);
create index kb_articles_search_idx on public.kb_articles using gin (search);

create table public.kudos (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  from_employee_id  uuid not null,
  to_employee_id    uuid not null,
  message           text not null check (char_length(message) between 3 and 500),
  created_at        timestamptz not null default now(),
  check (from_employee_id <> to_employee_id),
  foreign key (organization_id, from_employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, to_employee_id) references public.employees (organization_id, id) on delete cascade
);
create index kudos_org_idx on public.kudos (organization_id, created_at desc);

create trigger announcements_audit after insert or update or delete on public.announcements for each row execute function app.audit_row();
create trigger tickets_touch before update on public.tickets for each row execute function app.touch_updated_at();
create trigger tickets_audit after insert or update on public.tickets for each row execute function app.audit_row('description');
create function app.kb_articles_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger kb_articles_stamp before insert or update on public.kb_articles for each row execute function app.kb_articles_stamp();
create trigger kb_articles_touch before update on public.kb_articles for each row execute function app.touch_updated_at();
create trigger kb_articles_audit after insert or update or delete on public.kb_articles for each row execute function app.audit_row('body');

-- An agent on a ticket: helpdesk staff, or the employee it is assigned to.
create function app.is_ticket_agent(p_ticket uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tickets t
                  where t.id = p_ticket
                    and (app.has_permission(t.organization_id, 'helpdesk.manage') or app.is_own_employee(t.assignee_id)));
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.announcements enable row level security;
alter table public.announcement_acknowledgements enable row level security;
alter table public.ticket_categories enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.kb_articles enable row level security;
alter table public.kudos enable row level security;

-- Publishers see everything (drafts scheduled for later, expired); the audience sees what is live.
create policy announcements_select on public.announcements for select to authenticated
  using (app.has_permission(organization_id, 'announcement.manage')
         or (published_at <= now() and (expires_at is null or expires_at > now())
             and app.in_audience(organization_id, department_id, location_id)));
create policy announcements_write on public.announcements for all to authenticated
  using (app.has_permission(organization_id, 'announcement.manage')) with check (app.has_permission(organization_id, 'announcement.manage'));
create policy announcement_acks_select on public.announcement_acknowledgements for select to authenticated
  using (app.is_own_employee(employee_id) or app.has_permission(organization_id, 'announcement.manage'));

create policy ticket_categories_select on public.ticket_categories for select to authenticated using (app.is_member(organization_id));
create policy ticket_categories_write on public.ticket_categories for all to authenticated
  using (app.has_permission(organization_id, 'helpdesk.manage')) with check (app.has_permission(organization_id, 'helpdesk.manage'));
create policy tickets_select on public.tickets for select to authenticated
  using (app.is_own_employee(requester_id) or app.is_own_employee(assignee_id) or app.has_permission(organization_id, 'helpdesk.manage'));
-- Requesters never see internal notes.
create policy ticket_comments_select on public.ticket_comments for select to authenticated
  using (app.is_ticket_agent(ticket_id)
         or (not internal and exists (select 1 from public.tickets t where t.id = ticket_id and app.is_own_employee(t.requester_id))));

create policy kb_articles_select on public.kb_articles for select to authenticated
  using ((published and app.is_member(organization_id)) or app.has_permission(organization_id, 'helpdesk.manage'));
create policy kb_articles_write on public.kb_articles for all to authenticated
  using (app.has_permission(organization_id, 'helpdesk.manage')) with check (app.has_permission(organization_id, 'helpdesk.manage'));

create policy kudos_select on public.kudos for select to authenticated using (app.is_member(organization_id));

grant select, insert, update, delete on public.announcements, public.ticket_categories, public.kb_articles to authenticated;
grant select on public.announcement_acknowledgements, public.tickets, public.ticket_comments to authenticated;
grant select on public.kudos to authenticated;
grant all on public.announcements, public.announcement_acknowledgements, public.ticket_categories, public.tickets,
             public.ticket_comments, public.kb_articles, public.kudos to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

create function public.acknowledge_announcement(p_announcement uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_a   public.announcements;
  v_emp uuid;
begin
  select * into v_a from public.announcements where id = p_announcement;
  select id into v_emp from public.employees where organization_id = v_a.organization_id and user_id = auth.uid();
  if v_a.id is null or v_emp is null or not app.in_audience(v_a.organization_id, v_a.department_id, v_a.location_id)
     or v_a.published_at > now() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not v_a.requires_ack then
    raise exception 'This announcement doesn’t need an acknowledgement.' using errcode = '22023';
  end if;
  insert into public.announcement_acknowledgements (organization_id, announcement_id, employee_id)
  values (v_a.organization_id, p_announcement, v_emp) on conflict do nothing;
end $$;

-- Notify every active member holding an org-wide permission (time-boxed grants included while valid).
create function app.notify_permission_holders(p_org uuid, p_permission text, p_kind text, p_title text, p_link text, p_except uuid default null)
returns void
language sql volatile security definer set search_path = '' as $$
  select app.notify(p_org, h.user_id, p_kind, p_title, null, p_link)
    from (select distinct om.user_id
            from public.organization_members om
            join public.member_roles mr on mr.member_id = om.id and (mr.valid_until is null or mr.valid_until > now())
            join public.role_permissions rp on rp.role_id = mr.role_id and rp.permission_key = p_permission and rp.scope = 'org'
           where om.organization_id = p_org and om.status = 'active' and om.user_id is distinct from p_except) h;
$$;

create function app.sla_interval(p_priority public.ticket_priority) returns interval
language sql immutable set search_path = '' as $$
  select case p_priority when 'urgent' then interval '4 hours' when 'high' then interval '8 hours'
                         when 'normal' then interval '24 hours' else interval '72 hours' end;
$$;

create function public.raise_ticket(p_org uuid, p_category uuid, p_subject text, p_description text, p_priority public.ticket_priority default 'normal')
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp  uuid;
  v_cat  public.ticket_categories;
  v_id   uuid;
  v_user uuid;
begin
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid() and status <> 'exited';
  if v_emp is null or not app.is_member(p_org) then
    raise exception 'Your account isn’t linked to an employee record.' using errcode = '42501';
  end if;
  select * into v_cat from public.ticket_categories where id = p_category and organization_id = p_org and is_active;
  if v_cat.id is null then
    raise exception 'Choose a category.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) not between 3 and 160 then
    raise exception 'Give the ticket a short subject.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 10 and 5000 then
    raise exception 'Describe the problem in a sentence or two.' using errcode = '22023';
  end if;
  insert into public.tickets (organization_id, number, requester_id, category_id, subject, description, priority, assignee_id, sla_due_at)
  values (p_org, app.next_counter(p_org, 'ticket_number'), v_emp, p_category, btrim(p_subject), btrim(p_description), p_priority,
          v_cat.default_assignee_id, now() + app.sla_interval(p_priority))
  returning id into v_id;
  -- Routed tickets go to the assignee; the rest to helpdesk staff.
  if v_cat.default_assignee_id is not null then
    select user_id into v_user from public.employees where id = v_cat.default_assignee_id;
    perform app.notify(p_org, v_user, 'helpdesk.assigned', 'New ticket: ' || left(btrim(p_subject), 150), null, '/helpdesk/' || v_id);
  else
    perform app.notify_permission_holders(p_org, 'helpdesk.manage', 'helpdesk.new', 'New ticket: ' || left(btrim(p_subject), 150),
                                          '/helpdesk/' || v_id, auth.uid());
  end if;
  return v_id;
end $$;

-- Comments: the requester on their own ticket (never internal); agents on any (optionally internal).
create function public.comment_ticket(p_ticket uuid, p_body text, p_internal boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t      public.tickets;
  v_agent  boolean;
  v_notify uuid;
begin
  select * into v_t from public.tickets where id = p_ticket for update;
  if v_t.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  v_agent := app.is_ticket_agent(p_ticket);
  if not (v_agent or app.is_own_employee(v_t.requester_id)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_internal and not v_agent then
    raise exception 'Only agents can add internal notes.' using errcode = '42501';
  end if;
  if v_t.status = 'closed' then
    raise exception 'This ticket is closed. Raise a new one.' using errcode = '22023';
  end if;
  insert into public.ticket_comments (organization_id, ticket_id, body, internal) values (v_t.organization_id, p_ticket, btrim(p_body), coalesce(p_internal, false));
  -- A requester's reply notifies the assignee and reopens a ticket waiting on them or resolved; an agent's public
  -- reply notifies the requester.
  if app.is_own_employee(v_t.requester_id) then
    if v_t.status in ('waiting', 'resolved') then
      update public.tickets set status = 'open', resolved_at = null where id = p_ticket;
    end if;
    select user_id into v_notify from public.employees where id = v_t.assignee_id;
  elsif v_agent and not coalesce(p_internal, false) then
    select user_id into v_notify from public.employees where id = v_t.requester_id;
  end if;
  perform app.notify(v_t.organization_id, v_notify, 'helpdesk.reply', 'Reply on ticket #' || v_t.number || ': ' || left(v_t.subject, 120), null, '/helpdesk/' || p_ticket);
end $$;

create function public.update_ticket(p_ticket uuid, p_status public.ticket_status, p_assignee uuid default null, p_priority public.ticket_priority default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t public.tickets;
begin
  select * into v_t from public.tickets where id = p_ticket for update;
  if v_t.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Without helpdesk access: the assignee may change the status; the requester may only close their own ticket.
  if not app.has_permission(v_t.organization_id, 'helpdesk.manage') then
    if p_assignee is not null or p_priority is not null
       or not (app.is_own_employee(v_t.assignee_id) or (app.is_own_employee(v_t.requester_id) and p_status = 'closed')) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  if v_t.status = 'closed' then
    raise exception 'This ticket is closed. Raise a new one.' using errcode = '22023';
  end if;
  if p_assignee is not null and not exists (select 1 from public.employees where id = p_assignee and organization_id = v_t.organization_id and status <> 'exited') then
    raise exception 'Choose a current employee to assign.' using errcode = '22023';
  end if;
  update public.tickets set
    status = p_status,
    assignee_id = coalesce(p_assignee, assignee_id),
    priority = coalesce(p_priority, priority),
    sla_due_at = case when p_priority is not null and p_priority <> priority then created_at + app.sla_interval(p_priority) else sla_due_at end,
    resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
   where id = p_ticket;
  if p_status = 'resolved' and v_t.status <> 'resolved' then
    perform app.notify(v_t.organization_id, (select user_id from public.employees where id = v_t.requester_id), 'helpdesk.resolved',
      'Resolved: ticket #' || v_t.number || ' ' || left(v_t.subject, 120), null, '/helpdesk/' || p_ticket);
  end if;
  if p_assignee is not null and p_assignee is distinct from v_t.assignee_id then
    perform app.notify(v_t.organization_id, (select user_id from public.employees where id = p_assignee), 'helpdesk.assigned',
      'Assigned to you: ticket #' || v_t.number || ' ' || left(v_t.subject, 120), null, '/helpdesk/' || p_ticket);
  end if;
end $$;

-- A ticket's conversation with author names (internal notes only for agents), for people without employee.read.
create function public.ticket_thread(p_ticket uuid)
returns table (id uuid, author_name text, mine boolean, body text, internal boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, coalesce(nullif(concat_ws(' ', e.first_name, e.last_name), ''), 'Helpdesk'), c.author_user_id = auth.uid(),
         c.body, c.internal, c.created_at
    from public.ticket_comments c
    join public.tickets t on t.id = c.ticket_id
    left join public.employees e on e.organization_id = c.organization_id and e.user_id = c.author_user_id
   where c.ticket_id = p_ticket
     and (app.is_ticket_agent(p_ticket) or (not c.internal and app.is_own_employee(t.requester_id)))
   order by c.created_at, c.id;
$$;

-- Worker: flag SLA breaches once and escalate to the assignee and HR agents.
create function public.worker_helpdesk_sla() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t record;
  v_user uuid;
  v_n int := 0;
begin
  for t in update public.tickets set breached_at = now()
            where status in ('open', 'in_progress') and breached_at is null and sla_due_at < now()
            returning * loop
    v_n := v_n + 1;
    select user_id into v_user from public.employees where id = t.assignee_id;
    perform app.notify(t.organization_id, v_user, 'helpdesk.breach', 'SLA missed: ticket #' || t.number || ' ' || left(t.subject, 120), null, '/helpdesk/' || t.id);
    perform app.notify_permission_holders(t.organization_id, 'helpdesk.manage', 'helpdesk.breach',
                                          'SLA missed: ticket #' || t.number || ' ' || left(t.subject, 120), '/helpdesk/' || t.id, v_user);
  end loop;
  return jsonb_build_object('breached', v_n);
end $$;

-- Kudos: public recognition from one colleague to another; the recipient is notified.
create function public.give_kudos(p_org uuid, p_to uuid, p_message text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_from uuid;
  v_to   public.employees;
  v_id   uuid;
begin
  select id into v_from from public.employees where organization_id = p_org and user_id = auth.uid() and status <> 'exited';
  if v_from is null or not app.is_member(p_org) then
    raise exception 'Your account isn’t linked to an employee record.' using errcode = '42501';
  end if;
  select * into v_to from public.employees where id = p_to and organization_id = p_org and status <> 'exited';
  if v_to.id is null then
    raise exception 'Choose a colleague.' using errcode = '22023';
  end if;
  if v_to.id = v_from then
    raise exception 'Kudos go to someone else.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) < 3 then
    raise exception 'Say what they did.' using errcode = '22023';
  end if;
  insert into public.kudos (organization_id, from_employee_id, to_employee_id, message)
  values (p_org, v_from, p_to, btrim(p_message)) returning id into v_id;
  perform app.notify(p_org, v_to.user_id, 'kudos.received', 'You received kudos', left(btrim(p_message), 300), '/engagement');
  return v_id;
end $$;

-- Minimal directory: current employees' name, department and designation. Members only; at most 500 rows.
create function public.colleague_directory(p_org uuid, p_query text default null, p_limit int default 50)
returns table (id uuid, name text, department text, designation text)
language sql stable security definer set search_path = '' as $$
  select e.id, concat_ws(' ', e.first_name, e.middle_name, e.last_name), d.name, g.title
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
   where app.is_member(p_org) and e.organization_id = p_org and e.status in ('active', 'on_notice')
     and (coalesce(btrim(p_query), '') = ''
          or lower(concat_ws(' ', e.first_name, e.middle_name, e.last_name)) like '%' || lower(btrim(p_query)) || '%')
   order by e.first_name, e.last_name
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

-- The kudos wall with names (kudos are public within the organization).
create function public.kudos_feed(p_org uuid, p_limit int default 30)
returns table (id uuid, from_name text, to_name text, to_employee_id uuid, message text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select k.id, concat_ws(' ', f.first_name, f.last_name), concat_ws(' ', t.first_name, t.last_name), k.to_employee_id, k.message, k.created_at
    from public.kudos k
    join public.employees f on f.id = k.from_employee_id
    join public.employees t on t.id = k.to_employee_id
   where app.is_member(p_org) and k.organization_id = p_org
   order by k.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- Knowledge base search for members (published only unless you manage it).
create function public.search_kb(p_org uuid, p_query text)
returns table (id uuid, title text, category text, snippet text)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.title, a.category, left(a.body, 240)
    from public.kb_articles a
   where a.organization_id = p_org
     and (coalesce(btrim(p_query), '') = '' or a.search @@ plainto_tsquery('simple', p_query))
   order by a.updated_at desc
   limit 50;
$$;

-- ─── Defaults ───────────────────────────────────────────────────────────────

create function app.seed_org_helpdesk(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.ticket_categories (organization_id, name) values
    (p_org, 'Payroll and payslips'), (p_org, 'Leave and attendance'), (p_org, 'IT and access'), (p_org, 'Documents and letters'), (p_org, 'Other')
  on conflict (organization_id, name) do nothing;
$$;
create function app.seed_org_helpdesk_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_helpdesk(new.id);
  return null;
end $$;
create trigger organizations_seed_helpdesk after insert on public.organizations
  for each row execute function app.seed_org_helpdesk_trigger();
select app.seed_org_helpdesk(id) from public.organizations;

revoke all on function app.in_audience(uuid, uuid, uuid) from public;
revoke all on function app.is_ticket_agent(uuid) from public;
grant execute on function app.is_ticket_agent(uuid) to authenticated, service_role;
revoke all on function app.sla_interval(public.ticket_priority) from public;
revoke all on function app.notify_permission_holders(uuid, text, text, text, text, uuid) from public;
revoke all on function app.seed_org_helpdesk(uuid) from public;
revoke all on function app.seed_org_helpdesk_trigger() from public;
revoke all on function app.kb_articles_stamp() from public;
grant execute on function app.in_audience(uuid, uuid, uuid) to authenticated, service_role;
revoke all on function public.give_kudos(uuid, uuid, text) from public, anon;
grant execute on function public.give_kudos(uuid, uuid, text) to authenticated, service_role;
revoke all on function public.acknowledge_announcement(uuid) from public, anon;
revoke all on function public.raise_ticket(uuid, uuid, text, text, public.ticket_priority) from public, anon;
revoke all on function public.comment_ticket(uuid, text, boolean) from public, anon;
revoke all on function public.update_ticket(uuid, public.ticket_status, uuid, public.ticket_priority) from public, anon;
revoke all on function public.search_kb(uuid, text) from public, anon;
revoke all on function public.ticket_thread(uuid) from public, anon;
grant execute on function public.ticket_thread(uuid) to authenticated, service_role;
revoke all on function public.colleague_directory(uuid, text, int) from public, anon;
revoke all on function public.kudos_feed(uuid, int) from public, anon;
grant execute on function public.colleague_directory(uuid, text, int) to authenticated, service_role;
grant execute on function public.kudos_feed(uuid, int) to authenticated, service_role;
revoke all on function public.worker_helpdesk_sla() from public, anon, authenticated;
grant execute on function public.acknowledge_announcement(uuid) to authenticated, service_role;
grant execute on function public.raise_ticket(uuid, uuid, text, text, public.ticket_priority) to authenticated, service_role;
grant execute on function public.comment_ticket(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.update_ticket(uuid, public.ticket_status, uuid, public.ticket_priority) to authenticated, service_role;
grant execute on function public.search_kb(uuid, text) to authenticated, service_role;
grant execute on function public.worker_helpdesk_sla() to service_role;
