-- PeopleCore · A daily, tamper-evident copy of the audit log (docs/09-security-review.md).
--
-- * Each UTC day, the worker writes every organization's audit events of the day before to the private
--   `audit-archive` bucket as gzipped JSON lines (<org>/<year>/<day>.jsonl.gz; none for a day without events) and
--   records the day here: how many events, the first and last event id, the SHA-256 of the uncompressed file, and a
--   chain hash over the previous day's chain. Days follow one another without gaps from the organization's first day.
-- * audit_archives can't be changed or deleted (as audit_events): a later change to an archived day, in the log or in
--   its file, shows when the chain is checked (Audit log › Daily archive › Verify). Storage can't refuse a delete
--   from the service role, so this detects tampering rather than preventing it; truly write-once storage (an S3 bucket
--   with Object Lock) is an option for the owner to add.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audit-archive', 'audit-archive', false, 52428800, array['application/gzip'])
on conflict (id) do nothing;

create table public.audit_archives (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  day              date not null,
  row_count        integer not null check (row_count >= 0),
  first_event_id   bigint,
  last_event_id    bigint,
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  prev_chain       text check (prev_chain ~ '^[0-9a-f]{64}$'),
  chain            text not null check (chain ~ '^[0-9a-f]{64}$'),
  path             text,
  created_at       timestamptz not null default now(),
  unique (organization_id, day),
  unique (organization_id, id),
  check ((row_count = 0) = (path is null)),
  check (path is null or path = organization_id || '/' || extract(year from day)::int || '/' || to_char(day, 'YYYY-MM-DD') || '.jsonl.gz')
);
create trigger audit_archives_no_update before update or delete on public.audit_archives
  for each row execute function app.prevent_mutation();
create trigger audit_archives_no_truncate before truncate on public.audit_archives
  for each statement execute function app.prevent_mutation();
alter table public.audit_archives enable row level security;
create policy audit_archives_select on public.audit_archives for select to authenticated
  using (app.has_permission(organization_id, 'audit.read'));
grant select on public.audit_archives to authenticated;
grant select, insert on public.audit_archives to service_role;

-- The chain hash of a day: SHA-256 over the previous chain (empty for the first day), the day, its event count and
-- its file's SHA-256, one per line.
create function app.audit_chain(p_prev text, p_day date, p_rows integer, p_sha256 text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_prev, '') || E'\n' || to_char(p_day, 'YYYY-MM-DD') || E'\n' || p_rows || E'\n' || p_sha256, 'UTF8')), 'hex');
$$;
grant execute on function app.audit_chain(text, date, integer, text) to authenticated, service_role;

-- Worker: the next days to archive (UTC), oldest first, each organization continuing after its last archived day
-- from the day it was created, up to yesterday.
create function public.worker_audit_archive_due(p_limit integer default 50)
returns table (organization_id uuid, day date)
language sql stable security definer set search_path = '' as $$
  select o.id, d::date
    from public.organizations o
    cross join lateral generate_series(
      coalesce((select max(a.day) + 1 from public.audit_archives a where a.organization_id = o.id), (o.created_at at time zone 'UTC')::date),
      (now() at time zone 'UTC')::date - 1, interval '1 day') d
   order by d, o.id
   limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- Worker: an organization's audit events of one UTC day, in id order, a page at a time (after event p_after; the API
-- returns at most 1,000 rows per call).
create function public.worker_audit_day(p_org uuid, p_day date, p_after bigint default 0, p_limit integer default 1000)
returns setof public.audit_events
language sql stable security definer set search_path = '' as $$
  select * from public.audit_events
   where organization_id = p_org and occurred_at >= p_day::timestamp at time zone 'UTC' and occurred_at < (p_day + 1)::timestamp at time zone 'UTC'
     and id > coalesce(p_after, 0)
   order by id
   limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

-- Worker: records a day once its file is stored. The day must be the organization's next one, and the count must
-- match the log as it stands.
create function public.worker_record_audit_archive(p_org uuid, p_day date, p_rows integer, p_first bigint, p_last bigint, p_sha256 text, p_path text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_prev  public.audit_archives;
  v_start date;
  v_count integer;
  v_chain text;
begin
  select * into v_prev from public.audit_archives where organization_id = p_org order by day desc limit 1;
  select (created_at at time zone 'UTC')::date into v_start from public.organizations where id = p_org;
  if p_day <> coalesce(v_prev.day + 1, v_start) then
    raise exception 'Archive % for % is not the next day.', p_day, p_org using errcode = '22023';
  end if;
  if p_day >= (now() at time zone 'UTC')::date then
    raise exception 'Only past days are archived.' using errcode = '22023';
  end if;
  select count(*) into v_count from public.audit_events
   where organization_id = p_org and occurred_at >= p_day::timestamp at time zone 'UTC' and occurred_at < (p_day + 1)::timestamp at time zone 'UTC';
  if v_count <> p_rows then
    raise exception 'The day has % events, not %.', v_count, p_rows using errcode = '22023';
  end if;
  v_chain := app.audit_chain(v_prev.chain, p_day, p_rows, p_sha256);
  insert into public.audit_archives (organization_id, day, row_count, first_event_id, last_event_id, sha256, prev_chain, chain, path)
  values (p_org, p_day, p_rows, p_first, p_last, p_sha256, v_prev.chain, v_chain, p_path);
  return v_chain;
end $$;

-- For the Verify button (audit.read): the recorded days, newest first, and how many events each day has now.
create function public.audit_archive_check(p_org uuid, p_days integer default 30)
returns table (day date, row_count integer, rows_now integer, sha256 text, prev_chain text, chain text, path text)
language sql stable security definer set search_path = '' as $$
  select a.day, a.row_count,
         (select count(*)::integer from public.audit_events e
           where e.organization_id = a.organization_id and e.occurred_at >= a.day::timestamp at time zone 'UTC'
             and e.occurred_at < (a.day + 1)::timestamp at time zone 'UTC'),
         a.sha256, a.prev_chain, a.chain, a.path
    from public.audit_archives a
   where a.organization_id = p_org and app.has_permission(p_org, 'audit.read')
   order by a.day desc
   limit greatest(1, least(coalesce(p_days, 30), 366));
$$;

revoke all on function public.worker_audit_archive_due(integer) from public, anon, authenticated;
revoke all on function public.worker_audit_day(uuid, date, bigint, integer) from public, anon, authenticated;
revoke all on function public.worker_record_audit_archive(uuid, date, integer, bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function public.audit_archive_check(uuid, integer) from public, anon;
grant execute on function public.worker_audit_archive_due(integer) to service_role;
grant execute on function public.worker_audit_day(uuid, date, bigint, integer) to service_role;
grant execute on function public.worker_record_audit_archive(uuid, date, integer, bigint, bigint, text, text) to service_role;
grant execute on function public.audit_archive_check(uuid, integer) to authenticated, service_role;
