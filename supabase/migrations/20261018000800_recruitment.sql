-- PeopleCore · Recruitment, slice 1: requisitions, candidates, applications and hiring.
--
-- * Requisitions: one per position to fill, with a hiring manager. recruitment.read with team scope sees
--   requisitions whose hiring manager is the caller or someone in the caller's reporting line.
-- * Candidates are deduplicated per organization by email and phone. Adding someone already on file
--   reuses their record. Consent to process their data is recorded when they are added.
-- * Applications move through stages; "hired" is reached only by hire_application, which creates exactly
--   one employee per application (pre_joining for a future joining date) and closes the requisition when
--   all openings are filled.
-- * Erasure: erase_candidate deletes a candidate who was never hired. Their audit entries hold no personal
--   values (those columns are redacted in the audit trail from the start).
-- Offers, interviews and scorecards come in later slices.

create type public.requisition_status as enum ('open', 'on_hold', 'closed');
create type public.application_stage as enum ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn');
create type public.candidate_source as enum ('careers_site', 'referral', 'agency', 'job_board', 'direct', 'other');

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table public.job_requisitions (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations (id) on delete cascade,
  code                       text not null,
  title                      text not null check (char_length(title) between 2 and 120),
  department_id              uuid,
  designation_id             uuid,
  location_id                uuid,
  hiring_manager_employee_id uuid,
  employment_type            public.employment_type not null default 'permanent',
  openings                   smallint not null default 1 check (openings between 1 and 500),
  status                     public.requisition_status not null default 'open',
  description                text check (char_length(description) <= 5000),
  created_by                 uuid default auth.uid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, department_id) references public.departments (organization_id, id),
  foreign key (organization_id, designation_id) references public.designations (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  foreign key (organization_id, hiring_manager_employee_id) references public.employees (organization_id, id)
);
create index job_requisitions_org_status_idx on public.job_requisitions (organization_id, status, created_at desc);

create table public.candidates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  first_name       text not null check (char_length(first_name) between 1 and 100),
  last_name        text check (char_length(last_name) <= 100),
  email            text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            text check (phone ~ '^\+?[0-9]{7,15}$'),
  source           public.candidate_source not null default 'direct',
  current_company  text check (char_length(current_company) <= 120),
  consent_at       timestamptz not null,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  check (email is not null or phone is not null)
);
create unique index candidates_email_uq on public.candidates (organization_id, lower(email)) where email is not null;
create unique index candidates_phone_uq on public.candidates (organization_id, phone) where phone is not null;

create table public.applications (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  requisition_id        uuid not null,
  candidate_id          uuid not null,
  stage                 public.application_stage not null default 'applied',
  stage_changed_at      timestamptz not null default now(),
  outcome_note          text check (char_length(outcome_note) <= 1000),
  converted_employee_id uuid unique,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  unique (requisition_id, candidate_id),
  check ((stage = 'hired') = (converted_employee_id is not null)),
  foreign key (organization_id, requisition_id) references public.job_requisitions (organization_id, id),
  foreign key (organization_id, candidate_id) references public.candidates (organization_id, id) on delete cascade,
  foreign key (organization_id, converted_employee_id) references public.employees (organization_id, id)
);
create index applications_requisition_idx on public.applications (organization_id, requisition_id, stage);
create index applications_candidate_idx on public.applications (organization_id, candidate_id);

create trigger job_requisitions_touch before update on public.job_requisitions for each row execute function app.touch_updated_at();
create trigger candidates_touch before update on public.candidates for each row execute function app.touch_updated_at();
create trigger job_requisitions_audit after insert or update or delete on public.job_requisitions
  for each row execute function app.audit_row();
-- Candidate personal values never enter the audit trail, so erasure leaves nothing behind.
create trigger candidates_audit after insert or update or delete on public.candidates
  for each row execute function app.audit_row('first_name', 'last_name', 'email', 'phone', 'current_company');
