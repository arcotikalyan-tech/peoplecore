-- PeopleCore · Recruitment slice 2: offers with approval, interviews and scorecards, and a public careers page.
--
-- Offers: one per application, with immutable versions. A recruiter prepares a version and submits it; someone
--   else with recruitment.offer.approve approves it through the approvals engine (maker ≠ checker). Approved
--   offers are sent, then the candidate's answer is recorded. Hiring now REQUIRES an accepted offer and takes
--   the joining date and designation from it, so the hire journey is requisition → offer accepted → employee.
-- Interviews: scheduled rounds with panelists (employees). Panelists get a task and see only what they need
--   (name, role, round; no contact details), and submit one scorecard each, rated per criterion. They see
--   other panelists' scorecards only after submitting their own (independent judgement).
-- Careers page: the FIRST anonymous access in PeopleCore. Reviewed public use case (see 07-threat-model T17):
--   anon can call exactly two functions: list a published organization's open, published requisitions
--   (public fields only) and submit an application with consent. No table is granted to anon. Submissions
--   are throttled per email and per requisition, never reveal whether a person is already a candidate, and
--   never overwrite an existing candidate's details.

-- ─── Permission ─────────────────────────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('recruitment.offer.approve', 'recruitment', 'Approve job offers', true);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'recruitment.offer.approve', 'org'), ('hr_admin', 'recruitment.offer.approve', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'recruitment.offer.approve'
on conflict (role_id, permission_key) do nothing;

-- ─── Offers ─────────────────────────────────────────────────────────────────

-- Tenant-safe composite references to applications (organization_id, id).
alter table public.applications add unique (organization_id, id);

create type public.offer_status as enum ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined', 'withdrawn');

create table public.offers (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  application_id       uuid not null unique,
  status               public.offer_status not null default 'draft',
  current_version      int not null default 1,
  approval_request_id  uuid,
  responded_at         timestamptz,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, application_id) references public.applications (organization_id, id) on delete cascade
);

create table public.offer_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  offer_id         uuid not null,
  version          int not null check (version >= 1),
  annual_ctc       numeric(14,2) not null check (annual_ctc > 0 and annual_ctc < 1000000000),
  currency         char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  joining_date     date not null,
  expires_on       date not null,
  designation_id   uuid,
  terms            text check (char_length(terms) <= 5000),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (offer_id, version),
  check (expires_on >= created_at::date),
  foreign key (organization_id, offer_id) references public.offers (organization_id, id) on delete cascade,
  foreign key (organization_id, designation_id) references public.designations (organization_id, id)
);

create trigger offers_touch before update on public.offers for each row execute function app.touch_updated_at();
create trigger offers_audit after insert or update on public.offers for each row execute function app.audit_row();
-- Compensation is sensitive: the amount is redacted in the audit trail.
create trigger offer_versions_audit after insert on public.offer_versions for each row execute function app.audit_row('annual_ctc', 'terms');

-- ─── Interviews and scorecards ──────────────────────────────────────────────

create type public.interview_mode as enum ('in_person', 'video', 'phone');
create type public.interview_status as enum ('scheduled', 'completed', 'cancelled');
create type public.recommendation as enum ('strong_yes', 'yes', 'no', 'strong_no');

create table public.interviews (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  application_id    uuid not null,
  round_name        text not null check (char_length(round_name) between 2 and 80),
  scheduled_at      timestamptz not null,
  duration_minutes  smallint not null default 60 check (duration_minutes between 15 and 480),
  mode              public.interview_mode not null default 'video',
  location          text check (char_length(location) <= 300),
  status            public.interview_status not null default 'scheduled',
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, application_id) references public.applications (organization_id, id) on delete cascade
);

