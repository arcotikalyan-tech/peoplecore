# 10 · Competitor benchmark: Kredily (new dashboard), 2026-10-18

A feature-by-feature walk through Kredily's new dashboard (`*.ai.kredily.com`, which replaces the old one on
31 October 2026), done from the owner's own account in both the **CEO** and **Employee** views: 24 modules,
about 390 screens and tabs. This records **what the product does**, to decide what PeopleCore builds next.
It deliberately copies no wording, layout or artwork: PeopleCore keeps its own design.

Legend for PeopleCore today: ✅ have it · 🟡 partly · ❌ missing.

## 1. Product shell (applies to every screen)

| Kredily | PeopleCore |
|---|---|
| Icon sidebar with ~24 modules; collapsible | ❌ flat text list of ~20 links |
| Global employee search with ⌘K | ❌ |
| **CEO ↔ Employee view switch** in the top bar (admins see the self-service view too) | ❌ (one mixed view) |
| Dark and light themes | ❌ light only |
| Every module is a **hub**: KPI cards on top, then tabs (Hub, Logs, Approvals, Rules, Analytics, Settings) | ❌ one page per module |
| Avatars and initials everywhere | ❌ |
| An AI insight banner per module ("3 requests awaiting approval…") | 🟡 role dashboards show what is waiting |
| Saved views (★), column chooser, filters, page size, export on every table | 🟡 filters and export on some tables |
| In-app guide links per screen, chat support | ❌ |

## 2. Dashboard

| Kredily | PeopleCore |
|---|---|
| Greeting, date, company and headcount | 🟡 |
| KPI tiles: headcount, monthly payroll, compliance score, average presence, 30-day attrition | 🟡 different tiles (approvals, tasks, tickets, exits, joiners, probation) |
| Headcount trend and payroll spend charts (6 months) | ❌ |
| Live attendance snapshot (late, on leave, absent today) | ❌ |
| Compliance status (PF, ESI, PT, TDS) | ❌ |
| Customisable quick-access tiles | ❌ |
| Side rail: clock in/out, announcements, birthdays, holidays | 🟡 announcements elsewhere; no clock-in on dashboard |
| Recent activity | ❌ |

## 3. People (directory)

| Kredily | PeopleCore |
|---|---|
| Overview: headcount, new joiners, average tenure, gender mix, profile gaps | ❌ |
| Quick lists: new joiners, incomplete profiles, exiting | 🟡 dashboard lists |
| People table and grid view, filters, column chooser, saved views, sort, paging | 🟡 table, search, status and department filters |
| Account status: signed in / not signed in / mobile users / inactive; resend activation | ❌ |
| Invite by email, WhatsApp or SMS | 🟡 email invitations |
| Bulk actions, bulk mail, confirm probation in bulk, deletion requests | ❌ |
| Org chart (zoom, fit, export) | ❌ |
| Lifecycle board: pre-joiners → onboarding → active → notice → exited (90 days) | 🟡 statuses exist; no board |
| Insights: by department, location, gender, tenure, employee type | 🟡 Insights page has headcount reports |
| Directory privacy settings (which fields employees see) | ❌ |
| Employee view: Discover, My network (manager, skip-level, reports), New & notable | 🟡 colleague directory |

## 4. Employee profile (My profile and HR's view)

| Kredily | PeopleCore |
|---|---|
| Header: photo, ID, probation badge, tenure, reports-to, profile completeness % | 🟡 |
| Personal: DOB, gender, blood group, marital status, disability; contacts; current and permanent address; social | 🟡 personal tables exist |
| Work: joining date, probation, location, billing status, designation, job title, sub-department, resignation info, **career progression timeline** | 🟡 effective-dated employment records; no timeline view |
| Team: reporting line and direct reports | 🟡 |
| Education (qualifications) | ❌ |
| Family members and emergency contacts | ❌ |
| Documents by type (IDs, certifications, work, policy) with **verification status** and proof mapping (photo ID, DOB, address) | 🟡 documents; no verification workflow |
| Work week, attendance, leave, payroll, expense, PMS tabs inside the profile | 🟡 separate pages |
| Stationery (generated letters and payslips) and file manager | 🟡 |
| E-exit: apply for resignation from the profile | ✅ (separations) |

## 5. Company profile and settings

