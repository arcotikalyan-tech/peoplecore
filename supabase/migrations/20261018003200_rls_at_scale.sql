-- Row-level security that scales (Phase 8 load test: 50,000 employees).
--
-- Policies called app.can_access_employee() or app.has_permission() once per row, so listing 50,000 employees
-- made 50,000 permission lookups (9.5 s for HR's first directory page). These two helpers compute the caller's
-- reach once per query instead: Postgres runs an uncorrelated `x IN (SELECT …)` once and hashes it.
--
--   app.orgs_with_scope(p, s)   organizations where the caller holds permission p at scope s
--                               (the same joins as app.permission_scopes: active membership and organization,
--                               unexpired roles, two-step roles only in aal2 sessions)
--   app.employees_in_scope(p)   employees the caller reaches with p through 'self' (themselves) or 'team'
--                               (their reporting line, walked down at most 30 levels, the same relation that
--                               app.is_in_reporting_line walks up)
--
-- Every policy that used the per-row functions is rewritten mechanically with the identical meaning:
--   app.can_access_employee(o, e, p)  →  o IN (orgs_with_scope(p, 'org')) OR e IN (employees_in_scope(p))
--   app.has_permission(o, p)          →  o IN (orgs_with_scope(p, 'org'))
-- The functions themselves stay for RPCs, which check one row at a time.

create function app.orgs_with_scope(p_permission text, p_scope public.permission_scope) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct m.organization_id
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.member_roles mr
      on mr.member_id = m.id and (mr.valid_until is null or mr.valid_until > now())
    join public.roles r
      on r.id = mr.role_id and (not r.requires_mfa or app.current_aal() = 'aal2')
    join public.role_permissions rp
      on rp.role_id = mr.role_id and rp.permission_key = p_permission and rp.scope = p_scope
   where m.user_id = auth.uid()
     and m.status = 'active';
$$;

create function app.employees_in_scope(p_permission text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive
  mine as (
    select e.id, e.organization_id from public.employees e where e.user_id = auth.uid()
  ),
  line as (
    select e.id, e.organization_id, 1 as depth
      from mine m
      join public.employees e on e.organization_id = m.organization_id and e.manager_employee_id = m.id
     where m.organization_id in (select app.orgs_with_scope(p_permission, 'team'))
    union all
    select e.id, e.organization_id, l.depth + 1
      from line l
      join public.employees e on e.organization_id = l.organization_id and e.manager_employee_id = l.id
     where l.depth < 30
  )
  select m.id from mine m where m.organization_id in (select app.orgs_with_scope(p_permission, 'self'))
  union
  select l.id from line l;
$$;

revoke all on function app.orgs_with_scope(text, public.permission_scope) from public;
revoke all on function app.employees_in_scope(text) from public;
grant execute on function app.orgs_with_scope(text, public.permission_scope) to authenticated, service_role;
grant execute on function app.employees_in_scope(text) to authenticated, service_role;

-- The directory lists people by name; with this index a page reads 25 rows in order instead of sorting everyone.
create index employees_org_name_idx on public.employees (organization_id, first_name, last_name, id);

-- ─── Policies (generated from the definitions in force after 20261018003100; same meaning) ──────────────────

alter policy access_systems_write on public.access_systems
  using (((organization_id) IN (SELECT app.orgs_with_scope('asset.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('asset.manage'::text, 'org'::public.permission_scope))));
alter policy ai_runs_select on public.ai_runs
  using (((user_id = auth.uid()) OR ((organization_id) IN (SELECT app.orgs_with_scope('ai.manage'::text, 'org'::public.permission_scope)))));
alter policy announcement_acks_select on public.announcement_acknowledgements
  using ((app.is_own_employee(employee_id) OR ((organization_id) IN (SELECT app.orgs_with_scope('announcement.manage'::text, 'org'::public.permission_scope)))));
alter policy announcements_select on public.announcements
  using ((((organization_id) IN (SELECT app.orgs_with_scope('announcement.manage'::text, 'org'::public.permission_scope))) OR ((published_at <= now()) AND ((expires_at IS NULL) OR (expires_at > now())) AND app.in_audience(organization_id, department_id, location_id))));
alter policy announcements_write on public.announcements
  using (((organization_id) IN (SELECT app.orgs_with_scope('announcement.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('announcement.manage'::text, 'org'::public.permission_scope))));
alter policy anomaly_flags_select on public.anomaly_flags
  using ((((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('attendance.approve'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('attendance.approve'::text)))));
alter policy applications_insert on public.applications
  with check (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))));
alter policy applications_update on public.applications
  using (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))));
alter policy approval_delegations_select on public.approval_delegations
  using ((app.is_member(organization_id) AND ((delegator_user_id = auth.uid()) OR (delegate_user_id = auth.uid()) OR ((organization_id) IN (SELECT app.orgs_with_scope('member.manage'::text, 'org'::public.permission_scope))))));
alter policy approval_flow_steps_write on public.approval_flow_steps
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy asset_assignments_select on public.asset_assignments
  using ((((organization_id) IN (SELECT app.orgs_with_scope('asset.manage'::text, 'org'::public.permission_scope))) OR app.is_own_employee(employee_id)));
alter policy assets_select on public.assets
  using ((((organization_id) IN (SELECT app.orgs_with_scope('asset.manage'::text, 'org'::public.permission_scope))) OR (EXISTS ( SELECT 1
   FROM asset_assignments a
  WHERE ((a.asset_id = assets.id) AND app.is_own_employee(a.employee_id))))));
alter policy assets_write on public.assets
  using (((organization_id) IN (SELECT app.orgs_with_scope('asset.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('asset.manage'::text, 'org'::public.permission_scope))));
alter policy attendance_days_select on public.attendance_days
  using (((organization_id) IN (SELECT app.orgs_with_scope('attendance.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('attendance.read'::text))));
alter policy attendance_punches_select on public.attendance_punches
  using (((organization_id) IN (SELECT app.orgs_with_scope('attendance.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('attendance.read'::text))));
alter policy audit_events_select on public.audit_events
  using (((organization_id IS NOT NULL) AND ((organization_id) IN (SELECT app.orgs_with_scope('audit.read'::text, 'org'::public.permission_scope)))));
alter policy biometric_devices_write on public.biometric_devices
  using (((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))));
alter policy candidates_insert on public.candidates
  with check (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))));
alter policy candidates_update on public.candidates
  using (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))));
alter policy compensation_lines_select on public.compensation_lines
  using ((EXISTS ( SELECT 1
   FROM compensation_records r
  WHERE ((r.id = compensation_lines.record_id) AND ((r.organization_id) IN (SELECT app.orgs_with_scope('compensation.read'::text, 'org'::public.permission_scope)) OR (r.employee_id) IN (SELECT app.employees_in_scope('compensation.read'::text)))))));
alter policy compensation_records_select on public.compensation_records
  using (((organization_id) IN (SELECT app.orgs_with_scope('compensation.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('compensation.read'::text))));
alter policy cost_centres_delete on public.cost_centres
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy cost_centres_insert on public.cost_centres
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy cost_centres_update on public.cost_centres
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy course_enrollments_select on public.course_enrollments
  using ((app.is_own_employee(employee_id) OR ((organization_id) IN (SELECT app.orgs_with_scope('learning.manage'::text, 'org'::public.permission_scope))) OR app.is_in_reporting_line(organization_id, employee_id)));
alter policy courses_select on public.courses
  using (((is_active AND app.is_member(organization_id)) OR ((organization_id) IN (SELECT app.orgs_with_scope('learning.manage'::text, 'org'::public.permission_scope))) OR (EXISTS ( SELECT 1
   FROM course_enrollments x
  WHERE ((x.course_id = courses.id) AND app.is_own_employee(x.employee_id))))));
alter policy courses_write on public.courses
  using (((organization_id) IN (SELECT app.orgs_with_scope('learning.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('learning.manage'::text, 'org'::public.permission_scope))));
alter policy departments_delete on public.departments
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy departments_insert on public.departments
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy departments_update on public.departments
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy designations_delete on public.designations
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy designations_insert on public.designations
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy designations_update on public.designations
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy emergency_contacts_delete on public.emergency_contacts
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.update'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.update'::text))));
alter policy emergency_contacts_insert on public.emergency_contacts
  with check (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.update'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.update'::text))));
alter policy emergency_contacts_select on public.emergency_contacts
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.read'::text))));
alter policy emergency_contacts_update on public.emergency_contacts
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.update'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.update'::text))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.update'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.update'::text))));
alter policy employee_documents_select on public.employee_documents
  using (((deleted_at IS NULL) AND ((organization_id) IN (SELECT app.orgs_with_scope('employee.document.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.document.read'::text)))));
alter policy employee_personal_delete on public.employee_personal
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.update'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.update'::text))));
alter policy employee_personal_insert on public.employee_personal
  with check (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.update'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.update'::text))));
