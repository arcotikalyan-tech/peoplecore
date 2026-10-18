# 07 · Security Threat Model (STRIDE)

**Assets:** employee PII (identity docs, bank, salary, medical/accommodation, grievances), candidate data, payroll outputs and bank files, credentials/secrets, audit logs.
**Actors:** employees, managers, HR/payroll staff, recruiters, candidates (unauthenticated portal), platform admins, integrations, AI providers, attackers.
**Trust boundaries:** browser/mobile ↔ Next.js server ↔ Supabase (PostgREST/Auth/Storage) ↔ worker ↔ third parties (AI, e-sign, BGV, banks, messaging).

| # | Threat | STRIDE | Mitigation | Verified by |
|---|---|---|---|---|
| T1 | Tenant A reads tenant B's data by changing an org id or slug | I | RLS on every tenant table. Membership derived from `auth.uid()`. Composite FKs prevent cross-tenant links | `packages/db/test/rls.*.test.ts` cross-tenant suite ✅ |
| T2 | Employee escalates by self-assigning a role | E | `member_roles` insert requires `role.manage`. Owner role protected. Audit trigger | RLS test ✅ |
| T3 | Secret (service-role) key leaked to client | E/I | Key only in server env. `server-only` import guard. Lint rule bans reading `process.env` in `apps/web/src` outside `lib/env.ts` (publishable values) and `server/admin.ts`. `NEXT_PUBLIC_` vars never contain it | lint + review |
| T4 | Manager sees non-reports | I | `team` scope resolved by recursive reporting-line function with cycle guard | RLS test ✅ |
| T5 | Payroll fraud by a single insider | T/E | Maker-checker DB constraint. Run locking. Bank file hash + audit. Anomaly auditor | Phase 4 tests |
| T6 | Audit log tampering | T/R | Append-only trigger, no UPDATE/DELETE grants, actor from `auth.uid()` not client input. Periodic export to WORM storage (Phase 8) | test ✅ |
| T7 | Document URL guessing/sharing | I | Private buckets. Short-lived signed URLs issued after a permission check. Object paths prefixed by org id with storage RLS | Phase 3 tests |
| T8 | Prompt injection via resumes, receipts, tickets | T/E | Untrusted content tagged as data. Tools allowlisted per agent with permission checks executed as the actor. Tier-3 actions never automated | AI evals with injection fixtures |
| T9 | AI leaks data across users | I | Retrieval runs through the actor's RLS client. ACL tags on KB chunks. Redaction step | AI tests |
| T10 | Spoofed attendance (GPS spoofing, photo of photo) | S | Mock-location detection, accuracy thresholds, liveness (optional), device binding. Anomalies go to review and are never sole proof | Phase 3 |
| T11 | Account takeover | S | Supabase Auth with MFA (TOTP) enforced for sensitive roles, session timeout, rate limiting on auth routes | Phase 1b |
| T12 | Webhook/integration spoofing | S/T | HMAC signatures, timestamp tolerance, idempotency keys, secrets in Vault | Phase 8 |
| T13 | Bulk export exfiltration | I | `*.export` permission, export audit events, watermarking, rate limits | Phase 2b |
| T14 | Injection / XSS | T | Parameterised queries via PostgREST/RPC. zod at boundaries. React escaping. Nonce-based CSP (`src/proxy.ts`) | lint, `e2e/security-headers.spec.ts` ✅ |
| T15 | Data retained beyond purpose | I (privacy) | Retention classes per record type, scheduled anonymisation jobs, candidate consent expiry | Phase 6; `settlements.test.ts`, `candidate-retention.test.ts` ✅ |
| T16 | DoS / cost exhaustion on AI | D | Per-org rate limits and budgets, queueing | Phase 7 |
| T17 | Abuse of the public careers page (spam, enumeration, data injection) | S/T/I/D | The only anonymous access: two functions, no table grants (asserted by a test). Published, open requisitions only; public fields only. Applications need consent, are validated, matched on email only, never overwrite existing candidates, and get the same answer whether or not the person is on file; at most 5 per email per day are recorded. Rate limiting at the edge (Phase 8) | DB tests (privileges, careers) |

## Privacy (India: DPDP Act 2023 and Rules)
Design supports notice and purpose-specific consent records, data-principal requests (access/correction/erasure where no legal retention applies), breach logging and notification workflow, and retention schedules. **Not a compliance claim:** requirements must be reviewed with counsel against current rules and each customer's circumstances.

## Incident response (outline)
Detect (alerts on auth anomalies, RLS-denied spikes, export spikes) → triage → contain (revoke sessions/keys) → assess → notify (per law/contract) → post-mortem. The full runbook is [runbooks/incident-response.md](runbooks/incident-response.md); the Phase 8 review of these threats is [09-security-review.md](09-security-review.md).
