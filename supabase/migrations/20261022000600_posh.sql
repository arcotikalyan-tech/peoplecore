-- PeopleCore · POSH: the Internal Committee and the statutory timeline of sexual harassment complaints, under the
-- Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 and its Rules.
--
-- * HR (grievance.manage) keeps the Internal Committee register: a woman presiding officer, members from the staff and
--   one external member (from an NGO or someone familiar with the issues), each for a term of up to three years.
--   Every member of the organization can see who is on it now (section 19(b): its composition is displayed).
-- * Current committee members handle POSH cases as investigators (read the case, write notes, move it along) in a
--   two-step session, unless the organization has made two-step optional. As for every case, anyone named in it never
--   sees it, and the person who raised it keeps the reporter's view.
-- * The people handling a POSH case record its statutory steps (copy of the complaint to the respondent, reply, end of
--   the inquiry, report to the employer, action taken); the app works out what falls due when.
-- * Awareness sessions, and the figures for the committee's annual report (section 21, rule 14).

-- ─── The Internal Committee ─────────────────────────────────────────────────

create table public.posh_committee_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  role             text not null check (role in ('presiding_officer', 'member', 'external_member')),
  employee_id      uuid,
  external_name    text check (char_length(external_name) between 2 and 120),
  external_org     text check (char_length(external_org) <= 160),
  woman            boolean not null,          -- at least half the committee are women, and a woman presides
  term_from        date not null,
  term_until       date not null,
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id),
  check ((role = 'external_member') = (employee_id is null)),
  check ((role = 'external_member') = (external_name is not null)),
  check (role = 'external_member' or external_org is null),
  check (term_until > term_from and term_until <= term_from + interval '3 years'),
  check (role <> 'presiding_officer' or woman)
);
create index posh_committee_members_org_idx on public.posh_committee_members (organization_id, term_until);
create unique index posh_committee_members_once on public.posh_committee_members (organization_id, employee_id, term_from) where employee_id is not null;
create trigger posh_committee_members_audit after insert or update or delete on public.posh_committee_members for each row execute function app.audit_row();
alter table public.posh_committee_members enable row level security;
create policy posh_committee_members_select on public.posh_committee_members for select to authenticated
  using (app.has_permission(organization_id, 'grievance.manage'));
create policy posh_committee_members_write on public.posh_committee_members for all to authenticated
  using (app.has_permission(organization_id, 'grievance.manage')) with check (app.has_permission(organization_id, 'grievance.manage'));
grant select, insert, update, delete on public.posh_committee_members to authenticated;
grant all on public.posh_committee_members to service_role;