alter policy employee_personal_select on public.employee_personal
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.read'::text))));
alter policy employee_personal_update on public.employee_personal
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.update'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.update'::text))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('employee.personal.update'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.personal.update'::text))));
alter policy employee_statutory_profiles_select on public.employee_statutory_profiles
  using ((((organization_id) IN (SELECT app.orgs_with_scope('compensation.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('compensation.read'::text))) OR app.is_payroll_staff(organization_id)));
alter policy employee_statutory_profiles_write on public.employee_statutory_profiles
  using (((organization_id) IN (SELECT app.orgs_with_scope('payroll.prepare'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('payroll.prepare'::text, 'org'::public.permission_scope))));
alter policy employees_insert on public.employees
  with check (((organization_id) IN (SELECT app.orgs_with_scope('employee.create'::text, 'org'::public.permission_scope))));
alter policy employees_select on public.employees
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.read'::text, 'org'::public.permission_scope)) OR (id) IN (SELECT app.employees_in_scope('employee.read'::text))));
alter policy employees_update on public.employees
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.update'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('employee.update'::text, 'org'::public.permission_scope))));
alter policy employment_records_insert on public.employment_records
  with check ((((organization_id) IN (SELECT app.orgs_with_scope('employee.create'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('employee.update'::text, 'org'::public.permission_scope)))));
alter policy employment_records_select on public.employment_records
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.read'::text))));
alter policy employment_records_update on public.employment_records
  using (((organization_id) IN (SELECT app.orgs_with_scope('employee.update'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('employee.update'::text, 'org'::public.permission_scope))));
alter policy expense_categories_write on public.expense_categories
  using (((organization_id) IN (SELECT app.orgs_with_scope('expense.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('expense.manage'::text, 'org'::public.permission_scope))));
alter policy feedback_requests_select on public.feedback_requests
  using ((app.is_own_employee(from_employee_id) OR ((organization_id) IN (SELECT app.orgs_with_scope('performance.manage'::text, 'org'::public.permission_scope))) OR (EXISTS ( SELECT 1
   FROM reviews r
  WHERE ((r.id = feedback_requests.review_id) AND (NOT app.is_own_employee(r.employee_id)) AND (((r.organization_id) IN (SELECT app.orgs_with_scope('performance.read'::text, 'org'::public.permission_scope)) OR (r.employee_id) IN (SELECT app.employees_in_scope('performance.read'::text))) OR app.is_own_employee(r.manager_employee_id)))))));
alter policy fnf_settlements_select on public.fnf_settlements
  using ((app.is_payroll_staff(organization_id) OR ((organization_id) IN (SELECT app.orgs_with_scope('separation.manage'::text, 'org'::public.permission_scope))) OR ((status = 'approved'::text) AND app.is_own_employee(employee_id))));
alter policy geofences_write on public.geofences
  using (((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))));
alter policy goals_select on public.goals
  using (((organization_id) IN (SELECT app.orgs_with_scope('performance.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('performance.read'::text))));
alter policy goals_write on public.goals
  using (((organization_id) IN (SELECT app.orgs_with_scope('performance.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('performance.read'::text))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('performance.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('performance.read'::text))));
alter policy holiday_calendars_delete on public.holiday_calendars
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy holiday_calendars_insert on public.holiday_calendars
  with check (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy holiday_calendars_update on public.holiday_calendars
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy holidays_delete on public.holidays
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy holidays_insert on public.holidays
  with check (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy holidays_update on public.holidays
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy job_requisitions_insert on public.job_requisitions
  with check (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))));
alter policy job_requisitions_update on public.job_requisitions
  using (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('recruitment.manage'::text, 'org'::public.permission_scope))));
alter policy kb_articles_select on public.kb_articles
  using (((published AND app.is_member(organization_id)) OR ((organization_id) IN (SELECT app.orgs_with_scope('helpdesk.manage'::text, 'org'::public.permission_scope)))));
alter policy kb_articles_write on public.kb_articles
  using (((organization_id) IN (SELECT app.orgs_with_scope('helpdesk.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('helpdesk.manage'::text, 'org'::public.permission_scope))));
alter policy leave_ledger_select on public.leave_ledger
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('leave.read'::text))));
alter policy leave_policies_delete on public.leave_policies
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy leave_policies_insert on public.leave_policies
  with check (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy leave_policies_update on public.leave_policies
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy leave_requests_select on public.leave_requests
  using ((((organization_id) IN (SELECT app.orgs_with_scope('leave.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('leave.read'::text))) OR ((approval_request_id IS NOT NULL) AND app.can_view_approval(approval_request_id))));
alter policy leave_types_delete on public.leave_types
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy leave_types_insert on public.leave_types
  with check (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy leave_types_update on public.leave_types
  using (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('leave.manage'::text, 'org'::public.permission_scope))));
alter policy legal_entities_delete on public.legal_entities
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy legal_entities_insert on public.legal_entities
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy legal_entities_update on public.legal_entities
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy locations_delete on public.locations
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy locations_insert on public.locations
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy locations_update on public.locations
  using (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy member_roles_select on public.member_roles
  using (((EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.id = member_roles.member_id) AND (m.user_id = auth.uid())))) OR ((organization_id) IN (SELECT app.orgs_with_scope('member.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('role.manage'::text, 'org'::public.permission_scope)))));
alter policy notice_periods_write on public.notice_periods
  using (((organization_id) IN (SELECT app.orgs_with_scope('separation.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('separation.manage'::text, 'org'::public.permission_scope))));
alter policy onboarding_plans_select on public.onboarding_plans
  using ((((organization_id) IN (SELECT app.orgs_with_scope('onboarding.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('employee.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.read'::text)))));
alter policy onboarding_template_tasks_select on public.onboarding_template_tasks
  using (((organization_id) IN (SELECT app.orgs_with_scope('onboarding.manage'::text, 'org'::public.permission_scope))));
alter policy onboarding_template_tasks_write on public.onboarding_template_tasks
  using (((organization_id) IN (SELECT app.orgs_with_scope('onboarding.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('onboarding.manage'::text, 'org'::public.permission_scope))));
alter policy onboarding_templates_select on public.onboarding_templates
  using (((organization_id) IN (SELECT app.orgs_with_scope('onboarding.manage'::text, 'org'::public.permission_scope))));
alter policy onboarding_templates_write on public.onboarding_templates
  using (((organization_id) IN (SELECT app.orgs_with_scope('onboarding.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('onboarding.manage'::text, 'org'::public.permission_scope))));
alter policy members_insert on public.organization_members
  with check (((organization_id) IN (SELECT app.orgs_with_scope('member.manage'::text, 'org'::public.permission_scope))));
alter policy members_select on public.organization_members
  using (((user_id = auth.uid()) OR ((organization_id) IN (SELECT app.orgs_with_scope('member.manage'::text, 'org'::public.permission_scope)))));
alter policy organizations_update on public.organizations
  using (((id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))))
  with check (((id) IN (SELECT app.orgs_with_scope('org.manage'::text, 'org'::public.permission_scope))));
alter policy payroll_adjustments_delete on public.payroll_adjustments
  using (((organization_id) IN (SELECT app.orgs_with_scope('payroll.prepare'::text, 'org'::public.permission_scope))));
alter policy payroll_adjustments_insert on public.payroll_adjustments
  with check ((((organization_id) IN (SELECT app.orgs_with_scope('payroll.prepare'::text, 'org'::public.permission_scope))) AND (applied_run_id IS NULL)));
alter policy payroll_runs_select on public.payroll_runs
  using ((app.is_payroll_staff(organization_id) OR (((organization_id) IN (SELECT app.orgs_with_scope('compensation.read'::text, 'org'::public.permission_scope))) AND (status = 'locked'::payroll_status))));
alter policy policy_acknowledgements_select on public.policy_acknowledgements
  using ((((organization_id) IN (SELECT app.orgs_with_scope('policy.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('employee.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('employee.read'::text)))));
alter policy policy_documents_write on public.policy_documents
  using (((organization_id) IN (SELECT app.orgs_with_scope('policy.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('policy.manage'::text, 'org'::public.permission_scope))));
alter policy regularization_requests_select on public.regularization_requests
  using ((((organization_id) IN (SELECT app.orgs_with_scope('attendance.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('attendance.read'::text))) OR ((approval_request_id IS NOT NULL) AND app.can_view_approval(approval_request_id))));
alter policy retention_actions_select on public.retention_actions
  using ((((organization_id) IN (SELECT app.orgs_with_scope('separation.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('audit.read'::text, 'org'::public.permission_scope)))));
alter policy retention_policies_select on public.retention_policies
  using ((((organization_id) IN (SELECT app.orgs_with_scope('separation.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('audit.read'::text, 'org'::public.permission_scope)))));
alter policy retention_policies_write on public.retention_policies
  using (((organization_id) IN (SELECT app.orgs_with_scope('separation.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('separation.manage'::text, 'org'::public.permission_scope))));
alter policy review_cycles_write on public.review_cycles
  using (((organization_id) IN (SELECT app.orgs_with_scope('performance.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('performance.manage'::text, 'org'::public.permission_scope))));
alter policy reviews_select on public.reviews
  using ((((organization_id) IN (SELECT app.orgs_with_scope('performance.manage'::text, 'org'::public.permission_scope))) OR ((NOT app.is_own_employee(employee_id)) AND (((organization_id) IN (SELECT app.orgs_with_scope('performance.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('performance.read'::text))) OR app.is_own_employee(manager_employee_id)))));
alter policy role_permissions_write on public.role_permissions
  using ((((organization_id) IN (SELECT app.orgs_with_scope('role.manage'::text, 'org'::public.permission_scope))) AND (NOT (EXISTS ( SELECT 1
   FROM roles r
  WHERE ((r.id = role_permissions.role_id) AND (r.key = 'owner'::text)))))))
  with check ((((organization_id) IN (SELECT app.orgs_with_scope('role.manage'::text, 'org'::public.permission_scope))) AND (NOT (EXISTS ( SELECT 1
   FROM roles r
  WHERE ((r.id = role_permissions.role_id) AND (r.key = 'owner'::text)))))));
alter policy roles_delete on public.roles
  using ((((organization_id) IN (SELECT app.orgs_with_scope('role.manage'::text, 'org'::public.permission_scope))) AND (NOT is_system)));
alter policy roles_insert on public.roles
  with check ((((organization_id) IN (SELECT app.orgs_with_scope('role.manage'::text, 'org'::public.permission_scope))) AND (NOT is_system)));
alter policy roles_update on public.roles
  using ((((organization_id) IN (SELECT app.orgs_with_scope('role.manage'::text, 'org'::public.permission_scope))) AND (NOT is_system)))
  with check ((((organization_id) IN (SELECT app.orgs_with_scope('role.manage'::text, 'org'::public.permission_scope))) AND (NOT is_system)));
alter policy roster_assignments_select on public.roster_assignments
  using ((((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('attendance.read'::text, 'org'::public.permission_scope)) OR (employee_id) IN (SELECT app.employees_in_scope('attendance.read'::text)))));
alter policy roster_assignments_write on public.roster_assignments
  using (((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))));
alter policy salary_components_write on public.salary_components
  using (((organization_id) IN (SELECT app.orgs_with_scope('compensation.update'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('compensation.update'::text, 'org'::public.permission_scope))));
alter policy separations_select on public.separations
  using ((app.is_own_employee(employee_id) OR ((organization_id) IN (SELECT app.orgs_with_scope('separation.manage'::text, 'org'::public.permission_scope))) OR app.is_in_reporting_line(organization_id, employee_id) OR ((status = ANY (ARRAY['approved'::separation_status, 'completed'::separation_status])) AND (((organization_id) IN (SELECT app.orgs_with_scope('asset.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('payroll.prepare'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('expense.manage'::text, 'org'::public.permission_scope)))))));
alter policy shifts_write on public.shifts
  using (((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('attendance.manage'::text, 'org'::public.permission_scope))));
alter policy tasks_insert on public.tasks
  with check (((organization_id) IN (SELECT app.orgs_with_scope('task.manage'::text, 'org'::public.permission_scope))));
alter policy tasks_select on public.tasks
  using ((((organization_id) IN (SELECT app.orgs_with_scope('task.manage'::text, 'org'::public.permission_scope))) OR ((organization_id) IN (SELECT app.orgs_with_scope('employee.read'::text, 'org'::public.permission_scope)) OR (assignee_employee_id) IN (SELECT app.employees_in_scope('employee.read'::text)))));
alter policy tasks_update on public.tasks
  using (((organization_id) IN (SELECT app.orgs_with_scope('task.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('task.manage'::text, 'org'::public.permission_scope))));
alter policy ticket_categories_write on public.ticket_categories
  using (((organization_id) IN (SELECT app.orgs_with_scope('helpdesk.manage'::text, 'org'::public.permission_scope))))
  with check (((organization_id) IN (SELECT app.orgs_with_scope('helpdesk.manage'::text, 'org'::public.permission_scope))));
alter policy tickets_select on public.tickets
  using ((app.is_own_employee(requester_id) OR app.is_own_employee(assignee_id) OR ((organization_id) IN (SELECT app.orgs_with_scope('helpdesk.manage'::text, 'org'::public.permission_scope)))));
alter policy workflow_definitions_select on public.workflow_definitions
  using (((organization_id) IN (SELECT app.orgs_with_scope('workflow.manage'::text, 'org'::public.permission_scope))));
alter policy workflow_run_steps_select on public.workflow_run_steps
  using (((organization_id) IN (SELECT app.orgs_with_scope('workflow.manage'::text, 'org'::public.permission_scope))));
alter policy workflow_runs_select on public.workflow_runs
  using (((organization_id) IN (SELECT app.orgs_with_scope('workflow.manage'::text, 'org'::public.permission_scope))));
alter policy workflow_versions_select on public.workflow_versions
  using (((organization_id) IN (SELECT app.orgs_with_scope('workflow.manage'::text, 'org'::public.permission_scope))));
