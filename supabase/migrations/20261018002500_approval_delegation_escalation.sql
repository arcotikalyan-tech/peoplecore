-- PeopleCore · Approval delegation and escalation (Phase 5, approvals engine v1.1).
--
-- * Delegation: someone away (or HR on their behalf) hands their reporting-manager approvals to a colleague for up
--   to 90 days. During that window the delegate sees and decides those requests too; the decision records that it
--   was made on the manager's behalf, and the manager is told. Only decisions made as a reporting manager are
--   delegated: permission-based steps (HR, finance, offers) already have several holders, and handing a privileged
--   permission to someone without it (or without two-step sign-in) would bypass the role model.
-- * Escalation: each step can escalate after N hours (72 by default). The worker then reminds the approvers and,
--   for a reporting-manager step, adds the manager's own manager as an approver (or, without one, the step's
--   permission holders such as HR). Escalation resets when the request moves to its next step.
-- * Maker ≠ checker is unchanged: nobody decides their own request, a request about themselves, or two steps of one.

-- ─── Delegation ─────────────────────────────────────────────────────────────

create table public.approval_delegations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  delegator_user_id  uuid not null,
  delegate_user_id   uuid not null,
  starts_on          date not null,
  ends_on            date not null,
  note               text check (char_length(note) <= 300),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz,
  revoked_by         uuid,
  unique (organization_id, id),
  check (delegator_user_id <> delegate_user_id),
  check (ends_on >= starts_on and ends_on - starts_on <= 90)
);
create index approval_delegations_delegator_idx on public.approval_delegations (organization_id, delegator_user_id) where revoked_at is null;
create index approval_delegations_delegate_idx on public.approval_delegations (organization_id, delegate_user_id) where revoked_at is null;
create trigger approval_delegations_audit after insert or update on public.approval_delegations for each row execute function app.audit_row();

alter table public.approval_delegations enable row level security;
create policy approval_delegations_select on public.approval_delegations for select to authenticated
  using (app.is_member(organization_id)
         and (delegator_user_id = auth.uid() or delegate_user_id = auth.uid() or app.has_permission(organization_id, 'member.manage')));
grant select on public.approval_delegations to authenticated;
grant all on public.approval_delegations to service_role;

