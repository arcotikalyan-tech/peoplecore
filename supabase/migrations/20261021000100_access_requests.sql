-- PeopleCore · "Sign up" on the public website: a company asks for access; a platform admin reviews the request
-- and creates the organization (public self-sign-up stays off).
--
-- Public use case for `anon` (reviewed): the website's sign-up form calls request_access. The function only inserts
-- a request (validated lengths, one open request per work email); nobody but platform admins can read requests, and
-- the table itself is not granted to anon or authenticated.

create table public.access_requests (
  id            uuid primary key default gen_random_uuid(),
  company       text not null check (char_length(company) between 2 and 120),
  contact_name  text not null check (char_length(contact_name) between 2 and 120),
  work_email    text not null check (work_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(work_email) <= 254),
  phone         text check (char_length(phone) <= 30),
  headcount     text check (headcount in ('1-25', '26-100', '101-500', '501-2000', '2000+')),
  message       text check (char_length(message) <= 1000),
  status        text not null default 'new' check (status in ('new', 'contacted', 'onboarded', 'declined')),
  created_at    timestamptz not null default now(),
  reviewed_by   uuid,
  reviewed_at   timestamptz
);
create unique index access_requests_open_email_uq on public.access_requests (lower(work_email)) where status in ('new', 'contacted');

alter table public.access_requests enable row level security;
create policy access_requests_select on public.access_requests for select to authenticated using (app.is_platform_admin());
create policy access_requests_update on public.access_requests for update to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
grant select, update (status, reviewed_by, reviewed_at) on public.access_requests to authenticated;
grant all on public.access_requests to service_role;

create function public.request_access(p_company text, p_name text, p_email text, p_phone text default null, p_headcount text default null, p_message text default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if char_length(trim(coalesce(p_company, ''))) < 2 then raise exception 'Enter your company name.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your name.' using errcode = '22023'; end if;
  if trim(coalesce(p_email, '')) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid work email.' using errcode = '22023'; end if;
  -- An open request for the same email is not an error the visitor needs to see (and must not reveal anything).
  insert into public.access_requests (company, contact_name, work_email, phone, headcount, message)
  values (left(trim(p_company), 120), left(trim(p_name), 120), lower(trim(p_email)), left(nullif(trim(p_phone), ''), 30),
          nullif(p_headcount, ''), left(nullif(trim(p_message), ''), 1000))
  on conflict do nothing;
end $$;
revoke all on function public.request_access(text, text, text, text, text, text) from public;
grant execute on function public.request_access(text, text, text, text, text, text) to anon, authenticated;
