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

1. Create a project, then apply migrations from the repo root (each command is interactive):
   `npx supabase@2 login`, then `npx supabase@2 link --project-ref <ref>` (asks for the database password), then `npx supabase@2 db push`.
2. In Supabase Auth settings:
   - Disable public sign-ups.
   - Set the Site URL and add `<site>/auth/callback` to the redirect allowlist.
   - Point the invite and magic-link email templates at `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=<invite|magiclink>`.
3. Copy `.env.example` to `apps/web/.env.local` and paste the **Publishable key** and **Secret key** from Dashboard → Settings → API Keys (the project URL is `https://<project-ref>.supabase.co`).
4. Optionally seed the clearly-marked demo tenant (synthetic people only; you choose the password):
   `DEMO_USER_PASSWORD='<12+ chars>' corepack pnpm --filter @peoplecore/web seed:demo --yes --platform-admin`
   Demo owner, HR, payroll and platform accounts use two-step sign-in. The seed enrolls their authenticators (`demo:mfa` re-runs that). To sign in as one in the browser, get the current code with
   `corepack pnpm --filter @peoplecore/web demo:totp demo.hr`.
5. `corepack pnpm dev`, then open http://localhost:3000.
6. Check the live setup end to end (needs the dev server running and the demo tenant seeded):
   - `corepack pnpm --filter @peoplecore/web verify:demo --app http://localhost:3000`: read-only access checks for every role.
   - `corepack pnpm --filter @peoplecore/web test:e2e`: browser journeys in headless Chrome (creates test records, then deletes them).

### The CI path on your machine (a throwaway local Supabase)

This runs every journey, the email ones included, against all migrations on real Postgres, without touching the live project. Keep the local settings in their own file and never edit `.env.local` for this:

```sh
npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,supavisor
eval "$(npx supabase status -o env)"
cat > /tmp/local.env <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SECRET_KEY
DEMO_USER_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
MAILPIT_URL=http://127.0.0.1:54324
DEMO_MFA_FILE=/tmp/local-mfa.json
AI_PROVIDER=mock
ENV
cd apps/web
node --env-file=/tmp/local.env scripts/seed-demo.ts --yes --platform-admin
set -a; . /tmp/local.env; set +a        # values already in the environment win over .env.local
corepack pnpm exec next dev --port 3000 & corepack pnpm exec playwright test
```

`DEMO_MFA_FILE` keeps the local stack's authenticator secrets apart from the live ones. To reset the local database, run `npx supabase db reset --local`. **Never pass `--linked`**: that resets the live project. Load test: `node scripts/load-test.ts` (local container only).

Changing the schema: add a migration, then run `corepack pnpm --filter @peoplecore/db gen:types` to refresh `database.types.ts` (a test fails if you forget).

## Layout
`apps/web` (Next.js), `apps/worker` (jobs), `apps/mobile` (Expo), `packages/shared` (schemas, permissions), `packages/db` (DB test harness), `packages/payroll` (deterministic engine), `packages/ai` (assistants, evals), `supabase/migrations`, `docs/` (decisions, threat model, security review, runbooks).
