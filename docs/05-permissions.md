# 05 · Role–Permission Matrix

Source of truth for the UI: `packages/shared/src/permissions.ts`. The database seed in `supabase/migrations/*_rbac_seed.sql` must match it, and a test enforces that.

**Scopes:** `O` = whole organization · `T` = own reporting line (direct + indirect reports) · `S` = self only · blank = none.
Roles are per-org and editable by org owners, except `owner`, which can't lose `org.manage`/`role.manage`.

| Permission | Owner | HR Admin | Recruiter | Payroll | Dept Head | Manager | Employee | Auditor |
|---|---|---|---|---|---|---|---|---|
| org.manage (settings, structure) | O | O | | | | | | |
| org.read | O | O | O | O | O | O | O | O |
| member.manage (invite, suspend) | O | O | | | | | | |
| role.manage | O | | | | | | | |
| audit.read | O | O | | | | | | O |
| employee.read | O | O | ¹ | O | T | T | S | O |
| employee.create | O | O | | | | | | |
| employee.update | O | O | | | | | | |
| employee.export | O | O | | O | | | | O |
| employee.personal.read † | O | O | | | | | S | |
| employee.identity.read † | O | O | | O | | | S | |
| employee.bank.read † | O | | | O | | | S | |
| employee.personal.update † | O | O | | | | | S | |
| employee.identity.update † | O | O | | | | | | |
| employee.bank.update † | O | | | O | | | | |
| employee.document.read † | O | O | | | | | S | |
| employee.document.upload † | O | O | | | | | S | |
| employee.document.delete † | O | O | | | | | | |
| compensation.read † | O | | | O | ² | | S | O |
| compensation.update † | | | | O | | | | |
| payroll.prepare (maker) | | | | O | | | | |
| payroll.approve (checker) † | O | | | O³ | | | | |
| recruitment.manage | O | O | O | | | | | |
| recruitment.read | O | O | O | | T | T | | O |
| recruitment.offer.approve † | O | O | | | | | | |
| attendance.read | O | O | | O | T | T | S | O |
| attendance.approve | O | O | | | T | T | | |
| attendance.manage | O | O | | | | | | |
| leave.approve | O | O | | | T | T | | |
| leave.read | O | O | | O | T | T | S | O |
| leave.manage | O | O | | | | | | |
| expense.approve | O | | | O | T | T | | |
| expense.manage | O | | | O | | | | |
| performance.read † | O | O | | | T | T | S | |
| performance.manage † | O | O | | | | | | |
| grievance.read † | O | O⁴ | | | | | S | |
| grievance.manage † ⁴ | O | O | | | | | | |
| ai.use ¹⁰ | O | O | O | O | O | O | O | |
| ai.manage ¹⁰ | O | | | | | | | |
| task.manage | O | O | | | | | | |
| onboarding.manage | O | O | | | | | | |
| policy.manage | O | O | | | | | | |
| announcement.manage | O | O | | | | | | |
| helpdesk.manage ⁵ | O | O | | | | | | |
| asset.manage ⁶ | O | O | | | | | | |
| learning.manage ⁷ | O | O | | | | | | |
| workflow.manage ⁸ | O | O | | | | | | |
| separation.manage † ⁹ | O | O | | | | | | |
| letter.manage † | O | O | | | | | | |
| insurance.manage † | O | O | | | | | | |
| statutory.manage | O | O | | O | | | | |
| timesheet.manage ¹⁰ | O | O | | O | | | | |