| Kredily | PeopleCore |
|---|---|
| Company overview with completeness; brand, contacts, website, industry | 🟡 |
| Office addresses (registered, corporate, custom) | 🟡 locations |
| **Employee custom fields** | ❌ |
| Departments (with head, headcount), designations, grades | ✅ structure (heads and grades partly) |
| Announcements, policies with e-sign | ✅ announcements with acknowledgement; policies with acknowledgement (no e-sign) |
| Statutory: entity type, CIN, PAN, TAN, GST; directors, auditors, company secretary; company bank account | ❌ |
| Admin roles with a capability matrix (CEO, HR admin, finance admin, HR executive, manager, vendor admin, partner/auditor) | ✅ roles and permissions (stronger: scoped, MFA, in the database) |
| Work-week rules: 5-week grid, working / half day / off per day, default rule, assign | 🟡 shifts and weekly offs; no 5-week pattern editor |
| Module selector (turn modules on/off) | ❌ |
| Controls: directory visibility, payroll view for managers, salary revision history to employees, HR can't edit own record | 🟡 permissions cover some |
| Notification preferences by role | ❌ |
| **Support access window** (time-boxed vendor access) | ❌ (platform admin exists) |
| Bank integration (corporate banking, wallet) | ❌ |
| Plan and seats | n/a (we are not a reseller yet) |

## 6. Onboarding (company setup)

| Kredily | PeopleCore |
|---|---|
| Setup wizard: import employees from Excel or from Zoho, GreytHR, Keka, Darwinbox exports; AI column mapping | 🟡 CSV import with dry-run report |
| Readiness checklist board (company, employees, attendance, payroll, integrations) | ❌ |
| Company setup at a glance (departments, sub-departments, designations, locations) | 🟡 |
| Guided implementation plan (6 weeks) | ❌ (service, not software) |
| Gamified rewards for finishing setup | n/a |
| *Employee onboarding (new-hire plans, tasks, policy acknowledgements)* — not seen in Kredily | ✅ PeopleCore has it |

## 7. Attendance

| Kredily | PeopleCore |
|---|---|
| **Command centre**: live present / late / on leave / absent / anomalies, team pulse with each person's status, clock-in density chart, geofenced presence map, active signals | ❌ (we show only your own attendance) |
| Daily logs for everyone (table and calendar), status codes P/A/L/WO/H/HL/WFH/AN/LOP, edit a day, import | 🟡 monthly summary; no org-wide daily grid |
| Penalty logs (auto loss-of-pay for rule breaches, revert) | ❌ |
| Comp-off logs (auto-credited for weekend/holiday work) | ❌ |
| Overtime logs with approval | ❌ |
| Regularisation queue (open/resolved, bulk approve, by month) | ✅ regularisation approvals |
| Attendance rules: shift timings, grace in/out, break, full/half-day minutes, verification (selfie, GPS, IP), behaviour and anomaly handling, penalties, assignment; rotational shifts | 🟡 shifts and flags; no rule builder, no penalties |
| Analytics: 30-day trend, punctuality by department, late-arrival heatmap, average hours, overtime | ❌ |
| Biometric devices and their sync logs | 🟡 biometric CSV import |
| Settings: attendance cycle, reminders (missed clock-out, digests, late punch), skip-level approval | ❌ |
| Employee view: calendar, logs (punch time, IP, location, selfie), my rule (read-only), my requests, my insights (punctuality, average clock-in, heatmap), regularise, request WFH | 🟡 check in/out, month table, regularise; no WFH request, no insights |

## 8. Leave

| Kredily | PeopleCore |
|---|---|
| Hub: on leave today, pending, approved this month, latest requests with approve/reject, hot leave types, by department, monthly volume | 🟡 |
| Approvals table with bulk approve, filters, export, revoke approved leave | 🟡 approvals; no bulk |
| **Leave rules per type**: accrual (monthly / yearly, on presence), carry-forward cap, encashment, weekends/holidays counted or not, allowed in probation / notice; assign to people | 🟡 leave types and accrual; no full rule editor |
| Leave types out of the box: casual, sick, earned, WFH, maternity, paternity, on-duty, event, comp-off, loss of pay | 🟡 |
| **Balances table for everyone** (every type, used %, risk), edit a balance, recalculate, export | ❌ |
| Accrual ledger month by month per person; run carry-forward | 🟡 ledger exists, not shown this way |
| Settings: leave year (April or January), carry-forward expiry, approval levels, skip-level, leave donation | 🟡 |
| Employee view: apply, calendar (mine and team), requests, my rules, balances, accrual history, my patterns | 🟡 |

## 9. Timesheet (paid add-on in Kredily)

| Kredily | PeopleCore |
|---|---|
| Time tracker (start–end or live timer, copy last week, favourites), weekly view | ❌ |
| Workspace: members, clients, projects (budget, burn), tasks with rates | ❌ |
| Approvals with auto-lock; finance: billable roll-up and **invoices** | ❌ |
| Reports: utilisation, project burn, scheduled exports | ❌ |
| Settings: entry methods, overlap rules, rounding, lock dates, reminders, IP and geofence limits | ❌ |

