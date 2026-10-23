# 09 · Security review (Phase 8, 2026-10-18)

This review checks the [threat model](07-threat-model.md) against the code, the tests and the configuration. It is
the project's own review: **it does not replace an independent penetration test**, which should happen before the
first real customer.

## What is enforced automatically

These run in `corepack pnpm check` on every change; a regression fails the build.

| Guarantee | Where |
|---|---|
| Every table in `public` has row-level security enabled | `packages/db/test/rls-tenancy.test.ts` |
| Every policy applies to signed-in users only (none to `anon` or `public`) | `rls-tenancy.test.ts` (new) |
| Every security-definer function pins an empty `search_path` (no function hijacking through a schema the caller controls) | `rls-tenancy.test.ts` (new) |
| Anonymous users hold no table privileges and can execute only the two reviewed careers-page functions | `privileges.test.ts` |
| Signed-in users never hold privileges that bypass RLS (`TRUNCATE`, `REFERENCES`, `TRIGGER`) | `privileges.test.ts` |
| Sensitive text is not readable through tables: grievance descriptions and messages, why someone left and the exit interview, and AI prompts and outputs | `privileges.test.ts` |
| Cross-tenant isolation, and team and self scopes, for every module | the module test files (`rls-scopes`, `rls-tenancy`, …) |
| The set-based policy helpers grant exactly what the per-row functions did, for every fixture user, employee and permission, at aal1 and aal2 | `rls-at-scale.test.ts` (new) |
| Privileged roles only apply in two-step (aal2) sessions | `mfa.test.ts` |
| Payroll and settlements: maker ≠ checker, locked runs immutable, approval only for the inputs that were seen | `payroll.test.ts`, `settlements.test.ts` |
| The audit log is append-only and attributes changes to `auth.uid()` | `audit.test.ts` |
| AI: the gate (permission, on/off, hourly limit, monthly budget), runs and suggestions private to their user, knowledge search limited to what the caller can read, no tier-3 tool can be declared or run | `ai.test.ts`, `packages/ai/test/tiers.test.ts` |
| Analytics count only what the caller can see | `analytics.test.ts` |
| The secret key is read only in `src/server/admin.ts`, and the AI key only in `src/server/ai.ts` | ESLint rule `no-restricted-properties` |
| Runtime dependencies have no known high or critical vulnerabilities | CI: `pnpm audit --prod --audit-level high` |

## Threats reviewed

| # | Threat | Status after this review |
|---|---|---|
| T1 | Cross-tenant reads | ✅ RLS everywhere, composite keys, cross-tenant tests in every module |
| T2 | Self-assigned roles | ✅ `role.manage` / `member.manage` checks in the database; owner protected |
| T3 | Secret key in the client | ✅ Lint rule, `server-only` imports, no `NEXT_PUBLIC_` secret. A scan of the full git history found no committed keys. `.env.local` and `.demo-mfa.json` are ignored |
| T4 | Managers seeing non-reports | ✅ Recursive reporting line with a cycle guard; tested |
| T5 | Payroll insider fraud | ✅ Maker-checker in the database. The variance table shows approvers what changed since the last locked run |
| T6 | Audit tampering | ✅ Append-only. ⏳ Periodic export to write-once storage is not built |
| T7 | Document URL guessing | ✅ Private buckets, short-lived signed URLs after a permission check, the Storage API refused to signed-in users directly |
| T8 | Prompt injection | ✅ Untrusted content is marked as data. Agents have no write tools (tiers 0–1 in use, tier 3 impossible). Evals include injection cases; resumes and receipts can only fill fields that a person checks |
| T9 | AI leaking across users | ✅ Retrieval and analytics run as the asker; runs and suggestions are private; identifiers in questions are masked |
| T10 | Spoofed attendance | ⏳ Mobile check-in is not built yet. Web punches are idempotent, and absences and regularizations go through approval |
| T11 | Account takeover | ✅ Two-step sign-in where the organization switches it on, enforced in the database. The website limits guessing (15 minutes: 5 wrong passwords per account and address, 30 per account, 100 per address; 5 wrong two-step codes or current passwords per person), and Supabase Auth applies its own per-address limits, which also cover the phone app. ⏳ Session lifetime is Supabase's default: set an inactivity timeout for the production project |
| T12 | Webhook spoofing | n/a: no inbound integrations yet. Design rule for when they come: HMAC signature, timestamp tolerance, idempotency key |
| T13 | Bulk export exfiltration | ✅ `employee.export` permission, each export audited with its filters; the audit log's own CSV download is recorded in it too |
| T14 | Injection and XSS | ✅ Parameterised queries (PostgREST and RPC), zod at every boundary, React escaping, no `dangerouslySetInnerHTML`. **Fixed in this review: no Content-Security-Policy was sent.** There is now a nonce-based CSP (below) |
| T15 | Over-retention | ✅ Retention per data class for leavers, AI prompts cleared after 30 days. ✅ Candidate consent expiry: candidates with no open or hired application are erased a per-organization number of days (365 by default) after their consent or last application activity, by a daily worker job through the same audited path as a manual erasure (migration 20261018003400, `candidate-retention.test.ts`; not yet applied to the live project) |
| T16 | AI cost exhaustion | ✅ Per-person hourly limit and per-organization monthly token budget in the database gate |
| T17 | Careers page abuse | ✅ Two functions only, consent, 5 applications per email per day. ⏳ Edge rate limiting (a Vercel WAF rule on `/careers`) |

## Findings fixed in this review

1. **No Content-Security-Policy** (T14). `src/proxy.ts` now sends a policy with a fresh nonce on every response:
   - `script-src 'self' 'nonce-…' 'strict-dynamic'`, so injected markup can't run script;
   - `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` and `object-src 'none'`;
   - connections only to the app and the Supabase project.

   Inline styles stay allowed, because React style attributes need them. Development also allows `'unsafe-eval'` for fast refresh.
2. **Policies and function `search_path`**: now asserted by tests (see the table above). Both already held; nothing was wrong.
3. **Row-level security didn't scale** (availability, not exposure). At 50,000 employees, a directory page took 9.5 s, because every policy looked up permissions once per row. Migration 20261018003200 computes the caller's reach once per query (ADR-013); the page now takes about 1 ms. A test proves the new policies grant exactly what the old ones did, for every fixture user, employee and permission, with and without two-step sign-in.
4. **The CI test environment had the email provider switched off** (`supabase/config.toml`), so no password sign-in worked there. Fixed while running the CI path locally for the first time.

## Open items (owner: whoever runs production)

- An independent penetration test before the first real customer.
- An inactivity timeout and refresh-token reuse detection in the production Supabase Auth settings.
- An edge rate limit on `/careers`. (`/login` is limited by the website itself; an edge limit would add a second layer.)
- Copies of the audit log in write-once storage (T6). People with `audit.read` can download it by period as CSV (Audit log › Download CSV); a scheduled copy to write-once storage is still open.
- A no-training, zero-retention agreement with the AI provider ([ai.md](runbooks/ai.md)).
- Tooling advisories with no patched release yet, both high severity: `braces` (GHSA-vfj7-8cjw-p6xm, via `eslint-config-next` and the mobile app's Metro bundler) and `node-forge` (GHSA-86w9-cpqp-85rv, via Expo's CLI). They run only at lint, build and dev time on our own files, and are not in the web runtime or the app bundle. The audit ignores exactly these two IDs (`auditConfig` in `pnpm-workspace.yaml`); remove each when a fix ships.
