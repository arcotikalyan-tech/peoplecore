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
| attendance.device.manage | O | O | | | | | | |
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
| vendor.manage | O | | | O | | | | |
| timesheet.manage ¹¹ | O | O | | O | | | | |
| peoplexp.manage ¹² | O | O | | | | | | |

† Sensitive: every read is audited where the module supports it, and access is excluded from the AI retrieval default.
¹ Not granted. Every member, recruiters included, can read the minimal colleague directory (`colleague_directory`, migration 20261018002200): name, department and designation of current employees, never the employee row. A test asserts recruiters still see no employee rows.
² Not granted. Phase 4 adds band-level (not individual) compensation visibility for department heads.
³ **Separation of duties (Phase 4):** the payroll-run table will reject approval by the user who prepared the run (constraint `approved_by <> prepared_by`).
⁴ Grievances (migration 20261018002400) also have a per-case access list. `grievance.read` alone is necessary but not sufficient: an investigator also has to be added to the case by a case manager (`grievance.manage`). Case managers see every case except those that name them; anyone named in a case can never see it or be added to it. The reporter sees their own case (never internal notes). Descriptions, outcomes and messages are readable only through functions that record each handler's read in the audit log, and audit rows redact who raised a case, who is named and what was written. POSH cases (migration 20261022000600) are also handled by the organization's current Internal Committee members, as investigators, in a two-step session when the organization requires two-step; the committee register is kept by `grievance.manage` and every member can see who is on it.
⁵ A helpdesk category can route to one employee (for example the IT lead). They see, answer and change the status of tickets assigned to them without `helpdesk.manage`; they can't reassign or reprioritise. Requesters never see internal notes. Files on a ticket (migration 20261022000700) follow the same rules as replies: requesters and agents add them, agents can keep one internal, and requesters never see internal files.
⁶ Not granted to employees; they see the assets they hold or have held and their own system access, and confirm receipt of an issued asset. A system can name an owner (for example the IT lead) who records and revokes access to that system only, without `asset.manage`.
⁷ Managers and department heads assign training to people in their reporting line, see their progress and record completions for them without `learning.manage`. Employees enrol themselves in courses open for self-enrolment and see only their own learning.
⁸ Workflows run as the system, but they only do what their steps say (notify, create a task, assign a course, ask for an approval, wait). Approval steps go to the employee's manager (or, without one, to `workflow.manage` holders other than the workflow's author), through the normal approvals engine.
⁹ Employees resign themselves; their manager approves first, then HR. Managers see separations in their reporting line and clear the handover item; asset managers see and settle asset and access items; payroll or expense managers the no-dues item. Why someone left and the exit interview are readable only by the employee and HR (`separation_details`; not in the table privileges).
¹⁰ AI (migration 20261018003000). `ai.use` lets a person use the assistants once the owner has turned them on (`ai.manage`, owner only: on/off, monthly token budget, hourly limit per person, usage). Every run passes a gate in the database (`ai_begin_run`): ai.use, the agent's own module permission (resume reading needs recruitment.manage, for example), AI turned on, the hourly limit and the monthly budget. Assistants read data as the person asking (RLS). Runs are visible to their own user and to ai.manage holders, without the prompt or output (no column privilege; kept 30 days for troubleshooting, service role only). Suggestions are visible only to the person who asked. No agent or tool can be declared above tier 2, so no assistant can approve, reject, change pay or end employment.
¹¹ Not granted to employees. Workspace members log their own time; an employee's reporting manager approves (and, if the settings allow, logs or corrects) their time without `timesheet.manage`. Nobody approves their own time.
¹² Not granted to employees. Everyone posts to the PeopleXP feed, recognises colleagues within the daily limits, redeems their own points and sees their own pulse answers; `peoplexp.manage` approves high-value recognitions, fulfils rewards, adjusts points and sees pulse summaries (groups of three or more only).

Platform super-admins are **not** org members by default (tested). They manage tenants through `/platform`. Time-boxed support access will use an audited `member_roles.valid_until` grant; the mechanism exists and is tested, the support-access workflow is Phase 1b.

## Who can grant which role (enforced in the database)

| Role | Can be granted or revoked by |
|---|---|
| Organization owner, HR administrator, HR executive, Payroll administrator, Finance administrator, Auditor, Partner, Vendor payout admin, Attendance device admin | `role.manage` only (owners) |
| Employee, Reporting manager, Department head, Recruiter | `member.manage` (HR) or `role.manage` |