† Sensitive: every read is audited where the module supports it, and access is excluded from the AI retrieval default.
¹ Not granted. Every member, recruiters included, can read the minimal colleague directory (`colleague_directory`, migration 20261018002200): name, department and designation of current employees, never the employee row. A test asserts recruiters still see no employee rows.
² Not granted. Phase 4 adds band-level (not individual) compensation visibility for department heads.
³ **Separation of duties (Phase 4):** the payroll-run table will reject approval by the user who prepared the run (constraint `approved_by <> prepared_by`).
⁴ Grievances (migration 20261018002400) also have a per-case access list. `grievance.read` alone is necessary but not sufficient: an investigator also has to be added to the case by a case manager (`grievance.manage`). Case managers see every case except those that name them; anyone named in a case can never see it or be added to it. The reporter sees their own case (never internal notes). Descriptions, outcomes and messages are readable only through functions that record each handler's read in the audit log, and audit rows redact who raised a case, who is named and what was written.
⁵ A helpdesk category can route to one employee (for example the IT lead). They see, answer and change the status of tickets assigned to them without `helpdesk.manage`; they can't reassign or reprioritise. Requesters never see internal notes.
⁶ Not granted to employees; they see the assets they hold or have held and their own system access, and confirm receipt of an issued asset. A system can name an owner (for example the IT lead) who records and revokes access to that system only, without `asset.manage`.
⁷ Managers and department heads assign training to people in their reporting line, see their progress and record completions for them without `learning.manage`. Employees enrol themselves in courses open for self-enrolment and see only their own learning.
⁸ Workflows run as the system, but they only do what their steps say (notify, create a task, assign a course, ask for an approval, wait). Approval steps go to the employee's manager (or, without one, to `workflow.manage` holders other than the workflow's author), through the normal approvals engine.
⁹ Employees resign themselves; their manager approves first, then HR. Managers see separations in their reporting line and clear the handover item; asset managers see and settle asset and access items; payroll or expense managers the no-dues item. Why someone left and the exit interview are readable only by the employee and HR (`separation_details`; not in the table privileges).
¹⁰ AI (migration 20261018003000). `ai.use` lets a person use the assistants once the owner has turned them on (`ai.manage`, owner only: on/off, monthly token budget, hourly limit per person, usage). Every run passes a gate in the database (`ai_begin_run`): ai.use, the agent's own module permission (resume reading needs recruitment.manage, for example), AI turned on, the hourly limit and the monthly budget. Assistants read data as the person asking (RLS). Runs are visible to their own user and to ai.manage holders, without the prompt or output (no column privilege; kept 30 days for troubleshooting, service role only). Suggestions are visible only to the person who asked. No agent or tool can be declared above tier 2, so no assistant can approve, reject, change pay or end employment.

Platform super-admins are **not** org members by default (tested). They manage tenants through `/platform`. Time-boxed support access will use an audited `member_roles.valid_until` grant; the mechanism exists and is tested, the support-access workflow is Phase 1b.

## Who can grant which role (enforced in the database)

| Role | Can be granted or revoked by |
|---|---|
| Organization owner, HR administrator, Payroll / finance administrator, Auditor | `role.manage` only (owners) |
| Employee, Reporting manager, Department head, Recruiter | `member.manage` (HR) or `role.manage` |

- Each role stores its `assignment_permission`; custom roles default to owner-only.
- Nobody can suspend, remove or change the roles of a member who holds a role they could not grant themselves. HR therefore cannot touch owners or payroll administrators, and cannot promote anyone (themselves included) to HR admin.
- Invited members get access only after their first sign-in. Only a membership's status can be edited, never whose or which organization's it is.
- Every organization keeps at least one active, permanent owner. The rule is checked at commit, so ownership can be handed over within one change.
- Suspending an organization (platform admins only) removes all member access immediately.

## Two-step sign-in (enforced in the database)

Organization owner, HR administrator, Payroll / finance administrator and Auditor roles, and platform-admin status, only take effect once the session has completed a second factor (TOTP, session `aal2`). With a password alone, a person keeps only their everyday roles (Employee, Manager, Department head, Recruiter). The app sends them to `/mfa` to set up or enter a code, but the database enforces the rule even for direct API calls.

## Delegation & access review
- **Approval delegation** (migration 20261018002500): a member hands the approvals they make *as someone's reporting manager* to a colleague for up to 90 days (HR, with `member.manage`, can set it up for them). The delegate decides those requests as well; the decision is recorded with `via = 'delegation'` and `on_behalf_of`, and the manager is notified. Permission-based steps (HR, finance, offers) are never delegated: they already have several holders, and delegation must not hand a privileged permission, or its two-step sign-in requirement, to someone without it. Maker ≠ checker still applies to the delegate.
- **Escalation:** each approval step escalates after a number of hours (72 by default, set per step by `org.manage` holders on Approval rules). A reporting-manager step then also goes to the manager's manager (or, without one, to the step's org-wide permission holders); permission steps remind their holders. Once per step.
- `member_roles.valid_until` supports temporary role grants (time-boxed support access, cover for an absent HR admin), granted by those who could grant the role permanently.
- A quarterly access-review job (Phase 5) lists sensitive grants per org for owner recertification.
