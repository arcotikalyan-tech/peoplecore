-- PeopleCore · Performance (Phase 5): cycles, goals, reviews, calibration, 360 feedback.
--
-- * Goals belong to an employee (optionally to a cycle and aligned to a parent goal). Employees manage their own;
--   managers manage their reports' (team scope); HR everyone's.
-- * A cycle, once activated, opens one review per active employee with a manager: self review → manager review
--   (the direct manager, or HR) → calibration by HR (final rating with a note) → shared.
-- * Until results are shared, the employee sees only their own self review; the manager's assessment and the
--   final rating become visible to them when HR shares the cycle.
-- * 360 feedback: anyone can be asked for feedback on a colleague under review; the subject's manager and HR read
--   it; the subject sees it (without names) once results are shared.

insert into public.permissions (key, module, description, is_sensitive) values
  ('performance.read', 'performance', 'View goals and reviews', true),
  ('performance.manage', 'performance', 'Run review cycles and calibrate ratings', true);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'performance.read', 'org'), ('owner', 'performance.manage', 'org'),
  ('hr_admin', 'performance.read', 'org'), ('hr_admin', 'performance.manage', 'org'),
  ('department_head', 'performance.read', 'team'),
  ('manager', 'performance.read', 'team'),
  ('employee', 'performance.read', 'self');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key in ('performance.read', 'performance.manage')
on conflict (role_id, permission_key) do nothing;

create type public.cycle_status as enum ('draft', 'active', 'calibration', 'shared');
create type public.goal_status as enum ('active', 'completed', 'dropped');
create type public.review_status as enum ('not_started', 'self_submitted', 'manager_submitted', 'calibrated');

create table public.review_cycles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  period_start     date not null,
  period_end       date not null,
  self_review_due  date,
  manager_review_due date,
  status           public.cycle_status not null default 'draft',
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  activated_at     timestamptz,
  shared_at        timestamptz,
  unique (organization_id, id),
  check (period_end >= period_start)
);

create table public.goals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  cycle_id         uuid,
  parent_goal_id   uuid,
  title            text not null check (char_length(title) between 3 and 200),
  description      text check (char_length(description) <= 2000),
  weight           smallint not null default 0 check (weight between 0 and 100),
  progress         smallint not null default 0 check (progress between 0 and 100),
  status           public.goal_status not null default 'active',
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, cycle_id) references public.review_cycles (organization_id, id) on delete set null (cycle_id),
  foreign key (organization_id, parent_goal_id) references public.goals (organization_id, id) on delete set null (parent_goal_id),
  check (parent_goal_id is null or parent_goal_id <> id)
);

create table public.reviews (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  cycle_id              uuid not null,
  employee_id           uuid not null,
  manager_employee_id   uuid,
  status                public.review_status not null default 'not_started',
  self_rating           smallint check (self_rating between 1 and 5),
  self_comments         text check (char_length(self_comments) <= 5000),
  self_submitted_at     timestamptz,
  manager_rating        smallint check (manager_rating between 1 and 5),
  manager_comments      text check (char_length(manager_comments) <= 5000),
  manager_submitted_at  timestamptz,
  final_rating          smallint check (final_rating between 1 and 5),
  calibration_note      text check (char_length(calibration_note) <= 1000),
  calibrated_by         uuid,
  unique (cycle_id, employee_id),
  unique (organization_id, id),
  foreign key (organization_id, cycle_id) references public.review_cycles (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

create table public.feedback_requests (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  review_id          uuid not null,
  from_employee_id   uuid not null,
  question           text not null check (char_length(question) between 5 and 500),
  response           text check (char_length(response) <= 3000),
  responded_at       timestamptz,
  requested_by       uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (review_id, from_employee_id),
  foreign key (organization_id, review_id) references public.reviews (organization_id, id) on delete cascade,
  foreign key (organization_id, from_employee_id) references public.employees (organization_id, id) on delete cascade
);

create trigger goals_touch before update on public.goals for each row execute function app.touch_updated_at();
create trigger review_cycles_audit after insert or update on public.review_cycles for each row execute function app.audit_row();
create trigger goals_audit after insert or update or delete on public.goals for each row execute function app.audit_row();
-- Ratings and comments are sensitive: redacted in the audit trail.
create trigger reviews_audit after insert or update on public.reviews for each row
  execute function app.audit_row('self_rating', 'self_comments', 'manager_rating', 'manager_comments', 'final_rating', 'calibration_note');
create trigger feedback_requests_audit after insert or update on public.feedback_requests for each row execute function app.audit_row('response');

-- ─── Access ─────────────────────────────────────────────────────────────────

alter table public.review_cycles enable row level security;
alter table public.goals enable row level security;
alter table public.reviews enable row level security;
alter table public.feedback_requests enable row level security;

create function app.is_own_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e where e.id = p_employee and e.user_id = auth.uid() and app.is_member(e.organization_id));
$$;

create policy review_cycles_select on public.review_cycles for select to authenticated using (app.is_member(organization_id));
create policy review_cycles_write on public.review_cycles for all to authenticated
  using (app.has_permission(organization_id, 'performance.manage')) with check (app.has_permission(organization_id, 'performance.manage'));

create policy goals_select on public.goals for select to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'performance.read'));
-- Whoever may see someone's goals may maintain them: the employee (self), their line (team) and HR (org).
create policy goals_write on public.goals for all to authenticated
  using (app.can_access_employee(organization_id, employee_id, 'performance.read'))
  with check (app.can_access_employee(organization_id, employee_id, 'performance.read'));

