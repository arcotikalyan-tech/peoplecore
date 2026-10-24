-- PeopleCore · Helpdesk: response targets in business hours, and a satisfaction survey.
--
-- * Helpdesk settings (helpdesk.manage): the response target per priority, in hours, and whether they count business
--   hours only. Business hours run from a start to an end time on the working days of the organization's default
--   holiday calendar (its weekly offs and its holidays, optional holidays excepted), in the organization's time zone.
--   The due time is worked out when a ticket is raised and when its priority changes; open tickets keep theirs when
--   the settings change.
-- * Satisfaction: once a ticket is resolved or closed, its requester rates the help from 1 to 5, optionally with a
--   comment, and may change it later. The assignee is told; agents see the rating, helpdesk managers the average.

create table public.helpdesk_settings (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  business_hours   boolean not null default false,
  day_start        time not null default '09:30',
  day_end          time not null default '18:30',
  urgent_hours     smallint not null default 4 check (urgent_hours between 1 and 720),
  high_hours       smallint not null default 8 check (high_hours between 1 and 720),
  normal_hours     smallint not null default 24 check (normal_hours between 1 and 720),
  low_hours        smallint not null default 72 check (low_hours between 1 and 720),
  updated_at       timestamptz not null default now(),
  updated_by       uuid default auth.uid(),
  check (day_end > day_start),
  check (urgent_hours <= high_hours and high_hours <= normal_hours and normal_hours <= low_hours)
);
create trigger helpdesk_settings_touch before update on public.helpdesk_settings for each row execute function app.touch_updated_at();
create trigger helpdesk_settings_audit after insert or update on public.helpdesk_settings for each row execute function app.audit_row();
alter table public.helpdesk_settings enable row level security;
-- Every member may read the targets (the ticket page says when a response is due); helpdesk managers change them.
create policy helpdesk_settings_select on public.helpdesk_settings for select to authenticated using (app.is_member(organization_id));
create policy helpdesk_settings_insert on public.helpdesk_settings for insert to authenticated
  with check (app.has_permission(organization_id, 'helpdesk.manage'));
create policy helpdesk_settings_update on public.helpdesk_settings for update to authenticated
  using (app.has_permission(organization_id, 'helpdesk.manage')) with check (app.has_permission(organization_id, 'helpdesk.manage'));
grant select, insert, update on public.helpdesk_settings to authenticated;
grant all on public.helpdesk_settings to service_role;

-- When a response is due for a ticket of this priority raised at p_from: the target in wall-clock hours, or in
-- business hours when the organization counts those.
create function app.helpdesk_due(p_org uuid, p_from timestamptz, p_priority public.ticket_priority) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  s        public.helpdesk_settings;
  v_tz     text;
  v_cal    uuid;
  v_offs   smallint[];
  v_left   integer;
  v_day    date;
  v_cursor timestamp;
  v_open   timestamp;
  v_close  timestamp;
  v_avail  integer;
begin
  select * into s from public.helpdesk_settings where organization_id = p_org;
  v_left := 60 * case p_priority when 'urgent' then coalesce(s.urgent_hours, 4) when 'high' then coalesce(s.high_hours, 8)
                                 when 'normal' then coalesce(s.normal_hours, 24) else coalesce(s.low_hours, 72) end;
  if not coalesce(s.business_hours, false) then
    return p_from + make_interval(mins => v_left);
  end if;
  select timezone into v_tz from public.organizations where id = p_org;
  select id, weekly_offs into v_cal, v_offs from public.holiday_calendars where organization_id = p_org and location_id is null;
  v_offs := coalesce(v_offs, '{0,6}');
  v_cursor := p_from at time zone v_tz;
  v_day := v_cursor::date;
  for i in 1..1500 loop  -- about four years of days: enough for any target on any calendar with a working day
    if not (extract(dow from v_day)::smallint = any (v_offs))
       and not exists (select 1 from public.holidays h where h.calendar_id = v_cal and h.holiday_date = v_day and not h.is_optional) then
      v_open := greatest(v_day + s.day_start, v_cursor);
      v_close := v_day + s.day_end;
      if v_open < v_close then
        v_avail := (extract(epoch from v_close - v_open) / 60)::integer;
        if v_left <= v_avail then
          return (v_open + make_interval(mins => v_left)) at time zone v_tz;
        end if;
        v_left := v_left - v_avail;
      end if;
    end if;
    v_day := v_day + 1;
    v_cursor := v_day::timestamp;
  end loop;
  return p_from + make_interval(mins => v_left);  -- a calendar without working days: fall back to wall-clock time
