-- PeopleCore · Grievances: an anonymous channel, and files on cases.
--
-- * Anonymous cases. The person raising a concern can keep their name from everyone handling it. The case still
--   belongs to them (they follow it, reply, add files and can withdraw it), but handlers see "Anonymous": the
--   reporter's id is no longer readable from the table, the case and messages hide who raised it, and the audit log
--   records no actor for what the reporter does on an anonymous case. The refusals that would tell a handler who
--   raised it ("can't name / add the person who raised it") don't apply to anonymous cases; the reporter keeps the
--   reporter's view whatever a handler does. POSH complaints can't be anonymous: the Act needs a written complaint
--   from the person affected.
-- * Files. PDF, JPEG or PNG (5 MB each, ten per case), added by the reporter or the people handling the case, under the
--   same rules as messages; handlers can mark a file internal. Files sit in the private `grievance-files` bucket that
--   signed-in users can't reach: the server stores a file before add_grievance_file records it (removing it if that
--   refuses) and signs a short-lived link only for a path grievance_file returns. A handler's download is audited.

-- ─── Anonymous: who did it, kept out of the audit log ──────────────────────

-- The audit trigger leaves the actor out for rows of one anonymous case while its reporter acts on it: the case's
-- functions set app.anonymous_case to the case id for the statement, and only rows of that case qualify.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new     jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old     jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_redact  text[] := coalesce(tg_argv::text[], '{}');
  v_changes jsonb;
  v_col     text;
  v_anon    text := nullif(current_setting('app.anonymous_case', true), '');
  v_actor   uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(
             n.key,
             case when n.key = any (v_redact)
                  then jsonb_build_object('from', '[redacted]', 'to', '[redacted]')
                  else jsonb_build_object('from', v_old -> n.key, 'to', n.value) end)
      into v_changes
      from jsonb_each(v_new) n
     where n.key not in ('updated_at', 'search_text')
       and (v_old -> n.key) is distinct from n.value;
    if v_changes is null then
      return null;  -- no meaningful change
    end if;
  else
    v_changes := v_row - 'search_text';
    foreach v_col in array v_redact loop
      if v_changes ? v_col and v_changes -> v_col <> 'null'::jsonb then
        v_changes := jsonb_set(v_changes, array[v_col], '"[redacted]"');
      end if;
    end loop;
  end if;

  if v_anon is not null and tg_table_name in ('grievances', 'grievance_notes', 'grievance_respondents', 'grievance_files')
     and v_anon = coalesce(case when tg_table_name = 'grievances' then v_row ->> 'id' end, v_row ->> 'grievance_id') then
    v_actor := null;
  end if;

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes, metadata)
  values (
    coalesce((v_row ->> 'organization_id')::uuid,
             case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end),
    v_actor,
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_changes,
    case when v_row ? 'employee_id' then jsonb_build_object('employee_id', v_row ->> 'employee_id') else '{}'::jsonb end
  );
  return null;
end $$;

