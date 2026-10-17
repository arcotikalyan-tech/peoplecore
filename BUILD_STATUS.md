# Build status

_Last updated: 2026-10-17_

**Current phase:** Phase 1 (foundation) and Phase 2a (Core HR), first vertical slice. Phase 0 is complete.

A module only counts as **complete** when its schema, authorization, business logic, validation, workflows, UI, error handling and tests all work together (see [docs/08-roadmap.md](docs/08-roadmap.md)). **Nothing is complete yet.** Everything below is "in progress" or "not started".

## What is verified

| Check | Result |
|---|---|
| `corepack pnpm check` (typecheck + lint + tests, 3 packages) | ✅ 97 tests pass: 50 database/RLS/privileges, 37 shared, 10 web |
| `next build` (production) | ✅ |
| Production server smoke test | ✅ Login renders the "not configured" notice, security headers present, `X-Powered-By` removed |
| `pnpm audit --prod` | ✅ No known vulnerabilities in runtime dependencies |
| Live Supabase project **Peoplecore** (`rncjncpazqxqkfqoumsk`, Postgres 17) | ✅ Migrations 100–400 applied with `supabase db push`; history recorded. Permission catalog present (24). Anonymous API read of `employees` refused (`42501`). |
| Live end-to-end smoke test, `verify:demo` (2026-10-17) | ✅ 36/36 checks. Demo tenant seeded (26 synthetic employees, 6 accounts). Every role signs in; owner/HR/payroll see all 26, the manager exactly their line (10), the employee only themselves. Audit-log reads and structure writes are refused where they should be; anonymous requests are refused. Every main page renders through the running app as each role, with no data from outside the viewer's scope. |
| Browser E2E, `test:e2e` (Playwright driving Chrome against the live project, 2026-10-17) | ✅ 10/10 journeys pass, each checked in the UI **and** in the database. HR adds a department. Validation errors appear on the employee form. HR adds an employee (auto code, joining history). A duplicate work email is refused and the typed values are kept. A transfer closes the joining entry and opens a new one. The audit log attributes every change to HR. A manager can view but not edit a new report; an employee can't see them. The platform admin creates a tenant (8 roles seeded) but can't open it. Suspending an organization locks its members out with a clear notice until it is reactivated. Sign-out ends the session. All test data is deleted afterwards. |
| Email-link sign-in and invitations | ❌ **Not yet exercised.** Demo addresses (`example.test`) can't receive email; needs a real mailbox. |

The database tests apply every migration to PGlite (Postgres 17 in WASM) with a shim for Supabase's `auth` schema and roles (ADR-005). The shim grants **no** default table privileges, so the tests also prove the migrations' explicit grants are sufficient whether or not a Supabase project auto-grants. They give strong evidence for schema, RLS and RPC behaviour, but they don't replace a run against hosted Supabase.

## Vertical slice: what exists

**Database** (`supabase/migrations`)
- Tenancy: organizations, members, platform admins.
- RBAC: per-org roles seeded from templates, permission catalog, org/team/self scopes, time-boxed grants.
- Append-only audit log: trigger-written, diffed updates, redaction support, blocks UPDATE/DELETE/TRUNCATE.
- Org structure: legal entities, locations, cost centres, departments, designations.
- Employees, plus effective-dated employment history. Overlaps are blocked by an exclusion constraint.
- RPCs: `create_employee` (auto codes), `change_employee_assignment`, `create_organization`, `my_permissions`.

**Web** (`apps/web`)
- Auth: password sign-in and email-link sign-in (no self-signup), auth callback, sign out, and a session-refreshing `proxy.ts`.
- Org picker and workspace shell: permission-filtered navigation, mobile navigation, demo banner, skip link.
- Dashboard: headcount by status, upcoming joiners, probation reviews due, "my profile". Figures are scoped to what the viewer may see.
- Employees: directory with search, filters and pagination; create form with validation; profile page with history timeline, assignment changes and an activity feed from the audit log.
- Organization structure: list and create departments, designations and locations.
- Audit log viewer.
- Platform console: list tenants; create a tenant and invite or attach its owner.

**Shared code**
- `@peoplecore/shared`: zod schemas, permission catalog, date and pagination helpers.
- `@peoplecore/db`: PGlite test harness, generated `Database` types plus a drift test.