create trigger applications_audit after insert or update or delete on public.applications
  for each row execute function app.audit_row('outcome_note');

-- ─── Access ─────────────────────────────────────────────────────────────────

-- Org scope sees every requisition; team scope sees those whose hiring manager is the caller or in their line.
create function app.can_access_requisition(p_org uuid, p_hiring_manager uuid, p_permission text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scopes public.permission_scope[];
begin
  select array_agg(s) into v_scopes from app.permission_scopes(p_org, p_permission) s;
  if v_scopes is null then return false; end if;
  if 'org' = any (v_scopes) then return true; end if;
  if p_hiring_manager is null then return false; end if;
  return ('team' = any (v_scopes) or 'self' = any (v_scopes))
     and (exists (select 1 from public.employees e where e.id = p_hiring_manager and e.organization_id = p_org and e.user_id = auth.uid())
          or ('team' = any (v_scopes) and app.is_in_reporting_line(p_org, p_hiring_manager)));
end $$;

-- A candidate is visible with org-wide recruitment.read, or through an application on a visible requisition.
create function app.can_view_candidate(p_org uuid, p_candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_org, 'recruitment.read')
      or exists (select 1 from public.applications a
                   join public.job_requisitions r on r.id = a.requisition_id
                  where a.organization_id = p_org and a.candidate_id = p_candidate
                    and app.can_access_requisition(p_org, r.hiring_manager_employee_id, 'recruitment.read'));
$$;

alter table public.job_requisitions enable row level security;
alter table public.candidates enable row level security;
alter table public.applications enable row level security;

create policy job_requisitions_select on public.job_requisitions for select to authenticated
  using (app.can_access_requisition(organization_id, hiring_manager_employee_id, 'recruitment.read'));
create policy job_requisitions_insert on public.job_requisitions for insert to authenticated
  with check (app.has_permission(organization_id, 'recruitment.manage'));
create policy job_requisitions_update on public.job_requisitions for update to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage'))
  with check (app.has_permission(organization_id, 'recruitment.manage'));

create policy candidates_select on public.candidates for select to authenticated
  using (app.can_view_candidate(organization_id, id));
create policy candidates_insert on public.candidates for insert to authenticated
  with check (app.has_permission(organization_id, 'recruitment.manage'));
create policy candidates_update on public.candidates for update to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage'))
  with check (app.has_permission(organization_id, 'recruitment.manage'));

create policy applications_select on public.applications for select to authenticated
  using (exists (select 1 from public.job_requisitions r where r.id = requisition_id
                  and app.can_access_requisition(r.organization_id, r.hiring_manager_employee_id, 'recruitment.read')));
create policy applications_insert on public.applications for insert to authenticated
  with check (app.has_permission(organization_id, 'recruitment.manage'));
create policy applications_update on public.applications for update to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage'))
  with check (app.has_permission(organization_id, 'recruitment.manage'));

-- Stage changes go through move_application / hire_application; the table only allows notes otherwise.
create function app.guard_application_stage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage is distinct from old.stage and coalesce(current_setting('app.stage_change', true), '') <> 'on' then
    raise exception 'Change the stage with move_application or hire_application.' using errcode = '22023';
  end if;
  if old.stage = 'hired' and (new.stage is distinct from old.stage or new.converted_employee_id is distinct from old.converted_employee_id) then
    raise exception 'A hire can’t be undone here.' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger applications_stage_guard before update on public.applications
  for each row execute function app.guard_application_stage();

-- ─── RPCs (security invoker: RLS and permission checks apply as the caller) ─

create function public.create_requisition(
  p_org               uuid,
  p_title             text,
  p_openings          smallint default 1,
  p_employment_type   public.employment_type default 'permanent',
  p_department_id     uuid default null,
  p_designation_id    uuid default null,
  p_location_id       uuid default null,
  p_hiring_manager    uuid default null,
  p_description       text default null
) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if not app.has_permission(p_org, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.job_requisitions (organization_id, code, title, openings, employment_type, department_id,
                                       designation_id, location_id, hiring_manager_employee_id, description)
  values (p_org, 'REQ' || lpad(app.next_counter(p_org, 'requisition_code')::text, 5, '0'), btrim(p_title), p_openings,
          p_employment_type, p_department_id, p_designation_id, p_location_id, p_hiring_manager, nullif(btrim(p_description), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Adds a candidate to a requisition, reusing an existing candidate with the same email or phone.
create function public.add_application(
  p_requisition     uuid,
  p_first_name      text,
  p_last_name       text default null,
  p_email           text default null,
  p_phone           text default null,
  p_source          public.candidate_source default 'direct',
  p_current_company text default null,
  p_consent         boolean default false
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_req        public.job_requisitions;
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s\-()]', '', 'g'), '');
  v_by_email   uuid;
  v_by_phone   uuid;
  v_candidate  uuid;
  v_existing   boolean := false;
  v_app        uuid;
begin
  select * into v_req from public.job_requisitions where id = p_requisition;
  if v_req.id is null or not app.has_permission(v_req.organization_id, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_req.status <> 'open' then
    raise exception 'This requisition isn’t open for applications.' using errcode = '22023';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'Enter an email or a phone number for the candidate.' using errcode = '22023';
  end if;

  select id into v_by_email from public.candidates where organization_id = v_req.organization_id and lower(email) = v_email;
  select id into v_by_phone from public.candidates where organization_id = v_req.organization_id and phone = v_phone;
  if v_by_email is not null and v_by_phone is not null and v_by_email <> v_by_phone then
    raise exception 'This email and this phone number belong to two different candidates.' using errcode = '22023';
  end if;
  v_candidate := coalesce(v_by_email, v_by_phone);

  if v_candidate is null then
    if not p_consent then
      raise exception 'Record the candidate’s consent to process their details.' using errcode = '22023';
    end if;
    insert into public.candidates (organization_id, first_name, last_name, email, phone, source, current_company, consent_at)
    values (v_req.organization_id, btrim(p_first_name), nullif(btrim(p_last_name), ''), v_email, v_phone, p_source,
            nullif(btrim(p_current_company), ''), now())
    returning id into v_candidate;
  else
    v_existing := true;
  end if;

  begin
    insert into public.applications (organization_id, requisition_id, candidate_id)
    values (v_req.organization_id, v_req.id, v_candidate)
    returning id into v_app;
  exception when unique_violation then
    raise exception 'This candidate has already applied for this requisition.' using errcode = '22023';
  end;
  return jsonb_build_object('application_id', v_app, 'candidate_id', v_candidate, 'existing_candidate', v_existing);
end $$;

-- Moves an application between stages. Hiring has its own function.
create function public.move_application(p_application uuid, p_stage public.application_stage, p_note text default null)
returns void
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_app public.applications;
begin
  select * into v_app from public.applications where id = p_application for update;
  if v_app.id is null or not app.has_permission(v_app.organization_id, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_stage = 'hired' then
    raise exception 'Use Hire to hire a candidate.' using errcode = '22023';
  end if;
  if v_app.stage = 'hired' then
    raise exception 'This candidate has already been hired.' using errcode = '22023';
  end if;
  perform set_config('app.stage_change', 'on', true);
  update public.applications
     set stage = p_stage, stage_changed_at = now(), outcome_note = coalesce(nullif(btrim(p_note), ''), outcome_note)
   where id = p_application;
  perform set_config('app.stage_change', 'off', true);
end $$;

-- Hires the candidate: creates the employee (once), marks the application hired, closes a filled requisition.
create function public.hire_application(
  p_application     uuid,
  p_date_of_joining date,
  p_work_email      text default null,
  p_employee_code   text default null,
  p_employment_type public.employment_type default null
) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_app       public.applications;
  v_req       public.job_requisitions;
  v_candidate public.candidates;
  v_employee  uuid;
  v_hired     int;
begin
  select * into v_app from public.applications where id = p_application for update;
  if v_app.id is null or not app.has_permission(v_app.organization_id, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_app.stage = 'hired' then
    raise exception 'This candidate has already been hired.' using errcode = '22023';
  end if;
  if v_app.stage <> 'offer' then
    raise exception 'Move the candidate to Offer before hiring.' using errcode = '22023';
  end if;
  select * into v_req from public.job_requisitions where id = v_app.requisition_id for update;
  if v_req.status <> 'open' then
    raise exception 'This requisition isn’t open.' using errcode = '22023';
  end if;
  select * into v_candidate from public.candidates where id = v_app.candidate_id;

  -- create_employee checks employee.create as the caller.
  v_employee := public.create_employee(
    p_organization_id     => v_app.organization_id,
    p_first_name          => v_candidate.first_name,
    p_employment_type     => coalesce(p_employment_type, v_req.employment_type),
    p_date_of_joining     => p_date_of_joining,
    p_employee_code       => p_employee_code,
    p_last_name           => v_candidate.last_name,
    p_work_email          => p_work_email,
    p_department_id       => v_req.department_id,
    p_designation_id      => v_req.designation_id,
    p_location_id         => v_req.location_id,
    p_manager_employee_id => v_req.hiring_manager_employee_id
  );

  perform set_config('app.stage_change', 'on', true);
  update public.applications set stage = 'hired', stage_changed_at = now(), converted_employee_id = v_employee where id = v_app.id;
  perform set_config('app.stage_change', 'off', true);

  select count(*) into v_hired from public.applications where requisition_id = v_req.id and stage = 'hired';
  if v_hired >= v_req.openings then
    update public.job_requisitions set status = 'closed' where id = v_req.id;
  end if;
  return v_employee;
end $$;

-- Deletes a candidate who was never hired, with their applications. Hired candidates are employees and
-- follow employee retention instead.
create function public.erase_candidate(p_candidate uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.candidates where id = p_candidate;
  if v_org is null or not app.has_permission(v_org, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.applications where candidate_id = p_candidate and stage = 'hired') then
    raise exception 'This candidate was hired; their records are kept as an employee’s.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id)
  values (v_org, auth.uid(), 'erase', 'candidates', p_candidate);
  delete from public.candidates where id = p_candidate;  -- applications cascade
end $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

grant select, insert, update on public.job_requisitions, public.candidates, public.applications to authenticated;
grant all on public.job_requisitions, public.candidates, public.applications to service_role;

revoke all on function app.can_access_requisition(uuid, uuid, text) from public;
revoke all on function app.can_view_candidate(uuid, uuid) from public;
revoke all on function app.guard_application_stage() from public;
grant execute on function app.can_access_requisition(uuid, uuid, text) to authenticated, service_role;
grant execute on function app.can_view_candidate(uuid, uuid) to authenticated, service_role;

revoke all on function public.create_requisition(uuid, text, smallint, public.employment_type, uuid, uuid, uuid, uuid, text) from public, anon;
revoke all on function public.add_application(uuid, text, text, text, text, public.candidate_source, text, boolean) from public, anon;
revoke all on function public.move_application(uuid, public.application_stage, text) from public, anon;
revoke all on function public.hire_application(uuid, date, text, text, public.employment_type) from public, anon;
revoke all on function public.erase_candidate(uuid) from public, anon;
grant execute on function public.create_requisition(uuid, text, smallint, public.employment_type, uuid, uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.add_application(uuid, text, text, text, text, public.candidate_source, text, boolean) to authenticated, service_role;
grant execute on function public.move_application(uuid, public.application_stage, text) to authenticated, service_role;
grant execute on function public.hire_application(uuid, date, text, text, public.employment_type) to authenticated, service_role;
grant execute on function public.erase_candidate(uuid) to authenticated, service_role;