-- Called by the case functions: is this the reporter acting on their anonymous case? Then their writes on this case
-- are audited without an actor until app.show_actor() (called right after them).
create function app.hide_anonymous_reporter(p_case uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if exists (select 1 from public.grievances g where g.id = p_case and g.anonymous and app.is_own_employee(g.reporter_id)) then
    perform set_config('app.anonymous_case', p_case::text, true);
  end if;
end $$;
revoke all on function app.hide_anonymous_reporter(uuid) from public;

create function app.show_actor() returns void
language sql volatile security definer set search_path = '' as $$
  select set_config('app.anonymous_case', '', true);
$$;
revoke all on function app.show_actor() from public;

alter table public.grievances add column anonymous boolean not null default false;
alter table public.grievances add constraint grievances_posh_named check (not (anonymous and category = 'posh'));

-- Who raised a case is no longer readable from the table: only through grievance_list (is it mine?) and
-- grievance_case (handlers see the name only on cases that aren't anonymous).
revoke select (reporter_id) on public.grievances from authenticated;
grant select (anonymous) on public.grievances to authenticated;

-- ─── Raising, reading and writing on a case ─────────────────────────────────

drop function public.raise_grievance(uuid, public.grievance_category, text, text, date, uuid[]);
create function public.raise_grievance(p_org uuid, p_category public.grievance_category, p_subject text, p_description text,
                                       p_incident_on date default null, p_respondents uuid[] default null, p_anonymous boolean default false)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp    uuid;
  v_id     uuid := gen_random_uuid();
  v_number bigint;
  v_named  uuid[] := array(select distinct x from unnest(coalesce(p_respondents, '{}')) x where x is not null);
  v_anon   boolean := coalesce(p_anonymous, false);
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
  if v_anon and p_category = 'posh' then
    raise exception 'A POSH complaint can’t be anonymous: the Act needs a written complaint from the person affected. Raise it in confidence instead.' using errcode = '22023';
  end if;
  if v_emp = any (v_named) then
    raise exception 'You can’t name yourself.' using errcode = '22023';
  end if;
  if (select count(*) from public.employees where organization_id = p_org and id = any (v_named)) <> cardinality(v_named) then
    raise exception 'Choose people from your organization.' using errcode = '22023';
  end if;
  if v_anon then
    perform set_config('app.anonymous_case', v_id::text, true);
  end if;
  v_number := app.next_counter(p_org, 'grievance_number');
  insert into public.grievances (id, organization_id, number, reporter_id, category, subject, description, incident_on, anonymous)
  values (v_id, p_org, v_number, v_emp, p_category, btrim(p_subject), btrim(p_description), p_incident_on, v_anon);
  insert into public.grievance_respondents (organization_id, grievance_id, employee_id)
  select p_org, v_id, x from unnest(v_named) x;
  perform app.show_actor();
  perform app.notify_grievance_handlers(v_id, 'grievance.new',
    case when v_anon then 'New anonymous grievance case #' else 'New grievance case #' end || v_number);
  return v_id;
end $$;

-- The cases the caller can see, and which of them they raised (the table no longer says who raised a case).
create function public.grievance_list(p_org uuid)
returns table (id uuid, number bigint, category public.grievance_category, subject text, status public.grievance_status, anonymous boolean,
               created_at timestamptz, updated_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
  select g.id, g.number, g.category, g.subject, g.status, g.anonymous, g.created_at, g.updated_at, app.is_own_employee(g.reporter_id)
    from public.grievances g
   where g.organization_id = p_org and app.grievance_role(g.id) is not null
   order by g.created_at desc
   limit 200;
$$;

-- The case with what was written. Handlers of an anonymous case get neither the reporter's id nor their name.
drop function public.grievance_case(uuid);
create function public.grievance_case(p_case uuid)
returns table (id uuid, number bigint, category public.grievance_category, subject text, description text, incident_on date,
               status public.grievance_status, outcome text, created_at timestamptz, resolved_at timestamptz, closed_at timestamptz,
               reporter_id uuid, reporter_name text, my_role text, anonymous boolean)
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
           g.closed_at,
           case when g.anonymous and v_role <> 'reporter' then null else g.reporter_id end,
           case when g.anonymous and v_role <> 'reporter' then 'Anonymous' else concat_ws(' ', e.first_name, e.last_name) end,
           v_role, g.anonymous
      from public.grievances g join public.employees e on e.id = g.reporter_id
     where g.id = p_case;
end $$;

-- Messages: on an anonymous case, the reporter's messages are signed "Person who raised it" for everyone else.
create or replace function public.grievance_thread(p_case uuid)
returns table (id uuid, author_name text, mine boolean, body text, internal boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id,
         case when g.anonymous and n.author_user_id = re.user_id then 'Person who raised it'
              else coalesce(nullif(concat_ws(' ', e.first_name, e.last_name), ''), 'HR') end,
         n.author_user_id = auth.uid(), n.body, n.internal, n.created_at
    from public.grievance_notes n
    join public.grievances g on g.id = n.grievance_id
    join public.employees re on re.id = g.reporter_id
    left join public.employees e on e.organization_id = n.organization_id and e.user_id = n.author_user_id
   where n.grievance_id = p_case
     and (app.grievance_role(p_case) in ('manager', 'investigator') or (not n.internal and app.grievance_role(p_case) = 'reporter'))
   order by n.created_at, n.id;
$$;

create or replace function public.add_grievance_note(p_case uuid, p_body text, p_internal boolean default false) returns void
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
  perform app.hide_anonymous_reporter(p_case);
  insert into public.grievance_notes (organization_id, grievance_id, body, internal)
  values (v_g.organization_id, p_case, btrim(p_body), coalesce(p_internal, false));
  perform app.show_actor();
  if v_role = 'reporter' then
    perform app.notify_grievance_handlers(p_case, 'grievance.message', 'New message on grievance case #' || v_g.number);
  elsif not coalesce(p_internal, false) then
    perform app.notify(v_g.organization_id, (select user_id from public.employees where id = v_g.reporter_id), 'grievance.message',
      'New message on your grievance #' || v_g.number, null, '/grievances/' || p_case);
  end if;
end $$;

create or replace function public.withdraw_grievance(p_case uuid, p_reason text default null) returns void
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
  perform app.hide_anonymous_reporter(p_case);
  update public.grievances set status = 'withdrawn', closed_at = now() where id = p_case;
  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    insert into public.grievance_notes (organization_id, grievance_id, body) values (v_g.organization_id, p_case, 'Withdrawn: ' || btrim(p_reason));
  end if;
  perform app.show_actor();
  perform app.notify_grievance_handlers(p_case, 'grievance.update', 'Grievance case #' || v_g.number || ' was withdrawn');
end $$;

-- Investigators: on an anonymous case the reporter isn't refused by name (that would say who raised it); adding them
-- changes nothing for them, since the reporter's view always comes first.
create or replace function public.set_grievance_access(p_case uuid, p_user uuid, p_allow boolean) returns void
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
  if not v_g.anonymous and exists (select 1 from public.employees where id = v_g.reporter_id and user_id = p_user) then
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

create or replace function public.add_grievance_respondent(p_case uuid, p_employee uuid) returns void
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
  if p_employee = v_g.reporter_id and not v_g.anonymous then
    raise exception 'The person who raised it can’t be named in it.' using errcode = '22023';
  end if;
  insert into public.grievance_respondents (organization_id, grievance_id, employee_id) values (v_g.organization_id, p_case, p_employee)
  on conflict (grievance_id, employee_id) do nothing;
  -- Naming someone removes any access they had (never the reporter's own view).
  delete from public.grievance_access a using public.employees e
   where a.grievance_id = p_case and e.id = p_employee and a.user_id = e.user_id;
end $$;

-- ─── Files ──────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('grievance-files', 'grievance-files', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create table public.grievance_files (
  id               uuid primary key,          -- chosen by the server: also the file's name in storage
  organization_id  uuid not null,
  grievance_id     uuid not null,
  name             text not null check (char_length(name) between 1 and 200),
  content_type     text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes       integer not null check (size_bytes between 1 and 5242880),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  internal         boolean not null default false,
  uploaded_by      uuid not null default auth.uid(),
  created_at       timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, grievance_id) references public.grievances (organization_id, id) on delete cascade
);
create index grievance_files_case_idx on public.grievance_files (grievance_id, created_at);
create trigger grievance_files_audit after insert or delete on public.grievance_files for each row execute function app.audit_row('name');
alter table public.grievance_files enable row level security;
-- Read like messages: handlers see every file, the reporter all but internal ones. Who added a file comes only from
-- grievance_files (which hides the reporter of an anonymous case). Writes only through the functions.
create policy grievance_files_select on public.grievance_files for select to authenticated
  using (app.grievance_role(grievance_id) in ('manager', 'investigator') or (not internal and app.grievance_role(grievance_id) = 'reporter'));
grant select (id, organization_id, grievance_id, name, content_type, size_bytes, internal, created_at) on public.grievance_files to authenticated;
grant all on public.grievance_files to service_role;

-- Records a file the server has just stored for a case, if the caller may write on it. The reporter's file tells the
-- handlers; a handler's file tells the reporter (not internal files).
create function public.add_grievance_file(p_case uuid, p_id uuid, p_name text, p_type text, p_size integer, p_sha256 text,
                                          p_internal boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text := app.grievance_role(p_case);
  v_g    public.grievances;
begin
  select * into v_g from public.grievances where id = p_case for update;
  if v_role is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if coalesce(p_internal, false) and v_role = 'reporter' then
    raise exception 'Only the people handling the case can add internal files.' using errcode = '42501';
  end if;
  if v_g.status in ('closed', 'withdrawn') then
    raise exception 'This case is closed.' using errcode = '22023';
  end if;
  if (select count(*) from public.grievance_files where grievance_id = p_case) >= 10 then
    raise exception 'A case can have up to ten files.' using errcode = '22023';
  end if;
  perform app.hide_anonymous_reporter(p_case);
  insert into public.grievance_files (id, organization_id, grievance_id, name, content_type, size_bytes, sha256, internal)
  values (p_id, v_g.organization_id, p_case, btrim(p_name), p_type, p_size, p_sha256, coalesce(p_internal, false));
  perform app.show_actor();
  if v_role = 'reporter' then
    perform app.notify_grievance_handlers(p_case, 'grievance.message', 'File added on grievance case #' || v_g.number);
  elsif not coalesce(p_internal, false) then
    perform app.notify(v_g.organization_id, (select user_id from public.employees where id = v_g.reporter_id), 'grievance.message',
      'File added on your grievance #' || v_g.number, null, '/grievances/' || p_case);
  end if;
end $$;

-- The files on a case the caller can see, with who added them ("Person who raised it" on an anonymous case).
create function public.grievance_files(p_case uuid)
returns table (id uuid, name text, content_type text, size_bytes integer, internal boolean, uploader_name text, mine boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.id, f.name, f.content_type, f.size_bytes, f.internal,
         case when g.anonymous and f.uploaded_by = re.user_id then 'Person who raised it'
              else coalesce(nullif(concat_ws(' ', e.first_name, e.last_name), ''), 'HR') end,
         f.uploaded_by = auth.uid(), f.created_at
    from public.grievance_files f
    join public.grievances g on g.id = f.grievance_id
    join public.employees re on re.id = g.reporter_id
    left join public.employees e on e.organization_id = f.organization_id and e.user_id = f.uploaded_by
   where f.grievance_id = p_case
     and (app.grievance_role(p_case) in ('manager', 'investigator') or (not f.internal and app.grievance_role(p_case) = 'reporter'))
   order by f.created_at, f.id;
$$;

-- Where a file is stored and its name, for a caller who may download it; a handler's download is recorded in the
-- audit log. The server then signs a short-lived link.
create function public.grievance_file(p_id uuid)
returns table (path text, name text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_f    public.grievance_files;
  v_role text;
begin
  select * into v_f from public.grievance_files where id = p_id;
  v_role := app.grievance_role(v_f.grievance_id);
  if v_f.id is null or not coalesce(v_role in ('manager', 'investigator') or (not v_f.internal and v_role = 'reporter'), false) then
    return;
  end if;
  if v_role in ('manager', 'investigator') then
    insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (v_f.organization_id, auth.uid(), 'download', 'grievance_files', v_f.id, jsonb_build_object('grievance_id', v_f.grievance_id, 'role', v_role));
  end if;
  return query select v_f.organization_id || '/' || v_f.grievance_id || '/' || v_f.id, v_f.name;
end $$;

-- Removes a file while the case is open: a case manager, or whoever added it. Returns where it was stored, for the
-- server to delete.
create function public.remove_grievance_file(p_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_f public.grievance_files;
  v_g public.grievances;
begin
  select * into v_f from public.grievance_files where id = p_id;
  if v_f.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_g from public.grievances where id = v_f.grievance_id for update;
  if not coalesce(app.grievance_role(v_g.id) = 'manager' or (v_f.uploaded_by = auth.uid() and app.grievance_role(v_g.id) is not null), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_g.status in ('closed', 'withdrawn') then
    raise exception 'This case is closed.' using errcode = '22023';
  end if;
  perform app.hide_anonymous_reporter(v_g.id);
  delete from public.grievance_files where id = p_id;
  perform app.show_actor();
  return v_f.organization_id || '/' || v_f.grievance_id || '/' || v_f.id;
end $$;

revoke all on function public.raise_grievance(uuid, public.grievance_category, text, text, date, uuid[], boolean) from public, anon;
revoke all on function public.grievance_list(uuid) from public, anon;
revoke all on function public.grievance_case(uuid) from public, anon;
revoke all on function public.add_grievance_file(uuid, uuid, text, text, integer, text, boolean) from public, anon;
revoke all on function public.grievance_files(uuid) from public, anon;
revoke all on function public.grievance_file(uuid) from public, anon;
revoke all on function public.remove_grievance_file(uuid) from public, anon;
grant execute on function public.raise_grievance(uuid, public.grievance_category, text, text, date, uuid[], boolean) to authenticated, service_role;
grant execute on function public.grievance_list(uuid) to authenticated, service_role;
grant execute on function public.grievance_case(uuid) to authenticated, service_role;
grant execute on function public.add_grievance_file(uuid, uuid, text, text, integer, text, boolean) to authenticated, service_role;
grant execute on function public.grievance_files(uuid) to authenticated, service_role;
grant execute on function public.grievance_file(uuid) to authenticated, service_role;
grant execute on function public.remove_grievance_file(uuid) to authenticated, service_role;
