# 08 · Phased Implementation Plan & Acceptance Criteria

A module is **complete** only when its schema, RLS/authorization, business logic, validation, workflows, UI, error handling and tests all work together. Screens alone don't count.

Every phase gate requires `corepack pnpm check` to pass (typecheck, lint, unit + DB/RLS tests), updated `BUILD_STATUS.md`, and no open P0 issues.

### Phase 0: Foundation setup ✅
Inspect the environment, write the ADRs and plans, set up the monorepo, standards and env templates.
**AC:** workspace installs; `check` passes on an empty-but-wired repo; docs 01–08 exist.

### Phase 1: Auth, tenancy, RBAC, audit, design system ✅
**Scope:** Supabase Auth (email/password + magic link), org membership, org switcher, roles/permissions with scopes, audit framework, design tokens and primitives, `/platform` org list.
**AC:**
1. A user with no membership sees no tenant data (RLS test).
2. Cross-tenant read/write attempts fail for every tenant table (generated test over all tables).
3. Permission checks match the matrix in `05-permissions.md` (catalog ↔ DB test).
4. Audit events are written for sensitive mutations and cannot be modified or deleted.
5. Service-role usage is confined to server modules (lint rule).
6. ✅ Two-step sign-in (TOTP) enforced in the database for owner/HR/payroll/auditor roles and platform admins. ✅ Member invitations and role assignment with safe delegation. ✅ Suspended organizations and last-owner protection.

### Phase 2: Core HR + Recruitment
**2a Core HR ✅ (scope built):** employees, effective-dated employment records, org structure CRUD, search, filters, pagination, audit timeline, personal/identity/bank tables, documents, bulk import with dry-run validation report, export with audit.
**2b ATS ✅ hire journey built (requisitions, candidates with dedupe and consent, pipeline, interviews/scorecards, versioned offers with approval, hire from an accepted offer, careers page, erasure; resume parsing waits for Phase 7):** requisitions → postings → candidates (dedupe) → applications pipeline → interviews/scorecards → offers (versioned, approval) → convert to employee without duplicates. Careers page. Resume parsing via AI adapter with human confirmation.
**AC:** hire journey E2E (requisition → offer accepted → employee in `pre_joining`) and one employee record per hire. Candidate consent and deletion work.

### Phase 3: Onboarding, documents, attendance, shifts, leave, mobile app, job queue
**Built:** job queue + worker, private storage with signed URLs (documents), leave (ledger, approvals, accrual), attendance (idempotent punches, offline sync, regularization approvals, reproducible monthly summary), biometric CSV import, onboarding (templates, plans started by hires, policies with acknowledgements). ✅ Expo mobile app (check-in with location and an offline queue, leave, payslips; device builds need an Expo account). 🔜 Selfie/liveness.
Job queue + worker (ADR-007). Private storage with signed URLs. Expo app (employee check-in, leave, payslips later). Geofence and selfie punch with device checks and offline queue. Biometric adapter interface + CSV/ADMS-style import. Leave ledger with accrual jobs.
**AC:** punches are idempotent; offline punches sync once; leave balance = ledger sum, verified by property-based tests; regularization approval updates `attendance_days`; payroll-ready monthly summary is reproducible.

### Phase 4: Payroll, expenses, statutory
**Built:** deterministic engine with golden vectors (packages/payroll), statutory rules as versioned data (unvalidated), runs with maker ≠ checker at DB level, immutable locked runs, arrears through the next run, payslips, bank file, expenses with receipts and duplicate checks paid through payroll. ✅ Receipt reading (Phase 7). 🔜 professional validation, payslip PDF, accounting export.
Deterministic engine, effective-dated statutory rule sets with golden vectors, maker-checker, locking, payslips, bank file export, accounting export. Expenses with OCR and duplicate detection.
**AC:** regression suite of payroll scenarios; the same inputs always give the same outputs; approval by the preparer is rejected at DB level; a locked run is immutable; corrections via arrears in the next run. **Professional validation sign-off is required before any production payroll.**

### Phase 5: Performance, learning, services, assets, tasks, approvals, workflow engine v1
Generic approvals engine with delegation and escalation, tasks, notifications centre (in-app + email + push), helpdesk, announcements, assets, grievances (restricted).

### Phase 6: Separation & offboarding
**Built and verified on the live project:** separations (resign or start an exit, manager then HR approval, notice and shortfall), clearance (assets and access clear themselves), exit interview (HR only), sign-in revoked the day after the last working day, full and final settlement through the payroll engine with maker ≠ checker, relieving and experience letters, retention per data class, alumni. Settlement rules need professional validation.
Separation types, notice calculation, waiver/buyout, clearance, F&F via payroll engine, letters, access revocation, retention and alumni.
**AC:** E2E resignation → F&F approved → access revoked → records archived per retention class.

### Phase 7: AI orchestration, agents, analytics, workflow automation
**Built (verified on a local Supabase stack; live migration pending):** `packages/ai` (ADR-009) with the database gate, redaction, validated structured output, tier-capped tools and logged runs; Ask HR, resume and receipt reading, job-description drafts, the reporting copilot on an Insights page, payroll variance with an AI summary, role dashboards, recorded-response eval suites for every agent. Live-model evals need a provider key. Not built: scheduling, coordinators, anomaly detectors, learning gaps, workforce planning.
Per `06-ai-architecture.md`. Role dashboards. Reporting copilot.
**AC:** eval suites pass thresholds; no agent can perform a tier-3 action; cross-user leakage tests pass.

### Phase 8: Hardening & production
**Built:** CI on a real Supabase stack (the job runs every journey against `supabase start`; run locally 91/91), dependency audit and Dependabot, a 50,000-employee load test (every directory query under 300 ms P95 after set-based RLS, ADR-013), a security review with a nonce CSP ([09-security-review.md](09-security-review.md)), a passed backup and restore drill, a gated deploy workflow, and runbooks for operations, deploys, incidents, backups, AI and email. ✅ First GitHub CI run passed (91/91 journeys). ⏳ Needs credentials or accounts: production secrets, a penetration test, and integration sandboxes (WhatsApp, e-sign, BGV, SSO).
Real-Supabase CI, security review, dependency scanning, load tests (target: 50k employees/org, P95 list query < 300 ms), backup/restore drill, runbooks, deployment pipelines, WhatsApp/e-sign/BGV/SSO integrations verified with real sandbox credentials.