- Each role stores its `assignment_permission`; custom roles default to owner-only.
- Nobody can suspend, remove or change the roles of a member who holds a role they could not grant themselves. HR therefore cannot touch owners or payroll administrators, and cannot promote anyone (themselves included) to HR admin.
- Invited members get access only after their first sign-in. Only a membership's status can be edited, never whose or which organization's it is.
- Every organization keeps at least one active, permanent owner. The rule is checked at commit, so ownership can be handed over within one change.
- Suspending an organization (platform admins only) removes all member access immediately.

## Two-step sign-in (enforced in the database)

**Since 2026-10-22 two-step sign-in is off unless it is switched on (owner's decision).** Nobody is asked for a code at sign-up or at first sign-in unless a switch says so:

- **Per organization:** an owner turns it on for everyone in Settings › Controls (`org_controls.require_mfa`, default off, changed only through `set_org_require_mfa`, which needs `role.manage`). Turning it on needs the owner's own session to be two-step already (`aal2`), so nobody locks themselves out half way; while it is on, turning it off needs a two-step session too. While it is on, **every** role in that organization — owner and employee alike — takes effect only once the session has completed a second factor (TOTP, session `aal2`); with a password alone a member has no permissions there. The app sends them to `/mfa` to set it up or enter a code, but the database enforces the rule even for direct API calls (`app.role_mfa_ok`). `roles.requires_mfa` is kept on roles but no longer matters.
- **Platform:** a platform admin turns it on for platform admins in the platform console (`platform_settings.require_mfa_for_admins`, default off, through `set_platform_require_mfa`, audited; turning it on needs an `aal2` session). While on, platform-admin powers apply only in `aal2` sessions (`app.platform_mfa_ok`).
- **Personal:** anyone can turn two-step on (or off again) for themselves in Account settings; a person with a verified authenticator is always asked for the code, on the web and in the phone app (enforced by the apps, not the database). They can't turn it off while their organization requires it.

## Delegation & access review

- **Approval delegation** (migration 20261018002500): a member hands the approvals they make *as someone's reporting manager* to a colleague for up to 90 days (HR, with `member.manage`, can set it up for them). The delegate decides those requests as well; the decision is recorded with `via = 'delegation'` and `on_behalf_of`, and the manager is notified. Permission-based steps (HR, finance, offers) are never delegated: they already have several holders, and delegation must not hand a privileged permission, or its two-step sign-in requirement, to someone without it. Maker ≠ checker still applies to the delegate.
- **Escalation:** each approval step escalates after a number of hours (72 by default, set per step by `org.manage` holders on Approval rules). A reporting-manager step then also goes to the manager's manager (or, without one, to the step's org-wide permission holders); permission steps remind their holders. Once per step.
- `member_roles.valid_until` supports temporary role grants (time-boxed support access, cover for an absent HR admin), granted by those who could grant the role permanently.
- A quarterly access-review job (Phase 5) lists sensitive grants per org for owner recertification.


**Vendor payout admin** (2026-10-21): `org.read` and `vendor.manage` only. Owners give it to chosen HR administrators from Settings › Controls (Kredily's "Vendor payout for HR"). Vendor payments need a second person to approve (whoever records an invoice can't approve it).

**Standard roles added 2026-10-22** (Kredily's role list; all owner-granted):

| Role | Grants (all organization-wide) | For |
|---|---|---|
| HR executive | `org.read`, `employee.read`, `employee.create`, `employee.update`, `onboarding.manage`, `attendance.read`, `leave.read`, `ai.use` | People operations without payroll or sensitive IDs |
| Finance administrator | `org.read`, `employee.read`, `employee.identity.read`, `employee.bank.read`, `compensation.read`, `payroll.approve`, `expense.approve`, `expense.manage`, `vendor.manage`, `statutory.manage`, `ai.use` | The checker: approves payroll prepared by the payroll administrator, pays expenses and vendors |
| Partner (read-only) | `org.read`, `employee.read`, `employee.identity.read`, `compensation.read` | An external partner such as a CA firm |
| Attendance device admin | `org.read`, `employee.read`, `attendance.read`, `attendance.device.manage` | Registers biometric devices and imports their punches; changes no rules |

"Payroll / finance administrator" is now "Payroll administrator" (the maker; its grants are unchanged).
