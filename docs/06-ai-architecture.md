# 06 · AI Service Architecture

```
caller (server action / worker job)
   │  AiRequest { agent, task, actor, org, input }
   ▼
┌───────────────────────── packages/ai ─────────────────────────┐
│ 1 Policy gate    ai.use permission · org entitlement · rate     │
│                  limit · per-org budget                         │
│ 2 Context build  permission-aware retrieval: queries run AS     │
│                  THE ACTOR (RLS client), never service-role     │
│ 3 Redaction      drop fields not needed for task (PII map per   │
│                  task); mask identifiers                        │
│ 4 Prompt         versioned template (ai_prompts) + model config │
│ 5 Provider       adapter interface → provider A | B | local     │
│                  timeout · retry · fallback model               │
│ 6 Validate       zod schema on structured output; reject/repair │
│ 7 Tools          allowlisted tools per agent, each declaring    │
│                  required permission + risk tier                │
│ 8 Persist        ai_runs (tokens, latency, cost, versions) +    │
│                  ai_suggestions (status = proposed)             │
└───────────────────────────────────────────────────────────────┘
   │
   ▼
Human review UI: accept / edit / reject → writes the real record via normal
module code paths (same validation, RLS, approvals, audit)
```

## Risk tiers for agent actions
| Tier | Examples | Execution |
|---|---|---|
| 0 Read/summarise | answer policy question, explain payroll variance | auto, cites sources |
| 1 Draft | draft email, JD, interview questions, exit letter | saved as suggestion, human sends |
| 2 Low-risk write | create a task, schedule a reminder, propose interview slots | auto **only if** the org enabled it for that agent. Fully logged and reversible |
| 3 Consequential | reject candidate, change pay, approve leave, flag misconduct, terminate | **never auto**. Creates an approval request at most |

## Agents (all Phase 7 unless noted)
| Agent | Grounding data | Output | Max tier |
|---|---|---|---|
| Resume & document extraction (Phase 2b, early) | uploaded file (OCR) | typed fields + confidence | 1 |
| Recruitment assistant | requisition, candidate profile | criteria-based match with per-criterion evidence. **No protected attributes in features** | 1 |
| Interview scheduling & feedback | calendars (integration), scorecards | slot proposals, feedback summary | 2 |
| Onboarding coordinator | onboarding plan | reminders, task creation | 2 |
| Attendance anomaly detector | punches, roster, geofence | `anomaly_flags` with explanation → review queue | 2 (flag only) |
| HR policy assistant | kb_chunks (RAG) filtered by the user's ACL | answer + citations, "I don't know" fallback | 0 |
| Payroll anomaly auditor | run vs prior runs | variance explanations, exceptions | 2 (exception only) |
| Expense fraud-risk | receipts (OCR, hash), policy | risk notes, duplicate flags | 2 (flag only) |
| Learning & skills gap | skills, role competencies | suggested plan | 1 |
| HR reporting copilot | analytics views as actor | answer + query used + timeframe + limitations | 0 |
| Workforce planning | headcount, attrition | scenarios | 0 |
| Offboarding coordinator | separation, clearance | checklist tasks, letter drafts | 2 |

## Quality & safety
- **Evaluations:** `packages/ai/evals/<agent>/*.jsonl` with expected structured outputs. CI runs them against a recorded-response provider for regression, and a nightly job runs them against live models.
- **Bias controls (recruitment):** the feature allowlist excludes name, gender, age, photo, address and marital status. Scores always show per-criterion evidence. Adverse-impact reporting is in analytics.
- **Data handling:** a no-training/zero-retention provider setting is required per contract. Prompts and outputs live in `ai_runs` with retention limits. Sensitive categories (`†` in the permission matrix) are excluded from retrieval unless the task needs them **and** the actor holds the permission.
- **No credentials invented:** provider keys come from env/Vault. The adapter fails closed with a clear "AI not configured" state.
