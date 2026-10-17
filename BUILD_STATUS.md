# Build status

_Last updated: 2026-10-18_

**Current phase:** Phase 1 (foundation) and Phase 2a (Core HR), first vertical slice. Phase 0 is complete.

A module only counts as **complete** when its schema, authorization, business logic, validation, workflows, UI, error handling and tests all work together (see [docs/08-roadmap.md](docs/08-roadmap.md)). **Nothing is complete yet.** Everything below is "in progress" or "not started".

## What is verified

| Check | Result |
|---|---|
| `corepack pnpm check` (typecheck + lint + tests, 3 packages) | ✅ 182 tests pass: 109 database/RLS/privileges, 56 shared, 17 web |
| `next build` (production) | ✅ |
| Production server smoke test | ✅ Login renders the "not configured" notice, security headers present, `X-Powered-By` removed |
| `pnpm audit --prod` | ✅ No known vulnerabilities in runtime dependencies |
| Live Supabase project **Peoplecore** (`rncjncpazqxqkfqoumsk`, Postgres 17) | ✅ All 12 migrations applied with `supabase db push`; history recorded. Permission catalog present (30). Anonymous API read of `employees` refused (`42501`). |
| Live end-to-end smoke test, `verify:demo` (2026-10-17) | ✅ 36/36 checks. Demo tenant seeded (26 synthetic employees, 6 accounts). Every role signs in (admins with two-step codes); owner/HR/payroll see all 26, the manager exactly their line (10), the employee only themselves. HR with a password alone sees only their own record and is sent to two-step verification. Audit-log reads and structure writes are refused where they should be; anonymous requests are refused. Every main page renders through the running app as each role, with no data from outside the viewer's scope. |
| Browser E2E, `test:e2e` (Playwright driving Chrome against the live project, 2026-10-18) | ✅ 28/28 journeys pass on the live project (plus 3 email journeys that run only against the local stack in CI, see below), each checked in the UI **and** in the database. HR adds a department. Validation errors appear on the employee form. HR adds an employee (auto code, joining history). A duplicate work email is refused and the typed values are kept. A transfer closes the joining entry and opens a new one. The audit log attributes every change to HR. A manager can view but not edit a new report; an employee can't see them. The platform admin creates a tenant (8 roles seeded) but can't open it. Suspending an organization locks its members out with a clear notice until it is reactivated. HR invites an existing account (only everyday roles offered), the invitee gets access on first sign-in, HR changes their roles, suspends and removes them, and cannot touch the owner. A brand-new HR admin must set up an authenticator (wrong codes refused) before any HR data is reachable. HR edits work and personal details. HR records identity numbers (an invalid individual PAN is refused); they show masked, and "Show full numbers" is recorded in the activity feed. Payroll adds a bank account (mismatched confirmation refused, shown masked); HR sees no bank section at all. An employee edits their own personal details and emergency contacts but can't open a colleague. A manager sees a report's work profile but no personal, identity or bank details. HR renames a department and moves it under another; a department in use can't be archived (clear message), an unused one is archived, disappears from the employee form and is restored; a manager sees the structure read-only. HR uploads a document (a fake PDF is refused by its bytes), downloads it through a short-lived signed link (recorded in the audit log), and deletes it (the stored file is removed); an employee uploads their own but can't delete it or reach a colleague's; the Storage API refuses a signed-in user directly, even for their own file; a manager sees no documents. HR exports the filtered directory as CSV (row count matches, recorded in the audit log with its filters); managers and employees get no export, not even by URL. Sign-out ends the session. All test data is deleted afterwards. |
| CI against a local Supabase (`e2e` job) | ⏳ **Written, not yet run.** GitHub Actions starts a throwaway local Supabase (all migrations, Auth, Storage, Mailpit inbox), seeds, runs `verify:demo` and every browser journey. Runs on the first push (blocked: the GitHub CLI token needs the `workflow` scope). |
| Email-link sign-in and invitations | ⏳ Journeys written (`e2e/email.spec.ts`: emailed sign-in link, no email for unknown addresses, invitation accepted once from the email); they run in the CI job above. The live project still needs Hostinger SMTP, see [docs/runbooks/email.md](docs/runbooks/email.md). |

The database tests apply every migration to PGlite (Postgres 17 in WASM) with a shim for Supabase's `auth` schema and roles (ADR-005). The shim grants **no** default table privileges, so the tests also prove the migrations' explicit grants are sufficient whether or not a Supabase project auto-grants. They give strong evidence for schema, RLS and RPC behaviour, but they don't replace a run against hosted Supabase.

## Vertical slice: what exists

