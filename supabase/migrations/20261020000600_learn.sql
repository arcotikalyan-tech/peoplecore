-- PeopleCore · Learn (Kredily's Learn: overview, journeys, courses & content, skills, assignments, learners,
-- analytics, settings; for employees: me, explore, my journeys, calendar).
--
-- Builds on learning (courses, enrolments, recertification, reminders):
-- * Courses get a lifecycle (draft → in review → published → archived; only published courses are live), a version,
--   lessons (text, video or link) with per-learner progress, skills covered at a level, and completion points.
-- * Skills: a taxonomy, the levels courses teach, a proficiency record written when someone completes a course, and
--   the levels each designation requires.
-- * Journeys: ordered courses; enrolling someone assigns every course; finishing them all completes the journey.
-- * Assignment rules: assign a course or journey to everyone matching a department / designation / location / type,
--   either everyone now or only new joiners, with a due date and optional yearly recurrence; applied daily by the worker
--   (and on demand).
-- * Settings: journey points (course points live on each course; both are paid into the PeopleXP wallet), the due-soon
--   nudge and overdue alerts (the daily learning job honours both), certificate details.

-- ─── Courses: lifecycle, lessons, points ────────────────────────────────────

alter table public.courses
  add column status text not null default 'published' check (status in ('draft', 'in_review', 'published', 'archived')),
  add column version smallint not null default 1 check (version >= 1),
  add column points integer not null default 0 check (points between 0 and 100000);
update public.courses set status = case when is_active then 'published' else 'archived' end;

-- is_active (what the catalog and older code read and write) and the status stay in step: switching is_active off
-- archives a published course, switching it on publishes; otherwise is_active follows the status.
create function app.course_status_sync() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and not new.is_active and new.status = 'published' then
    new.status := 'archived';
  elsif tg_op = 'UPDATE' and new.is_active is distinct from old.is_active and new.status is not distinct from old.status then
    new.status := case when new.is_active then 'published' else 'archived' end;
  end if;
  new.is_active := new.status = 'published';
  if tg_op = 'UPDATE' and old.status = 'published' and new.status = 'draft' then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger courses_status_sync before insert or update on public.courses for each row execute function app.course_status_sync();

create table public.course_lessons (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  course_id         uuid not null,
  position          smallint not null check (position between 1 and 500),
  title             text not null check (char_length(title) between 2 and 160),
  kind              text not null default 'text' check (kind in ('text', 'video', 'link')),
  body              text check (char_length(body) <= 20000),
  url               text check (url ~ '^https://[^\s]+$' and char_length(url) <= 500),
  duration_minutes  smallint check (duration_minutes between 1 and 600),
  unique (organization_id, id),
  foreign key (organization_id, course_id) references public.courses (organization_id, id) on delete cascade,
  check (kind = 'text' or url is not null)
);
create index course_lessons_course_idx on public.course_lessons (course_id, position);
create trigger course_lessons_audit after insert or update or delete on public.course_lessons for each row execute function app.audit_row();

create table public.lesson_progress (
  organization_id  uuid not null,
  enrollment_id    uuid not null,
  lesson_id        uuid not null,
  completed_at     timestamptz not null default now(),
  primary key (enrollment_id, lesson_id),
  foreign key (organization_id, enrollment_id) references public.course_enrollments (organization_id, id) on delete cascade,
  foreign key (organization_id, lesson_id) references public.course_lessons (organization_id, id) on delete cascade
);

-- ─── Skills ─────────────────────────────────────────────────────────────────

create table public.learn_skills (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  category         text check (char_length(category) <= 60),
  unique (organization_id, name),
  unique (organization_id, id)
);
create trigger learn_skills_audit after insert or update or delete on public.learn_skills for each row execute function app.audit_row();

create table public.course_skills (
  organization_id  uuid not null,
  course_id        uuid not null,
  skill_id         uuid not null,
  level            smallint not null default 2 check (level between 1 and 5),
  primary key (course_id, skill_id),
  foreign key (organization_id, course_id) references public.courses (organization_id, id) on delete cascade,
  foreign key (organization_id, skill_id) references public.learn_skills (organization_id, id) on delete cascade
);

