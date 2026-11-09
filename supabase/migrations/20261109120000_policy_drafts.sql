-- Policy drafts: policies HR is still writing. Publishing put a policy in front of every employee at once, so there was
-- nowhere to keep one half-written or to start from a template. Drafts live in their own table, which only people who
-- manage policies can read or change; employees, Ask HR's policy search and acknowledgements only ever see
-- policy_documents. Publishing a draft creates the policy (or its next version) and removes the draft.
-- source: 'own' for a draft HR wrote, 'starter' for one added from PeopleCore's starter library.

create table public.policy_drafts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (char_length(title) between 2 and 120),
  body             text not null check (char_length(body) between 10 and 50000),
  source           text not null default 'own' check (source in ('own', 'starter')),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, title),
  unique (organization_id, id)
);

create trigger policy_drafts_audit after insert or update or delete on public.policy_drafts
  for each row execute function app.audit_row('body');

alter table public.policy_drafts enable row level security;
create policy policy_drafts_all on public.policy_drafts for all to authenticated
  using (organization_id in (select app.orgs_with_scope('policy.manage', 'org')))
  with check (organization_id in (select app.orgs_with_scope('policy.manage', 'org')));

grant select, insert, update, delete on public.policy_drafts to authenticated;
grant all on public.policy_drafts to service_role;
