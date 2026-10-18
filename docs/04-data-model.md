# 04 · Database Entity & Relationship Plan

Conventions apply to every table:

- `id uuid pk default gen_random_uuid()`.
- `organization_id uuid not null references organizations` on every tenant-owned table.
- `created_at`, `updated_at`, `created_by`. Soft-archive (`archived_at`) for master data. Hard delete only through retention jobs.
- Composite FKs `(organization_id, x_id)` are used where cross-tenant references would otherwise be possible. This makes it **impossible at the constraint level** to link an employee to another tenant's department.
- Effective-dated tables carry `effective_from date not null` and `effective_to date null`, plus a GiST exclusion constraint preventing overlap per subject.
- Money is `numeric(14,2)` with a currency code. Never float.
- Enums are Postgres enums only for closed sets the code branches on. Configurable lists (leave types, components) are tables.

Legend: ✅ built in the current slice · 🔜 next phase · 📋 planned.

## Foundation (Phase 1)
| Table | Key columns / notes |
|---|---|
| ✅ `organizations` | name, slug (unique), status, country_code, plan_code, settings |
| ✅ `platform_admins` | user_id. Not tenant-scoped, readable only by platform admins |
| ✅ `organization_members` | org, user_id → auth.users, status (invited/active/suspended), unique (org,user) |
| ✅ `roles` | org, key, name, is_system. Unique (org,key) |
| ✅ `permissions` | key (pk), module, description, is_sensitive. Global catalog |
| ✅ `role_permissions` | role, permission_key, scope (`org`/`team`/`self`) |
| ✅ `member_roles` | member, role, granted_by, valid_until (for delegation/time-boxed access) |
| ✅ `audit_events` | org, actor_user_id, action, entity_type, entity_id, before/after jsonb diff, request id. **Append-only** (trigger blocks UPDATE/DELETE) |
| 📋 `org_entitlements` | org, feature_key, limit. Subscription limits |
| 📋 `access_reviews`, `approval_delegations` | Periodic access recertification, out-of-office delegation |

## Org structure (Phase 1–2)
✅ `legal_entities` (PAN/TAN/GSTIN as attributes, never on employee rows), ✅ `locations` (state for PT/holiday rules, geo for geofence), ✅ `departments` (self-FK parent, head_employee_id), ✅ `designations`, ✅ `cost_centres`.

## Core HR (Phase 2)
| Table | Notes |
|---|---|
| ✅ `employees` | org, employee_code (unique per org), user_id (nullable, unique per org), legal names, work_email, status (`pre_joining`/`active`/`on_notice`/`exited`), date_of_joining, date_of_exit, manager_employee_id, department, designation, location, legal_entity, employment_type |
| ✅ `employment_records` | effective-dated history: department/designation/location/manager/type/change_reason. `employees` holds the denormalised current snapshot, maintained by app logic |
| 🔜 `employee_personal` | DOB, gender, personal contacts, address. Separate table so permission `employee.personal.read` applies |
| 🔜 `employee_identity_docs` | PAN/Aadhaar/passport refs. Encrypted columns + storage objects. `employee.identity.read` |
| 🔜 `employee_bank_accounts` | Effective-dated, verification status. `employee.bank.read` |
| 🔜 `dependants`, `emergency_contacts`, `qualifications`, `skills`, `employee_skills`, `certifications`, `work_experience` | |
| ✅ `employee_documents` | Category, title, file name, type, size, storage path `<org>/<employee>/<id>` in the private `employee-documents` bucket, uploader, soft delete. Retention class: Phase 6 |

## Recruitment (Phase 2)
`job_requisitions` → `positions` → `job_postings`. `candidates` (dedupe keys: normalised email/phone) → `applications` (stage, source). `resumes` (document + parsed JSON *and* extracted normalised fields). `interview_rounds`, `interviews`, `interview_panelists`, `scorecards` (criterion rows, not a JSON blob), `offers` + `offer_versions`, `bgv_checks`, `candidate_consents` (purpose, granted_at, expires_at). `applications.converted_employee_id` links to `employees` so records aren't duplicated on hire.

**Built (slice 1, migration 20261018000800):** `job_requisitions` (positions and postings are folded into the requisition for now), `candidates` (email/phone dedupe, `consent_at`), `applications` (stage pipeline, `converted_employee_id` unique). ✅ Slice 2 (migration 20261018001400): `offers` + `offer_versions`, `interviews`, `interview_panelists`, `scorecards` + `scorecard_ratings`, `job_requisitions.is_published`. 🔜 `resumes`, `bgv_checks`, `candidate_consents` with expiry.

## Onboarding & documents (Phase 3)
✅ Built (migration 20261018001500): `onboarding_templates`/`onboarding_template_tasks` → `onboarding_plans` (tasks live in the shared `tasks` table), `policy_documents` (versioned) + `policy_acknowledgements`. 🔜 `esign_requests`, `probation_plans`.

