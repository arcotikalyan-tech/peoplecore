# 02 · Module & Dependency Map

Arrows mean "depends on". Lower layers never import upper layers.

```
                         ┌──────────────────────────────────────────────┐
  Experience layer       │ web (HR, managers, platform)   mobile   API  │
                         └───────────────┬──────────────────────────────┘
                                         │
  Intelligence layer     AI orchestration · Analytics · Workflow engine
                                         │
  Lifecycle modules      Planning → Recruitment → Onboarding → Core HR → Attendance/Leave
                         → Payroll/Expenses → Performance/Learning → Services/Assets/ER
                         → Offboarding → Alumni
                                         │
  Platform services      Approvals · Tasks · Notifications · Documents/Storage · Jobs
                                         │
  Foundation             Tenancy · Identity/Auth · RBAC · Audit · Org structure · Config
```

## Module dependencies

| Module | Depends on | Emits events consumed by |
|---|---|---|
| **Foundation** (tenancy, RBAC, audit, org structure) | — | everything |
| Approvals & tasks | Foundation | all modules with approvals |
| Notifications | Foundation, Jobs | — |
| Documents (private storage, signed URLs) | Foundation | Recruitment, Onboarding, Core HR, Expenses, ER |
| Workforce planning | Foundation, Approvals | Recruitment (approved requisition → pipeline) |
| Recruitment / ATS | Planning, Documents, AI (parsing) | Onboarding (offer accepted) |
| Onboarding | Recruitment, Core HR, Tasks, Documents | Attendance/Payroll (joined → eligibility) |
| **Core HR** (employees, employment records) | Foundation | nearly everything |
| Attendance & shifts | Core HR, Leave (holidays) | Payroll (summaries), AI anomaly detector |
| Leave & holidays | Core HR, Approvals | Attendance, Payroll |
| Payroll & compensation | Core HR, Attendance, Leave, Expenses, statutory rules | Offboarding (F&F), Accounting export |
| Expenses | Core HR, Documents, Approvals | Payroll |
| Performance & learning | Core HR | Compensation (revisions via approval only) |
| Engagement & helpdesk | Core HR, Documents, AI (policy RAG) | — |
| Assets & access | Core HR, Tasks | Offboarding (clearance) |
| Employee relations | Core HR, Documents (restricted) | — |
| Offboarding | Core HR, Assets, Payroll, Tasks, Approvals | Alumni, retention jobs |
| Analytics | read models of all modules | — |
| AI orchestration | Foundation (permissions), all modules via tools | — |

## Event backbone

Modules don't call each other's tables to trigger behaviour. They write a **domain event** (`app.domain_events`, in the same transaction) and the workflow engine reacts to it. Examples: `requisition.approved`, `offer.accepted`, `employee.joined`, `attendance.punch_missed`, `resignation.approved`, `exit.completed`. Each event carries `organization_id`, the subject id and an idempotency key.

## Code packages

| Package | Purpose | Runs where |
|---|---|---|
| `@peoplecore/shared` | Zod schemas, DTO types, permission catalog, constants | web, mobile, worker |
| `@peoplecore/db` | Migration test harness (PGlite), typed row models | tests, worker |
| `@peoplecore/payroll` *(Phase 4)* | Deterministic payroll & statutory engine | worker, web server |
| `@peoplecore/workflow` *(Phase 5)* | Workflow definitions, executor | worker |
| `@peoplecore/ai` *(Phase 7)* | Provider adapters, policy layer, agents | web server, worker |
| `@peoplecore/ui` *(when mobile shares UI)* | Tokens and cross-platform primitives | web, mobile |
