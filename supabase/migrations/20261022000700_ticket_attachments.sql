-- PeopleCore · Helpdesk attachments: PDF, JPEG or PNG files (5 MB each, ten per ticket) added to a ticket by its
-- requester or its agents, under the same rules as replies. Agents can mark a file internal; requesters never see
-- those. The files sit in the private `helpdesk-attachments` bucket, which signed-in users can't reach: the server
-- stores a file before add_ticket_attachment records it (and removes it if that refuses), and signs a short-lived
-- download link only for a path ticket_file returns.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('helpdesk-attachments', 'helpdesk-attachments', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create table public.ticket_attachments (
  id               uuid primary key,          -- chosen by the server: also the file's name in storage
  organization_id  uuid not null,
  ticket_id        uuid not null,
  name             text not null check (char_length(name) between 1 and 200),
  content_type     text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes       integer not null check (size_bytes between 1 and 5242880),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  internal         boolean not null default false,
  uploaded_by      uuid not null default auth.uid(),
  created_at       timestamptz not null default clock_timestamp(),
  foreign key (organization_id, ticket_id) references public.tickets (organization_id, id) on delete cascade
);
create index ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id, created_at);
create trigger ticket_attachments_audit after insert or delete on public.ticket_attachments for each row execute function app.audit_row();
alter table public.ticket_attachments enable row level security;
-- Read like replies: agents see every file, the requester all but the internal ones. Writes only through the functions.
create policy ticket_attachments_select on public.ticket_attachments for select to authenticated
  using (app.is_ticket_agent(ticket_id)
         or (not internal and exists (select 1 from public.tickets t where t.id = ticket_id and app.is_own_employee(t.requester_id))));
grant select on public.ticket_attachments to authenticated;
grant all on public.ticket_attachments to service_role;

-- Records a file the server has just stored for a ticket, if the caller may reply on it. A requester's file tells the
-- assignee; an agent's file the requester (not for internal files).
create function public.add_ticket_attachment(p_ticket uuid, p_id uuid, p_name text, p_type text, p_size integer, p_sha256 text,
                                             p_internal boolean default false) returns void
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
  if coalesce(p_internal, false) and not v_agent then
    raise exception 'Only agents can add internal files.' using errcode = '42501';
  end if;
  if v_t.status = 'closed' then
    raise exception 'This ticket is closed. Raise a new one.' using errcode = '22023';
  end if;
  if (select count(*) from public.ticket_attachments where ticket_id = p_ticket) >= 10 then
    raise exception 'A ticket can have up to ten files.' using errcode = '22023';
  end if;
  insert into public.ticket_attachments (id, organization_id, ticket_id, name, content_type, size_bytes, sha256, internal)
  values (p_id, v_t.organization_id, p_ticket, btrim(p_name), p_type, p_size, p_sha256, coalesce(p_internal, false));
  if app.is_own_employee(v_t.requester_id) then
    select user_id into v_notify from public.employees where id = v_t.assignee_id;
  elsif not coalesce(p_internal, false) then
    select user_id into v_notify from public.employees where id = v_t.requester_id;
  end if;
  perform app.notify(v_t.organization_id, v_notify, 'helpdesk.reply', 'File added on ticket #' || v_t.number || ': ' || left(v_t.subject, 120), null, '/helpdesk/' || p_ticket);
end $$;

-- The files on a ticket the caller can see, with who added them (requesters: not agents' internal files).
create function public.ticket_files(p_ticket uuid)
returns table (id uuid, name text, content_type text, size_bytes integer, internal boolean, uploader_name text, mine boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, a.content_type, a.size_bytes, a.internal, coalesce(nullif(concat_ws(' ', e.first_name, e.last_name), ''), 'Helpdesk'),
         a.uploaded_by = auth.uid(), a.created_at
    from public.ticket_attachments a
    join public.tickets t on t.id = a.ticket_id
    left join public.employees e on e.organization_id = a.organization_id and e.user_id = a.uploaded_by
   where a.ticket_id = p_ticket
     and (app.is_ticket_agent(p_ticket) or (not a.internal and app.is_own_employee(t.requester_id)))
   order by a.created_at, a.id;
$$;

-- Where a file is stored and its name, for a caller who may download it (the server then signs a short-lived link).
create function public.ticket_file(p_id uuid)
returns table (path text, name text)
language sql stable security definer set search_path = '' as $$
  select a.organization_id || '/' || a.ticket_id || '/' || a.id, a.name
    from public.ticket_attachments a join public.tickets t on t.id = a.ticket_id
   where a.id = p_id and (app.is_ticket_agent(a.ticket_id) or (not a.internal and app.is_own_employee(t.requester_id)));
$$;

-- Removes a file while the ticket is open: an agent, or the requester for a file they added. Returns where it was
-- stored, for the server to delete.
create function public.remove_ticket_attachment(p_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_a public.ticket_attachments;
  v_t public.tickets;
begin
  select * into v_a from public.ticket_attachments where id = p_id;
  if v_a.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_t from public.tickets where id = v_a.ticket_id for update;
  if not (app.is_ticket_agent(v_a.ticket_id) or (v_a.uploaded_by = auth.uid() and app.is_own_employee(v_t.requester_id))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_t.status = 'closed' then
    raise exception 'This ticket is closed.' using errcode = '22023';
  end if;
  delete from public.ticket_attachments where id = p_id;
  return v_a.organization_id || '/' || v_a.ticket_id || '/' || v_a.id;
end $$;

revoke all on function public.add_ticket_attachment(uuid, uuid, text, text, integer, text, boolean) from public, anon;
revoke all on function public.ticket_files(uuid) from public, anon;
revoke all on function public.ticket_file(uuid) from public, anon;
revoke all on function public.remove_ticket_attachment(uuid) from public, anon;
grant execute on function public.add_ticket_attachment(uuid, uuid, text, text, integer, text, boolean) to authenticated, service_role;
grant execute on function public.ticket_files(uuid) to authenticated, service_role;
grant execute on function public.ticket_file(uuid) to authenticated, service_role;
grant execute on function public.remove_ticket_attachment(uuid) to authenticated, service_role;
