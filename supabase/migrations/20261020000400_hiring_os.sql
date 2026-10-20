-- PeopleCore · Hiring OS (Kredily's Hiring OS: hub, recruitment, pipeline, outreach, insights, settings).
--
-- Builds on recruitment (requisitions, candidates, applications, interviews, scorecards, offers, careers page):
-- * hiring_plans / hiring_plan_lines: planned headcount by department for a month, quarter or year.
-- * talent_pools / talent_pool_members: candidates grouped for nurture and re-engagement.
-- * recruiting_email_templates: templates with {{variables}} for the usual candidate messages (seeded per organization).
-- * recruiting_spend: money spent per source and month, for cost per hire.
-- * recruitment_settings gains automations: the stalled-candidate threshold and notifying the hiring manager of a new
--   applicant. (Hiring already closes a requisition once every opening is filled.)
-- * recruiting_activity: the recruitment slice of the audit trail for people who read recruitment org-wide.
-- Reads: recruitment.read (org); writes: recruitment.manage. RLS decides.

-- ─── Hiring plans ───────────────────────────────────────────────────────────

create table public.hiring_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 120),
  period_kind      text not null check (period_kind in ('month', 'quarter', 'year')),
  period_start     date not null check (extract(day from period_start) = 1),
  note             text check (char_length(note) <= 500),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create trigger hiring_plans_audit after insert or update or delete on public.hiring_plans for each row execute function app.audit_row();

create table public.hiring_plan_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  plan_id          uuid not null,
  department_id    uuid not null,
  headcount        smallint not null check (headcount between 1 and 10000),
  budget           numeric(14,2) check (budget >= 0),
  unique (plan_id, department_id),
  foreign key (organization_id, plan_id) references public.hiring_plans (organization_id, id) on delete cascade,
  foreign key (organization_id, department_id) references public.departments (organization_id, id)
);
create trigger hiring_plan_lines_audit after insert or update or delete on public.hiring_plan_lines for each row execute function app.audit_row();

-- ─── Talent pools ───────────────────────────────────────────────────────────

create table public.talent_pools (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  description      text check (char_length(description) <= 300),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);
create trigger talent_pools_audit after insert or update or delete on public.talent_pools for each row execute function app.audit_row();

create table public.talent_pool_members (
  organization_id  uuid not null,
  pool_id          uuid not null,
  candidate_id     uuid not null,
  note             text check (char_length(note) <= 300),
  added_by         uuid default auth.uid(),
  added_at         timestamptz not null default now(),
  primary key (pool_id, candidate_id),
  foreign key (organization_id, pool_id) references public.talent_pools (organization_id, id) on delete cascade,
  foreign key (organization_id, candidate_id) references public.candidates (organization_id, id) on delete cascade
);
create trigger talent_pool_members_audit after insert or delete on public.talent_pool_members for each row execute function app.audit_row();

-- ─── Email templates ────────────────────────────────────────────────────────

create table public.recruiting_email_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  kind             text not null default 'custom' check (kind in ('application_received', 'interview_invite', 'rejection', 'offer', 'follow_up', 'custom')),
  subject          text not null check (char_length(subject) between 2 and 200),
  body             text not null check (char_length(body) between 2 and 5000),
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)
);
create trigger recruiting_email_templates_touch before update on public.recruiting_email_templates for each row execute function app.touch_updated_at();
create trigger recruiting_email_templates_audit after insert or update or delete on public.recruiting_email_templates for each row execute function app.audit_row();