end $$;
revoke all on function app.helpdesk_due(uuid, timestamptz, public.ticket_priority) from public;

create or replace function public.raise_ticket(p_org uuid, p_category uuid, p_subject text, p_description text, p_priority public.ticket_priority default 'normal')
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
          v_cat.default_assignee_id, app.helpdesk_due(p_org, now(), p_priority))
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

create or replace function public.update_ticket(p_ticket uuid, p_status public.ticket_status, p_assignee uuid default null, p_priority public.ticket_priority default null)
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
    sla_due_at = case when p_priority is not null and p_priority <> priority then app.helpdesk_due(organization_id, created_at, p_priority) else sla_due_at end,
    resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
   where id = p_ticket;
  if p_status = 'resolved' and v_t.status <> 'resolved' then
    perform app.notify(v_t.organization_id, (select user_id from public.employees where id = v_t.requester_id), 'helpdesk.resolved',
      'Resolved: ticket #' || v_t.number || ' ' || left(v_t.subject, 120) || '. How did we do?', null, '/helpdesk/' || p_ticket);
  end if;
  if p_assignee is not null and p_assignee is distinct from v_t.assignee_id then
    perform app.notify(v_t.organization_id, (select user_id from public.employees where id = p_assignee), 'helpdesk.assigned',
      'Assigned to you: ticket #' || v_t.number || ' ' || left(v_t.subject, 120), null, '/helpdesk/' || p_ticket);
  end if;
end $$;

-- ─── Satisfaction ───────────────────────────────────────────────────────────

create table public.ticket_feedback (
  ticket_id        uuid primary key,
  organization_id  uuid not null,
  rating           smallint not null check (rating between 1 and 5),
  comment          text check (char_length(comment) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, ticket_id) references public.tickets (organization_id, id) on delete cascade
);
create index ticket_feedback_org_idx on public.ticket_feedback (organization_id, created_at desc);
create trigger ticket_feedback_touch before update on public.ticket_feedback for each row execute function app.touch_updated_at();
create trigger ticket_feedback_audit after insert or update on public.ticket_feedback for each row execute function app.audit_row();
alter table public.ticket_feedback enable row level security;
-- The requester and the ticket's agents see a rating; writes only through rate_ticket.
create policy ticket_feedback_select on public.ticket_feedback for select to authenticated
  using (app.is_ticket_agent(ticket_id) or exists (select 1 from public.tickets t where t.id = ticket_id and app.is_own_employee(t.requester_id)));
grant select on public.ticket_feedback to authenticated;
grant all on public.ticket_feedback to service_role;

create function public.rate_ticket(p_ticket uuid, p_rating integer, p_comment text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t public.tickets;
begin
  select * into v_t from public.tickets where id = p_ticket;
  if v_t.id is null or not app.is_own_employee(v_t.requester_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_t.status not in ('resolved', 'closed') then
    raise exception 'You can rate the help once the ticket is resolved.' using errcode = '22023';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Choose from 1 to 5.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Keep the comment under 1,000 characters.' using errcode = '22023';
  end if;
  insert into public.ticket_feedback (ticket_id, organization_id, rating, comment)
  values (p_ticket, v_t.organization_id, p_rating, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (ticket_id) do update set rating = excluded.rating, comment = excluded.comment;
  perform app.notify(v_t.organization_id, (select user_id from public.employees where id = v_t.assignee_id), 'helpdesk.feedback',
    'Rated ' || p_rating || ' of 5: ticket #' || v_t.number || ' ' || left(v_t.subject, 120), null, '/helpdesk/' || p_ticket);
end $$;

-- Helpdesk managers: ratings over the last p_days days (how many, the average, how many were 1 or 2).
create function public.helpdesk_satisfaction(p_org uuid, p_days integer default 90)
returns table (responses integer, average numeric, low integer)
language sql stable security definer set search_path = '' as $$
  select count(*)::integer, round(avg(f.rating), 1), count(*) filter (where f.rating <= 2)::integer
    from public.ticket_feedback f
   where f.organization_id = p_org and app.has_permission(p_org, 'helpdesk.manage')
     and f.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 3650)));
$$;

revoke all on function public.rate_ticket(uuid, integer, text) from public, anon;
revoke all on function public.helpdesk_satisfaction(uuid, integer) from public, anon;
grant execute on function public.rate_ticket(uuid, integer, text) to authenticated, service_role;
grant execute on function public.helpdesk_satisfaction(uuid, integer) to authenticated, service_role;
