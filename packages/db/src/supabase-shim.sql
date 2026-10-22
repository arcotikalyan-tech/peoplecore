-- TEST ONLY. Reproduces the parts of a Supabase database that migrations depend on, so they can run
-- on PGlite (ADR-005). Never apply this to a real Supabase project.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema extensions;
create schema auth;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,          -- empty until the person sets a password (as in Supabase)
  invited_at         timestamptz,
  last_sign_in_at    timestamptz,
  created_at         timestamptz not null default now()
);

-- Same resolution order as Supabase's auth.uid().
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- Same as Supabase's auth.jwt(): the request's JWT claims (carries 'aal').
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
-- Deliberately NO default table/sequence privileges (Supabase projects may auto-grant them; ours must not
-- depend on that). Migrations grant explicitly, and the tests prove those grants are sufficient.

-- Storage: just the bucket catalogue (columns migrations set). Objects live outside Postgres in tests.
create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null unique,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
-- Stored files, as far as the database sees them (Supabase keeps the bytes elsewhere): which bucket and path, and when.
create table storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text,
  owner       uuid,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  metadata    jsonb
);