create table public.employee_skills (
  organization_id  uuid not null,
  employee_id      uuid not null,
  skill_id         uuid not null,
  level            smallint not null check (level between 1 and 5),
  course_id        uuid,
  achieved_at      timestamptz not null default now(),
  primary key (employee_id, skill_id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, skill_id) references public.learn_skills (organization_id, id) on delete cascade
);

create table public.designation_skills (
  organization_id  uuid not null,
  designation_id   uuid not null,
  skill_id         uuid not null,
  level            smallint not null default 2 check (level between 1 and 5),
  primary key (designation_id, skill_id),
  foreign key (organization_id, designation_id) references public.designations (organization_id, id) on delete cascade,
  foreign key (organization_id, skill_id) references public.learn_skills (organization_id, id) on delete cascade
);

-- ─── Journeys ───────────────────────────────────────────────────────────────

create table public.learn_journeys (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (char_length(title) between 3 and 160),
  description      text check (char_length(description) <= 2000),
  status           text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  points           integer not null default 0 check (points between 0 and 100000),
  created_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create trigger learn_journeys_audit after insert or update or delete on public.learn_journeys for each row execute function app.audit_row();

create table public.journey_steps (
  organization_id  uuid not null,
  journey_id       uuid not null,
  position         smallint not null check (position between 1 and 100),
  course_id        uuid not null,
  primary key (journey_id, course_id),
  unique (journey_id, position),
  foreign key (organization_id, journey_id) references public.learn_journeys (organization_id, id) on delete cascade,
  foreign key (organization_id, course_id) references public.courses (organization_id, id)
);

create table public.journey_enrollments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  journey_id       uuid not null,
  employee_id      uuid not null,
  source           text not null default 'assigned' check (source in ('self', 'assigned', 'rule')),
  due_on           date,
  enrolled_at      timestamptz not null default now(),
  completed_at     timestamptz,
  unique (journey_id, employee_id),
  foreign key (organization_id, journey_id) references public.learn_journeys (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

-- ─── Rules and settings ─────────────────────────────────────────────────────

create table public.learn_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 3 and 120),
  course_id        uuid,
  journey_id       uuid,
  department_id    uuid,
  designation_id   uuid,
  location_id      uuid,
  employment_type  public.employment_type,
  trigger          text not null default 'new_joiners' check (trigger in ('new_joiners', 'everyone')),
  due_days         smallint not null default 14 check (due_days between 1 and 365),
  recurrence       text not null default 'none' check (recurrence in ('none', 'yearly')),
  mandatory        boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  last_applied_at  timestamptz,
  foreign key (organization_id, course_id) references public.courses (organization_id, id) on delete cascade,
  foreign key (organization_id, journey_id) references public.learn_journeys (organization_id, id) on delete cascade,
  foreign key (organization_id, department_id) references public.departments (organization_id, id),
  foreign key (organization_id, designation_id) references public.designations (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  check ((course_id is null) <> (journey_id is null))
);
create trigger learn_rules_audit after insert or update or delete on public.learn_rules for each row execute function app.audit_row();

create table public.learn_settings (
  organization_id        uuid primary key references public.organizations (id) on delete cascade,
  journey_points         integer not null default 200 check (journey_points between 0 and 100000),
  due_soon_days          smallint not null default 3 check (due_soon_days between 0 and 30),
  overdue_alerts         boolean not null default true,
  certificate_accent     text not null default '#5652e8' check (certificate_accent ~ '^#[0-9a-fA-F]{6}$'),
  signature_name         text check (char_length(signature_name) <= 80),
  signature_title        text check (char_length(signature_title) <= 80),
  updated_at             timestamptz not null default now()
);
create trigger learn_settings_touch before update on public.learn_settings for each row execute function app.touch_updated_at();
create trigger learn_settings_audit after insert or update on public.learn_settings for each row execute function app.audit_row();

-- Points earned through learning go into the PeopleXP wallet.
alter table public.pxp_ledger drop constraint pxp_ledger_kind_check;
alter table public.pxp_ledger add constraint pxp_ledger_kind_check check (kind in ('received', 'redeemed', 'refund', 'adjustment', 'learning'));
alter table public.pxp_ledger add column enrollment_id uuid;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.course_lessons enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.learn_skills enable row level security;
alter table public.course_skills enable row level security;
alter table public.employee_skills enable row level security;
alter table public.designation_skills enable row level security;
alter table public.learn_journeys enable row level security;
alter table public.journey_steps enable row level security;
alter table public.journey_enrollments enable row level security;
alter table public.learn_rules enable row level security;
alter table public.learn_settings enable row level security;

-- Lessons follow their course's visibility (RLS on courses); HR writes.
create policy course_lessons_select on public.course_lessons for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id));
create policy course_lessons_write on public.course_lessons for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));
create policy lesson_progress_select on public.lesson_progress for select to authenticated
  using (exists (select 1 from public.course_enrollments x where x.id = enrollment_id));