## 10. Payroll

| Kredily | PeopleCore |
|---|---|
| Hub: cycle status, **5-step run** (pre-check → inputs → calculate → approve → disburse), net payout, gross, deductions, TDS, PF/ESI, items needing attention (e.g. missing PAN) | 🟡 runs with maker-checker and variance; no stepped view |
| Run inputs: attendance & leave, variable & ad hoc, arrears, tax override, **salary on hold**, wage-based inputs | 🟡 arrears and adjustments |
| **Pay register**: one wide grid — profile, statutory IDs, bank, attendance, earnings, deductions, status; frozen columns; LOP import | 🟡 run page lists employees |
| Payout: mode (bank, cheque, cash), UTR and status per person, bulk status update, **bank advice files for ICICI, Axis, HDFC, BoB** | 🟡 one generic bank CSV |
| Salary structures with **component formulas** (e.g. Basic = Gross × 0.4), templates (general, hourly, daily, contractor, job-based), CTC preview | 🟡 components and compensation; no formula builder or wage templates |
| Salary view for everyone; **salary revisions** with old/new CTC and effective date | 🟡 compensation records |
| **Tax declarations**: regime, HRA (rent, landlord PAN), 80C and other deductions, house property, LTA, previous employer, reimbursements; proofs; bulk approve; Form 12BB, Form 16 | ❌ |
| Compliance: PF ECR, ESI challan, TDS 24Q, PT; PF/ESI bulk KYC and imports; registers (PF, PT, TDS, reconciliation, net pay, gross vs net, Form T, muster roll) | ❌ (rules are data; no filing files) |
| Journal voucher (double-entry) | ✅ accounting journal |
| Quick actions: bonus / off-cycle run, LOP import, generate and email payslips in bulk, add new joiners to payroll | 🟡 payslip PDF one by one |
| Settings: pay cycle and payout date, PF & ESI, PT by state, components, declaration window, payslip template gallery, bank integration | 🟡 |
| Employee view: payslips by FY, **tax centre** (projection sheet, computation), salary structure and history, reimbursements, bank and statutory IDs | 🟡 payslips and PDF |
| *Maker ≠ checker and immutable locked runs enforced in the database* — not visible in Kredily | ✅ PeopleCore is stronger here |

## 11. Expenses

| Kredily | PeopleCore |
|---|---|
| Hub: open claims, approved to pay, reimbursed this month, average approval time, pipeline | 🟡 |
| All claims with filters and import; categories and sub-categories | 🟡 categories |
| Reimbursement queue, bank file, **push to payroll** | ✅ paid through payroll |
| Analytics: spend by category and department, month on month | ❌ |
| Settings: receipt OCR, multi-level approval with thresholds, auto-escalation, mandatory rejection comment | 🟡 OCR (AI, off), approvals engine |

## 12. Loans and advances

| Kredily | PeopleCore |
|---|---|
| Employee: my loans, eligibility and EMI simulator, apply, statements; recovered through payroll | ❌ |
| Admin: loan tracker | ❌ |

## 13. Assets

| Kredily | PeopleCore |
|---|---|
| Register with category, serial, assignee, status, condition, location; import/export | ✅ |
| Requests from employees, categories, recent activity, repairs, warranty | ✅ hub (summary, figures with book value, quick actions, activity, fleet by category), register with filters, CSV import/export, requests fulfilled by issuing, categories with useful life, repair log, warranty expiry |
| Settle dues in full and final | ✅ dues per issue: recovered, waived or deducted in the next payroll run; clearance in exits |

## 14. Letters

| Kredily | PeopleCore |
|---|---|
| Letter studio: 12 letter types (offer, appointment, confirmation, increment, promotion, internship offer/completion, address proof, employment, relieving, probation extension, leave approval), custom types | 🟡 relieving and experience letters; offer letters in recruitment |
| Templates with merge fields; generate for many people at once; protected PDF | ❌ |
| **Letter requests** from employees with ageing and turnaround | ❌ |
| Letterhead (header/footer art), authorised signatories | ❌ |
| AI drafting | 🟡 (AI off) |

## 15. Insurance

| Kredily | PeopleCore |
|---|---|
| Group health policy: insurer, policy number, validity, cover, sum insured, room rent, waivers; members and dependants; read details from the policy PDF | ❌ |

## 16. People experience (engagement)

| Kredily | PeopleCore |
|---|---|
| Social feed (posts, photos, celebrations, classifieds) to team / department / location / company | 🟡 announcements |
| Daily mood pulse | ❌ |
| Recognition with badges and **points**, nominations for culture values, approvals for high-value badges | 🟡 kudos |
| Culture values, coverage ("never recognised" list), culture OKRs | ❌ |
| Points wallet and gift-voucher marketplace | ❌ (commercial partnership) |
| Birthdays and work anniversaries | ❌ |
| Analytics: posts, active users, pulse by department | ❌ |

