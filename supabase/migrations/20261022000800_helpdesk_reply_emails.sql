-- PeopleCore · Email for helpdesk replies. When switched on (Settings › Notifications, off until then), a public reply
-- on a ticket emails the other side: the requester when an agent replies, the assignee when the requester replies.
-- Internal notes never email anyone. The email says why it was sent (the worker reads the event).

alter table public.notification_email_rules
  drop constraint notification_email_rules_event_check,
  add constraint notification_email_rules_event_check check (event in ('regularization', 'leave', 'expense', 'birthday', 'anniversary', 'helpdesk_reply')),
  drop constraint notification_email_rules_audience_check,
  add constraint notification_email_rules_audience_check
    check (audience in ('owner', 'hr_admin', 'hr_executive', 'finance_admin', 'payroll_admin', 'line_manager', 'ticket_parties')),
  -- The people on a ticket are an audience of their own, for helpdesk replies only.
  add constraint notification_email_rules_ticket_parties_check check ((event = 'helpdesk_reply') = (audience = 'ticket_parties'));

-- Queues one email to one member, if the organization has that event switched on for that audience.
create function app.queue_user_email(p_org uuid, p_user uuid, p_event text, p_audience text, p_subject text, p_body text, p_link text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  insert into public.email_outbox (organization_id, user_id, to_email, event, subject, body, link)
  select p_org, u.id, u.email, p_event, left(p_subject, 200), left(p_body, 4000), p_link
    from auth.users u
   where u.id = p_user and u.email is not null
     and exists (select 1 from public.organization_members om where om.organization_id = p_org and om.user_id = p_user and om.status = 'active')
     and exists (select 1 from public.notification_email_rules r
                  where r.organization_id = p_org and r.event = p_event and r.audience = p_audience and r.enabled);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function app.queue_user_email(uuid, uuid, text, text, text, text, text) from public;

-- A public reply emails the other side of the ticket. A side effect: a problem queueing it never blocks the reply.
create function app.email_on_ticket_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_t      public.tickets;
  v_to     uuid;
  v_author text;
begin
  begin
    select * into v_t from public.tickets where id = new.ticket_id;
    select nullif(trim(concat_ws(' ', e.first_name, e.last_name)), '') into v_author
      from public.employees e where e.organization_id = new.organization_id and e.user_id = new.author_user_id;
    if exists (select 1 from public.employees e where e.id = v_t.requester_id and e.user_id = new.author_user_id) then
      select user_id into v_to from public.employees where id = v_t.assignee_id;
    else
      select user_id into v_to from public.employees where id = v_t.requester_id;
    end if;
    if v_to is not null and v_to is distinct from new.author_user_id then
      perform app.queue_user_email(new.organization_id, v_to, 'helpdesk_reply', 'ticket_parties',
        format('Re: ticket #%s %s', v_t.number, left(v_t.subject, 120)),
        format('%s replied on ticket #%s “%s”:', coalesce(v_author, 'The helpdesk'), v_t.number, left(v_t.subject, 120)) || E'\n\n' || left(new.body, 3000),
        '/helpdesk/' || v_t.id);
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function app.email_on_ticket_reply() from public;
create trigger ticket_comments_email after insert on public.ticket_comments
  for each row when (not new.internal) execute function app.email_on_ticket_reply();

-- The worker's batch now says which event each email is for, so the footer can say why it was sent.
drop function public.worker_claim_emails(integer);
create function public.worker_claim_emails(p_limit integer default 25)
returns table (id uuid, to_email text, subject text, body text, link text, org_slug text, org_name text, event text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.email_outbox x set status = 'expired' where x.status = 'queued' and x.created_at < now() - interval '2 days';
  update public.email_outbox x set status = 'queued' where x.status = 'sending' and x.claimed_at < now() - interval '15 minutes';
  return query
    with picked as (
      select x.id from public.email_outbox x where x.status = 'queued' order by x.created_at
       limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked),
    claimed as (
      update public.email_outbox x set status = 'sending', attempts = x.attempts + 1, claimed_at = now()
        from picked where x.id = picked.id
      returning x.id, x.to_email, x.subject, x.body, x.link, x.organization_id, x.event)
    select c.id, c.to_email, c.subject, c.body, c.link, o.slug, o.name, c.event
      from claimed c join public.organizations o on o.id = c.organization_id;
end $$;
revoke all on function public.worker_claim_emails(integer) from public, anon, authenticated;
grant execute on function public.worker_claim_emails(integer) to service_role;