create table public.interview_panelists (
  organization_id  uuid not null,
  interview_id     uuid not null,
  employee_id      uuid not null,
  primary key (interview_id, employee_id),
  unique (organization_id, interview_id, employee_id),
  foreign key (organization_id, interview_id) references public.interviews (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

create table public.scorecards (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  interview_id          uuid not null,
  panelist_employee_id  uuid not null,
  recommendation        public.recommendation not null,
  summary               text not null check (char_length(summary) between 3 and 3000),
  submitted_at          timestamptz not null default now(),
  unique (interview_id, panelist_employee_id),
  unique (organization_id, id),
  foreign key (organization_id, interview_id, panelist_employee_id)
    references public.interview_panelists (organization_id, interview_id, employee_id) on delete cascade
);

create table public.scorecard_ratings (
  organization_id  uuid not null,
  scorecard_id     uuid not null,
  criterion        text not null check (char_length(criterion) between 2 and 80),
  rating           smallint not null check (rating between 1 and 5),
  primary key (scorecard_id, criterion),
  foreign key (organization_id, scorecard_id) references public.scorecards (organization_id, id) on delete cascade
);

create trigger interviews_audit after insert or update on public.interviews for each row execute function app.audit_row();
create trigger scorecards_audit after insert on public.scorecards for each row execute function app.audit_row('summary');

-- ─── Publishing requisitions ────────────────────────────────────────────────

alter table public.job_requisitions add column is_published boolean not null default false;

-- ─── Access ─────────────────────────────────────────────────────────────────

-- Is the caller a panelist on this interview?
create function app.is_panelist(p_interview uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.interview_panelists p join public.employees e on e.id = p.employee_id
                  where p.interview_id = p_interview and e.user_id = auth.uid() and app.is_member(e.organization_id));
$$;

-- Recruitment visibility of an application (org-wide, or team via the requisition's hiring manager).
create function app.can_read_application(p_application uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.applications a join public.job_requisitions r on r.id = a.requisition_id
                  where a.id = p_application and app.can_access_requisition(r.organization_id, r.hiring_manager_employee_id, 'recruitment.read'));
$$;

alter table public.offers enable row level security;
alter table public.offer_versions enable row level security;
alter table public.interviews enable row level security;
alter table public.interview_panelists enable row level security;
alter table public.scorecards enable row level security;
alter table public.scorecard_ratings enable row level security;

create policy offers_select on public.offers for select to authenticated
  using (app.can_read_application(application_id) or (approval_request_id is not null and app.can_view_approval(approval_request_id)));
create policy offer_versions_select on public.offer_versions for select to authenticated
  using (exists (select 1 from public.offers o where o.id = offer_id
                  and (app.can_read_application(o.application_id) or (o.approval_request_id is not null and app.can_view_approval(o.approval_request_id)))));
create policy interviews_select on public.interviews for select to authenticated
  using (app.can_read_application(application_id) or app.is_panelist(id));
create policy interview_panelists_select on public.interview_panelists for select to authenticated
  using (exists (select 1 from public.interviews i where i.id = interview_id and (app.can_read_application(i.application_id) or app.is_panelist(i.id))));
-- Scorecards: recruiters and the hiring line see them; a panelist sees their own, and others' only after
-- submitting their own.
create function app.can_view_scorecard(p_scorecard uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s  public.scorecards;
  v_me uuid;
begin
  select * into v_s from public.scorecards where id = p_scorecard;
  if v_s.id is null or not app.is_member(v_s.organization_id) then return false; end if;
  select e.id into v_me from public.employees e where e.organization_id = v_s.organization_id and e.user_id = auth.uid();
  if v_me is not null and v_me = v_s.panelist_employee_id then return true; end if;
  if app.is_panelist(v_s.interview_id) then
    return exists (select 1 from public.scorecards mine where mine.interview_id = v_s.interview_id and mine.panelist_employee_id = v_me);
  end if;
  return app.can_read_application((select i.application_id from public.interviews i where i.id = v_s.interview_id));
end $$;
create policy scorecards_select on public.scorecards for select to authenticated using (app.can_view_scorecard(id));
create policy scorecard_ratings_select on public.scorecard_ratings for select to authenticated using (app.can_view_scorecard(scorecard_id));

grant select on public.offers, public.offer_versions, public.interviews, public.interview_panelists, public.scorecards, public.scorecard_ratings to authenticated;
grant all on public.offers, public.offer_versions, public.interviews, public.interview_panelists, public.scorecards, public.scorecard_ratings to service_role;

-- ─── Offer functions ────────────────────────────────────────────────────────

create function app.offer_or_deny(p_offer uuid) returns public.offers
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.offers;
begin
  select * into v from public.offers where id = p_offer;
  if v.id is null or not app.has_permission(v.organization_id, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return v;
end $$;

-- Creates the offer (version 1), or adds a new version to a draft/approved/declined offer (back to draft).
create function public.save_offer_version(
  p_application  uuid,
  p_annual_ctc   numeric,
  p_joining_date date,
  p_expires_on   date,
  p_designation  uuid default null,
  p_terms        text default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_app   public.applications;
  v_offer public.offers;
  v_next  int;
begin
  select * into v_app from public.applications where id = p_application;
  if v_app.id is null or not app.has_permission(v_app.organization_id, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_app.stage in ('hired', 'rejected', 'withdrawn') then
    raise exception 'This application is closed.' using errcode = '22023';
  end if;
  if p_joining_date < app.org_today(v_app.organization_id) then
    raise exception 'The joining date can’t be in the past.' using errcode = '22023';
  end if;
  if p_expires_on < app.org_today(v_app.organization_id) then
    raise exception 'The offer can’t expire in the past.' using errcode = '22023';
  end if;
  select * into v_offer from public.offers where application_id = p_application for update;
  if v_offer.id is null then
    insert into public.offers (organization_id, application_id) values (v_app.organization_id, p_application) returning * into v_offer;
    v_next := 1;
  else
    if v_offer.status in ('pending_approval', 'sent', 'accepted') then
      raise exception 'An offer that is % can’t be changed. %', replace(v_offer.status::text, '_', ' '),
        case v_offer.status when 'pending_approval' then 'Withdraw it from approval first.' else 'Withdraw it first.' end
        using errcode = '22023';
    end if;
    v_next := v_offer.current_version + 1;
    update public.offers set current_version = v_next, status = 'draft', responded_at = null where id = v_offer.id;
  end if;
  insert into public.offer_versions (organization_id, offer_id, version, annual_ctc, joining_date, expires_on, designation_id, terms)
  values (v_app.organization_id, v_offer.id, v_next, p_annual_ctc, p_joining_date, p_expires_on, p_designation, nullif(btrim(p_terms), ''));
  -- An offer moves the application to the Offer stage.
  perform set_config('app.stage_change', 'on', true);
  update public.applications set stage = 'offer', stage_changed_at = now() where id = p_application and stage <> 'offer';
  perform set_config('app.stage_change', 'off', true);
  return v_offer.id;
end $$;

create function public.submit_offer(p_offer uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_offer public.offers := app.offer_or_deny(p_offer);
  v_name  text;
  v_title text;
  v_req   uuid;
begin
  if v_offer.status <> 'draft' then
    raise exception 'Only a draft offer can be submitted for approval.' using errcode = '22023';
  end if;
  select trim(concat_ws(' ', c.first_name, c.last_name)), r.title into v_name, v_title
    from public.applications a join public.candidates c on c.id = a.candidate_id join public.job_requisitions r on r.id = a.requisition_id
   where a.id = v_offer.application_id;
  v_req := app.request_approval(v_offer.organization_id, 'offer', v_offer.id, null,
    format('Offer for %s (%s), version %s', v_name, v_title, v_offer.current_version), '/recruitment');
  update public.offers set status = 'pending_approval', approval_request_id = v_req where id = v_offer.id;
end $$;

create function app.on_offer_decided(p_offer uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.offers set status = case when p_outcome = 'approved' then 'approved' else 'draft' end::public.offer_status
   where id = p_offer and status = 'pending_approval';
end $$;
insert into app.approval_handlers (subject_type, handler) values ('offer', 'app.on_offer_decided(uuid,text)');
insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label)
values ('offer', 1, 'permission', 'recruitment.offer.approve', 'Offer approval');

-- Sent → the candidate's answer. (Candidates answer outside PeopleCore for now; a recruiter records it.)
create function public.set_offer_status(p_offer uuid, p_status public.offer_status) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_offer public.offers := app.offer_or_deny(p_offer);
  v_ver   public.offer_versions;
begin
  select * into v_ver from public.offer_versions where offer_id = v_offer.id and version = v_offer.current_version;
  if p_status = 'sent' and v_offer.status <> 'approved' then
    raise exception 'Only an approved offer can be sent.' using errcode = '22023';
  elsif p_status in ('accepted', 'declined') and v_offer.status <> 'sent' then
    raise exception 'Record the answer to an offer that has been sent.' using errcode = '22023';
  elsif p_status = 'accepted' and v_ver.expires_on < app.org_today(v_offer.organization_id) then
    raise exception 'This offer expired on %. Send a new version.', to_char(v_ver.expires_on, 'DD Mon YYYY') using errcode = '22023';
  elsif p_status = 'withdrawn' and v_offer.status in ('accepted', 'withdrawn') then
    raise exception 'This offer can’t be withdrawn now.' using errcode = '22023';
  elsif p_status not in ('sent', 'accepted', 'declined', 'withdrawn') then
    raise exception 'Use submit to request approval.' using errcode = '22023';
  end if;
  if p_status = 'withdrawn' and v_offer.status = 'pending_approval' then
    update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_offer.approval_request_id and status = 'pending';
  end if;
  update public.offers set status = p_status, responded_at = case when p_status in ('accepted', 'declined') then now() end where id = v_offer.id;
  if p_status = 'accepted' then
    perform app.emit_event(v_offer.organization_id, 'offer.accepted', v_offer.id,
      jsonb_build_object('application_id', v_offer.application_id), 'offer.accepted:' || v_offer.id || ':' || v_offer.current_version);
  end if;
end $$;

-- Emits employee.hired for a hire that really happened (hire_application runs as the caller, who can't emit
-- arbitrary events).
create function app.record_hire_event(p_application uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_app public.applications;
begin
  select * into v_app from public.applications where id = p_application and stage = 'hired' and converted_employee_id is not null;
  if v_app.id is null then return; end if;
  perform app.emit_event(v_app.organization_id, 'employee.hired', v_app.converted_employee_id,
    jsonb_build_object('application_id', v_app.id), 'employee.hired:' || v_app.converted_employee_id);
end $$;

-- Hiring needs an accepted offer; joining date and designation come from it.
create or replace function public.hire_application(
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
  v_offer     public.offers;
  v_ver       public.offer_versions;
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
  select * into v_offer from public.offers where application_id = v_app.id;
  if v_offer.id is null or v_offer.status <> 'accepted' then
    raise exception 'Record the candidate’s acceptance of an offer before hiring.' using errcode = '22023';
  end if;
  select * into v_ver from public.offer_versions where offer_id = v_offer.id and version = v_offer.current_version;
  select * into v_req from public.job_requisitions where id = v_app.requisition_id for update;
  if v_req.status <> 'open' then
    raise exception 'This requisition isn’t open.' using errcode = '22023';
  end if;
  select * into v_candidate from public.candidates where id = v_app.candidate_id;

  v_employee := public.create_employee(
    p_organization_id     => v_app.organization_id,
    p_first_name          => v_candidate.first_name,
    p_employment_type     => coalesce(p_employment_type, v_req.employment_type),
    p_date_of_joining     => coalesce(p_date_of_joining, v_ver.joining_date),
    p_employee_code       => p_employee_code,
    p_last_name           => v_candidate.last_name,
    p_work_email          => p_work_email,
    p_department_id       => v_req.department_id,
    p_designation_id      => coalesce(v_ver.designation_id, v_req.designation_id),
    p_location_id         => v_req.location_id,
    p_manager_employee_id => v_req.hiring_manager_employee_id
  );

  perform set_config('app.stage_change', 'on', true);
  update public.applications set stage = 'hired', stage_changed_at = now(), converted_employee_id = v_employee where id = v_app.id;
  perform set_config('app.stage_change', 'off', true);
  perform app.record_hire_event(v_app.id);

  select count(*) into v_hired from public.applications where requisition_id = v_req.id and stage = 'hired';
  if v_hired >= v_req.openings then
    update public.job_requisitions set status = 'closed' where id = v_req.id;
  end if;
  return v_employee;
end $$;

-- ─── Interview functions ────────────────────────────────────────────────────

create function public.schedule_interview(
  p_application uuid, p_round text, p_at timestamptz, p_duration smallint, p_mode public.interview_mode,
  p_location text, p_panelists uuid[]
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_app  public.applications;
  v_id   uuid;
  v_emp  public.employees;
  v_name text;
begin
  select * into v_app from public.applications where id = p_application;
  if v_app.id is null or not app.has_permission(v_app.organization_id, 'recruitment.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_app.stage in ('hired', 'rejected', 'withdrawn') then
    raise exception 'This application is closed.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_panelists, 1), 0) = 0 then
    raise exception 'Choose at least one interviewer.' using errcode = '22023';
  end if;
  insert into public.interviews (organization_id, application_id, round_name, scheduled_at, duration_minutes, mode, location)
  values (v_app.organization_id, p_application, btrim(p_round), p_at, coalesce(p_duration, 60), coalesce(p_mode, 'video'), nullif(btrim(p_location), ''))
  returning id into v_id;
  select trim(concat_ws(' ', first_name, last_name)) into v_name from public.candidates where id = v_app.candidate_id;
  for v_emp in select * from public.employees where organization_id = v_app.organization_id and id = any (p_panelists) and status <> 'exited' loop
    insert into public.interview_panelists (organization_id, interview_id, employee_id) values (v_app.organization_id, v_id, v_emp.id);
    insert into public.tasks (organization_id, assignee_employee_id, title, details, due_on, subject_type, subject_id)
    values (v_app.organization_id, v_emp.id, format('Interview %s: %s', v_name, btrim(p_round)),
            'Submit your scorecard after the interview (Recruitment → My interviews).',
            (p_at at time zone (select o.timezone from public.organizations o where o.id = v_app.organization_id))::date + 1, 'interview', v_id);
    perform app.notify(v_app.organization_id, v_emp.user_id, 'interview.scheduled', format('Interview with %s (%s)', v_name, btrim(p_round)),
      null, '/recruitment/interviews');
  end loop;
  if not exists (select 1 from public.interview_panelists where interview_id = v_id) then
    raise exception 'Choose current employees as interviewers.' using errcode = '22023';
  end if;
  perform set_config('app.stage_change', 'on', true);
  update public.applications set stage = 'interview', stage_changed_at = now() where id = p_application and stage in ('applied', 'screening');
  perform set_config('app.stage_change', 'off', true);
  return v_id;
end $$;

-- What a panelist needs: their interviews with candidate name, role and round (no contact details).
create function public.my_interviews(p_org uuid)
returns table (interview_id uuid, scheduled_at timestamptz, duration_minutes smallint, mode public.interview_mode, location text,
               round_name text, status public.interview_status, candidate_name text, current_company text, requisition_title text,
               scorecard_submitted boolean)
language sql stable security definer set search_path = '' as $$
  select i.id, i.scheduled_at, i.duration_minutes, i.mode, i.location, i.round_name, i.status,
         trim(concat_ws(' ', c.first_name, c.last_name)), c.current_company, r.title,
         exists (select 1 from public.scorecards s where s.interview_id = i.id and s.panelist_employee_id = me.id)
    from public.employees me
    join public.interview_panelists p on p.employee_id = me.id
    join public.interviews i on i.id = p.interview_id
    join public.applications a on a.id = i.application_id
    join public.candidates c on c.id = a.candidate_id
    join public.job_requisitions r on r.id = a.requisition_id
   where me.organization_id = p_org and me.user_id = auth.uid() and app.is_member(p_org)
   order by i.scheduled_at desc;
$$;

create function public.submit_scorecard(p_interview uuid, p_recommendation public.recommendation, p_summary text, p_ratings jsonb)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_int  public.interviews;
  v_me   uuid;
  v_id   uuid;
  v_r    jsonb;
begin
  select * into v_int from public.interviews where id = p_interview;
  select p.employee_id into v_me from public.interview_panelists p join public.employees e on e.id = p.employee_id
   where p.interview_id = p_interview and e.user_id = auth.uid();
  if v_int.id is null or v_me is null or not app.is_member(v_int.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_int.status = 'cancelled' then
    raise exception 'This interview was cancelled.' using errcode = '22023';
  end if;
  if v_int.scheduled_at > now() then
    raise exception 'Submit the scorecard after the interview.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_ratings) <> 'array' or jsonb_array_length(p_ratings) = 0 then
    raise exception 'Rate at least one criterion.' using errcode = '22023';
  end if;
  begin
    insert into public.scorecards (organization_id, interview_id, panelist_employee_id, recommendation, summary)
    values (v_int.organization_id, p_interview, v_me, p_recommendation, btrim(p_summary))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You have already submitted a scorecard for this interview.' using errcode = '22023';
  end;
  for v_r in select * from jsonb_array_elements(p_ratings) loop
    insert into public.scorecard_ratings (organization_id, scorecard_id, criterion, rating)
    values (v_int.organization_id, v_id, btrim(v_r ->> 'criterion'), (v_r ->> 'rating')::smallint);
  end loop;
  update public.tasks set status = 'done', completed_at = now(), completed_by = auth.uid()
   where subject_type = 'interview' and subject_id = p_interview and assignee_employee_id = v_me and status = 'open';
  if not exists (select 1 from public.interview_panelists p where p.interview_id = p_interview
                  and not exists (select 1 from public.scorecards s where s.interview_id = p_interview and s.panelist_employee_id = p.employee_id)) then
    update public.interviews set status = 'completed' where id = p_interview;
  end if;
  return v_id;
end $$;

-- ─── Careers page (anonymous) ───────────────────────────────────────────────

create function public.public_job_postings(p_org_slug text)
returns table (requisition_id uuid, title text, department text, location text, employment_type public.employment_type,
               description text, posted_at timestamptz, organization_name text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, d.name, l.name, r.employment_type, r.description, r.created_at, o.name
    from public.organizations o
    join public.job_requisitions r on r.organization_id = o.id
    left join public.departments d on d.id = r.department_id
    left join public.locations l on l.id = r.location_id
   where o.slug = lower(p_org_slug) and o.status = 'active' and r.status = 'open' and r.is_published
   order by r.created_at desc
   limit 200;
$$;

-- Always answers the same way for a valid submission (whether or not the person is already on file).
create function public.submit_public_application(
  p_org_slug    text,
  p_requisition uuid,
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text,
  p_consent     boolean
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req    public.job_requisitions;
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_phone  text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s\-()]', '', 'g'), '');
  v_cand   uuid;
begin
  select r.* into v_req from public.job_requisitions r join public.organizations o on o.id = r.organization_id
   where r.id = p_requisition and o.slug = lower(p_org_slug) and o.status = 'active' and r.status = 'open' and r.is_published;
  if v_req.id is null then
    raise exception 'This position is no longer open.' using errcode = '22023';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'Please agree to the processing of your details to apply.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_first_name, ''))) not between 1 and 100 or char_length(coalesce(p_last_name, '')) > 100 then
    raise exception 'Enter your name.' using errcode = '22023';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;
  -- Throttle: at most 5 public applications per email per day across the organization.
  if (select count(*) from public.applications a join public.candidates c on c.id = a.candidate_id
       where c.organization_id = v_req.organization_id and lower(c.email) = v_email
         and a.created_at > now() - interval '1 day' and a.created_by is null) >= 5 then
    return 'received';
  end if;

  -- Match on email only: a phone number alone must not attach a stranger's application to someone's record,
  -- nor reveal (through a uniqueness error) that the number is on file. A phone in use elsewhere isn't stored.
  select id into v_cand from public.candidates where organization_id = v_req.organization_id and lower(email) = v_email;
  if v_cand is null and v_phone is not null
     and exists (select 1 from public.candidates where organization_id = v_req.organization_id and phone = v_phone) then
    v_phone := null;
  end if;
  if v_cand is null then
    insert into public.candidates (organization_id, first_name, last_name, email, phone, source, consent_at, created_by)
    values (v_req.organization_id, btrim(p_first_name), nullif(btrim(p_last_name), ''), v_email, v_phone, 'careers_site', now(), null)
    returning id into v_cand;
  end if;
  insert into public.applications (organization_id, requisition_id, candidate_id, created_by)
  values (v_req.organization_id, v_req.id, v_cand, null)
  on conflict (requisition_id, candidate_id) do nothing;
  return 'received';
end $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

select app.seed_org_flows(id, 'offer') from public.organizations;

revoke all on function app.is_panelist(uuid) from public;
revoke all on function app.can_read_application(uuid) from public;
revoke all on function app.can_view_scorecard(uuid) from public;
revoke all on function app.offer_or_deny(uuid) from public;
revoke all on function app.on_offer_decided(uuid, text) from public;
revoke all on function app.record_hire_event(uuid) from public;
grant execute on function app.record_hire_event(uuid) to authenticated, service_role;
grant execute on function app.is_panelist(uuid) to authenticated, service_role;
grant execute on function app.can_read_application(uuid) to authenticated, service_role;
grant execute on function app.can_view_scorecard(uuid) to authenticated, service_role;

revoke all on function public.save_offer_version(uuid, numeric, date, date, uuid, text) from public, anon;
revoke all on function public.submit_offer(uuid) from public, anon;
revoke all on function public.set_offer_status(uuid, public.offer_status) from public, anon;
revoke all on function public.schedule_interview(uuid, text, timestamptz, smallint, public.interview_mode, text, uuid[]) from public, anon;
revoke all on function public.my_interviews(uuid) from public, anon;
revoke all on function public.submit_scorecard(uuid, public.recommendation, text, jsonb) from public, anon;
grant execute on function public.save_offer_version(uuid, numeric, date, date, uuid, text) to authenticated, service_role;
grant execute on function public.submit_offer(uuid) to authenticated, service_role;
grant execute on function public.set_offer_status(uuid, public.offer_status) to authenticated, service_role;
grant execute on function public.schedule_interview(uuid, text, timestamptz, smallint, public.interview_mode, text, uuid[]) to authenticated, service_role;
grant execute on function public.my_interviews(uuid) to authenticated, service_role;
grant execute on function public.submit_scorecard(uuid, public.recommendation, text, jsonb) to authenticated, service_role;

-- The reviewed public use case: anon may list published openings and apply, nothing else.
revoke all on function public.public_job_postings(text) from public;
revoke all on function public.submit_public_application(text, uuid, text, text, text, text, boolean) from public;
grant execute on function public.public_job_postings(text) to anon, authenticated, service_role;
grant execute on function public.submit_public_application(text, uuid, text, text, text, text, boolean) to anon, authenticated, service_role;