create policy learn_skills_select on public.learn_skills for select to authenticated using (app.is_member(organization_id));
create policy learn_skills_write on public.learn_skills for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));
create policy course_skills_select on public.course_skills for select to authenticated using (app.is_member(organization_id));
create policy course_skills_write on public.course_skills for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));
create policy employee_skills_select on public.employee_skills for select to authenticated
  using (app.is_own_employee(employee_id) or app.has_permission(organization_id, 'learning.manage') or app.is_in_reporting_line(organization_id, employee_id));
create policy designation_skills_select on public.designation_skills for select to authenticated using (app.is_member(organization_id));
create policy designation_skills_write on public.designation_skills for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));
create policy learn_journeys_select on public.learn_journeys for select to authenticated
  using ((status = 'published' and app.is_member(organization_id)) or app.has_permission(organization_id, 'learning.manage')
         or exists (select 1 from public.journey_enrollments j where j.journey_id = learn_journeys.id and app.is_own_employee(j.employee_id)));
create policy learn_journeys_write on public.learn_journeys for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));
create policy journey_steps_select on public.journey_steps for select to authenticated using (exists (select 1 from public.learn_journeys j where j.id = journey_id));
create policy journey_steps_write on public.journey_steps for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));
create policy journey_enrollments_select on public.journey_enrollments for select to authenticated
  using (app.is_own_employee(employee_id) or app.has_permission(organization_id, 'learning.manage') or app.is_in_reporting_line(organization_id, employee_id));
create policy learn_rules_all on public.learn_rules for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));
create policy learn_settings_select on public.learn_settings for select to authenticated using (app.is_member(organization_id));
create policy learn_settings_write on public.learn_settings for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));

grant select, insert, update, delete on public.course_lessons, public.learn_skills, public.course_skills, public.designation_skills,
  public.learn_journeys, public.journey_steps, public.learn_rules to authenticated;
grant select, insert, update on public.learn_settings to authenticated;
grant select on public.lesson_progress, public.employee_skills, public.journey_enrollments to authenticated;
grant all on public.course_lessons, public.lesson_progress, public.learn_skills, public.course_skills, public.employee_skills, public.designation_skills,
  public.learn_journeys, public.journey_steps, public.journey_enrollments, public.learn_rules, public.learn_settings to service_role;

-- ─── Completion: skills, points, journeys ───────────────────────────────────