-- Who is on the committee today, for every member of the organization: names and roles only.
create function public.posh_committee(p_org uuid)
returns table (role text, name text, external_org text, term_until date, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select m.role, coalesce(m.external_name, concat_ws(' ', e.first_name, e.last_name)), m.external_org, m.term_until,
         coalesce(e.user_id = auth.uid(), false)
    from public.posh_committee_members m
    left join public.employees e on e.id = m.employee_id
   where m.organization_id = p_org and app.is_member(p_org)
     and app.org_today(p_org) between m.term_from and m.term_until
   order by case m.role when 'presiding_officer' then 0 when 'member' then 1 else 2 end, 2;
$$;

-- Is the caller on the organization's committee today, in a session strong enough to open case files?
create function app.is_posh_committee_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_member(p_org) and app.role_mfa_ok(true, p_org) and exists (
    select 1 from public.posh_committee_members m join public.employees e on e.id = m.employee_id
     where m.organization_id = p_org and e.user_id = auth.uid() and e.status in ('active', 'on_notice')
       and app.org_today(p_org) between m.term_from and m.term_until);
$$;

-- The caller's relationship to a case: as before, plus current committee members on POSH cases (as investigators).
create or replace function app.grievance_role(p_case uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
           when app.is_own_employee(g.reporter_id) then 'reporter'
           when app.is_grievance_respondent(g.id) then null
           when app.has_permission(g.organization_id, 'grievance.manage') then 'manager'
           when app.has_permission(g.organization_id, 'grievance.read')
                and exists (select 1 from public.grievance_access a where a.grievance_id = g.id and a.user_id = auth.uid()) then 'investigator'
           when g.category = 'posh' and app.is_posh_committee_member(g.organization_id) then 'investigator'
         end
    from public.grievances g where g.id = p_case;
$$;

-- Notify a case's handlers: case managers, its investigators and, for POSH cases, the committee. Never the reporter
-- or anyone named in it.
create or replace function app.notify_grievance_handlers(p_case uuid, p_kind text, p_title text) returns void
language sql volatile security definer set search_path = '' as $$
  with g as (select * from public.grievances where id = p_case),
  named as (select e.user_id from public.grievance_respondents r join public.employees e on e.id = r.employee_id
             where r.grievance_id = p_case and e.user_id is not null),
  handlers as (
    select om.user_id from g
      join public.organization_members om on om.organization_id = g.organization_id and om.status = 'active'
     where app.member_holds_permission(g.organization_id, om.user_id, 'grievance.manage')
    union
    select a.user_id from public.grievance_access a where a.grievance_id = p_case
    union
    select e.user_id from g
      join public.posh_committee_members m on m.organization_id = g.organization_id
      join public.employees e on e.id = m.employee_id
     where g.category = 'posh' and e.user_id is not null and e.status in ('active', 'on_notice')
       and app.org_today(g.organization_id) between m.term_from and m.term_until)
  select app.notify(g.organization_id, h.user_id, p_kind, p_title, null, '/grievances/' || p_case)
    from g, handlers h
   where h.user_id not in (select user_id from named)
     and h.user_id is distinct from (select user_id from public.employees where id = g.reporter_id);
$$;

-- ─── The statutory steps of a POSH case ─────────────────────────────────────

create table public.posh_case_steps (
  grievance_id              uuid primary key,
  organization_id           uuid not null,
  filing_extended_on        date,   -- the committee extended the three-month limit (reasons in an internal note)
  conciliation_requested_on date,   -- the complainant asked for conciliation (section 10)
  conciliation_settled_on   date,   -- settled: no inquiry follows
  notice_sent_on            date,   -- copy of the complaint to the respondent (rule 7: within 7 working days)
  reply_received_on         date,   -- the respondent's reply (within 10 working days of the copy)
  inquiry_completed_on      date,   -- within 90 days of the complaint (section 11(4))
  report_sent_on            date,   -- findings to the employer within 10 days of the inquiry (section 13)
  action_taken_on           date,   -- the employer acts within 60 days of the report
  action_kind               text check (action_kind in ('written_apology', 'warning', 'reprimand', 'withholding_promotion', 'withholding_increment',
                                                         'termination', 'counselling', 'community_service', 'no_action', 'other')),
  updated_at                timestamptz not null default now(),
  updated_by                uuid default auth.uid(),
  foreign key (organization_id, grievance_id) references public.grievances (organization_id, id) on delete cascade,
  check ((action_taken_on is null) = (action_kind is null))
);
create trigger posh_case_steps_audit after insert or update on public.posh_case_steps for each row execute function app.audit_row();
alter table public.posh_case_steps enable row level security;
create policy posh_case_steps_select on public.posh_case_steps for select to authenticated
  using (app.grievance_role(grievance_id) in ('manager', 'investigator'));
grant select on public.posh_case_steps to authenticated;
grant all on public.posh_case_steps to service_role;

-- The people handling a POSH case record (or clear, with a null date) one of its steps.
create function public.record_posh_step(p_case uuid, p_step text, p_on date, p_action text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_g     public.grievances;
  v_s     public.posh_case_steps;
  v_filed date;
begin
  select * into v_g from public.grievances where id = p_case;
  if app.grievance_role(p_case) is distinct from 'manager' and app.grievance_role(p_case) is distinct from 'investigator' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_g.category <> 'posh' then
    raise exception 'Statutory steps are kept for POSH cases.' using errcode = '22023';
  end if;
  if v_g.status = 'withdrawn' then
    raise exception 'This case was withdrawn.' using errcode = '22023';
  end if;
  if p_step not in ('filing_extended', 'conciliation_requested', 'conciliation_settled', 'notice_sent', 'reply_received',
                    'inquiry_completed', 'report_sent', 'action_taken') then
    raise exception 'Choose a step.' using errcode = '22023';
  end if;
  select (v_g.created_at at time zone o.timezone)::date into v_filed from public.organizations o where o.id = v_g.organization_id;
  if p_on is not null and (p_on < v_filed or p_on > app.org_today(v_g.organization_id)) then
    raise exception 'Use a date between the complaint and today.' using errcode = '22023';
  end if;
  if p_step = 'action_taken' and p_on is not null and p_action is null then
    raise exception 'Choose the action taken.' using errcode = '22023';
  end if;
  insert into public.posh_case_steps (grievance_id, organization_id) values (p_case, v_g.organization_id) on conflict (grievance_id) do nothing;
  update public.posh_case_steps set
    filing_extended_on        = case when p_step = 'filing_extended' then p_on else filing_extended_on end,
    conciliation_requested_on = case when p_step = 'conciliation_requested' then p_on else conciliation_requested_on end,
    conciliation_settled_on   = case when p_step = 'conciliation_settled' then p_on else conciliation_settled_on end,
    notice_sent_on            = case when p_step = 'notice_sent' then p_on else notice_sent_on end,
    reply_received_on         = case when p_step = 'reply_received' then p_on else reply_received_on end,
    inquiry_completed_on      = case when p_step = 'inquiry_completed' then p_on else inquiry_completed_on end,
    report_sent_on            = case when p_step = 'report_sent' then p_on else report_sent_on end,
    action_taken_on           = case when p_step = 'action_taken' then p_on else action_taken_on end,
    action_kind               = case when p_step = 'action_taken' then case when p_on is null then null else p_action end else action_kind end,
    updated_at = now(), updated_by = auth.uid()
   where grievance_id = p_case
  returning * into v_s;
  if v_s.reply_received_on < v_s.notice_sent_on or v_s.report_sent_on < v_s.inquiry_completed_on or v_s.action_taken_on < v_s.report_sent_on
     or v_s.conciliation_settled_on < v_s.conciliation_requested_on then
    raise exception 'That date comes before the step it follows.' using errcode = '22023';
  end if;
end $$;

-- ─── Awareness sessions and the annual report ───────────────────────────────

create table public.posh_sessions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  held_on          date not null,
  audience         text not null check (audience in ('employees', 'committee')),   -- awareness workshops; committee orientation
  title            text not null check (char_length(title) between 3 and 160),
  attendees        integer check (attendees between 0 and 1000000),
  created_at       timestamptz not null default now()
);
create index posh_sessions_org_idx on public.posh_sessions (organization_id, held_on);
create trigger posh_sessions_audit after insert or update or delete on public.posh_sessions for each row execute function app.audit_row();
alter table public.posh_sessions enable row level security;
create policy posh_sessions_all on public.posh_sessions for all to authenticated
  using (app.has_permission(organization_id, 'grievance.manage')) with check (app.has_permission(organization_id, 'grievance.manage'));
grant select, insert, update, delete on public.posh_sessions to authenticated;
grant all on public.posh_sessions to service_role;

-- The figures for the committee's annual report for a calendar year: complaints received and disposed of, cases
-- pending more than 90 days at the year end, workshops held, and the actions taken. Counts only.
create function public.posh_annual_report(p_org uuid, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date;
  v_to   date;
  v_tz   text;
begin
  if not app.has_permission(p_org, 'grievance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2013 and 2100 then
    raise exception 'Choose a year.' using errcode = '22023';
  end if;
  v_from := make_date(p_year, 1, 1);
  v_to := make_date(p_year, 12, 31);
  select timezone into v_tz from public.organizations where id = p_org;
  return (
    with cases as (
      select g.id, (g.created_at at time zone v_tz)::date as filed, (coalesce(g.resolved_at, g.closed_at) at time zone v_tz)::date as done
        from public.grievances g where g.organization_id = p_org and g.category = 'posh')
    select jsonb_build_object(
      'year', p_year,
      'received', (select count(*) from cases where filed between v_from and v_to),
      'disposed', (select count(*) from cases where done between v_from and v_to),
      'pending_over_90_days', (select count(*) from cases where filed <= v_to - 90 and (done is null or done > v_to)),
      'workshops', (select count(*) from public.posh_sessions s where s.organization_id = p_org and s.audience = 'employees' and s.held_on between v_from and v_to),
      'committee_sessions', (select count(*) from public.posh_sessions s where s.organization_id = p_org and s.audience = 'committee' and s.held_on between v_from and v_to),
      'actions', coalesce((select jsonb_object_agg(a.action_kind, a.n) from (
          select s.action_kind, count(*) as n from public.posh_case_steps s join cases c on c.id = s.grievance_id
           where s.action_taken_on between v_from and v_to group by s.action_kind) a), '{}'::jsonb)));
end $$;

revoke all on function public.posh_committee(uuid) from public, anon;
revoke all on function app.is_posh_committee_member(uuid) from public;
revoke all on function public.record_posh_step(uuid, text, date, text) from public, anon;
revoke all on function public.posh_annual_report(uuid, integer) from public, anon;
grant execute on function public.posh_committee(uuid) to authenticated, service_role;
grant execute on function app.is_posh_committee_member(uuid) to authenticated, service_role;
grant execute on function public.record_posh_step(uuid, text, date, text) to authenticated, service_role;
grant execute on function public.posh_annual_report(uuid, integer) to authenticated, service_role;