create function app.seed_recruiting_templates(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.recruiting_email_templates (organization_id, name, kind, subject, body, updated_by) values
    (p_org, 'Application received', 'application_received', 'We received your application for {{job_title}}',
     E'Hi {{candidate_first_name}},\n\nThank you for applying for {{job_title}} at {{company}}. Our team is reviewing your application and will get back to you soon.\n\nRegards,\n{{recruiter_name}}', null),
    (p_org, 'Interview invitation', 'interview_invite', 'Interview for {{job_title}} at {{company}}',
     E'Hi {{candidate_first_name}},\n\nWe would like to invite you to an interview for {{job_title}} on {{interview_time}}.\n\nPlease reply to confirm.\n\nRegards,\n{{recruiter_name}}', null),
    (p_org, 'Not moving forward', 'rejection', 'Your application for {{job_title}}',
     E'Hi {{candidate_first_name}},\n\nThank you for your interest in {{job_title}} at {{company}}. After careful consideration we will not be moving forward with your application at this time.\n\nWe wish you the very best.\n\nRegards,\n{{recruiter_name}}', null),
    (p_org, 'Offer', 'offer', 'Your offer from {{company}}',
     E'Hi {{candidate_first_name}},\n\nWe are delighted to offer you the role of {{job_title}} at {{company}}. Your offer letter is attached.\n\nRegards,\n{{recruiter_name}}', null),
    (p_org, 'Follow-up', 'follow_up', 'Following up on {{job_title}}',
     E'Hi {{candidate_first_name}},\n\nI wanted to follow up on your application for {{job_title}}. Do let me know if you have any questions.\n\nRegards,\n{{recruiter_name}}', null)
  on conflict (organization_id, name) do nothing;
$$;
select app.seed_recruiting_templates(id) from public.organizations;
create function app.seed_recruiting_templates_trigger() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_recruiting_templates(new.id);
  return new;
end $$;
create trigger organizations_recruiting_templates after insert on public.organizations for each row execute function app.seed_recruiting_templates_trigger();

-- ─── Spend ──────────────────────────────────────────────────────────────────

create table public.recruiting_spend (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  source           public.candidate_source not null,
  month            date not null check (extract(day from month) = 1),
  amount           numeric(14,2) not null check (amount > 0 and amount < 1000000000),
  note             text check (char_length(note) <= 200),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create trigger recruiting_spend_audit after insert or update or delete on public.recruiting_spend for each row execute function app.audit_row();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.hiring_plans enable row level security;
alter table public.hiring_plan_lines enable row level security;
alter table public.talent_pools enable row level security;
alter table public.talent_pool_members enable row level security;
alter table public.recruiting_email_templates enable row level security;
alter table public.recruiting_spend enable row level security;

create policy hiring_plans_select on public.hiring_plans for select to authenticated using (app.has_permission(organization_id, 'recruitment.read'));
create policy hiring_plans_write on public.hiring_plans for all to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage')) with check (app.has_permission(organization_id, 'recruitment.manage'));
create policy hiring_plan_lines_select on public.hiring_plan_lines for select to authenticated using (app.has_permission(organization_id, 'recruitment.read'));
create policy hiring_plan_lines_write on public.hiring_plan_lines for all to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage')) with check (app.has_permission(organization_id, 'recruitment.manage'));
create policy talent_pools_select on public.talent_pools for select to authenticated using (app.has_permission(organization_id, 'recruitment.read'));
create policy talent_pools_write on public.talent_pools for all to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage')) with check (app.has_permission(organization_id, 'recruitment.manage'));
create policy talent_pool_members_select on public.talent_pool_members for select to authenticated using (app.has_permission(organization_id, 'recruitment.read'));
create policy talent_pool_members_write on public.talent_pool_members for all to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage')) with check (app.has_permission(organization_id, 'recruitment.manage'));
create policy recruiting_email_templates_select on public.recruiting_email_templates for select to authenticated using (app.has_permission(organization_id, 'recruitment.read'));
create policy recruiting_email_templates_write on public.recruiting_email_templates for all to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage')) with check (app.has_permission(organization_id, 'recruitment.manage'));
create policy recruiting_spend_select on public.recruiting_spend for select to authenticated using (app.has_permission(organization_id, 'recruitment.read'));
create policy recruiting_spend_write on public.recruiting_spend for all to authenticated
  using (app.has_permission(organization_id, 'recruitment.manage')) with check (app.has_permission(organization_id, 'recruitment.manage'));

grant select, insert, update, delete on public.hiring_plans, public.hiring_plan_lines, public.talent_pools, public.talent_pool_members,
  public.recruiting_email_templates, public.recruiting_spend to authenticated;
grant all on public.hiring_plans, public.hiring_plan_lines, public.talent_pools, public.talent_pool_members,
  public.recruiting_email_templates, public.recruiting_spend to service_role;
revoke all on function app.seed_recruiting_templates(uuid), app.seed_recruiting_templates_trigger() from public;
grant execute on function app.seed_recruiting_templates(uuid) to service_role;

-- ─── Automations ────────────────────────────────────────────────────────────

alter table public.recruitment_settings
  add column stall_days smallint not null default 7 check (stall_days between 1 and 90),
  add column notify_hiring_manager boolean not null default true;

create function public.save_recruiting_automations(p_org uuid, p_stall_days smallint, p_notify boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'recruitment.manage') then
    raise exception 'You can''t change recruitment settings.' using errcode = '42501';
  end if;
  if p_stall_days is null or p_stall_days < 1 or p_stall_days > 90 then
    raise exception 'Stalled after must be between 1 and 90 days.' using errcode = '22023';
  end if;
  insert into public.recruitment_settings (organization_id, stall_days, notify_hiring_manager, updated_by)
  values (p_org, p_stall_days, coalesce(p_notify, true), auth.uid())
  on conflict (organization_id) do update set stall_days = excluded.stall_days, notify_hiring_manager = excluded.notify_hiring_manager,
     updated_by = excluded.updated_by;
end $$;
revoke all on function public.save_recruiting_automations(uuid, smallint, boolean) from public;
grant execute on function public.save_recruiting_automations(uuid, smallint, boolean) to authenticated;

-- A new applicant: the requisition's hiring manager hears about it (unless they added the candidate themselves).
create function app.recruiting_new_applicant() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r        public.job_requisitions;
  v_user   uuid;
  v_name   text;
begin
  if not coalesce((select notify_hiring_manager from public.recruitment_settings where organization_id = new.organization_id), true) then
    return new;
  end if;
  select * into r from public.job_requisitions where id = new.requisition_id;
  if r.hiring_manager_employee_id is null then return new; end if;
  select user_id into v_user from public.employees where id = r.hiring_manager_employee_id;
  if v_user is not null and v_user is distinct from auth.uid() then
    select trim(first_name || ' ' || coalesce(last_name, '')) into v_name from public.candidates where id = new.candidate_id;
    perform app.notify(new.organization_id, v_user, 'recruitment.applicant', 'New applicant for ' || left(r.title, 120),
                       coalesce(v_name, 'A candidate') || ' applied.', '/recruitment/' || r.id);
  end if;
  return new;
end $$;
create trigger applications_new_applicant after insert on public.applications for each row execute function app.recruiting_new_applicant();

-- ─── Activity log ───────────────────────────────────────────────────────────

create function public.recruiting_activity(p_org uuid, p_limit integer default 200)
returns table (occurred_at timestamptz, actor text, action text, entity_type text, entity_id uuid, subject text, changes jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'recruitment.read') then
    raise exception 'You can''t view recruitment activity.' using errcode = '42501';
  end if;
  return query
    select a.occurred_at,
           coalesce((select trim(e.first_name || ' ' || coalesce(e.last_name, '')) from public.employees e where e.organization_id = p_org and e.user_id = a.actor_user_id), 'System'),
           a.action, a.entity_type, a.entity_id,
           coalesce(
             case a.entity_type
               when 'candidates' then (select trim(c.first_name || ' ' || coalesce(c.last_name, '')) from public.candidates c where c.id = a.entity_id)
               when 'applications' then (select trim(c.first_name || ' ' || coalesce(c.last_name, '')) || ' · ' || r.title
                                           from public.applications ap join public.candidates c on c.id = ap.candidate_id
                                           join public.job_requisitions r on r.id = ap.requisition_id where ap.id = a.entity_id)
               when 'job_requisitions' then (select r.title from public.job_requisitions r where r.id = a.entity_id)
               when 'interviews' then (select i.round_name from public.interviews i where i.id = a.entity_id)
               else null
             end, '—'),
           a.changes - 'first_name' - 'last_name' - 'email' - 'phone' - 'current_company' - 'outcome_note'
      from public.audit_events a
     where a.organization_id = p_org
       and a.entity_type in ('job_requisitions', 'candidates', 'applications', 'interviews', 'offers', 'offer_versions', 'scorecards',
                             'hiring_plans', 'talent_pools', 'talent_pool_members', 'recruiting_email_templates', 'recruiting_spend')
     order by a.occurred_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;
revoke all on function public.recruiting_activity(uuid, integer) from public;
grant execute on function public.recruiting_activity(uuid, integer) to authenticated;

-- ─── Team ───────────────────────────────────────────────────────────────────

-- Who works in recruitment: active members whose roles grant recruitment.manage or recruitment.read, with the scope.
-- Names and work emails only; roles are changed in Members (member.manage / role.manage).
create function public.recruiting_team(p_org uuid)
returns table (user_id uuid, name text, email text, roles text[], access text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'recruitment.read') then
    raise exception 'You can''t view the recruitment team.' using errcode = '42501';
  end if;
  return query
    select m.user_id,
           coalesce(trim(e.first_name || ' ' || coalesce(e.last_name, '')), u.email::text),
           coalesce(e.work_email, u.email::text),
           array_agg(distinct r.name order by r.name),
           case when bool_or(rp.permission_key = 'recruitment.manage' and rp.scope = 'org') then 'Manage (all jobs)'
                when bool_or(rp.permission_key = 'recruitment.manage') then 'Manage (own team''s jobs)'
                when bool_or(rp.scope = 'org') then 'View (all jobs)'
                else 'View (own team''s jobs)' end
      from public.organization_members m
      join public.member_roles mr on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
      join public.roles r on r.id = mr.role_id
      join public.role_permissions rp on rp.role_id = r.id and rp.permission_key in ('recruitment.manage', 'recruitment.read')
      left join public.employees e on e.organization_id = p_org and e.user_id = m.user_id
      left join auth.users u on u.id = m.user_id
     where m.organization_id = p_org and m.status = 'active'
     group by m.user_id, e.first_name, e.last_name, e.work_email, u.email
     order by 2;
end $$;
revoke all on function public.recruiting_team(uuid) from public;
grant execute on function public.recruiting_team(uuid) to authenticated;