## Attendance, shifts, leave (Phase 3)
✅ Built (migration 20261018001300): `shifts`, `roster_assignments`, `geofences`, `biometric_devices`, `attendance_punches` (immutable, source-keyed), `attendance_days` (derived cache), `regularization_requests`, `anomaly_flags`. 🔜 `shift_patterns`, `overtime_records`, `timesheets`. Original plan: `shifts`, `shift_patterns`, `roster_assignments` (effective-dated). `attendance_punches` (raw, immutable: method, device_id, geo point, accuracy, selfie object, liveness score, captured_at, received_at). `attendance_days` (derived per employee/day: status, worked minutes, late/early flags). `regularization_requests`, `overtime_records`, `geofences`, `biometric_devices` + `device_punch_imports` (idempotent on device+serial). `timesheets`/`timesheet_entries`. `anomaly_flags` (subject, rule/model, explanation, status, reviewer).
✅ Built (migration 20261018001200): `holiday_calendars` (with weekly offs)/`holidays`, `leave_types`, `leave_policies` (versioned), `leave_ledger`, `leave_requests`. 🔜 `comp_off_grants`, encashment. Original plan: `holiday_calendars`/`holidays` (by location). `leave_types`, `leave_policies` (versioned rules: accrual, carry-forward, encashment, eligibility), `leave_ledger` (**ledger**, not a balance column: accrual/debit/lapse/encash/adjust rows; balance = sum), `leave_requests` (+ partial-day fields), `comp_off_grants`.

## Payroll & expenses (Phase 4)
✅ Built (migration 20261018001600): `salary_components`, `compensation_records` + `compensation_lines`, `employee_statutory_profiles`, `statutory_rule_sets` (global), `payroll_runs` (draft → computed → approved → locked, maker ≠ checker), `payroll_run_employees` (payslips), `payroll_line_items`. 🔜 the rest below. Original plan: `pay_groups`, `payroll_calendars`, `salary_components` (earning/deduction/reimbursement, taxability), `salary_structures` + `structure_components`, `compensation_records` (effective-dated CTC + component values), `statutory_rule_sets` + `statutory_rules` (effective-dated, versioned, with test vectors), `employee_statutory_profiles` (PF/ESI/PT eligibility and numbers), `tax_declarations`, `payroll_runs` (state machine: draft → computed → reviewed → approved → locked → paid; maker ≠ checker), `payroll_run_employees`, `payroll_line_items`, `payroll_exceptions` (blocking flag), `payslips`, `bank_payment_files`, `arrears`, `fnf_settlements` + `fnf_line_items`. `expense_categories`, `expense_policies`, `expense_claims`, `expense_items`, `receipts` (hash for duplicate detection), `mileage_rates`. ✅ Built (migration 20261018001800): `expense_categories` (receipt rule, per-item limit), `expense_claims`, `expense_items` (receipt path, name and SHA-256 on the item). 🔜 `expense_policies`, `mileage_rates`.

## Performance, learning, services, assets, ER (Phase 5)
`review_cycles`, `review_templates`, `goals` (OKR/KRA with parent), `reviews`, `review_responses`, `feedback_requests`, `calibration_sessions`, `competency_frameworks`, `training_courses`, `training_enrolments`, `development_plans`, `succession_plans`. `announcements` + `acknowledgements`, `helpdesk_tickets`, `kb_articles`, `surveys`, `recognitions`. `assets`, `asset_assignments` (with condition evidence), `access_grants`. `grievance_cases` (restricted visibility list), `case_notes`, `corrective_actions`.

## Platform services
✅ Built: `approval_flows` + `approval_flow_steps` (from `app.approval_flow_templates`), `approval_requests`, `approval_actions` (append-only), `app.approval_handlers`; `tasks`; `notifications`; `app.jobs`; `app.domain_events`. 🔜 `notification_deliveries` (email/push), `notification_preferences`, `workflow_definitions`/`workflow_versions`/`workflow_executions`/`workflow_step_runs`. `webhook_endpoints`/`webhook_deliveries`, `integration_connections` (secrets in Vault, not in rows).

## Offboarding (Phase 6)
`separations` (type: resignation/termination/retirement/contract_expiry/abandonment/death; dates; notice computation inputs/outputs; waiver/buyout), `clearance_items`, `exit_interviews`, `issued_letters`, `alumni_records` (rehire_eligible, reason), `retention_schedules`.

## AI (Phase 7)
`ai_prompts` (versioned), `ai_runs` (agent, model, prompt_version, tokens, latency, cost, status, redaction summary, actor), `ai_suggestions` (subject, payload, status: proposed/accepted/rejected, decided_by), `ai_feedback`, `kb_chunks` (pgvector embeddings with source document + ACL tag).