## Module status

| Module | Schema | RLS / authz | Logic | Validation | UI | Tests | Status |
|---|---|---|---|---|---|---|---|
| Tenancy, RBAC, audit | ✅ | ✅ | ✅ | ✅ | Partial: no member or role management UI | DB ✅ | In progress |
| Org structure | ✅ | ✅ | ✅ | ✅ | Create and list only (no edit or archive) | DB ✅ | In progress |
| Core HR: employees | ✅ | ✅ | ✅ | ✅ | List, create, profile, assignment | DB ✅ · unit ✅ · E2E ❌ | In progress |
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

Applied to the Peoplecore project on 2026-10-17, so they are now **immutable**: every change goes in a new migration (`supabase db push` applies only new ones).

**Rollback approach:** migrations are forward-only. A bad schema change is reverted by a new corrective migration. Data recovery relies on Supabase point-in-time recovery, and the restore drill is a Phase 8 deliverable. Destructive migrations (drops, type narrowing) must ship in two steps: expand, then contract.

## Known issues and limitations

1. **End-to-end gaps.** The main journeys are covered by `verify:demo` and `test:e2e` on the live project. Still missing: email-link sign-in and invitations (need a real mailbox), mobile-viewport checks, and running E2E in CI (needs a separate test project and CI secrets, never the main project).
2. **RLS performance:** the employee policy calls `app.can_access_employee` per row, and team scope walks a recursive reporting chain. This is fine at small scale. Before the 50k-employees-per-org target, it needs a reporting-closure table or a set-based policy, plus load tests.
3. **Future-dated assignment changes:** the database records them, but the UI and server action only accept dates up to today, because the job that applies them to the current snapshot (Phase 3) doesn't exist yet.
4. **Page latency:** pages take about 0.7–1.4 s in development. Each request makes roughly five *sequential* Supabase round trips (org lookup, permissions, platform-admin check, page queries) to a project hosted in Seoul. Fix: one RPC returning org + grants + platform flag, parallel page queries, and a Mumbai-region project for Indian customers.
5. The manager picker is capped at 500 employees. Larger tenants need a server-side search combobox.
6. Profile fields can't be edited after creation, except placement. Structure items can't be edited or archived.
7. **No Content-Security-Policy yet.** A nonce-based CSP needs dedicated work with Next.js (Phase 8). Other security headers are set.
8. `packages/db/src/database.types.ts` is generated by our own PGlite introspection. Compare it with `supabase gen types --linked` now that the project exists.
9. **Dev-only advisory:** `braces` (GHSA-vfj7-8cjw-p6xm, high) reaches the tree via `eslint-config-next`. It's lint tooling only, isn't shipped, and has no patched version yet. CI reports it without blocking; runtime dependencies are blocking.
10. **Supabase Auth settings:** public sign-ups are confirmed **off** on the live project. Still to confirm when email sign-in is tested:
    - Site URL and redirect allowlist include `/auth/callback` (set by the owner, not yet exercised).
    - Invite email template points at `/auth/callback?token_hash={{ .TokenHash }}&type=invite`.
11. **Demo password:** the demo accounts use a 10-character password, accepted with `--allow-short-password` at the owner's request. To strengthen it, change `DEMO_USER_PASSWORD` to 12+ characters and re-run `seed:demo --yes --reset --platform-admin`; existing accounts get the new password.
12. **Process note:** on 2026-10-17 a second agent session (`peoplecore-a6`) wrote into this repo concurrently. Its overlapping files were reconciled into this structure and its duplicates removed. Only one session should write here.

## Next steps

1. **Close the verification gaps.** Test email-link sign-in and an invitation with a real mailbox. Create a separate Supabase test project so CI can run `test:e2e` and the DB tests against real Supabase without touching the main project.
2. **Phase 1b.** Member invitations and role assignment UI. MFA (TOTP) enforced for owner, HR and payroll roles. Suspended-org enforcement, last-owner guard, access-review listing.
3. **Finish Phase 2a.** Personal, identity and bank tables with field-level permissions. Private document storage with signed URLs. Profile edit flows. Bulk import with a dry-run report. Audited export.
4. **Phase 2b.** Applicant tracking, per the roadmap.
