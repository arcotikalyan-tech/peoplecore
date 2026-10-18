# 01 · Architecture Decision Record

Status legend: **Accepted** (in force) · **Proposed** (to confirm before the phase that needs it).

Environment at Phase 0 (2026-10-17): macOS 27, Node 24.18, npm 11.16, corepack 0.35 (pnpm 12.14), git 2.54. **No Docker, no Supabase CLI, no psql installed.** This shaped ADR-005.

---

## ADR-001 · Monorepo with pnpm workspaces + Turborepo — Accepted

- **pnpm** (pinned through `packageManager`, invoked via `corepack pnpm`, so no global install). Strict dependency isolation stops one app from silently importing another app's dependencies. Expo SDK 54+ supports pnpm isolated installs.
- **Turborepo** for task graph and caching (`build`, `typecheck`, `lint`, `test`).
- **TypeScript 6.0.x**, pinned. TS 7 is released, but `typescript-eslint` supports `<6.1`. Revisit when the lint tooling catches up.

## ADR-002 · Apps and deployment units — Accepted

| Unit | Tech | Deploy target |
|---|---|---|
| `apps/web` | Next.js 16 App Router | Vercel (or any Node host) |
| `apps/mobile` | Expo / React Native (single app; employee + manager experiences by role) | EAS Build |
| `apps/worker` | Node process draining the job queue | Container / Fly / Render |
| `supabase/` | Migrations, config, seed | Supabase project per environment |

The **platform super-admin console** lives in `apps/web` under `/platform`. It is gated by `app.is_platform_admin()` and server-side checks, so it isn't a separate app. That avoids duplicating auth and the design system. It can be split out later if a separate network boundary is needed (e.g. IP allowlisting).

## ADR-003 · Supabase is the system of record; authorization is enforced in the database — Accepted

- Every tenant-owned table has `organization_id uuid not null` and RLS enabled with **no permissive default**.
- Authorization helpers are `security definer` SQL functions in schema `app` (`app.is_member`, `app.has_permission`, `app.can_access_employee`). Policies call them. The same rules therefore protect web, mobile, worker and direct PostgREST calls.
- Clients **never** hold the secret key (`SUPABASE_SECRET_KEY`, service-role privileges); browsers get only the publishable key. Its use is confined to `apps/web/src/server/admin.ts` (`server-only`) and `apps/worker`. Every call site must perform its own authorization check first.
- The client may *name* an organization (URL slug), but it is never *trusted*. RLS re-checks membership on every row.

## ADR-004 · Permission model: roles → permissions with scope — Accepted

Permissions are strings (`employee.read`, `payroll.approve`, …) granted to roles with a **scope**: `org`, `team` (reporting line) or `self`. Roles are per-organization rows. System roles are seeded from a template and custom roles are allowed. Members can hold several roles. The TypeScript catalog in `packages/shared/src/permissions.ts` is the source of truth for the UI. A test asserts it matches the database seed. See [05-permissions.md](05-permissions.md).

## ADR-005 · Database tests run on PGlite — Accepted

There's no Docker, so `supabase start` isn't available. Migrations are applied to **PGlite** (real Postgres compiled to WASM) on top of a small shim that reproduces Supabase's `auth` schema, `auth.uid()` and the `anon`/`authenticated`/`service_role` roles. Tests then switch to `authenticated` with JWT claims and assert RLS behaviour, including cross-tenant isolation.
*Limitation:* PGlite is not hosted Supabase. A CI job against a real Supabase instance (`supabase db reset` + the same tests) is required before production (Phase 8).

## ADR-006 · Effective-dated records for employment and compensation — Accepted

`employment_records` and (Phase 4) `compensation_records` use `effective_from`/`effective_to` with an exclusion constraint preventing overlaps. The current state is derived, never overwritten. Payroll for a historical period must reproduce exactly.

## ADR-007 · Background jobs: Postgres-backed queue — Accepted (built: migration 20261018001000, apps/worker)

Table `app.jobs` with an `idempotency_key` unique constraint, `run_at`, `attempts` and `locked_until`. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, use exponential backoff, and move dead jobs to a failure queue. Chosen over an external broker so that a job is enqueued **in the same transaction** as the business change (transactional outbox). Supabase `pgmq` remains an option if throughput requires it.

## ADR-008 · Workflow engine on top of the job queue — Proposed (Phase 5/7)

Versioned workflow definitions (trigger → conditions → steps), persisted executions and step history. Approval steps create `approval_requests` rows, so humans act through the same permission model. Details are in [02-module-map.md](02-module-map.md).

## ADR-009 · AI behind a provider-independent adapter — Accepted (built: packages/ai, migration 20261018003000)

`packages/ai` exposes `runAgent(agent, input, deps)` on top of a provider interface (`complete`), and structured output (`extract<T>` in the original proposal) is every agent's `respond` tool, validated with zod and repaired once. Provider adapters plug in behind that interface: Anthropic (plain fetch, retries, fallback model), `mock` (deterministic answers for development and browser tests, refused in production) and `recorded` (evals). Every call goes through the same pipeline: a database gate, context loaded as the actor, redaction, a prompt versioned in code, the provider, validation, allowlisted tools, and a persisted run. See [06-ai-architecture.md](06-ai-architecture.md).

Decisions made while building it:
- **Prompts are versioned in code**, not in an `ai_prompts` table. They are reviewed like code and covered by the eval suites, and every run stores `prompt_version`.
- **Retrieval uses Postgres full-text search for now** (`search_knowledge`, security invoker), not embeddings. It needs no second provider, and it runs as the caller, so RLS is the access control. `embed` and `kb_chunks` wait until search quality calls for them.
- **Budgets are in tokens**, not money, so no prices are hard-coded.

## ADR-010 · Payroll calculations are deterministic and rule-versioned — Accepted (built: packages/payroll, migration 20261018001600)

`packages/payroll` is pure TypeScript with no I/O. Statutory rules (PF, ESI, PT, TDS, gratuity, bonus) are **data**: effective-dated, versioned rule sets stored in the DB, never constants in code. Each rule set has golden test cases. AI never computes amounts. **Professional validation is required before production payroll use.**

## ADR-011 · UI: Tailwind CSS v4 + in-repo component set — Accepted

Design tokens are CSS variables. Accessible primitives are written in-repo (`apps/web/src/components/ui`) and extracted to `packages/ui` once mobile/web sharing is real. AI-generated content always renders inside a distinct `AiSuggestion` container and is never styled like a confirmed record.

## ADR-012 · Isolation from Vibe Upp — Accepted

PeopleCore lives only in `~/Projects/peoplecore`. The Vibe Upp project (`~/Projects/gossip-app`) is never read, modified or reused. It uses separate Supabase projects, keys, EAS project and bundle identifiers (`in.peoplecore.*`).