create function app.learn_on_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_points  integer;
  v_pxp_on  boolean;
  j         record;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  -- Proficiency: the higher of what they had and what the course teaches.
  insert into public.employee_skills (organization_id, employee_id, skill_id, level, course_id)
  select new.organization_id, new.employee_id, cs.skill_id, cs.level, new.course_id from public.course_skills cs where cs.course_id = new.course_id
  on conflict (employee_id, skill_id) do update set level = excluded.level, course_id = excluded.course_id, achieved_at = now()
    where public.employee_skills.level < excluded.level;
  -- Points, once per enrolment.
  select points into v_points from public.courses where id = new.course_id;
  select coalesce((select points_enabled from public.pxp_settings where organization_id = new.organization_id), true) into v_pxp_on;
  if v_pxp_on and v_points > 0 and not exists (select 1 from public.pxp_ledger where enrollment_id = new.id) then
    insert into public.pxp_ledger (organization_id, employee_id, delta, kind, enrollment_id, note)
    select new.organization_id, new.employee_id, v_points, 'learning', new.id, left('Completed ' || title, 200) from public.courses where id = new.course_id;
  end if;
  -- Journeys this finishes.
  for j in select je.id, je.journey_id, lj.points, lj.title from public.journey_enrollments je join public.learn_journeys lj on lj.id = je.journey_id
            where je.employee_id = new.employee_id and je.completed_at is null
              and exists (select 1 from public.journey_steps s where s.journey_id = je.journey_id and s.course_id = new.course_id)
              and not exists (select 1 from public.journey_steps s where s.journey_id = je.journey_id
                                 and not exists (select 1 from public.course_enrollments x where x.course_id = s.course_id and x.employee_id = new.employee_id
                                                    and (x.status = 'completed' or x.id = new.id))) loop
    update public.journey_enrollments set completed_at = now() where id = j.id;
    if v_pxp_on and j.points > 0 then
      insert into public.pxp_ledger (organization_id, employee_id, delta, kind, note)
      values (new.organization_id, new.employee_id, j.points, 'learning', left('Completed journey ' || j.title, 200));
    end if;
  end loop;
  return new;
end $$;
create trigger course_enrollments_completion after update of status on public.course_enrollments for each row execute function app.learn_on_completion();

