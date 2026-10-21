# PeopleCore — guidance for coding agents

- PeopleCore is a standalone product. **Never read, modify or reuse `~/Projects/gossip-app` (Vibe Upp)** or its Supabase project/keys.
- Only one agent session should write to this repo at a time.
- Package manager: `corepack pnpm …` (pinned in `package.json`). Gate before moving on: `corepack pnpm check`.
- Read `BUILD_STATUS.md` first; update it when you finish a unit of work.
- Architecture: `docs/01-architecture-decisions.md`. Permissions: `docs/05-permissions.md` + `packages/shared/src/permissions.ts`.

## Database rules
- New migration per change (`supabase/migrations/YYYYMMDDHHMMSS_name.sql`). Once a migration has been applied to any shared environment, never edit it.
- Every tenant table: `organization_id`, RLS enabled, policies `to authenticated`, composite `(organization_id, id)` FKs, audit trigger if sensitive, and tests in `packages/db/test`.
- Every new table or function needs **explicit grants** in the same migration (`grant select, … to authenticated`, `grant all … to service_role`; RPCs: `grant execute`). No default privileges exist; the test DB has none either, so a missing grant fails tests. Never grant `anon` without an RLS-reviewed public use case.
- After a schema change run `corepack pnpm --filter @peoplecore/db gen:types`.
- Changing the permission catalog: edit `permissions.ts`, then write a new migration (use `node scripts/gen-rbac-seed.ts` as a starting point). `rbac-catalog.test.ts` must pass.

## Security rules
- The Supabase secret key (`SUPABASE_SECRET_KEY`, service-role privileges) is only used in `apps/web/src/server/admin.ts`, the seed script and the worker, after an explicit authorization check. Never in client code or `NEXT_PUBLIC_*`.
- The AI provider key (`ANTHROPIC_API_KEY`) is read only in `apps/web/src/server/ai.ts` (and `packages/ai/scripts`), server side. AI runs read data as the signed-in user, never with the secret key.
- Never trust client-supplied organization IDs for authorization; RLS decides.
- No real personal data in fixtures or seeds; use `example.test` and mark demo tenants `is_demo`.
- AI output is a suggestion until a human confirms it through the normal module code path.
- Privileged roles (`roles.requires_mfa`) and platform admin only apply in `aal2` sessions, unless an owner turned the requirement off for their organization (`org_controls.require_mfa`) or a platform admin turned it off for platform admins (`platform_settings.require_mfa_for_admins`); both default on and every check goes through `app.role_mfa_ok` / `app.platform_mfa_ok`. DB tests default to `aal2`; use `asUser(id, fn, { aal: 'aal1' })` to test password-only sessions.