-- Active members someone has delegated to, today in the organization's time zone.
create function app.active_delegates(p_org uuid, p_user uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select d.delegate_user_id
    from public.approval_delegations d
    join public.organization_members om on om.organization_id = d.organization_id and om.user_id = d.delegate_user_id and om.status = 'active'
   where d.organization_id = p_org and d.delegator_user_id = p_user and d.revoked_at is null
     and app.org_today(p_org) between d.starts_on and d.ends_on;
$$;

-- ─── Escalation state ───────────────────────────────────────────────────────

alter table app.approval_flow_templates add column escalate_after_hours smallint default 72 check (escalate_after_hours between 1 and 720);
update app.approval_flow_templates set escalate_after_hours = 72;
alter table public.approval_flow_steps add column escalate_after_hours smallint check (escalate_after_hours between 1 and 720);
update public.approval_flow_steps set escalate_after_hours = 72;
alter table public.approval_flow_steps alter column escalate_after_hours set default 72;

-- When the current step began (null for requests opened before this migration: then the last approval, or creation).
alter table public.approval_requests add column step_started_at timestamptz, add column escalated_at timestamptz;
alter table public.approval_requests alter column step_started_at set default now();

alter table public.approval_actions
  add column via text not null default 'direct' check (via in ('direct', 'delegation', 'escalation')),
  add column on_behalf_of uuid;

create or replace function app.seed_org_flows(p_org uuid, p_subject_type text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_type text;
  v_flow uuid;
begin
  for v_type in select distinct subject_type from app.approval_flow_templates
                 where p_subject_type is null or subject_type = p_subject_type loop
    continue when exists (select 1 from public.approval_flows where organization_id = p_org and subject_type = v_type and is_active);
    insert into public.approval_flows (organization_id, subject_type) values (p_org, v_type) returning id into v_flow;
    insert into public.approval_flow_steps (organization_id, flow_id, step_no, approver_rule, permission_key, label, escalate_after_hours)
    select p_org, v_flow, t.step_no, t.approver_rule, t.permission_key, t.label, t.escalate_after_hours
      from app.approval_flow_templates t where t.subject_type = v_type;
  end loop;
end $$;

-- ─── Who approves now ───────────────────────────────────────────────────────

-- The request subject's manager and that manager's manager (users who are active members), for reporting-line steps.
create function app.approval_line(p_request uuid, out manager_user uuid, out skip_user uuid)
language sql stable security definer set search_path = '' as $$
  select (select m.user_id
            from public.employees e
            join public.employees m on m.organization_id = e.organization_id and m.id = e.manager_employee_id
            join public.organization_members om on om.organization_id = m.organization_id and om.user_id = m.user_id and om.status = 'active'
           where e.id = r.subject_employee_id),
         (select s.user_id
            from public.employees e
            join public.employees m on m.organization_id = e.organization_id and m.id = e.manager_employee_id
            join public.employees s on s.organization_id = m.organization_id and s.id = m.manager_employee_id
            join public.organization_members om on om.organization_id = s.organization_id and om.user_id = s.user_id and om.status = 'active'
           where e.id = r.subject_employee_id)
    from public.approval_requests r where r.id = p_request;
$$;

-- Users who may decide the request's current step (notifications, the inbox, and can_decide_approval for
-- reporting-manager steps): the manager and whoever they have delegated to; after escalation also the manager's
-- manager (or, without one, the step's permission holders). Permission steps: the org-wide holders.
create or replace function app.current_approvers(p_request uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_req     public.approval_requests;
  v_step    public.approval_flow_steps;
  v_line    record;
  v_subject uuid;
begin
  select * into v_req from public.approval_requests where id = p_request;
  select * into v_step from public.approval_flow_steps where flow_id = v_req.flow_id and step_no = v_req.current_step;
  if v_req.id is null or v_req.status <> 'pending' or v_step.id is null then return; end if;
  select user_id into v_subject from public.employees where id = v_req.subject_employee_id;

  if v_step.approver_rule = 'reporting_manager' then
    select * into v_line from app.approval_line(p_request);
    -- The manager decides, unless there is none who can act (or they raised the request themselves).
    if v_line.manager_user is not null and v_line.manager_user <> v_req.requested_by then
      return next v_line.manager_user;
      return query select d from app.active_delegates(v_req.organization_id, v_line.manager_user) d
                    where d <> v_req.requested_by and d is distinct from v_subject;
      if v_req.escalated_at is null then return; end if;
      if v_line.skip_user is not null and v_line.skip_user <> v_req.requested_by and v_line.skip_user is distinct from v_subject then
        return next v_line.skip_user;
        return;
      end if;
    end if;
    if v_step.permission_key is null then return; end if;
  end if;

  -- Org-wide holders of the step's permission.
  return query
    select distinct om.user_id
      from public.organization_members om
      join public.member_roles mr on mr.member_id = om.id and (mr.valid_until is null or mr.valid_until > now())
      join public.role_permissions rp on rp.role_id = mr.role_id and rp.permission_key = v_step.permission_key and rp.scope = 'org'
     where om.organization_id = v_req.organization_id and om.status = 'active'
       and om.user_id <> v_req.requested_by;
end $$;

-- In what capacity the caller decides the current step: their own right, as the manager's delegate, or as the
-- skip-level manager after escalation.
create function app.approval_capacity(p_request uuid, out via text, out on_behalf_of uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_req  public.approval_requests;
  v_step public.approval_flow_steps;
  v_line record;
begin
  via := 'direct';
  select * into v_req from public.approval_requests where id = p_request;
  select * into v_step from public.approval_flow_steps where flow_id = v_req.flow_id and step_no = v_req.current_step;
  if v_step.approver_rule is distinct from 'reporting_manager' then return; end if;
  select * into v_line from app.approval_line(p_request);
  if v_line.manager_user is null or v_line.manager_user = auth.uid() or v_line.manager_user = v_req.requested_by then return; end if;
  if auth.uid() in (select app.active_delegates(v_req.organization_id, v_line.manager_user)) then
    via := 'delegation';
    on_behalf_of := v_line.manager_user;
  elsif v_req.escalated_at is not null then
    via := 'escalation';
  end if;
end $$;

create or replace function public.decide_approval(p_request uuid, p_decision text, p_comment text default null) returns public.approval_status
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req   public.approval_requests;
  v_cap   record;
  v_last  smallint;
  v_user  uuid;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;
  select * into v_req from public.approval_requests where id = p_request for update;
  if v_req.id is null or not app.can_decide_approval(p_request) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision = 'reject' and nullif(btrim(p_comment), '') is null then
    raise exception 'Give a reason when rejecting.' using errcode = '22023';
  end if;
  select * into v_cap from app.approval_capacity(p_request);
  insert into public.approval_actions (organization_id, request_id, step_no, actor_user_id, decision, comment, via, on_behalf_of)
  values (v_req.organization_id, v_req.id, v_req.current_step, auth.uid(), p_decision, nullif(btrim(p_comment), ''), v_cap.via, v_cap.on_behalf_of);
  if v_cap.via = 'delegation' then
    perform app.notify(v_req.organization_id, v_cap.on_behalf_of, 'approval.delegated_decision',
      case p_decision when 'approve' then 'Approved' else 'Rejected' end || ' on your behalf: ' || left(v_req.summary, 140), null, v_req.link);
  end if;

  if p_decision = 'reject' then
    update public.approval_requests set status = 'rejected', decided_at = now() where id = v_req.id returning * into v_req;
    perform app.run_approval_handler(v_req, 'rejected');
    return 'rejected';
  end if;

  select max(step_no) into v_last from public.approval_flow_steps where flow_id = v_req.flow_id;
  if v_req.current_step < v_last then
    update public.approval_requests set current_step = current_step + 1, step_started_at = now(), escalated_at = null where id = v_req.id;
    for v_user in select app.current_approvers(v_req.id) loop
      perform app.notify(v_req.organization_id, v_user, 'approval.requested', 'Approval needed: ' || left(v_req.summary, 150), null, '/inbox');
    end loop;
    return 'pending';
  end if;
  update public.approval_requests set status = 'approved', decided_at = now() where id = v_req.id returning * into v_req;
  perform app.run_approval_handler(v_req, 'approved');
  return 'approved';
end $$;

-- The caller's inbox, now saying when they act for someone else or on an escalated request.
drop function public.my_pending_approvals(uuid);
create function public.my_pending_approvals(p_org uuid)
returns table (id uuid, subject_type text, subject_id uuid, summary text, link text, step_label text,
               requested_by_name text, created_at timestamptz, via text, on_behalf_of_name text, escalated boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.subject_type, r.subject_id, r.summary, r.link, s.label,
         coalesce((select nullif(trim(concat_ws(' ', e.first_name, e.last_name)), '') from public.employees e
                    where e.organization_id = r.organization_id and e.user_id = r.requested_by), 'A colleague'),
         r.created_at, c.via,
         (select nullif(trim(concat_ws(' ', e.first_name, e.last_name)), '') from public.employees e
           where e.organization_id = r.organization_id and e.user_id = c.on_behalf_of),
         r.escalated_at is not null
    from public.approval_requests r
    join public.approval_flow_steps s on s.flow_id = r.flow_id and s.step_no = r.current_step
    cross join lateral app.approval_capacity(r.id) c
   where r.organization_id = p_org and r.status = 'pending' and app.can_decide_approval(r.id)
   order by r.created_at;
$$;

-- Worker: escalate requests that have waited at one step longer than the step allows (once per step).
create function public.worker_approval_escalations() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r      record;
  v_user uuid;
  v_n    int := 0;
begin
  for r in update public.approval_requests q set escalated_at = now()
             from public.approval_flow_steps s
            where s.flow_id = q.flow_id and s.step_no = q.current_step
              and q.status = 'pending' and q.escalated_at is null and s.escalate_after_hours is not null
              and coalesce(q.step_started_at,
                           (select max(a.acted_at) from public.approval_actions a where a.request_id = q.id),
                           q.created_at) < now() - make_interval(hours => s.escalate_after_hours)
           returning q.id, q.organization_id, q.summary loop
    v_n := v_n + 1;
    for v_user in select app.current_approvers(r.id) loop
      perform app.notify(r.organization_id, v_user, 'approval.escalated', 'Overdue approval: ' || left(r.summary, 140), null, '/inbox');
    end loop;
  end loop;
  return jsonb_build_object('escalated', v_n);
end $$;

-- ─── Delegation functions ───────────────────────────────────────────────────

-- Delegate your reporting-manager approvals (or, with member.manage, someone else's) for a date range.
create function public.delegate_approvals(p_org uuid, p_delegate uuid, p_starts date, p_ends date,
                                          p_note text default null, p_delegator uuid default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_from  uuid := coalesce(p_delegator, auth.uid());
  v_id    uuid;
  v_name  text;
begin
  if not app.is_member(p_org) or (v_from <> auth.uid() and not app.has_permission(p_org, 'member.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = p_org and user_id = v_from and status = 'active') then
    raise exception 'Choose a current member.' using errcode = '22023';
  end if;
  if p_delegate = v_from then
    raise exception 'Choose someone else to approve.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_delegate and status = 'active') then
    raise exception 'Choose a colleague who can sign in.' using errcode = '22023';
  end if;
  if p_starts is null or p_ends is null or p_starts < app.org_today(p_org) then
    raise exception 'Start today or later.' using errcode = '22023';
  end if;
  if p_ends < p_starts then
    raise exception 'The end date is before the start date.' using errcode = '22023';
  end if;
  if p_ends - p_starts > 90 then
    raise exception 'Delegate for at most 90 days at a time.' using errcode = '22023';
  end if;
  if exists (select 1 from public.approval_delegations
              where organization_id = p_org and delegator_user_id = v_from and revoked_at is null
                and starts_on <= p_ends and ends_on >= p_starts) then
    raise exception 'There is already a delegation for some of these days. End it first.' using errcode = '22023';
  end if;
  insert into public.approval_delegations (organization_id, delegator_user_id, delegate_user_id, starts_on, ends_on, note)
  values (p_org, v_from, p_delegate, p_starts, p_ends, nullif(btrim(p_note), ''))
  returning id into v_id;
  select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'A colleague') into v_name
    from public.employees where organization_id = p_org and user_id = v_from;
  perform app.notify(p_org, p_delegate, 'approval.delegated', coalesce(v_name, 'A colleague') || ' asked you to approve on their behalf',
    'From ' || to_char(p_starts, 'DD Mon') || ' to ' || to_char(p_ends, 'DD Mon YYYY') || '. Their team’s requests will appear in your inbox.', '/inbox');
  return v_id;
end $$;

create function public.end_delegation(p_delegation uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_d public.approval_delegations;
begin
  select * into v_d from public.approval_delegations where id = p_delegation for update;
  if v_d.id is null or not app.is_member(v_d.organization_id)
     or not (v_d.delegator_user_id = auth.uid() or v_d.created_by = auth.uid() or app.has_permission(v_d.organization_id, 'member.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_d.revoked_at is not null then
    raise exception 'This delegation has already ended.' using errcode = '22023';
  end if;
  update public.approval_delegations set revoked_at = now(), revoked_by = auth.uid() where id = p_delegation;
end $$;

-- Active members with their names (for choosing a delegate). Members only.
create function public.member_directory(p_org uuid)
returns table (user_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select om.user_id, coalesce(nullif(trim(concat_ws(' ', e.first_name, e.last_name)), ''), 'Member')
    from public.organization_members om
    left join public.employees e on e.organization_id = om.organization_id and e.user_id = om.user_id
   where app.is_member(p_org) and om.organization_id = p_org and om.status = 'active'
   order by 2
   limit 1000;
$$;

revoke all on function app.active_delegates(uuid, uuid) from public;
revoke all on function app.approval_line(uuid) from public;
revoke all on function app.approval_capacity(uuid) from public;
grant execute on function app.approval_capacity(uuid) to authenticated, service_role;
revoke all on function public.my_pending_approvals(uuid) from public, anon;
grant execute on function public.my_pending_approvals(uuid) to authenticated, service_role;
revoke all on function public.worker_approval_escalations() from public, anon, authenticated;
grant execute on function public.worker_approval_escalations() to service_role;
revoke all on function public.delegate_approvals(uuid, uuid, date, date, text, uuid) from public, anon;
revoke all on function public.end_delegation(uuid) from public, anon;
revoke all on function public.member_directory(uuid) from public, anon;
grant execute on function public.delegate_approvals(uuid, uuid, date, date, text, uuid) to authenticated, service_role;
grant execute on function public.end_delegation(uuid) to authenticated, service_role;
grant execute on function public.member_directory(uuid) to authenticated, service_role;
