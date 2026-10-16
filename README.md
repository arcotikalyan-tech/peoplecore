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
2. Copy `.env.example` to `apps/web/.env.local` and fill in the project URL, anon key and service-role key.
3. Optionally seed the clearly-marked demo tenant: `corepack pnpm seed:demo` (needs the service-role key in your shell env).
4. `corepack pnpm dev`, then open http://localhost:3000.

## Layout
`apps/web` (Next.js), `packages/shared` (schemas, permissions), `packages/db` (DB test harness), `supabase/migrations`, `docs/`.
