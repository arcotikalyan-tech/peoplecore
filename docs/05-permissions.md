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
| compensation.read † | O | | | O | ² | | S | O |
| compensation.update † | | | | O | | | | |
| payroll.prepare (maker) | | | | O | | | | |
| payroll.approve (checker) † | O | | | O³ | | | | |
| recruitment.manage | O | O | O | | | | | |
| recruitment.read | O | O | O | | T | T | | O |
| attendance.read | O | O | | O | T | T | S | O |
| attendance.approve | O | O | | | T | T | | |
| leave.approve | O | O | | | T | T | | |
| expense.approve | O | | | O | T | T | | |
| grievance.read † | O | O⁴ | | | | | S | |
| ai.use | O | O | O | O | O | O | O | |

† Sensitive: every read is audited where the module supports it, and access is excluded from the AI retrieval default.
¹ Not granted yet. In Phase 2b recruiters get a minimal directory projection (name, department, designation) through a restricted view, never the full row. A test asserts recruiters currently see no employee rows.
² Not granted. Phase 4 adds band-level (not individual) compensation visibility for department heads.
³ **Separation of duties (Phase 4):** the payroll-run table will reject approval by the user who prepared the run (constraint `approved_by <> prepared_by`).
⁴ Grievances also have a per-case access list. `grievance.read` alone is necessary but not sufficient.

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
- `member_roles.valid_until` supports temporary delegation, such as a manager on leave delegating `leave.approve`.
- A quarterly access-review job (Phase 5) lists sensitive grants per org for owner recertification.
