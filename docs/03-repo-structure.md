# 03 · Monorepo Structure

```
peoplecore/
├── apps/
│   ├── web/                    Next.js 16: HR web app, manager web, /platform console
│   │   └── src/
│   │       ├── app/            routes (login, /app/[org]/…, /platform)
│   │       ├── components/ui/  design-system primitives
│   │       ├── lib/supabase/   browser/server clients (anon key + user session only)
│   │       └── server/         server-only code (actions, admin client, authz helpers)
│   ├── mobile/      (Phase 3)  Expo app: employee + manager experiences
│   └── worker/      (Phase 3)  job queue consumer, workflow executor, AI batch tasks
├── packages/
│   ├── shared/                 zod schemas, types, permission catalog
│   ├── db/                     PGlite harness, Supabase shim, DB/RLS tests
│   ├── payroll/     (Phase 4)
│   ├── workflow/    (Phase 5)
│   └── ai/          (Phase 7)
├── supabase/
│   ├── config.toml
│   ├── migrations/             ordered SQL migrations (forward-only; see rollback notes)
│   └── seed.sql                no-op; demo data comes from scripts/seed-demo.ts
├── scripts/                    seed-demo.ts, ops scripts
├── docs/                       ADRs, plans, threat model, runbooks
├── BUILD_STATUS.md             what's done / pending / known issues
└── turbo.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.mjs
```

## Coding standards

- TypeScript `strict`, `noUncheckedIndexedAccess`. No `any` in shared packages.
- All input crossing a trust boundary (form, API, webhook, AI output) is parsed with a zod schema from `@peoplecore/shared`.
- Server code that uses elevated credentials imports `server-only` and documents its authorization check.
- SQL: snake_case and one migration per change, named `YYYYMMDDHHMMSS_description.sql`. Every new tenant table ships in the same migration with: `organization_id`, RLS enabled, policies, indexes on `(organization_id, …)`, an audit trigger where sensitive, and a test in `packages/db/test`.
- Commits are small and reviewable. `pnpm check` (typecheck + lint + test) must pass before moving to the next phase.
- Never put real personal data in fixtures. Demo data uses `example.test` emails and is labelled **DEMO**.
