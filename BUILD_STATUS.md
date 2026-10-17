# Build status

_Last updated: 2026-10-17_

**Current phase:** Phase 1 (foundation) and Phase 2a (Core HR), first vertical slice. Phase 0 is complete.

A module only counts as **complete** when its schema, authorization, business logic, validation, workflows, UI, error handling and tests all work together (see [docs/08-roadmap.md](docs/08-roadmap.md)). **Nothing is complete yet.** Everything below is "in progress" or "not started".

## What is verified

| Check | Result |
|---|---|
| `corepack pnpm check` (typecheck + lint + tests, 3 packages) | ✅ 88 tests pass: 41 database/RLS/privileges, 37 shared, 10 web |
| `next build` (production) | ✅ |
| Production server smoke test | ✅ Login renders the "not configured" notice, security headers present, `X-Powered-By` removed |
| `pnpm audit --prod` | ✅ No known vulnerabilities in runtime dependencies |
| Live Supabase project **Peoplecore** (`rncjncpazqxqkfqoumsk`, Postgres 17) | ✅ Migrations 100–400 applied with `supabase db push`; history recorded. Permission catalog present (24). Anonymous API read of `employees` refused (`42501`). |
| Live end-to-end smoke test, `verify:demo` (2026-10-17) | ✅ 36/36 checks. Demo tenant seeded (26 synthetic employees, 6 accounts). Every role signs in; owner/HR/payroll see all 26, the manager exactly their line (10), the employee only themselves. Audit-log reads and structure writes are refused where they should be; anonymous requests are refused. Every main page renders through the running app as each role, with no data from outside the viewer's scope. |
| Form submissions (create employee, change assignment, add structure, create tenant), email-link sign-in, invitations | ❌ **Not yet exercised** against the live project; `verify:demo` only reads. |

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

Applied to the Peoplecore project on 2026-10-17, so they are now **immutable**: every change goes in a new migration (`supabase db push` applies only new ones).

**Rollback approach:** migrations are forward-only. A bad schema change is reverted by a new corrective migration. Data recovery relies on Supabase point-in-time recovery, and the restore drill is a Phase 8 deliverable. Destructive migrations (drops, type narrowing) must ship in two steps: expand, then contract.

## Known issues and limitations

1. **Partial end-to-end coverage.** `verify:demo` checks reads and page rendering on the live project; form submissions, email links and invitations still need testing, and there are no Playwright browser tests yet.
2. **RLS performance:** the employee policy calls `app.can_access_employee` per row, and team scope walks a recursive reporting chain. This is fine at small scale. Before the 50k-employees-per-org target, it needs a reporting-closure table or a set-based policy, plus load tests.
3. **Suspended organizations are not blocked yet.** `app.is_member` doesn't check `organizations.status`. Fix in Phase 1b, with a test.
4. **No last-owner guard.** An owner can remove the final owner-role assignment. Fix in Phase 1b.
5. **Future-dated assignment changes:** the database records them, but the UI and server action only accept dates up to today, because the job that applies them to the current snapshot (Phase 3) doesn't exist yet.
6. **Page latency:** pages take about 0.7–1.4 s in development. Each request makes roughly five *sequential* Supabase round trips (org lookup, permissions, platform-admin check, page queries) to a project hosted in Seoul. Fix: one RPC returning org + grants + platform flag, parallel page queries, and a Mumbai-region project for Indian customers.
7. The manager picker is capped at 500 employees. Larger tenants need a server-side search combobox.
8. Profile fields can't be edited after creation, except placement. Structure items can't be edited or archived.
9. **No Content-Security-Policy yet.** A nonce-based CSP needs dedicated work with Next.js (Phase 8). Other security headers are set.
10. `packages/db/src/database.types.ts` is generated by our own PGlite introspection. Compare it with `supabase gen types --linked` now that the project exists.
11. **Dev-only advisory:** `braces` (GHSA-vfj7-8cjw-p6xm, high) reaches the tree via `eslint-config-next`. It's lint tooling only, isn't shipped, and has no patched version yet. CI reports it without blocking; runtime dependencies are blocking.
12. **Supabase Auth settings:** public sign-ups are confirmed **off** on the live project. Still to confirm when email sign-in is tested:
    - Site URL and redirect allowlist include `/auth/callback` (set by the owner, not yet exercised).
    - Invite email template points at `/auth/callback?token_hash={{ .TokenHash }}&type=invite`.
13. **Demo password:** the demo accounts use a 10-character password, accepted with `--allow-short-password` at the owner's request. To strengthen it, change `DEMO_USER_PASSWORD` to 12+ characters and re-run `seed:demo --yes --reset --platform-admin`; existing accounts get the new password.
14. **Process note:** on 2026-10-17 a second agent session (`peoplecore-a6`) wrote into this repo concurrently. Its overlapping files were reconciled into this structure and its duplicates removed. Only one session should write here.

## Next steps

1. **Finish verifying the first environment.** The project is live, migrated, seeded and read-verified (`verify:demo`). Next, exercise the form submissions in the browser, then add Playwright E2E tests: sign in → create employee → change assignment → audit entry, plus cross-tenant denial. Run the DB tests against real Supabase in CI.
2. **Phase 1b.** Member invitations and role assignment UI. MFA (TOTP) enforced for owner, HR and payroll roles. Suspended-org enforcement, last-owner guard, access-review listing.
3. **Finish Phase 2a.** Personal, identity and bank tables with field-level permissions. Private document storage with signed URLs. Profile edit flows. Bulk import with a dry-run report. Audited export.
4. **Phase 2b.** Applicant tracking, per the roadmap.
