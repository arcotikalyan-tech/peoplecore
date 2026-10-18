-- PeopleCore · Learning (Phase 5): a course catalog, self-enrolment, assigned (often mandatory) training with due
-- dates, completions that expire and come back for recertification, and reminders.
--
-- * HR (`learning.manage`) keeps the catalog and assigns courses to anyone; managers assign to people in their
--   reporting line. Employees enrol themselves in courses open for self-enrolment.
-- * Completion is self-attested by the learner, or recorded for them by HR or their manager (classroom sessions).
--   A course can be valid for N months: the completion then carries `valid_until`, and the worker re-assigns it
--   30 days before it lapses (recertification, e.g. yearly POSH awareness).
-- * The worker reminds a learner once when an assignment is overdue, and tells whoever assigned it.

insert into public.permissions (key, module, description, is_sensitive) values
  ('learning.manage', 'learning', 'Manage the course catalog and assign training to anyone', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'learning.manage', 'org'), ('hr_admin', 'learning.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'learning.manage'
on conflict (role_id, permission_key) do nothing;

create type public.course_format as enum ('online', 'classroom', 'video', 'reading', 'external');
create type public.enrollment_status as enum ('assigned', 'in_progress', 'completed', 'cancelled');

create table public.courses (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  title              text not null check (char_length(title) between 3 and 160),
  description        text check (char_length(description) <= 5000),
  category           text check (char_length(category) <= 60),
  format             public.course_format not null default 'online',
  url                text check (url ~ '^https://[^\s]+$' and char_length(url) <= 500),
  duration_minutes   int check (duration_minutes between 1 and 10000),
  valid_for_months   smallint check (valid_for_months between 1 and 60),
  self_enroll        boolean not null default true,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, id)
);
create index courses_org_idx on public.courses (organization_id, is_active, title);

create table public.course_enrollments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  course_id         uuid not null,
  employee_id       uuid not null,
  source            text not null check (source in ('self', 'assigned', 'recertification')),
  assigned_by       uuid default auth.uid(),
  mandatory         boolean not null default false,
  due_on            date,
  status            public.enrollment_status not null default 'assigned',
  started_at        timestamptz,
  completed_at      timestamptz,
  completion_note   text check (char_length(completion_note) <= 1000),
  recorded_by       uuid,
  valid_until       date,
  reminded_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, course_id) references public.courses (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  check (status <> 'completed' or completed_at is not null)
);
-- One open enrolment per person and course.
create unique index course_enrollments_open_uq on public.course_enrollments (course_id, employee_id) where status in ('assigned', 'in_progress');
create index course_enrollments_employee_idx on public.course_enrollments (organization_id, employee_id, status);
create index course_enrollments_course_idx on public.course_enrollments (course_id, status);

create trigger courses_touch before update on public.courses for each row execute function app.touch_updated_at();
create trigger courses_audit after insert or update or delete on public.courses for each row execute function app.audit_row();
create trigger course_enrollments_audit after insert or update on public.course_enrollments for each row execute function app.audit_row();

alter table public.courses enable row level security;
alter table public.course_enrollments enable row level security;

-- Members see active courses; HR sees the whole catalog (and courses anyone is enrolled in stay readable to them).
create policy courses_select on public.courses for select to authenticated
  using ((is_active and app.is_member(organization_id)) or app.has_permission(organization_id, 'learning.manage')
         or exists (select 1 from public.course_enrollments x where x.course_id = courses.id and app.is_own_employee(x.employee_id)));
create policy courses_write on public.courses for all to authenticated
  using (app.has_permission(organization_id, 'learning.manage')) with check (app.has_permission(organization_id, 'learning.manage'));
-- Learners see their own; managers their reporting line; HR everyone.
create policy course_enrollments_select on public.course_enrollments for select to authenticated
  using (app.is_own_employee(employee_id) or app.has_permission(organization_id, 'learning.manage')
         or app.is_in_reporting_line(organization_id, employee_id));