**Database** (`supabase/migrations`)
- Tenancy: organizations, members, platform admins.
- RBAC: per-org roles seeded from templates, permission catalog, org/team/self scopes, time-boxed grants.
- Append-only audit log: trigger-written, diffed updates, redaction support, blocks UPDATE/DELETE/TRUNCATE.
- Org structure: legal entities, locations, cost centres, departments, designations.
- Employees, plus effective-dated employment history. Overlaps are blocked by an exclusion constraint.
- Sensitive employee data: `employee_personal` and `emergency_contacts` (RLS; employees edit their own); identity numbers and bank accounts in the `restricted` schema, which the API can't reach, read and written only through permission-checked functions (`employee_identity_summary` / `reveal_employee_identity` / `set_employee_identity`, and the bank equivalents). Summaries are masked; every reveal is audited. Only Aadhaar's last 4 digits are stored. Changing a bank account archives the previous one.
- Employee documents: `employee_documents` (RLS read; writes only via `add_employee_document` / `delete_employee_document`; `document_download` checks access and records the download). Files sit in the private `employee-documents` bucket (5 MB; PDF, JPEG, PNG) with no Storage policies for signed-in users, so only the server reaches them, via 60-second signed URLs. Deleting hides the record (kept for the audit trail) and removes the file.
- Employee export: CSV of the directory with its current filters (work fields only; never personal, identity or bank data), up to 50,000 rows, formula-injection-safe. `log_employee_export` records each export (filters, row count) before any data is sent, and refuses without `employee.export`.
- RPCs: `create_employee` (auto codes), `change_employee_assignment`, `create_organization`, `my_permissions`.

**Web** (`apps/web`)
- Auth: password sign-in and email-link sign-in (no self-signup), auth callback, sign out, and a session-refreshing `proxy.ts`.
- Org picker and workspace shell: permission-filtered navigation, mobile navigation, demo banner, skip link.
- Dashboard: headcount by status, upcoming joiners, probation reviews due, "my profile". Figures are scoped to what the viewer may see.
- Employees: directory with search, filters, pagination and CSV export; create form with validation; profile page with history timeline, assignment changes, editable work and personal details, emergency contacts, masked identity and bank panels with audited reveal, documents (upload, download, delete), and an activity feed from the audit log.
- Organization structure: list, create, edit, archive and restore departments, designations and locations, with a count of current employees using each.
- Audit log viewer.
- Platform console: list tenants; create a tenant and invite or attach its owner.

**Shared code**
- `@peoplecore/shared`: zod schemas, permission catalog, date and pagination helpers.
- `@peoplecore/db`: PGlite test harness, generated `Database` types plus a drift test.

## Module status

| Module | Schema | RLS / authz | Logic | Validation | UI | Tests | Status |
|---|---|---|---|---|---|---|---|
| Tenancy, RBAC, audit | ✅ | ✅ | ✅ | ✅ | Partial: no member or role management UI | DB ✅ | In progress |
| Org structure | ✅ | ✅ | ✅ | ✅ | Departments, designations, locations: full lifecycle. Legal entities and cost centres: no UI yet | DB ✅ · E2E ✅ | In progress |
| Core HR: employees | ✅ | ✅ | ✅ | ✅ | List, create, profile (incl. personal, identity, bank, documents), assignment | DB ✅ · unit ✅ · E2E ✅ | In progress |
| Platform console | ✅ | ✅ | ✅ | ✅ | ✅ | DB ✅ · E2E ❌ | In progress |
| Recruitment, onboarding, attendance, leave, payroll, expenses, performance, services, assets, ER, offboarding, AI, workflows, mobile, worker | — | — | — | — | — | — | Not started |

## Migrations

| File | Contents |
|---|---|
| `20261017000100_foundation.sql` | Extensions, `app` schema, tenancy, RBAC, audit, authorization helpers, RLS |
| `20261017000200_rbac_seed.sql` | Permission catalog and role templates (generated from `permissions.ts`) |
| `20261017000300_org_structure_core_hr.sql` | Org structure, employees, employment records, counters, scoped access functions, RPCs, RLS |
| `20261017000400_explicit_grants.sql` | Explicit least-privilege table grants; turns off automatic grants for future objects |
| `20261017000500_suspension_and_owner_guard.sql` | Suspended organizations lose all access; last-owner protection (checked at commit); slug/status/demo flag platform-only; `set_organization_status`, `my_organizations` |
| `20261017000600_member_management.sql` | Safe role delegation (`assignment_permission`, `can_grant_role`, `can_manage_member`); `org_members`, `grantable_roles`, `add_member`, `set_member_roles`, `accept_invitations`; only membership status is editable |
| `20261018000100_org_local_dates.sql` | Fix: "today" uses the organization's time zone, not UTC (found by the browser tests just after midnight IST) |
| `20261018000200_mfa_enforcement.sql` | Two-step sign-in: `requires_mfa` roles and platform admin only apply at `aal2`; `my_mfa_requirement` |
| `20261018000600_employee_export.sql` | `log_employee_export`: permission check and audit event for each CSV export |
| `20261018000500_employee_documents.sql` | `employee.document.read/upload/delete` permissions; private `employee-documents` bucket; `employee_documents` with `add_employee_document`, `document_download` (audited), `delete_employee_document` (soft delete) |
| `20261018000400_structure_lifecycle.sql` | Archive rules: items used by current employees, or departments with active sub-departments, can't be archived; no archived or cyclic parents; employees can't be placed in archived items; `structure_usage` (RLS-scoped counts) |
| `20261018000300_sensitive_employee_data.sql` | Personal details, emergency contacts, `restricted` identity and bank tables with masked/audited access functions; `employee.personal/identity/bank.update` permissions; audit fix (diff before redacting, so changes to redacted columns are logged; `metadata.employee_id` tag) |