-- A learner ticks off a lesson; finishing the last one completes the enrolment.
create function public.complete_lesson(p_lesson uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  l       public.course_lessons;
  x       public.course_enrollments;
  v_done  integer;
  v_total integer;
begin
  select * into l from public.course_lessons where id = p_lesson;
  if l.id is null or not app.is_member(l.organization_id) then raise exception 'Lesson not found.' using errcode = 'P0002'; end if;
  select * into x from public.course_enrollments
   where course_id = l.course_id and app.is_own_employee(employee_id) and status in ('assigned', 'in_progress')
   order by created_at desc limit 1;
  if x.id is null then raise exception 'Enrol in the course first.' using errcode = '22023'; end if;
  insert into public.lesson_progress (organization_id, enrollment_id, lesson_id) values (l.organization_id, x.id, l.id) on conflict do nothing;
  if x.status = 'assigned' then update public.course_enrollments set status = 'in_progress', started_at = coalesce(started_at, now()) where id = x.id; end if;
  select count(*) into v_done from public.lesson_progress where enrollment_id = x.id;
  select count(*) into v_total from public.course_lessons where course_id = l.course_id;
  if v_done >= v_total then
    perform public.update_enrollment(x.id, 'completed', 'All lessons completed');
  end if;
  return jsonb_build_object('done', v_done, 'total', v_total);
end $$;

-- Enrol people in a journey: every course is assigned (keeping existing open or valid enrolments).
create function app.learn_enroll_journey(p_journey uuid, p_employee uuid, p_due date, p_mandatory boolean, p_source text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  j public.learn_journeys;
  s record;
begin
  select * into j from public.learn_journeys where id = p_journey;
  insert into public.journey_enrollments (organization_id, journey_id, employee_id, source, due_on)
  values (j.organization_id, j.id, p_employee, p_source, p_due) on conflict (journey_id, employee_id) do nothing;
  for s in select course_id from public.journey_steps where journey_id = j.id order by position loop
    if not exists (select 1 from public.course_enrollments x where x.course_id = s.course_id and x.employee_id = p_employee
                     and (x.status in ('assigned', 'in_progress') or (x.status = 'completed' and (x.valid_until is null or x.valid_until > app.org_today(j.organization_id))))) then
      insert into public.course_enrollments (organization_id, course_id, employee_id, source, assigned_by, mandatory, due_on)
      values (j.organization_id, s.course_id, p_employee, case when p_source = 'self' then 'self' else 'assigned' end, auth.uid(), p_mandatory, p_due);
    end if;
  end loop;
end $$;

create function public.enroll_journey(p_journey uuid, p_employees uuid[] default null, p_due date default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  j  public.learn_journeys;
  e  uuid;
  n  integer := 0;
  me uuid;
begin
  select * into j from public.learn_journeys where id = p_journey;
  if j.id is null or not app.is_member(j.organization_id) then raise exception 'Journey not found.' using errcode = 'P0002'; end if;
  if j.status <> 'published' then raise exception 'Publish the journey first.' using errcode = '22023'; end if;
  if p_employees is null then
    select id into me from public.employees where organization_id = j.organization_id and user_id = auth.uid();
    if me is null then raise exception 'You need an employee record to enrol.' using errcode = '42501'; end if;
    perform app.learn_enroll_journey(j.id, me, p_due, false, 'self');
    return 1;
  end if;
  foreach e in array p_employees loop
    if not app.can_assign_learning(j.organization_id, e) then raise exception 'You can''t assign learning to everyone selected.' using errcode = '42501'; end if;
    perform app.learn_enroll_journey(j.id, e, p_due, true, 'assigned');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Applies active rules: matching current employees (or only those who joined after the rule was created) get the
-- course or journey, unless they already have it open or validly completed. Yearly rules come back a year after.
create function app.learn_apply_rules(p_org uuid default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  r  public.learn_rules;
  e  record;
  n  integer := 0;
  v_due date;
begin
  for r in select * from public.learn_rules where active and (p_org is null or organization_id = p_org) loop
    v_due := app.org_today(r.organization_id) + r.due_days;
    for e in select emp.id from public.employees emp
              where emp.organization_id = r.organization_id and emp.status in ('active', 'on_notice', 'pre_joining')
                and (r.department_id is null or emp.department_id = r.department_id)
                and (r.designation_id is null or emp.designation_id = r.designation_id)
                and (r.location_id is null or emp.location_id = r.location_id)
                and (r.employment_type is null or emp.employment_type = r.employment_type)
                and (r.trigger = 'everyone' or emp.date_of_joining >= r.created_at::date) loop
      if r.course_id is not null then
        if not exists (select 1 from public.course_enrollments x where x.course_id = r.course_id and x.employee_id = e.id
                         and (x.status in ('assigned', 'in_progress')
                              or (x.status = 'completed' and (r.recurrence = 'none' or x.completed_at > now() - interval '1 year')))) then
          insert into public.course_enrollments (organization_id, course_id, employee_id, source, assigned_by, mandatory, due_on)
          select r.organization_id, r.course_id, e.id, 'assigned', null, r.mandatory, v_due
            from public.courses c where c.id = r.course_id and c.status = 'published';
          if found then n := n + 1; end if;
        end if;
      elsif not exists (select 1 from public.journey_enrollments je where je.journey_id = r.journey_id and je.employee_id = e.id
                          and (je.completed_at is null or r.recurrence = 'none' or je.completed_at > now() - interval '1 year')) then
        if (select status from public.learn_journeys where id = r.journey_id) = 'published' then
          delete from public.journey_enrollments where journey_id = r.journey_id and employee_id = e.id;
          perform app.learn_enroll_journey(r.journey_id, e.id, v_due, r.mandatory, 'rule');
          n := n + 1;
        end if;
      end if;
    end loop;
    update public.learn_rules set last_applied_at = now() where id = r.id;
  end loop;
  return n;
end $$;

create function public.apply_learning_rules(p_org uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'learning.manage') then raise exception 'You can''t run assignment rules.' using errcode = '42501'; end if;
  return app.learn_apply_rules(p_org);
end $$;

-- The worker applies every organization's rules each day.
create function public.worker_learning_rules() returns jsonb
language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('assigned', app.learn_apply_rules(null));
$$;

-- HR nudges everyone overdue now (one notification each).
create function public.remind_overdue_learning(p_org uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer := 0;
  r record;
begin
  if not app.has_permission(p_org, 'learning.manage') then raise exception 'You can''t send reminders.' using errcode = '42501'; end if;
  for r in select distinct e.user_id from public.course_enrollments x join public.employees e on e.id = x.employee_id
            where x.organization_id = p_org and x.status in ('assigned', 'in_progress') and x.due_on < app.org_today(p_org) and e.user_id is not null loop
    perform app.notify(p_org, r.user_id, 'learning.overdue', 'You have overdue training', 'Open Learning to finish it.', '/learning');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function app.course_status_sync(), app.learn_on_completion(), app.learn_enroll_journey(uuid, uuid, date, boolean, text), app.learn_apply_rules(uuid) from public;
revoke all on function public.complete_lesson(uuid), public.enroll_journey(uuid, uuid[], date), public.apply_learning_rules(uuid),
  public.remind_overdue_learning(uuid), public.worker_learning_rules() from public;
grant execute on function public.complete_lesson(uuid), public.enroll_journey(uuid, uuid[], date), public.apply_learning_rules(uuid),
  public.remind_overdue_learning(uuid) to authenticated;
grant execute on function public.worker_learning_rules() to service_role;

-- ─── Reminders: due-soon nudges and the overdue switch ──────────────────────

alter table public.course_enrollments add column due_soon_reminded_at timestamptz;

create or replace function public.worker_learning() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r          record;
  v_reminded int := 0;
  v_nudged   int := 0;
  v_renewed  int := 0;
begin
  -- Due soon: once per enrolment, the configured number of days before the due date.
  for r in update public.course_enrollments x set due_soon_reminded_at = now()
             from public.courses c
            where c.id = x.course_id and x.status in ('assigned', 'in_progress') and x.due_soon_reminded_at is null
              and coalesce((select s.due_soon_days from public.learn_settings s where s.organization_id = x.organization_id), 3) > 0
              and x.due_on between app.org_today(x.organization_id)
                               and app.org_today(x.organization_id) + coalesce((select s.due_soon_days from public.learn_settings s where s.organization_id = x.organization_id), 3)
           returning x.organization_id, x.employee_id, x.due_on, c.title loop
    v_nudged := v_nudged + 1;
    perform app.notify(r.organization_id, (select user_id from public.employees where id = r.employee_id), 'learning.due_soon',
      'Due ' || to_char(r.due_on, 'DD Mon') || ': ' || left(r.title, 140), null, '/learning');
  end loop;

  -- Overdue: once per enrolment, unless the organization switched overdue alerts off.
  for r in update public.course_enrollments x set reminded_at = now()
             from public.courses c
            where c.id = x.course_id and x.status in ('assigned', 'in_progress') and x.reminded_at is null
              and x.due_on < app.org_today(x.organization_id)
              and coalesce((select s.overdue_alerts from public.learn_settings s where s.organization_id = x.organization_id), true)
           returning x.organization_id, x.employee_id, x.assigned_by, x.source, c.title loop
    v_reminded := v_reminded + 1;
    perform app.notify(r.organization_id, (select user_id from public.employees where id = r.employee_id), 'learning.overdue',
      'Training overdue: ' || left(r.title, 140), null, '/learning');
    if r.source = 'assigned' then
      perform app.notify(r.organization_id, r.assigned_by, 'learning.overdue',
        'Overdue: ' || (select concat_ws(' ', first_name, last_name) from public.employees where id = r.employee_id) || ', ' || left(r.title, 120),
        null, '/learning');
    end if;
  end loop;

  for r in select x.organization_id, x.course_id, x.employee_id, x.valid_until, x.mandatory, c.title, e.user_id
             from public.course_enrollments x
             join public.courses c on c.id = x.course_id and c.is_active
             join public.employees e on e.id = x.employee_id and e.status <> 'exited'
            where x.status = 'completed' and x.valid_until <= app.org_today(x.organization_id) + 30
              -- Once per completion: anything enrolled since (renewal, even if later cancelled) settles it.
              and not exists (select 1 from public.course_enrollments n
                               where n.course_id = x.course_id and n.employee_id = x.employee_id and n.id <> x.id
                                 and n.created_at >= x.completed_at) loop
    insert into public.course_enrollments (organization_id, course_id, employee_id, source, assigned_by, mandatory, due_on)
    values (r.organization_id, r.course_id, r.employee_id, 'recertification', null, r.mandatory, r.valid_until)
    on conflict do nothing;
    v_renewed := v_renewed + 1;
    perform app.notify(r.organization_id, r.user_id, 'learning.assigned', 'Time to renew: ' || left(r.title, 140),
      'Your completion lapses on ' || to_char(r.valid_until, 'DD Mon YYYY') || '.', '/learning');
  end loop;
  return jsonb_build_object('reminded', v_reminded, 'due_soon', v_nudged, 'recertifications', v_renewed);
end $$;