-- Reviews are read through functions (fields depend on who is asking and on the cycle's status).
-- The direct manager on the review always takes part, whatever their roles.
create policy reviews_select on public.reviews for select to authenticated
  using (app.has_permission(organization_id, 'performance.manage')
         or (not app.is_own_employee(employee_id)
             and (app.can_access_employee(organization_id, employee_id, 'performance.read') or app.is_own_employee(manager_employee_id))));
create policy feedback_requests_select on public.feedback_requests for select to authenticated
  using (app.is_own_employee(from_employee_id) or app.has_permission(organization_id, 'performance.manage')
         or exists (select 1 from public.reviews r where r.id = review_id and not app.is_own_employee(r.employee_id)
                     and (app.can_access_employee(r.organization_id, r.employee_id, 'performance.read') or app.is_own_employee(r.manager_employee_id))));

grant select on public.review_cycles, public.reviews, public.feedback_requests to authenticated;
grant insert, update, delete on public.review_cycles to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant all on public.review_cycles, public.goals, public.reviews, public.feedback_requests to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

create function public.activate_review_cycle(p_cycle uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cycle public.review_cycles;
  v_count int := 0;
  e       record;
begin
  select * into v_cycle from public.review_cycles where id = p_cycle for update;
  if v_cycle.id is null or not app.has_permission(v_cycle.organization_id, 'performance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_cycle.status <> 'draft' then
    raise exception 'Only a draft cycle can be activated.' using errcode = '22023';
  end if;
  for e in select * from public.employees where organization_id = v_cycle.organization_id and status in ('active', 'on_notice')
             and date_of_joining <= v_cycle.period_end loop
    insert into public.reviews (organization_id, cycle_id, employee_id, manager_employee_id)
    values (v_cycle.organization_id, p_cycle, e.id, e.manager_employee_id)
    on conflict (cycle_id, employee_id) do nothing;
    insert into public.tasks (organization_id, assignee_employee_id, title, due_on, subject_type, subject_id)
    values (v_cycle.organization_id, e.id, 'Self review: ' || v_cycle.name, v_cycle.self_review_due, 'review_cycle', p_cycle);
    perform app.notify(v_cycle.organization_id, e.user_id, 'performance.cycle', 'Self review open: ' || v_cycle.name, null, '/performance');
    v_count := v_count + 1;
  end loop;
  update public.review_cycles set status = 'active', activated_at = now() where id = p_cycle;
  return v_count;
end $$;

-- What a person may see of a review: everything for HR and the line above; their own self review always, and
-- the manager's part and the final rating once results are shared.
create function public.review_view(p_review uuid)
returns table (review_id uuid, cycle_name text, cycle_status public.cycle_status, employee_id uuid, status public.review_status,
               self_rating smallint, self_comments text, manager_rating smallint, manager_comments text, final_rating smallint,
               calibration_note text, is_self boolean, can_manager_review boolean, can_calibrate boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r     public.reviews;
  v_c     public.review_cycles;
  v_self  boolean;
  v_line  boolean;
  v_hr    boolean;
begin
  select * into v_r from public.reviews where id = p_review;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  v_self := app.is_own_employee(v_r.employee_id);
  v_hr := app.has_permission(v_r.organization_id, 'performance.manage');
  v_line := not v_self and (app.can_access_employee(v_r.organization_id, v_r.employee_id, 'performance.read')
                            or app.is_own_employee(v_r.manager_employee_id));
  if v_r.id is null or not (v_self or v_line or v_hr) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select v_r.id, v_c.name, v_c.status, v_r.employee_id, v_r.status, v_r.self_rating, v_r.self_comments,
    case when v_self and v_c.status <> 'shared' then null else v_r.manager_rating end,
    case when v_self and v_c.status <> 'shared' then null else v_r.manager_comments end,
    case when v_self and v_c.status <> 'shared' then null else v_r.final_rating end,
    case when v_self then null else v_r.calibration_note end,
    v_self,
    (not v_self) and v_c.status = 'active' and v_r.status = 'self_submitted'
      and (exists (select 1 from public.employees m where m.id = v_r.manager_employee_id and m.user_id = auth.uid()) or v_hr),
    (not v_self) and v_hr and v_c.status in ('active', 'calibration') and v_r.status in ('manager_submitted', 'calibrated');
end $$;

-- The caller's own reviews (ids and status only; contents through review_view).
create function public.my_reviews(p_org uuid)
returns table (review_id uuid, cycle_id uuid, cycle_name text, cycle_status public.cycle_status, status public.review_status, self_review_due date)
language sql stable security definer set search_path = '' as $$
  select r.id, c.id, c.name, c.status, r.status, c.self_review_due
    from public.reviews r join public.review_cycles c on c.id = r.cycle_id join public.employees e on e.id = r.employee_id
   where r.organization_id = p_org and e.user_id = auth.uid() and app.is_member(p_org)
   order by c.period_end desc;
$$;

create function public.submit_self_review(p_review uuid, p_rating smallint, p_comments text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.reviews;
  v_c public.review_cycles;
begin
  select * into v_r from public.reviews where id = p_review for update;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  if v_r.id is null or not app.is_own_employee(v_r.employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_c.status <> 'active' or v_r.status <> 'not_started' then
    raise exception 'Your self review can’t be changed now.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_comments, ''))) < 10 then
    raise exception 'Add a few sentences about your year.' using errcode = '22023';
  end if;
  update public.reviews set self_rating = p_rating, self_comments = btrim(p_comments), self_submitted_at = now(), status = 'self_submitted' where id = p_review;
  update public.tasks set status = 'done', completed_at = now(), completed_by = auth.uid()
   where subject_type = 'review_cycle' and subject_id = v_r.cycle_id and assignee_employee_id = v_r.employee_id and status = 'open';
  if v_r.manager_employee_id is not null then
    insert into public.tasks (organization_id, assignee_employee_id, title, due_on, subject_type, subject_id)
    select v_r.organization_id, v_r.manager_employee_id, 'Review ' || trim(concat_ws(' ', e.first_name, e.last_name)) || ': ' || v_c.name,
           v_c.manager_review_due, 'review', p_review
      from public.employees e where e.id = v_r.employee_id;
  end if;
end $$;

create function public.submit_manager_review(p_review uuid, p_rating smallint, p_comments text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.reviews;
  v_c public.review_cycles;
begin
  select * into v_r from public.reviews where id = p_review for update;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  if v_r.id is null or app.is_own_employee(v_r.employee_id)
     or not (exists (select 1 from public.employees m where m.id = v_r.manager_employee_id and m.user_id = auth.uid())
             or app.has_permission(v_r.organization_id, 'performance.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_c.status <> 'active' or v_r.status <> 'self_submitted' then
    raise exception 'The manager review opens after the self review, while the cycle is active.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_comments, ''))) < 10 then
    raise exception 'Explain the rating in a few sentences.' using errcode = '22023';
  end if;
  update public.reviews set manager_rating = p_rating, manager_comments = btrim(p_comments), manager_submitted_at = now(),
         status = 'manager_submitted', final_rating = p_rating where id = p_review;
  update public.tasks set status = 'done', completed_at = now(), completed_by = auth.uid()
   where subject_type = 'review' and subject_id = p_review and status = 'open';
end $$;

create function public.calibrate_review(p_review uuid, p_final_rating smallint, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.reviews;
  v_c public.review_cycles;
begin
  select * into v_r from public.reviews where id = p_review for update;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  if v_r.id is null or not app.has_permission(v_r.organization_id, 'performance.manage') or app.is_own_employee(v_r.employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_c.status not in ('active', 'calibration') or v_r.status not in ('manager_submitted', 'calibrated') then
    raise exception 'Calibrate after the manager review, before results are shared.' using errcode = '22023';
  end if;
  if p_final_rating is distinct from v_r.manager_rating and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Say why the final rating differs from the manager’s.' using errcode = '22023';
  end if;
  update public.reviews set final_rating = p_final_rating, calibration_note = nullif(btrim(p_note), ''), calibrated_by = auth.uid(), status = 'calibrated' where id = p_review;
end $$;

create function public.share_review_cycle(p_cycle uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.review_cycles;
  v_n int;
begin
  select * into v_c from public.review_cycles where id = p_cycle for update;
  if v_c.id is null or not app.has_permission(v_c.organization_id, 'performance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_c.status not in ('active', 'calibration') then
    raise exception 'Only an active cycle can be shared.' using errcode = '22023';
  end if;
  update public.review_cycles set status = 'shared', shared_at = now() where id = p_cycle;
  perform app.notify(v_c.organization_id, e.user_id, 'performance.shared', 'Your review for ' || v_c.name || ' is ready', null, '/performance')
     from public.reviews r join public.employees e on e.id = r.employee_id
    where r.cycle_id = p_cycle and r.final_rating is not null;
  select count(*) into v_n from public.reviews where cycle_id = p_cycle and final_rating is not null;
  return v_n;
end $$;

create function public.request_feedback(p_review uuid, p_from uuid, p_question text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r  public.reviews;
  v_id uuid;
  v_from public.employees;
begin
  select * into v_r from public.reviews where id = p_review;
  select * into v_from from public.employees where id = p_from and organization_id = v_r.organization_id and status <> 'exited';
  if v_r.id is null or v_from.id is null
     or not (app.is_own_employee(v_r.employee_id) or app.has_permission(v_r.organization_id, 'performance.manage')
             or exists (select 1 from public.employees m where m.id = v_r.manager_employee_id and m.user_id = auth.uid())) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from = v_r.employee_id then
    raise exception 'Ask someone other than the person being reviewed.' using errcode = '22023';
  end if;
  insert into public.feedback_requests (organization_id, review_id, from_employee_id, question)
  values (v_r.organization_id, p_review, p_from, btrim(p_question))
  on conflict (review_id, from_employee_id) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.tasks (organization_id, assignee_employee_id, title, subject_type, subject_id)
    select v_r.organization_id, p_from, 'Give feedback on ' || trim(concat_ws(' ', e.first_name, e.last_name)), 'feedback', v_id
      from public.employees e where e.id = v_r.employee_id;
  end if;
  return v_id;
end $$;

create function public.give_feedback(p_request uuid, p_response text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_f public.feedback_requests;
begin
  select * into v_f from public.feedback_requests where id = p_request for update;
  if v_f.id is null or not app.is_own_employee(v_f.from_employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_f.responded_at is not null then
    raise exception 'You have already answered this request.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_response, ''))) < 10 then
    raise exception 'Write a little more (at least a sentence).' using errcode = '22023';
  end if;
  update public.feedback_requests set response = btrim(p_response), responded_at = now() where id = p_request;
  update public.tasks set status = 'done', completed_at = now(), completed_by = auth.uid()
   where subject_type = 'feedback' and subject_id = p_request and status = 'open';
end $$;

-- The subject reads feedback about them, without names, once the cycle is shared.
create function public.my_feedback(p_review uuid) returns table (question text, response text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r public.reviews;
begin
  select * into v_r from public.reviews where id = p_review;
  if v_r.id is null or not app.is_own_employee(v_r.employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (select status from public.review_cycles where id = v_r.cycle_id) <> 'shared' then
    return;
  end if;
  return query select f.question, f.response from public.feedback_requests f where f.review_id = p_review and f.responded_at is not null order by f.responded_at;
end $$;

revoke all on function app.is_own_employee(uuid) from public;
grant execute on function app.is_own_employee(uuid) to authenticated, service_role;
revoke all on function public.my_reviews(uuid) from public, anon;
grant execute on function public.my_reviews(uuid) to authenticated, service_role;
revoke all on function public.activate_review_cycle(uuid) from public, anon;
revoke all on function public.review_view(uuid) from public, anon;
revoke all on function public.submit_self_review(uuid, smallint, text) from public, anon;
revoke all on function public.submit_manager_review(uuid, smallint, text) from public, anon;
revoke all on function public.calibrate_review(uuid, smallint, text) from public, anon;
revoke all on function public.share_review_cycle(uuid) from public, anon;
revoke all on function public.request_feedback(uuid, uuid, text) from public, anon;
revoke all on function public.give_feedback(uuid, text) from public, anon;
revoke all on function public.my_feedback(uuid) from public, anon;
grant execute on function public.activate_review_cycle(uuid) to authenticated, service_role;
grant execute on function public.review_view(uuid) to authenticated, service_role;
grant execute on function public.submit_self_review(uuid, smallint, text) to authenticated, service_role;
grant execute on function public.submit_manager_review(uuid, smallint, text) to authenticated, service_role;
grant execute on function public.calibrate_review(uuid, smallint, text) to authenticated, service_role;
grant execute on function public.share_review_cycle(uuid) to authenticated, service_role;
grant execute on function public.request_feedback(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.give_feedback(uuid, text) to authenticated, service_role;
grant execute on function public.my_feedback(uuid) to authenticated, service_role;
