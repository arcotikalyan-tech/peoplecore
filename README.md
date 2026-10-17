# PeopleCore

Multi-tenant, AI-assisted HRMS: web app, mobile app, platform console, shared Supabase backend.

> Status: Phase 1 in progress. See [BUILD_STATUS.md](BUILD_STATUS.md) and [the roadmap](docs/08-roadmap.md).

## Quick start

```bash
corepack pnpm install
corepack pnpm check          # typecheck + lint + unit + database/RLS tests (no Docker needed)
```

The database tests run every migration on an in-memory Postgres (PGlite). See ADR-005.

To run the web app you need a **PeopleCore** Supabase project (never the Vibe Upp one):

1. Create a project, then apply migrations: `npx supabase@2 link --project-ref <ref> && npx supabase@2 db push`.
2. In Supabase Auth settings:
   - Disable public sign-ups.
   - Set the Site URL and add `<site>/auth/callback` to the redirect allowlist.
   - Point the invite and magic-link email templates at `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=<invite|magiclink>`.
3. Copy `.env.example` to `apps/web/.env.local` and fill in the project URL, anon key and service-role key.
4. Optionally seed the clearly-marked demo tenant (synthetic people only; you choose the password):
   `DEMO_USER_PASSWORD='<12+ chars>' corepack pnpm --filter @peoplecore/web seed:demo --yes --platform-admin`
5. `corepack pnpm dev`, then open http://localhost:3000.

Changing the schema: add a migration, then run `corepack pnpm --filter @peoplecore/db gen:types` to refresh `database.types.ts` (a test fails if you forget).

## Layout
`apps/web` (Next.js), `packages/shared` (schemas, permissions), `packages/db` (DB test harness), `supabase/migrations`, `docs/`.
