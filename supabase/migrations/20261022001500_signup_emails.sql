-- PeopleCore · Emails about sign-ups (the website's "Sign up"): the first emails that belong to no organization.
-- * The person who asked gets "we've got your request": new requests only (asking again with the same address sends
--   nothing more), and at most 30 an hour in all, so the public form can't be used to flood someone's inbox.
-- * Every platform administrator gets the request with a link to the console (at most 60 an hour).
-- These email_outbox rows have no organization; tenants never see them (RLS is by organization) and the worker sends
-- them with links into the console rather than a workspace.

alter table public.email_outbox alter column organization_id drop not null;
alter table public.email_outbox add constraint email_outbox_platform_check
  check (organization_id is not null or event in ('signup_received', 'signup_alert'));

-- A side effect: a problem queueing these never blocks the request itself.
create function app.email_on_access_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if (select count(*) from public.email_outbox where event = 'signup_received' and created_at > now() - interval '1 hour') < 30 then
      insert into public.email_outbox (organization_id, user_id, to_email, event, subject, body, link)
      values (null, null, new.work_email, 'signup_received', 'We’ve got your PeopleCore request',
        format(E'Hi %s,\n\nThanks for asking for a PeopleCore workspace for %s. We’ll set it up and email you an invitation to choose your password and sign in, usually within one working day.\n\nIf you didn’t ask for this, you can ignore this email.',
               split_part(new.contact_name, ' ', 1), new.company),
        null);
    end if;
    if (select count(*) from public.email_outbox where event = 'signup_alert' and created_at > now() - interval '1 hour') < 60 then
      insert into public.email_outbox (organization_id, user_id, to_email, event, subject, body, link)
      select null, u.id, u.email, 'signup_alert',
             left(format('New sign-up: %s (%s)', new.company, coalesce(new.headcount || ' people', 'size not given')), 200),
             left(concat_ws(E'\n', format('%s asked for a PeopleCore workspace for %s.', new.contact_name, new.company), '',
                            'Email: ' || new.work_email, 'Phone: ' || new.phone, 'People: ' || new.headcount,
                            E'\nMessage: ' || new.message), 4000),
             '/platform'
        from public.platform_admins pa
        join auth.users u on u.id = pa.user_id
       where u.email is not null;
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function app.email_on_access_request() from public;
create trigger access_requests_email after insert on public.access_requests
  for each row execute function app.email_on_access_request();

-- The worker's batch: platform emails come without an organization.
create or replace function public.worker_claim_emails(p_limit integer default 25)
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
      from claimed c left join public.organizations o on o.id = c.organization_id;
end $$;
