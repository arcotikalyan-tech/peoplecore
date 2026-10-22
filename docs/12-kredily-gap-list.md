# Kredily second pass — settings and feature gaps (2026-10-21)

A field-by-field pass over Kredily's new dashboard (every module, tab, sub-tab and settings panel, read-only) after the
screen-level parity in [11-kredily-parity-checklist.md](11-kredily-parity-checklist.md). Kredily's Loans and PMS 2.0
were unavailable for the reference account, and Reports already matches (36 reports). Paid vouchers, Bazaar, referral
programmes, subscription plans and Kai (AI) features stay out of scope, as agreed earlier.

Priority: **P1** affects payroll correctness or everyday admin control; **P2** common admin workflows; **P3** polish and breadth.

## Batch 1 — P1: controls and payroll settings

| Area | Gap | Status |
|---|---|---|
| Settings › Controls | Directory: on for everyone / managers only; show or hide email, mobile, social, work location, department, designation in the directory; date of birth and marital status on profiles | ☑ built (directory access everyone / managers / HR; birthday as day and month; marital status). Social links on profiles (LinkedIn, X, website) with a directory switch |
| Settings › Controls | Payroll lock for HR; payroll view for managers; vendor payout access for chosen HR staff; notify admins when company data changes | ☑ built (HR approve/lock and managers' team salaries as role-matrix shortcuts; company-change notices). Vendor payouts module (vendors, TDS, second approver, bank file, UTR) and a Vendor payout admin role owners give to chosen HR staff |
| Settings › Controls | Delete company (owner only, typed confirmation, grace period) | ☑ built as closing: 30 days to cancel, then archived; statutory records kept for their retention period |
| Payroll › Settings › Pay settings | Attendance & leave input cycle separate from the pay cycle; payout day; joiner cut-off day | ☑ built (joiners after the cut-off are paid next month as joining arrears) |
| Payroll › Settings › Pay settings | Show paise on payslips; overtime in the ESI wage; Dearness Allowance; weekly offs and holidays as paid days; fixed 30 pay days | ☑ built (approved overtime now paid at 1×/1.5×/2×). DA switch adds a PF-wage DA component |
| Payroll › Settings › Access | Show tax projection / tax computation to employees | ☑ built |
| Payroll › Settings › Declaration window | Monthly / yearly window, proof deadline | ☑ already built (2026-10-19) |
| Payroll › Payout | Cheque payment mode; Axis and Bank of Baroda bank advice; bulk status update with UTR | ☑ built (bank / cheque / cash; per-bank download buttons; CSV import of status and UTR per employee) |

## Batch 2 — P1/P2: attendance rules and automation

| Area | Gap | Status |
|---|---|---|
| Attendance › Rules | Rule effective date; normal vs rotational shift on the rule | ☑ built (assigned people follow a rule from its effective date, the default rule before it; Normal / Rotational switch on the Rules page with rotations editable there; Duplicate) |
| Attendance › Rules › Penalties | Late-coming and early-leaving allowances, penalty interval, short-hours allowance; deduction hourly (pro-rata) or half day by duration; master switch | ☑ built (per rule: allowance per cycle, one deduction per N more, full day / half day / hourly, short hours also half day by duration; de-duplication in Kredily's order; deductions from up to two leave types, then loss of pay) |
| Attendance › Settings | Automatic deduction of absent days at cycle end on a set date | ☑ built (per rule; the morning after the cycle ends; absent days deducted from salary and not counted twice by payroll; run any cycle by hand; the attendance cycle and payroll's input cycle are one setting) |
| Attendance › Rules | Auto clock-in / clock-out rule | ☑ built (clock-in at the shift start on working days for people who haven't punched, clock-out at the end for people still in; every 15 minutes) |
| Attendance › Geofence | Zones drawn as rectangle or polygon (not only radius), test punch | ☑ built (circle, rectangle or polygon from coordinates, previewed to scale with area and perimeter; check-ins judged against the shape; test punch per location) |
| Attendance › Comp-off | Auto-credit, auto-approve, HR notified above a threshold, employees notified when claimable | ☑ built (auto-approve per rule, otherwise approve or reject in bulk; HR told when someone earns comp-off, employees when it's credited) |
| Attendance › Regularisation | Limit on how many days back; bulk regularise (employee) | ☑ built (1–90 days back, optional monthly cap; employees pick several days for one correction) |
| Attendance › Notifications | Daily attendance summary to admins; late / early punch reminder | ☑ built (9 am summary of yesterday for attendance admins; 11 am reminders for late check-ins today and early check-outs yesterday) |
| Attendance › Logs | Saved views; bulk revert of penalties | ☑ built (named views per person; bulk revert of penalties, bulk approve / reject / revert of comp-off, bulk approve / reject of overtime; penalty export) |

## Batch 3 — P2: roles, notifications, people

| Area | Gap | Status |
|---|---|---|
| Settings › Roles | Standard roles HR Executive (no payroll), Finance Admin, Vendor-payout admin, Partner (read-only), Attendance-device admin | ☑ built (HR executive, Finance administrator as the payroll checker, Partner read-only, Attendance device admin with a new `attendance.device.manage`; the vendor payout admin came with batch 1; roles show their holders and payroll access) |
| Settings › Notifications | Email notifications per event (regularisation, leave, expense, birthday, work anniversary) per role | ☑ built (matrix by event and role, plus “their manager”; an outbox the worker sends over SMTP with a delivery log; needs the SMTP settings on the server to go out) |
| Onboarding | Employee import from Excel/CSV with column mapping, including Zoho / GreytHR / Keka exports | ☑ built (CSV or .xlsx; columns mapped with suggestions for the template and Zoho, greytHR and Keka headers; names of departments, locations and managers become codes; spreadsheet dates and employment types understood) |
| Company profile | Directors, auditors, company secretary; company PAN / CIN / GST proofs; industry list | ☑ built (officers were already there; proofs for PAN, TAN, CIN, GST, PF and ESI in a private bucket; industry from a list) |
| Profile | Gender "Transgender"; blood groups A1B±; previous work experience (years, months) | ☑ built (total experience shown with time here) |
| Leave | "Event leave" standard type; nudge employees; close leave cycle from the hub | ☑ built (Event leave for new organizations and one click for others, with maternity and paternity; nudge people with unused leave, weekly at most; year-end preview of carry-forward and lapse with “close now”) |

## Batch 4 — P3: breadth

| Area | Gap | Status |
|---|---|---|
| ID Studio | Visiting cards; custom fields; roll a design out to everyone; export all | ☐ |
| Konnect | Company discussion board (posts by topic, replies) | ☐ |
| Insurance | Insurer list; CD (cash deposit) balance endorsement ledger | ☐ |
| Hiring | Interview calendar view; job-board feeds (Naukri, LinkedIn, Indeed) — feeds need partner accounts | ☐ |
| Compliance | Library breadth: Kredily tracks 522 artifacts (3 drafted); PeopleCore 160 | ☐ |
| Learn | Starter course library; bulk reminders | ☐ |
