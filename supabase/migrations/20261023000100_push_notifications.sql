-- PeopleCore · Push notifications on the phone app (Firebase Cloud Messaging). The app registers its phone after
-- sign-in and removes it at sign-out. Every in-app notification for that person is then also queued as a push, which
-- the worker sends when FCM is configured; a push still waiting after a day, or already read elsewhere, is dropped.
-- A phone belongs to a person, not to an organization, so phones and the queue live in the private app schema and
-- are reached only through the functions below.

create table app.push_devices (
  token         text primary key check (char_length(token) between 20 and 4096),
  user_id       uuid not null references auth.users (id) on delete cascade,
  platform      text not null check (platform in ('android', 'ios')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index push_devices_user_idx on app.push_devices (user_id, last_seen_at desc);

create table app.push_outbox (
  id               uuid primary key default gen_random_uuid(),
  notification_id  uuid not null unique references public.notifications (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  status           text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'expired', 'skipped')),
  attempts         smallint not null default 0,
  claimed_at       timestamptz,
  last_error       text check (char_length(last_error) <= 500),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index push_outbox_queue_idx on app.push_outbox (created_at) where status in ('queued', 'sending');

grant all on app.push_devices, app.push_outbox to service_role;

-- The signed-in person's phone. A phone that changes hands (one person signs out, another signs in) moves to the
-- new person. Where the person's organization asks for two-step sign-in, only a two-step session can register.
create function public.register_push_device(p_token text, p_platform text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if app.current_aal() <> 'aal2' and public.my_mfa_requirement() then
    raise exception 'Enter your two-step code first.' using errcode = '42501';
  end if;
  if p_platform is null or p_platform not in ('android', 'ios') or p_token is null or char_length(p_token) not between 20 and 4096 then
    raise exception 'That isn’t a phone this app can notify.' using errcode = '22023';
  end if;
  insert into app.push_devices (token, user_id, platform) values (p_token, v_user, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
  -- Ten phones per person at most; the ones not seen for longest go first.
  delete from app.push_devices d
   where d.user_id = v_user
     and d.token in (select x.token from app.push_devices x where x.user_id = v_user order by x.last_seen_at desc offset 10);
end $$;

-- At sign-out, or when the person switches notifications off on that phone. Only their own phone.
create function public.unregister_push_device(p_token text) returns void
language sql volatile security definer set search_path = '' as $$
  delete from app.push_devices where token = p_token and user_id = auth.uid();
$$;

-- Every new in-app notification for someone with a registered phone is queued as a push.
create function app.queue_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app.push_devices d where d.user_id = new.user_id) then
    insert into app.push_outbox (notification_id, user_id) values (new.id, new.user_id) on conflict (notification_id) do nothing;
  end if;
  return new;
end $$;
create trigger notifications_queue_push after insert on public.notifications
  for each row execute function app.queue_push();

-- The worker's batch: each push with the person's phones (most recently seen first), the notification's text and
-- link, and its organization. Pushes waiting over a day expire; ones already read are skipped; a batch claimed but
-- not reported within ten minutes is claimed again.
create function public.worker_claim_pushes(p_limit integer default 50)
returns table (id uuid, tokens text[], title text, body text, link text, kind text, org_slug text, org_name text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  update app.push_outbox x set status = 'expired' where x.status in ('queued', 'sending') and x.created_at < now() - interval '1 day';
  update app.push_outbox x set status = 'queued' where x.status = 'sending' and x.claimed_at < now() - interval '10 minutes';
  update app.push_outbox x set status = 'skipped'
    from public.notifications n where n.id = x.notification_id and x.status = 'queued' and n.read_at is not null;
  return query
    with picked as (
      select x.id from app.push_outbox x where x.status = 'queued' order by x.created_at
       limit greatest(1, least(coalesce(p_limit, 50), 200)) for update skip locked),
    claimed as (
      update app.push_outbox x set status = 'sending', attempts = x.attempts + 1, claimed_at = now()
        from picked where x.id = picked.id
      returning x.id, x.notification_id, x.user_id)
    select c.id,
           array(select d.token from app.push_devices d where d.user_id = c.user_id order by d.last_seen_at desc),
           n.title, n.body, n.link, n.kind, o.slug, o.name
      from claimed c
      join public.notifications n on n.id = c.notification_id
      join public.organizations o on o.id = n.organization_id;
end $$;

-- The outcome: sent, or tried again later (up to five attempts). Tokens the push service says are gone (the app was
-- uninstalled, say) are forgotten.
create function public.worker_push_result(p_id uuid, p_ok boolean, p_error text default null, p_dead_tokens text[] default '{}')
returns void
language sql volatile security definer set search_path = '' as $$
  delete from app.push_devices where token = any(coalesce(p_dead_tokens, '{}'));
  update app.push_outbox
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end, last_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id and status = 'sending';
$$;

revoke all on function public.register_push_device(text, text), public.unregister_push_device(text) from public, anon;
grant execute on function public.register_push_device(text, text), public.unregister_push_device(text) to authenticated, service_role;
revoke all on function app.queue_push() from public;
revoke all on function public.worker_claim_pushes(integer), public.worker_push_result(uuid, boolean, text, text[]) from public, anon, authenticated;
grant execute on function public.worker_claim_pushes(integer), public.worker_push_result(uuid, boolean, text, text[]) to service_role;