Applied to the Peoplecore project (100–400 on 2026-10-17, the rest on 2026-10-18), so they are now **immutable**: every change goes in a new migration (`supabase db push` applies only new ones).

**Rollback approach:** migrations are forward-only. A bad schema change is reverted by a new corrective migration. Data recovery relies on Supabase point-in-time recovery, and the restore drill is a Phase 8 deliverable. Destructive migrations (drops, type narrowing) must ship in two steps: expand, then contract.

## Known issues and limitations

1. **End-to-end gaps.** The main journeys are covered by `verify:demo` and `test:e2e` on the live project, and the CI `e2e` job (not yet run) covers the same journeys plus email against a local Supabase. Still missing: real-mailbox delivery on the live project (needs SMTP) and mobile-viewport checks.
2. **RLS performance:** the employee policy calls `app.can_access_employee` per row, and team scope walks a recursive reporting chain. This is fine at small scale. Before the 50k-employees-per-org target, it needs a reporting-closure table or a set-based policy, plus load tests.
3. **Future-dated assignment changes:** the database records them, but the UI and server action only accept dates up to today, because the job that applies them to the current snapshot (Phase 3) doesn't exist yet.
4. **Page latency:** pages take about 0.7–1.4 s in development. Each request makes roughly five *sequential* Supabase round trips (org lookup, permissions, platform-admin check, page queries) to a project hosted in Seoul. Fix: one RPC returning org + grants + platform flag, parallel page queries, and a Mumbai-region project for Indian customers.
5. The manager picker is capped at 500 employees. Larger tenants need a server-side search combobox.
6. Legal entities and cost centres have no UI yet (the database rules already cover them). Employment history may still reference archived items, by design.
7. **No Content-Security-Policy yet.** A nonce-based CSP needs dedicated work with Next.js (Phase 8). Other security headers are set.
8. `packages/db/src/database.types.ts` is generated by our own PGlite introspection. Compare it with `supabase gen types --linked` now that the project exists.
9. **Dev-only advisory:** `braces` (GHSA-vfj7-8cjw-p6xm, high) reaches the tree via `eslint-config-next`. It's lint tooling only, isn't shipped, and has no patched version yet. CI reports it without blocking; runtime dependencies are blocking.
10. **Supabase Auth settings:** public sign-ups are confirmed **off** on the live project. Still to confirm when email sign-in is tested:
    - Site URL and redirect allowlist include `/auth/callback` (set by the owner, not yet exercised).
    - Invite email template points at `/auth/callback?token_hash={{ .TokenHash }}&type=invite`.
11. **Demo password:** the demo accounts use a 10-character password, accepted with `--allow-short-password` at the owner's request. To strengthen it, change `DEMO_USER_PASSWORD` to 12+ characters and re-run `seed:demo --yes --reset --platform-admin`; existing accounts get the new password.
12. **Process note:** on 2026-10-17 a second agent session (`peoplecore-a6`) wrote into this repo concurrently. Its overlapping files were reconciled into this structure and its duplicates removed. Only one session should write here.
13. **Invitation emails to new people need custom SMTP.** Supabase's built-in email service is heavily rate-limited and meant for testing (it may only deliver to your project team's addresses). Configure custom SMTP before inviting real users. Adding people who already have a PeopleCore sign-in sends no email and works today.

14. **Two-step codes can be reused within their 30-second window** in a different session; Supabase doesn't track used codes (verified on the live project). That's standard for many TOTP setups. Rate limits and short windows limit the risk.
15. **Demo two-step secrets** live in `apps/web/.demo-mfa.json` (gitignored, owner-readable only). They belong to synthetic demo accounts; real users enroll their own authenticator app.
16. **Orphaned document files are possible but unreachable.** If removing a stored file fails (after a delete, or after the database refused a new document), the file stays in the bucket. No signed URL is ever issued for it, since the database has no live record. A cleanup job (worker, Phase 3) should sweep the bucket against `employee_documents`.
17. **Documents aren't scanned for malware.** Types are checked by their bytes and limited to PDF, JPEG and PNG, and downloads are served as attachments, but there is no antivirus scan yet.

## Next steps

1. **Close the verification gaps.** Grant the GitHub CLI the `workflow` scope and push, so the new CI `e2e` job runs for the first time. Configure Hostinger SMTP on the live project and test an invitation to a real mailbox ([runbook](docs/runbooks/email.md)).
2. **Phase 1b is done** (suspended organizations, last-owner protection, member management with safe delegation, two-step sign-in enforced in the database). Remaining small item: a periodic access-review listing of sensitive grants for owners.
3. **Finish Phase 2a.** ✅ Personal, identity and bank details. ✅ Profile edit flows. ✅ Structure edit/archive. ✅ Employee documents (private storage, signed URLs). ✅ Audited export. Still to do: bulk import with a dry-run report.
4. **Phase 2b.** Applicant tracking, per the roadmap.
