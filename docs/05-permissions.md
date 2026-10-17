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

## Delegation & access review
- `member_roles.valid_until` supports temporary delegation, such as a manager on leave delegating `leave.approve`.
- A quarterly access-review job (Phase 5) lists sensitive grants per org for owner recertification.