grant select, insert, update, delete on public.courses to authenticated;
grant select on public.course_enrollments to authenticated;
grant all on public.courses, public.course_enrollments to service_role;

-- May the caller assign training to (or record it for) this employee? HR, or their line.
create function app.can_assign_learning(p_org uuid, p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_org, 'learning.manage') or app.is_in_reporting_line(p_org, p_employee);
$$;

-- ─── Functions ──────────────────────────────────────────────────────────────

create function public.enroll_in_course(p_course uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c   public.courses;
  v_emp uuid;
  v_id  uuid;
begin
  select * into v_c from public.courses where id = p_course;
  select id into v_emp from public.employees where organization_id = v_c.organization_id and user_id = auth.uid() and status <> 'exited';
  if v_c.id is null or v_emp is null or not app.is_member(v_c.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not v_c.is_active or not v_c.self_enroll then
    raise exception 'This course isn’t open for enrolment. Ask HR or your manager.' using errcode = '22023';
  end if;
  if exists (select 1 from public.course_enrollments where course_id = p_course and employee_id = v_emp and status in ('assigned', 'in_progress')) then
    raise exception 'You’re already enrolled.' using errcode = '22023';
  end if;
  insert into public.course_enrollments (organization_id, course_id, employee_id, source, status, started_at)
  values (v_c.organization_id, p_course, v_emp, 'self', 'in_progress', now())
  returning id into v_id;
  return v_id;
end $$;

-- Assign a course to people (skipping anyone already enrolled). Returns how many were newly assigned.
create function public.assign_course(p_course uuid, p_employees uuid[], p_due_on date default null, p_mandatory boolean default true)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c    public.courses;
  v_emp  public.employees;
  v_n    int := 0;
begin
  select * into v_c from public.courses where id = p_course;
  if v_c.id is null or not app.is_member(v_c.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not v_c.is_active then
    raise exception 'This course is no longer offered.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_employees), 0) = 0 then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_due_on is not null and p_due_on < app.org_today(v_c.organization_id) then
    raise exception 'The due date can’t be in the past.' using errcode = '22023';
  end if;
  for v_emp in select * from public.employees where id = any (p_employees) loop
    if v_emp.organization_id <> v_c.organization_id or not app.can_assign_learning(v_c.organization_id, v_emp.id) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    continue when v_emp.status = 'exited';
    continue when exists (select 1 from public.course_enrollments
                           where course_id = p_course and employee_id = v_emp.id and status in ('assigned', 'in_progress'));
    insert into public.course_enrollments (organization_id, course_id, employee_id, source, mandatory, due_on)
    values (v_c.organization_id, p_course, v_emp.id, 'assigned', coalesce(p_mandatory, true), p_due_on);
    perform app.notify(v_c.organization_id, v_emp.user_id, 'learning.assigned', 'Training assigned: ' || left(v_c.title, 140),
      case when p_due_on is not null then 'Due ' || to_char(p_due_on, 'DD Mon YYYY') || '.' end, '/learning');
    v_n := v_n + 1;
  end loop;
  if (select count(*) from public.employees where id = any (p_employees)) <> cardinality(array(select distinct unnest(p_employees))) then
    raise exception 'Choose people from your organization.' using errcode = '22023';
  end if;
  return v_n;
end $$;

-- Start, complete or cancel. Learners start and complete their own; HR or their line records a completion for
-- them or cancels an assignment. A completion of a course valid for N months gets a valid_until date.
create function public.update_enrollment(p_enrollment uuid, p_status public.enrollment_status, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_x     public.course_enrollments;
  v_c     public.courses;
  v_own   boolean;
  v_today date;
begin
  select * into v_x from public.course_enrollments where id = p_enrollment for update;
  if v_x.id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_c from public.courses where id = v_x.course_id;
  v_own := app.is_own_employee(v_x.employee_id);
  if not (v_own or app.can_assign_learning(v_x.organization_id, v_x.employee_id)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_x.status in ('completed', 'cancelled') then
    raise exception 'This enrolment is closed.' using errcode = '22023';
  end if;
  if p_status = 'cancelled' and (v_own and not app.can_assign_learning(v_x.organization_id, v_x.employee_id)) and v_x.mandatory then
    raise exception 'Mandatory training can’t be dropped. Talk to HR.' using errcode = '22023';
  end if;
  if p_status = 'assigned' then
    raise exception 'Choose start, complete or cancel.' using errcode = '22023';
  end if;
  v_today := app.org_today(v_x.organization_id);
  update public.course_enrollments set
    status = p_status,
    started_at = coalesce(started_at, case when p_status in ('in_progress', 'completed') then now() end),
    completed_at = case when p_status = 'completed' then now() end,
    completion_note = case when p_status = 'completed' then nullif(btrim(coalesce(p_note, '')), '') else completion_note end,
    recorded_by = case when p_status = 'completed' and not v_own then auth.uid() end,
    valid_until = case when p_status = 'completed' and v_c.valid_for_months is not null
                       then (v_today + make_interval(months => v_c.valid_for_months))::date end
   where id = p_enrollment;
  if p_status = 'completed' and not v_own then
    perform app.notify(v_x.organization_id, (select user_id from public.employees where id = v_x.employee_id), 'learning.completed',
      'Completion recorded: ' || left(v_c.title, 140), null, '/learning');
  end if;
end $$;

-- HR's view of the catalog: how many are enrolled, done, overdue and lapsing per course.
create function public.learning_summary(p_org uuid)
returns table (course_id uuid, enrolled bigint, completed bigint, overdue bigint, lapsing bigint)
language sql stable security definer set search_path = '' as $$
  select x.course_id,
         count(*) filter (where x.status in ('assigned', 'in_progress')),
         count(*) filter (where x.status = 'completed' and (x.valid_until is null or x.valid_until >= app.org_today(p_org))),
         count(*) filter (where x.status in ('assigned', 'in_progress') and x.due_on < app.org_today(p_org)),
         count(*) filter (where x.status = 'completed' and x.valid_until between app.org_today(p_org) and app.org_today(p_org) + 30)
    from public.course_enrollments x
   where app.has_permission(p_org, 'learning.manage') and x.organization_id = p_org
   group by x.course_id;
$$;

-- Worker: remind overdue learners once (and whoever assigned it); re-assign completions that lapse within 30 days.
create function public.worker_learning() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r          record;
  v_reminded int := 0;
  v_renewed  int := 0;
begin
  for r in update public.course_enrollments x set reminded_at = now()
             from public.courses c
            where c.id = x.course_id and x.status in ('assigned', 'in_progress') and x.reminded_at is null
              and x.due_on < app.org_today(x.organization_id)
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
  return jsonb_build_object('reminded', v_reminded, 'recertifications', v_renewed);
end $$;

revoke all on function app.can_assign_learning(uuid, uuid) from public;
grant execute on function app.can_assign_learning(uuid, uuid) to authenticated, service_role;
revoke all on function public.enroll_in_course(uuid) from public, anon;
revoke all on function public.assign_course(uuid, uuid[], date, boolean) from public, anon;
revoke all on function public.update_enrollment(uuid, public.enrollment_status, text) from public, anon;
revoke all on function public.learning_summary(uuid) from public, anon;
revoke all on function public.worker_learning() from public, anon, authenticated;
grant execute on function public.enroll_in_course(uuid) to authenticated, service_role;
grant execute on function public.assign_course(uuid, uuid[], date, boolean) to authenticated, service_role;
grant execute on function public.update_enrollment(uuid, public.enrollment_status, text) to authenticated, service_role;
grant execute on function public.learning_summary(uuid) to authenticated, service_role;
grant execute on function public.worker_learning() to service_role;
