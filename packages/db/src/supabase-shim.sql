-- TEST ONLY. Reproduces the parts of a Supabase database that migrations depend on, so they can run
-- on PGlite (ADR-005). Never apply this to a real Supabase project.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema extensions;
create schema auth;
create table auth.users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique,
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now()
);

-- Same resolution order as Supabase's auth.uid().
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Deliberately NO default table/sequence privileges (Supabase projects may auto-grant them; ours must not
-- depend on that). Migrations grant explicitly, and the tests prove those grants are sufficient.
