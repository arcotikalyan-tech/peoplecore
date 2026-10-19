-- PeopleCore · Company onboarding (Kredily's Onboarding: hub, company, activation, guided plan, journeys).
--
-- The guided implementation plan is a fixed list of steps in the app (six weeks, from company setup to go-live);
-- this table records which steps the organization has marked done, by whom, and an optional note. Steps the app
-- can verify from live data (e.g. employees imported) are shown done automatically; the rest are marked by hand.
-- Kept by org.manage or onboarding.manage; every member may read progress.

create table public.org_setup_steps (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  step_key         text not null check (step_key ~ '^[a-z_]{3,40}$'),
  done_at          timestamptz not null default now(),
  done_by          uuid default auth.uid(),
  note             text check (char_length(note) <= 300),
  primary key (organization_id, step_key)
);
create trigger org_setup_steps_audit after insert or update or delete on public.org_setup_steps for each row execute function app.audit_row();

alter table public.org_setup_steps enable row level security;
create policy org_setup_steps_select on public.org_setup_steps for select to authenticated using (app.is_member(organization_id));
create policy org_setup_steps_write on public.org_setup_steps for all to authenticated
  using (app.has_permission(organization_id, 'org.manage') or app.has_permission(organization_id, 'onboarding.manage'))
  with check (app.has_permission(organization_id, 'org.manage') or app.has_permission(organization_id, 'onboarding.manage'));
grant select, insert, update, delete on public.org_setup_steps to authenticated;
grant all on public.org_setup_steps to service_role;
