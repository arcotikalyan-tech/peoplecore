-- AI foundation (ADR-009, docs/06-ai-architecture.md).
--
-- * AI assistants are off until the owner turns them on (ai_settings.enabled). Every run passes a gate here first:
--   the caller holds ai.use (and the agent's own module permission, if it has one), AI is on for the organization,
--   the caller is under the hourly request limit and the organization under its monthly token budget. The gate
--   opens an ai_runs row; the server closes it with the model, token counts and latency.
-- * The prompt (after redaction; files are summarised, never stored) and the model's output are kept for 30 days
--   for debugging. They are not readable through the API (no column privilege), and the worker clears them after
--   30 days; the metrics stay.
-- * ai_suggestions hold drafts and extracted fields (status proposed) for the person who asked, until they accept,
--   edit or reject them. Accepting never writes a record: the person submits the module's normal form, which goes
--   through the same validation, RLS, approvals and audit as typing it in.
-- * search_knowledge: full-text search over the published knowledge base and current policies. It runs as the
--   caller (security invoker), so an assistant only ever reads what the caller could read.

insert into public.permissions (key, module, description, is_sensitive) values
  ('ai.manage', 'ai', 'Turn AI assistants on or off and see AI usage', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values ('owner', 'ai.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'ai.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Settings ───────────────────────────────────────────────────────────────

create table public.ai_settings (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null unique references public.organizations (id) on delete cascade,
  enabled                boolean not null default false,
  monthly_token_budget   integer not null default 2000000 check (monthly_token_budget between 1000 and 1000000000),
  hourly_limit_per_user  integer not null default 30 check (hourly_limit_per_user between 1 and 1000),
  updated_by             uuid,
  updated_at             timestamptz not null default now()
);
create trigger ai_settings_touch before update on public.ai_settings for each row execute function app.touch_updated_at();
create trigger ai_settings_audit after insert or update on public.ai_settings for each row execute function app.audit_row();

alter table public.ai_settings enable row level security;
-- Everyone in the organization may know whether AI is on (the UI shows or hides the assistants).
create policy ai_settings_select on public.ai_settings for select to authenticated using (app.is_member(organization_id));
grant select on public.ai_settings to authenticated;
grant all on public.ai_settings to service_role;

create function public.save_ai_settings(p_org uuid, p_enabled boolean, p_monthly_token_budget int, p_hourly_limit int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'ai.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_monthly_token_budget is null or p_monthly_token_budget not between 1000 and 1000000000 then
    raise exception 'Choose a monthly budget between 1,000 and 1,000,000,000 tokens.' using errcode = '22023';
  end if;
  if p_hourly_limit is null or p_hourly_limit not between 1 and 1000 then
    raise exception 'Choose an hourly limit between 1 and 1,000 requests.' using errcode = '22023';
  end if;
  insert into public.ai_settings (organization_id, enabled, monthly_token_budget, hourly_limit_per_user, updated_by)
  values (p_org, coalesce(p_enabled, false), p_monthly_token_budget, p_hourly_limit, auth.uid())
  on conflict (organization_id) do update
     set enabled = excluded.enabled, monthly_token_budget = excluded.monthly_token_budget,
         hourly_limit_per_user = excluded.hourly_limit_per_user, updated_by = excluded.updated_by;
end $$;
revoke all on function public.save_ai_settings(uuid, boolean, int, int) from public, anon;
grant execute on function public.save_ai_settings(uuid, boolean, int, int) to authenticated;

-- ─── Runs ───────────────────────────────────────────────────────────────────

create table public.ai_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null,
  agent            text not null check (agent ~ '^[a-z][a-z0-9_]{1,40}$'),
  status           text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  model            text check (char_length(model) <= 80),
  prompt_version   text check (char_length(prompt_version) <= 80),
  input_tokens     integer not null default 0 check (input_tokens >= 0),
  output_tokens    integer not null default 0 check (output_tokens >= 0),
  latency_ms       integer check (latency_ms >= 0),
  redactions       jsonb not null default '{}'::jsonb,
  request          jsonb,  -- redacted prompt; service role only; cleared after 30 days
  response         jsonb,  -- model output; service role only; cleared after 30 days
  error            text check (char_length(error) <= 500),
  helpful          boolean,
  feedback         text check (char_length(feedback) <= 1000),
  created_at       timestamptz not null default now(),
  finished_at      timestamptz,
  unique (organization_id, id)
);
create index ai_runs_org_created_idx on public.ai_runs (organization_id, created_at desc);
create index ai_runs_user_created_idx on public.ai_runs (user_id, created_at desc);

alter table public.ai_runs enable row level security;
create policy ai_runs_select on public.ai_runs for select to authenticated
  using (user_id = auth.uid() or app.has_permission(organization_id, 'ai.manage'));
-- The prompt and output are deliberately not granted.
grant select (id, organization_id, user_id, agent, status, model, prompt_version, input_tokens, output_tokens, latency_ms,
              redactions, error, helpful, feedback, created_at, finished_at) on public.ai_runs to authenticated;
grant all on public.ai_runs to service_role;

-- The gate. Raises a user-facing message (22023) when AI can't be used right now.
create function public.ai_begin_run(p_org uuid, p_agent text, p_permission text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_set   public.ai_settings;
  v_tz    text;
  v_used  bigint;
  v_id    uuid;
begin
  if auth.uid() is null or not app.has_permission(p_org, 'ai.use') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_permission is not null and not exists (select 1 from app.permission_scopes(p_org, p_permission)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_set from public.ai_settings where organization_id = p_org;
  if v_set.id is null or not v_set.enabled then
    raise exception 'AI assistants are turned off for this organization.' using errcode = '22023';
  end if;
  -- Serialise the limit checks per organization so concurrent requests can't all slip under them.
  perform pg_advisory_xact_lock(hashtextextended('ai_runs:' || p_org::text, 0));
  if (select count(*) from public.ai_runs
       where organization_id = p_org and user_id = auth.uid() and created_at > now() - interval '1 hour') >= v_set.hourly_limit_per_user then
    raise exception 'You’ve reached the hourly limit for AI requests. Try again later.' using errcode = '22023';
  end if;
  select timezone into v_tz from public.organizations where id = p_org;
  select coalesce(sum(input_tokens + output_tokens), 0) into v_used
    from public.ai_runs
   where organization_id = p_org
     and created_at >= (date_trunc('month', now() at time zone coalesce(v_tz, 'Asia/Kolkata')) at time zone coalesce(v_tz, 'Asia/Kolkata'));
  if v_used >= v_set.monthly_token_budget then
    raise exception 'This organization has used its AI allowance for the month.' using errcode = '22023';
  end if;
  insert into public.ai_runs (organization_id, user_id, agent) values (p_org, auth.uid(), p_agent) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ai_begin_run(uuid, text, text) from public, anon;
grant execute on function public.ai_begin_run(uuid, text, text) to authenticated;

-- Closes the caller's own open run, once.
create function public.ai_finish_run(
  p_run uuid, p_status text, p_model text, p_prompt_version text, p_input_tokens int, p_output_tokens int, p_latency_ms int,
  p_redactions jsonb, p_request jsonb, p_response jsonb, p_error text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('succeeded', 'failed') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.ai_runs
     set status = p_status, model = left(p_model, 80), prompt_version = left(p_prompt_version, 80),
         input_tokens = greatest(coalesce(p_input_tokens, 0), 0), output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
         latency_ms = greatest(p_latency_ms, 0), redactions = coalesce(p_redactions, '{}'::jsonb),
         request = p_request, response = p_response, error = left(p_error, 500), finished_at = now()
   where id = p_run and user_id = auth.uid() and status = 'running';
  if not found then raise exception 'not authorized' using errcode = '42501'; end if;
end $$;
revoke all on function public.ai_finish_run(uuid, text, text, text, int, int, int, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.ai_finish_run(uuid, text, text, text, int, int, int, jsonb, jsonb, jsonb, text) to authenticated;

create function public.rate_ai_run(p_run uuid, p_helpful boolean, p_feedback text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_runs set helpful = p_helpful, feedback = nullif(left(trim(p_feedback), 1000), '')
   where id = p_run and user_id = auth.uid() and status = 'succeeded';
  if not found then raise exception 'not authorized' using errcode = '42501'; end if;
end $$;
revoke all on function public.rate_ai_run(uuid, boolean, text) from public, anon;
grant execute on function public.rate_ai_run(uuid, boolean, text) to authenticated;

-- This month's use, for the people who manage AI.
create function public.ai_usage(p_org uuid)
returns table (agent text, runs bigint, failed bigint, tokens bigint, helpful bigint, not_helpful bigint, users bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text;
begin
  if not app.has_permission(p_org, 'ai.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from public.organizations where id = p_org;
  return query
  select r.agent, count(*), count(*) filter (where r.status = 'failed'), coalesce(sum(r.input_tokens + r.output_tokens), 0)::bigint,
         count(*) filter (where r.helpful), count(*) filter (where r.helpful = false), count(distinct r.user_id)
    from public.ai_runs r
   where r.organization_id = p_org
     and r.created_at >= (date_trunc('month', now() at time zone v_tz) at time zone v_tz)
   group by r.agent order by r.agent;
end $$;
revoke all on function public.ai_usage(uuid) from public, anon;
grant execute on function public.ai_usage(uuid) to authenticated;

-- ─── Suggestions ────────────────────────────────────────────────────────────

create table public.ai_suggestions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  run_id           uuid not null,
  user_id          uuid not null,
  agent            text not null,
  subject_kind     text not null check (subject_kind ~ '^[a-z][a-z_]{1,40}$'),
  subject_id       uuid,
  payload          jsonb not null,
  status           text not null default 'proposed' check (status in ('proposed', 'accepted', 'edited', 'rejected')),
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, run_id) references public.ai_runs (organization_id, id) on delete cascade
);
create index ai_suggestions_user_idx on public.ai_suggestions (user_id, created_at desc);

alter table public.ai_suggestions enable row level security;
-- Only the person who asked sees a suggestion; it can hold extracted personal data (a resume, a receipt).
create policy ai_suggestions_select on public.ai_suggestions for select to authenticated using (user_id = auth.uid());
grant select on public.ai_suggestions to authenticated;
grant all on public.ai_suggestions to service_role;

create function public.ai_save_suggestion(p_run uuid, p_subject_kind text, p_subject_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.ai_runs;
  v_id  uuid;
begin
  select * into v_run from public.ai_runs where id = p_run and user_id = auth.uid() and status = 'succeeded';
  if v_run.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.ai_suggestions (organization_id, run_id, user_id, agent, subject_kind, subject_id, payload)
  values (v_run.organization_id, p_run, auth.uid(), v_run.agent, p_subject_kind, p_subject_id, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ai_save_suggestion(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.ai_save_suggestion(uuid, text, uuid, jsonb) to authenticated;

-- Records what the person did with a suggestion. 'accepted' or 'edited' only after the module's own form saved the record.
create function public.decide_ai_suggestion(p_suggestion uuid, p_status text, p_subject_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('accepted', 'edited', 'rejected') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.ai_suggestions
     set status = p_status, decided_at = now(), subject_id = coalesce(p_subject_id, subject_id)
   where id = p_suggestion and user_id = auth.uid() and status = 'proposed';
  if not found then raise exception 'This suggestion was already used or dismissed.' using errcode = '22023'; end if;
end $$;
revoke all on function public.decide_ai_suggestion(uuid, text, uuid) from public, anon;
grant execute on function public.decide_ai_suggestion(uuid, text, uuid) to authenticated;

-- ─── Knowledge search (runs as the caller) ──────────────────────────────────

-- Words of three or more letters, minus common English endings and cut to six characters as a crude stem
-- ("leaves" → "leav:*", "holidays" → "holida:*"), OR-ed together. packages/ai (searchTerms) mirrors it.
create function app.ai_tsquery(p_text text) returns tsquery
language sql immutable set search_path = '' as $$
  select case when count(*) = 0 then null
              else to_tsquery('simple', string_agg(distinct s || ':*', ' | ')) end
    from (select left(regexp_replace(w, '(ies|es|s|ing|ed)$', ''), 6) as s
            from (select t.m[1] as w from regexp_matches(lower(coalesce(p_text, '')), '([a-z0-9]{3,})', 'g') as t(m)) words
           where w not in ('the', 'and', 'for', 'are', 'how', 'what', 'when', 'can', 'does', 'with', 'that', 'this', 'have',
                           'from', 'you', 'your', 'our', 'who', 'why', 'will', 'about', 'many', 'much', 'there', 'which',
                           'into', 'any', 'all', 'get', 'was', 'were', 'been', 'its', 'not', 'but', 'may', 'should', 'would',
                           'could', 'per', 'his', 'her', 'they', 'them', 'their', 'she', 'him', 'tell', 'please', 'need',
                           'want', 'know', 'like', 'some', 'than', 'then', 'also', 'just', 'here', 'where', 'did')) stems
   where length(s) >= 3;
$$;
revoke all on function app.ai_tsquery(text) from public;
grant execute on function app.ai_tsquery(text) to authenticated;

create function public.search_knowledge(p_org uuid, p_query text, p_limit int default 6)
returns table (source_kind text, source_id uuid, title text, body text, updated_at timestamptz, rank real)
language sql stable security invoker set search_path = '' as $$
  with q as (select app.ai_tsquery(p_query) as q),
  policies as (
    select distinct on (p.title) p.id, p.title, p.version, p.body, p.published_at
      from public.policy_documents p
     where p.organization_id = p_org and p.retired_at is null and p.published_at <= now()
     order by p.title, p.version desc
  ),
  hits as (
    select 'article'::text as source_kind, a.id as source_id, a.title, a.body, a.updated_at, ts_rank(a.search, q.q) as rank
      from public.kb_articles a, q
     where q.q is not null and a.organization_id = p_org and a.published and a.search @@ q.q
    union all
    select 'policy', p.id, p.title, p.body, p.published_at, ts_rank(to_tsvector('simple', p.title || ' ' || p.body), q.q)
      from policies p, q
     where q.q is not null and to_tsvector('simple', p.title || ' ' || p.body) @@ q.q
  )
  select * from hits order by rank desc, updated_at desc limit least(greatest(coalesce(p_limit, 6), 1), 10);
$$;
revoke all on function public.search_knowledge(uuid, text, int) from public, anon;
grant execute on function public.search_knowledge(uuid, text, int) to authenticated;

-- ─── Retention (worker) ─────────────────────────────────────────────────────

create function public.worker_ai_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_runs int;
  v_suggestions int;
begin
  update public.ai_runs set request = null, response = null
   where created_at < now() - interval '30 days' and (request is not null or response is not null);
  get diagnostics v_runs = row_count;
  delete from public.ai_suggestions where created_at < now() - interval '30 days';
  get diagnostics v_suggestions = row_count;
  -- A run that never finished (the server crashed mid-call) is closed so it stops counting as open.
  update public.ai_runs set status = 'failed', error = 'Did not finish', finished_at = now()
   where status = 'running' and created_at < now() - interval '1 hour';
  return jsonb_build_object('runs_cleared', v_runs, 'suggestions_deleted', v_suggestions);
end $$;
revoke all on function public.worker_ai_retention() from public, anon, authenticated;
grant execute on function public.worker_ai_retention() to service_role;
