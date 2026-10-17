# 08 · Phased Implementation Plan & Acceptance Criteria

A module is **complete** only when its schema, RLS/authorization, business logic, validation, workflows, UI, error handling and tests all work together. Screens alone don't count.

Every phase gate requires `corepack pnpm check` to pass (typecheck, lint, unit + DB/RLS tests), updated `BUILD_STATUS.md`, and no open P0 issues.

### Phase 0: Foundation setup ✅
Inspect the environment, write the ADRs and plans, set up the monorepo, standards and env templates.
**AC:** workspace installs; `check` passes on an empty-but-wired repo; docs 01–08 exist.

### Phase 1: Auth, tenancy, RBAC, audit, design system (slice 1 in progress)
**Scope:** Supabase Auth (email/password + magic link), org membership, org switcher, roles/permissions with scopes, audit framework, design tokens and primitives, `/platform` org list.
**AC:**
1. A user with no membership sees no tenant data (RLS test).
2. Cross-tenant read/write attempts fail for every tenant table (generated test over all tables).
3. Permission checks match the matrix in `05-permissions.md` (catalog ↔ DB test).
4. Audit events are written for sensitive mutations and cannot be modified or deleted.
5. Service-role usage is confined to server modules (lint rule).
6. ✅ Two-step sign-in (TOTP) enforced in the database for owner/HR/payroll/auditor roles and platform admins. ✅ Member invitations and role assignment with safe delegation. ✅ Suspended organizations and last-owner protection.

### Phase 2: Core HR + Recruitment
**2a Core HR (slice 1 in progress):** employees, effective-dated employment records, org structure CRUD, search, filters, pagination, audit timeline. 🔜 personal/identity/bank tables, documents, bulk import with dry-run validation report, export with audit.
**2b ATS:** requisitions → postings → candidates (dedupe) → applications pipeline → interviews/scorecards → offers (versioned, approval) → convert to employee without duplicates. Careers page. Resume parsing via AI adapter with human confirmation.
**AC:** hire journey E2E (requisition → offer accepted → employee in `pre_joining`) and one employee record per hire. Candidate consent and deletion work.

### Phase 3: Onboarding, documents, attendance, shifts, leave, mobile app, job queue
Job queue + worker (ADR-007). Private storage with signed URLs. Expo app (employee check-in, leave, payslips later). Geofence and selfie punch with device checks and offline queue. Biometric adapter interface + CSV/ADMS-style import. Leave ledger with accrual jobs.
**AC:** punches are idempotent; offline punches sync once; leave balance = ledger sum, verified by property-based tests; regularization approval updates `attendance_days`; payroll-ready monthly summary is reproducible.

### Phase 4: Payroll, expenses, statutory
Deterministic engine, effective-dated statutory rule sets with golden vectors, maker-checker, locking, payslips, bank file export, accounting export. Expenses with OCR and duplicate detection.
**AC:** regression suite of payroll scenarios; the same inputs always give the same outputs; approval by the preparer is rejected at DB level; a locked run is immutable; corrections via arrears in the next run. **Professional validation sign-off is required before any production payroll.**

### Phase 5: Performance, learning, services, assets, tasks, approvals, workflow engine v1
Generic approvals engine with delegation and escalation, tasks, notifications centre (in-app + email + push), helpdesk, announcements, assets, grievances (restricted).

### Phase 6: Separation & offboarding
Separation types, notice calculation, waiver/buyout, clearance, F&F via payroll engine, letters, access revocation, retention and alumni.
**AC:** E2E resignation → F&F approved → access revoked → records archived per retention class.

### Phase 7: AI orchestration, agents, analytics, workflow automation
Per `06-ai-architecture.md`. Role dashboards. Reporting copilot.
**AC:** eval suites pass thresholds; no agent can perform a tier-3 action; cross-user leakage tests pass.

### Phase 8: Hardening & production
Real-Supabase CI, security review, dependency scanning, load tests (target: 50k employees/org, P95 list query < 300 ms), backup/restore drill, runbooks, deployment pipelines, WhatsApp/e-sign/BGV/SSO integrations verified with real sandbox credentials.