## 17. Performance

| Kredily | PeopleCore |
|---|---|
| PMS settings: evaluation period, skills, KRAs, feedback, rating scale, goal weightage; self-appraisal for employees (PMS 2.0 was not enabled on this account) | ✅ cycles, goals, self/manager reviews, calibration, 360 |

## 18. Learning

| Kredily | PeopleCore |
|---|---|
| Courses with content blocks, versions, review workflow; journeys (course paths) | 🟡 catalog and enrolment |
| AI course generation | ❌ |
| **Skill graph**: taxonomy, role requirements, proficiency from completions | ❌ |
| Auto-assignment rules from the directory (e.g. every new hire) | 🟡 mandatory training |
| Learners table, bulk reminders, analytics by department | 🟡 |
| Gamification (points, badges, streaks), branded certificates with verify link | ❌ |

## 19. Hiring

| Kredily | PeopleCore |
|---|---|
| Hub: active jobs, candidates, interviews, pending offers, hired; needs-action queue; funnel; sources | 🟡 |
| Jobs / requisitions, candidates (CV upload, fit score), **hiring plan** by department | ✅ requisitions and candidates; ❌ hiring plan |
| Pipeline kanban, interviews calendar, feedback and scorecards, offers, approvals | ✅ |
| Talent pools, careers page with job-board feeds (Naukri, LinkedIn, Indeed), email templates with variables | 🟡 careers page; ❌ pools, feeds, templates |
| Insights: time to hire, offer acceptance, recruiter performance, cost per hire | ❌ |
| Offer → employee in one click | ✅ |

## 20. Reports

| Kredily | PeopleCore |
|---|---|
| **36 reports in 8 categories** (attendance: consolidated, muster roll, Form T, Form D, late/early, comp-off; directory; leave; payroll; expense; workforce intelligence), filters, Excel, scheduled reports, custom builder, AI report studio | 🟡 Insights page with standard workforce reports and exports |

## 21. Compliance (statutory engine)

| Kredily | PeopleCore |
|---|---|
| Library of 522 statutory forms (central, 28 states, 8 UTs), which apply to you (by state and headcount), compliance calendar with due dates and overdue items, generate forms per wage period, 5-year retention | ❌ (in "preview" in Kredily; most forms not yet renderable) |

## 22. Holiday calendar

| Kredily | PeopleCore |
|---|---|
| Month/day/year calendar with holidays, approved and pending leave, WFH, on-duty, events; holiday list; per-city calendars | 🟡 holidays in leave; no calendar view |

## 23. ID and visiting cards

| Kredily | PeopleCore |
|---|---|
| 15 card templates, choose fields and layout, colours, logo, QR/NFC, print-ready | ❌ |

## 24. Where PeopleCore is already ahead

Recruitment-to-employee in one database, employee onboarding plans, helpdesk with SLAs, knowledge base,
grievances (confidential), full exit with clearance and full-and-final settlement through the payroll engine,
approval delegation and escalation, a workflow engine, a complete audit trail, two-step sign-in enforced in the
database, row-level security tested at 50,000 employees, and a mobile app.

## 25. Recommended build order

1. **New shell and design system**: icon sidebar, ⌘K search, avatars, light/dark, CEO ↔ Employee switch, module hubs with tabs, chart components, rich tables (saved views, columns, bulk select).
2. **Dashboard** rebuilt on it.
3. **Attendance command centre**: org-wide daily grid and calendar, rules builder (grace, half day, penalties, verification), penalty / comp-off / overtime logs, analytics, employee insights and WFH request.
4. **Leave**: rule editor per type, balances table for everyone, accrual ledger, carry-forward run, bulk approve, team calendar.
5. **Payroll**: stepped run, pay register, salary on hold, payout with UTR and bank-specific advice files, formula-based salary structures and wage templates, salary revisions, bulk payslip email.
6. **Tax**: declarations (regimes, HRA, 80C, LTA, previous employer), proofs, employee tax centre and projection, Form 16 / 12BB; compliance files (PF ECR, ESI, 24Q, PT, registers).
7. **People**: lifecycle board, org chart, profile gaps, custom fields, education/family/emergency contacts, document verification, account activation status, bulk actions.
8. **Letters studio**, **reports centre** (the 36 reports), **holiday calendar**.
9. **Loans and advances**, **insurance**, **timesheet with projects and invoicing**, **ID cards**, engagement extras (feed, pulse, points, birthdays).
