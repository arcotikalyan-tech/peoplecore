-- PeopleCore · Candidate consent expiry (threat T15, over-retention).
--
-- * Each organization keeps candidates who are no longer in a pipeline for a set number of days (365 by default)
--   after their last activity: the consent date, or the latest application or stage change, whichever is later.
--   Applying again (from the careers page or through a recruiter) records consent again and restarts the clock.
-- * A candidate is kept while any application is still open (applied, screening, interview, offer) and always
--   once hired (they are an employee and follow employee retention).
-- * The worker erases the others daily through the same code path as a recruiter's "Erase" (erase_candidate):
--   the same hired guard, the same audit entry (marked reason = consent_expired, no actor) and the same cascade.
-- * Recruiters see who is due in the next 30 days; only recruitment.manage changes the period.

-- ─── Setting ────────────────────────────────────────────────────────────────

create table public.recruitment_settings (
  organization_id           uuid primary key references public.organizations (id) on delete cascade,
  candidate_retention_days  smallint not null default 365 check (candidate_retention_days between 30 and 3650),
  updated_by                uuid,
  updated_at                timestamptz not null default now()
);
create trigger recruitment_settings_touch before update on public.recruitment_settings for each row execute function app.touch_updated_at();
create trigger recruitment_settings_audit after update on public.recruitment_settings for each row execute function app.audit_row();
alter table public.recruitment_settings enable row level security;
create policy recruitment_settings_select on public.recruitment_settings for select to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage') or app.has_permission(organization_id, 'audit.read'));
-- Writes go through save_candidate_retention (permission check and a readable message).
grant select on public.recruitment_settings to authenticated;
grant all on public.recruitment_settings to service_role;

create function app.seed_org_recruitment_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.recruitment_settings (organization_id) values (new.id) on conflict do nothing;
  return null;
end $$;
create trigger organizations_seed_recruitment_settings after insert on public.organizations
  for each row execute function app.seed_org_recruitment_settings();
insert into public.recruitment_settings (organization_id) select id from public.organizations on conflict do nothing;

create function public.save_candidate_retention(p_org uuid, p_days int) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'recruitment.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_days is null or p_days not between 30 and 3650 then
    raise exception 'Choose between 30 and 3,650 days.' using errcode = '22023';
  end if;
  insert into public.recruitment_settings (organization_id, candidate_retention_days, updated_by)
  values (p_org, p_days, auth.uid())
  on conflict (organization_id) do update
     set candidate_retention_days = excluded.candidate_retention_days, updated_by = excluded.updated_by;
end $$;

-- ─── Who is past their retention period ─────────────────────────────────────

-- Candidates (of one organization, or all when p_org is null) with no open or hired application, and the time
-- after which they are erased. Internal: callers check permissions.
create function app.candidate_erasure_schedule(p_org uuid)
returns table (organization_id uuid, candidate_id uuid, last_activity_at timestamptz, erase_after timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.organization_id, c.id, x.last_activity_at,
         x.last_activity_at + make_interval(days => s.candidate_retention_days)
    from public.candidates c
    join public.recruitment_settings s on s.organization_id = c.organization_id
    cross join lateral (
      select greatest(c.consent_at, max(a.created_at), max(a.stage_changed_at)) as last_activity_at
        from public.applications a where a.candidate_id = c.id
    ) x
   where (p_org is null or c.organization_id = p_org)
     and not exists (select 1 from public.applications a
                      where a.candidate_id = c.id and a.stage in ('applied', 'screening', 'interview', 'offer', 'hired'));
$$;

-- For recruiters: who will be erased within p_days (and anyone already past, awaiting the next daily run).
create function public.candidates_due_for_erasure(p_org uuid, p_days int default 30)
returns table (candidate_id uuid, name text, last_activity_at timestamptz, erase_after timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'recruitment.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select d.candidate_id, concat_ws(' ', c.first_name, c.last_name), d.last_activity_at, d.erase_after
      from app.candidate_erasure_schedule(p_org) d
      join public.candidates c on c.id = d.candidate_id
     where d.erase_after < now() + make_interval(days => least(greatest(coalesce(p_days, 30), 0), 365))
     order by d.erase_after, d.candidate_id
     limit 200;
end $$;

-- ─── Erasure: one code path for recruiters and the worker ───────────────────

-- The body of erase_candidate (migration 20261018000800), unchanged, with the actor passed in (none for the
-- worker, which also records why in the audit metadata).
create function app.erase_candidate_record(p_candidate uuid, p_actor uuid, p_metadata jsonb default '{}') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.candidates where id = p_candidate;
  if v_org is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from public.applications where candidate_id = p_candidate and stage = 'hired') then
    raise exception 'This candidate was hired; their records are kept as an employee’s.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org, p_actor, 'erase', 'candidates', p_candidate, coalesce(p_metadata, '{}'));
  delete from public.candidates where id = p_candidate;  -- applications cascade
end $$;

create or replace function public.erase_candidate(p_candidate uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.candidates where id = p_candidate;
  if v_org is null or not app.has_permission(v_org, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform app.erase_candidate_record(p_candidate, auth.uid());
end $$;

-- Worker (daily): erases candidates past their organization's retention period. Each candidate is locked and
-- re-checked first, so one who applies again while the job runs is kept.
create function public.worker_candidate_retention() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r    record;
  v_n  int := 0;
begin
  for r in select d.candidate_id, d.last_activity_at, s.candidate_retention_days
             from app.candidate_erasure_schedule(null) d
             join public.recruitment_settings s on s.organization_id = d.organization_id
            where d.erase_after <= now()
            order by d.candidate_id loop
    perform 1 from public.candidates where id = r.candidate_id for update skip locked;
    if not found then continue; end if;
    if not exists (select 1 from app.candidate_erasure_schedule(null) d
                    where d.candidate_id = r.candidate_id and d.erase_after <= now()) then
      continue;
    end if;
    perform app.erase_candidate_record(r.candidate_id, null, jsonb_build_object(
      'reason', 'consent_expired', 'retention_days', r.candidate_retention_days, 'last_activity_at', r.last_activity_at));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('erased', v_n);
end $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function app.seed_org_recruitment_settings() from public;
revoke all on function app.candidate_erasure_schedule(uuid) from public, anon, authenticated;
revoke all on function app.erase_candidate_record(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.candidate_erasure_schedule(uuid) to service_role;
grant execute on function app.erase_candidate_record(uuid, uuid, jsonb) to service_role;

revoke all on function public.save_candidate_retention(uuid, int) from public, anon;
revoke all on function public.candidates_due_for_erasure(uuid, int) from public, anon;
revoke all on function public.worker_candidate_retention() from public, anon, authenticated;
grant execute on function public.save_candidate_retention(uuid, int) to authenticated, service_role;
grant execute on function public.candidates_due_for_erasure(uuid, int) to authenticated, service_role;
grant execute on function public.worker_candidate_retention() to service_role;
