# 11 · Kredily parity checklist

Generated from the 2026-10-18 walkthrough of Kredily's new dashboard (every screen and tab the crawler opened, in the
CEO/admin and the employee views). One line per screen. Each line is ticked when PeopleCore has the equivalent screen
with the same content and behaviour, in PeopleCore's own design (see [10-competitor-benchmark.md](10-competitor-benchmark.md)
for what each screen contains). Status: `[ ]` to build · `[~]` partly there · `[x]` done.

**384 screens.**

## Admin (CEO) view

### Dashboard
- [x] Dashboard (hub) — Kredily layout: figures, trends, attendance snapshot, customisable quick access, compliance, activity, work hours, announcements, birthdays, holidays (AI insight replaced by a plain summary; vouchers and refer-and-earn are Kredily's own marketing)

### Onboarding
- [x] Onboarding (hub)
- [x] Onboarding › activation
- [x] Onboarding › ai setup — skipped (AI module out of scope as agreed)
- [x] Onboarding › company
- [x] Onboarding › guided
- [x] Onboarding › hub
- [x] Onboarding › journey
- [ ] Onboarding › rewards

### Directory
- [x] Directory (hub)
- [x] Directory › insights
- [x] Directory › lifecycle
- [x] Directory › org chart
- [x] Directory › org chart › fit
- [x] Directory › overview
- [x] Directory › overview › exiting
- [x] Directory › people
- [ ] Directory › people › deletion requests — not built: no self-service data-deletion requests yet
- [x] Directory › people › mail — opens a mail to the filtered people (BCC)
- [x] Directory › settings

### Company Profile
- [x] Company Profile (hub)
- [x] Company Profile › address
- [x] Company Profile › admin
- [x] Company Profile › announcements
- [x] Company Profile › department
- [x] Company Profile › designation
- [x] Company Profile › employee custom fields
- [ ] Company Profile › my plan — skipped: Kredily’s own billing
- [x] Company Profile › overview
- [x] Company Profile › policies
- [x] Company Profile › statutory
- [x] Company Profile › statutory › auditors
- [x] Company Profile › statutory › company secretary

### My Profile
- [x] My Profile (hub)
- [x] My Profile › attendance
- [x] My Profile › attendance › logs
- [x] My Profile › attendance › my rule
- [x] My Profile › documents
- [x] My Profile › documents › certifications
- [x] My Profile › documents › policy
- [x] My Profile › documents › work
- [x] My Profile › e exit
- [x] My Profile › education
- [x] My Profile › expense
- [x] My Profile › family
- [x] My Profile › file manager
- [x] My Profile › leave
- [x] My Profile › leave › accrual history
- [x] My Profile › leave › balances
- [x] My Profile › payroll
- [x] My Profile › payroll › bank account
- [x] My Profile › payroll › payslips
- [x] My Profile › payroll › reimbursements
- [x] My Profile › payroll › salary structure
- [x] My Profile › personal
- [x] My Profile › pms
- [x] My Profile › stationery
- [x] My Profile › team
- [x] My Profile › work
- [x] My Profile › work week

### Letters
- [x] Letters (hub)
- [x] Letters › generate — Kai (AI drafting) skipped as agreed
- [x] Letters › hub
- [x] Letters › insights
- [x] Letters › letter requests0
- [x] Letters › settings
- [x] Letters › settings › letter head
- [x] Letters › settings › letter setup

### Insurance
- [x] Insurance (hub)

### Attendance
- [x] Attendance (hub)
- [x] Attendance › analytics
- [x] Attendance › approvals
- [x] Attendance › approvals › open
- [x] Attendance › approvals › resolved
- [~] Attendance › attendance rules — rotational shifts and enforcing selfie / office-IP checks still to come
- [x] Attendance › devices
- [x] Attendance › devices › biometric logs
- [x] Attendance › hub
- [x] Attendance › logs
- [x] Attendance › logs › comp off logs
- [x] Attendance › logs › overtime logs
- [x] Attendance › logs › penalty logs
- [~] Attendance › settings — reminder switches are stored; the reminders themselves aren’t sent yet

### Leave
- [x] Leave (hub)
- [x] Leave › accruals
- [x] Leave › approvals
- [x] Leave › balances
- [x] Leave › balances › recalculate
- [x] Leave › hub
- [x] Leave › leave rules
- [x] Leave › settings

### Timesheet
- [x] Timesheet (hub)
- [x] Timesheet › approvals
- [x] Timesheet › dashboard
- [x] Timesheet › finance
- [x] Timesheet › reports
- [x] Timesheet › settings
- [x] Timesheet › settings › attendance integration
- [x] Timesheet › settings › permission settings
- [x] Timesheet › time tracker
- [x] Timesheet › workspace
- [x] Timesheet › workspace › clients
- [x] Timesheet › workspace › projects
- [x] Timesheet › workspace › tasks

### Payroll
- [x] Payroll (hub)
- [x] Payroll › compliance
- [x] Payroll › compliance › journal voucher
- [x] Payroll › compliance › statutory files reports
- [x] Payroll › declarations
- [x] Payroll › declarations › deductions
- [x] Payroll › declarations › forms
- [x] Payroll › declarations › house property
- [x] Payroll › declarations › hra
- [x] Payroll › declarations › lta
- [x] Payroll › declarations › prev employer
- [x] Payroll › declarations › reimbursements
- [x] Payroll › hub
- [x] Payroll › insights — computed from locked runs (no AI)
- [x] Payroll › payout — bank advice files and marking payouts paid; direct bank API integration needs a bank partner
- [x] Payroll › people salaries
- [x] Payroll › people salaries › salary revisions
- [x] Payroll › people salaries › salary view
- [x] Payroll › settings

### Expense
- [x] Expense (hub)
- [x] Expense › all claims
- [x] Expense › analytics
- [x] Expense › categories
- [x] Expense › hub
- [x] Expense › reimbursement
- [x] Expense › settings

### Loans
- [x] Loans (hub)

### Assets
- [x] Assets (hub)
- [x] Assets › asset register
- [x] Assets › categories
- [x] Assets › hub
- [x] Assets › requests

### Peoplexp
- [ ] Peoplexp (hub)
- [ ] Peoplexp › analytics
- [ ] Peoplexp › culture okrs
- [ ] Peoplexp › culture os
- [ ] Peoplexp › feed
- [ ] Peoplexp › gift vouchers
- [ ] Peoplexp › gift vouchers › power 1 000 points 1
- [ ] Peoplexp › gift vouchers › pro 2 500 points 2
- [ ] Peoplexp › my insights
- [ ] Peoplexp › recognition
- [ ] Peoplexp › settings

### Pms
- [x] Pms (hub)

### Learn
- [ ] Learn (hub)
- [ ] Learn › analytics
- [ ] Learn › assignments
- [ ] Learn › courses content
- [ ] Learn › courses content › archived
- [ ] Learn › courses content › drafts
- [ ] Learn › courses content › in review
- [ ] Learn › courses content › published
- [ ] Learn › journeys
- [ ] Learn › learners
- [ ] Learn › overview
- [ ] Learn › overview › generate course
- [ ] Learn › overview › review blocks
- [ ] Learn › question banks soon
- [ ] Learn › question banks soon › generate course
- [ ] Learn › question banks soon › review blocks
- [ ] Learn › settings
- [ ] Learn › skills

### Hiring
- [ ] Hiring (hub)
- [ ] Hiring › hub
- [ ] Hiring › insights
- [ ] Hiring › outreach
- [ ] Hiring › outreach › email templates
- [ ] Hiring › outreach › job board
- [ ] Hiring › pipeline
- [ ] Hiring › pipeline › approvals
- [ ] Hiring › pipeline › feedback
- [ ] Hiring › pipeline › interviews
- [ ] Hiring › pipeline › offers
- [ ] Hiring › pipeline › scorecards
- [ ] Hiring › recruitment
- [ ] Hiring › recruitment › candidates
- [ ] Hiring › recruitment › hiring plan
- [ ] Hiring › settings

### Reports
- [x] Reports (hub) — all 36 reports in 8 categories, Excel/CSV, recently generated, custom builder with saved templates, scheduled reminders (AI Report Studio skipped as agreed)

### Statutory
- [x] Statutory (hub)
- [x] Statutory › calendar
- [x] Statutory › documents
- [x] Statutory › documents › next
- [x] Statutory › documents › nov
- [x] Statutory › engine console
- [x] Statutory › library522
- [x] Statutory › overview
- [x] Statutory › regime map

### Referrals
- [ ] Referrals (hub)

### Settings
- [x] Settings (hub)
- [x] Settings › bank integration
- [x] Settings › module selector
- [x] Settings › setup wizard
- [x] Settings › support access

### Idstudio
- [x] Idstudio (hub)
- [x] Idstudio › l1templates
- [x] Idstudio › l2fields layout
- [x] Idstudio › l3advanced

### Holiday
- [x] Holiday (hub)
- [x] Holiday › calendar
- [x] Holiday › calendar rules
- [x] Holiday › holiday list

### Ceo
- [x] Ceo › payroll › pay register
- [x] Ceo › payroll › run payroll
- [x] Ceo › settings › controls
- [x] Ceo › settings › notifications
- [x] Ceo › settings › roles permissions
- [x] Ceo › settings › work week

## Employee view

### Dashboard
- [x] Dashboard (hub) — Kredily layout: figures, trends, attendance snapshot, customisable quick access, compliance, activity, work hours, announcements, birthdays, holidays (AI insight replaced by a plain summary; vouchers and refer-and-earn are Kredily's own marketing)

### My Profile
- [x] My Profile (hub)
- [x] My Profile › attendance
- [x] My Profile › documents
- [x] My Profile › documents › certifications
- [x] My Profile › documents › policy
- [x] My Profile › documents › work
- [x] My Profile › e exit
- [x] My Profile › education
- [x] My Profile › expense
- [x] My Profile › family
- [x] My Profile › file manager
- [x] My Profile › leave
- [x] My Profile › leave › accrual history
- [x] My Profile › leave › balances
- [x] My Profile › leave › my leave rules
- [x] My Profile › payroll
- [x] My Profile › payroll › bank account
- [x] My Profile › payroll › payslips
- [x] My Profile › payroll › reimbursements
- [x] My Profile › payroll › salary structure
- [x] My Profile › payroll › tax center
- [x] My Profile › personal
- [x] My Profile › pms
- [x] My Profile › stationery
- [x] My Profile › team
- [x] My Profile › work
- [x] My Profile › work week

### Attendance
- [x] Attendance (hub)
- [x] Attendance › approvals
- [x] Attendance › approvals › open
- [x] Attendance › approvals › resolved
- [x] Attendance › hub

### Leave
- [x] Leave (hub)
- [x] Leave › accruals
- [x] Leave › approvals
- [x] Leave › balances
- [x] Leave › hub
- [x] Leave › leave rules
- [x] Leave › settings

### Payroll
- [x] Payroll (hub)
- [x] Payroll › compliance
- [x] Payroll › compliance › journal voucher
- [x] Payroll › compliance › statutory files reports
- [x] Payroll › declarations
- [x] Payroll › declarations › deductions
- [x] Payroll › declarations › forms
- [x] Payroll › declarations › house property
- [x] Payroll › declarations › hra
- [x] Payroll › declarations › lta
- [x] Payroll › declarations › prev employer
- [x] Payroll › declarations › reimbursements
- [x] Payroll › hub
- [x] Payroll › insights — computed from locked runs (no AI)
- [x] Payroll › payout — bank advice files and marking payouts paid; direct bank API integration needs a bank partner
- [x] Payroll › people salaries
- [x] Payroll › people salaries › salary revisions
- [x] Payroll › people salaries › salary view
- [x] Payroll › settings

### Expense
- [x] Expense (hub)
- [x] Expense › all claims
- [x] Expense › analytics
- [x] Expense › categories
- [x] Expense › hub
- [x] Expense › reimbursement
- [x] Expense › settings

### Timesheet
- [x] Timesheet (hub)
- [x] Timesheet › approvals
- [x] Timesheet › dashboard
- [x] Timesheet › finance
- [x] Timesheet › reports
- [x] Timesheet › settings
- [x] Timesheet › settings › attendance integration
- [x] Timesheet › settings › permission settings
- [x] Timesheet › time tracker
- [x] Timesheet › workspace
- [x] Timesheet › workspace › clients
- [x] Timesheet › workspace › projects
- [x] Timesheet › workspace › tasks

### Letters
- [x] Letters (hub)
- [x] Letters › generate — Kai (AI drafting) skipped as agreed
- [x] Letters › hub
- [x] Letters › insights
- [x] Letters › letter requests0
- [x] Letters › settings
- [x] Letters › settings › letter head
- [x] Letters › settings › letter setup

### Pms
- [x] Pms (hub)

### Learn
- [ ] Learn (hub)
- [ ] Learn › analytics
- [ ] Learn › assignments
- [ ] Learn › courses content
- [ ] Learn › courses content › archived
- [ ] Learn › courses content › drafts
- [ ] Learn › courses content › in review
- [ ] Learn › courses content › published
- [ ] Learn › journeys
- [ ] Learn › learners
- [ ] Learn › overview
- [ ] Learn › overview › generate course
- [ ] Learn › overview › review blocks
- [ ] Learn › question banks soon
- [ ] Learn › question banks soon › generate course
- [ ] Learn › question banks soon › review blocks
- [ ] Learn › settings
- [ ] Learn › skills

### Peoplexp
- [ ] Peoplexp (hub)
- [ ] Peoplexp › analytics
- [ ] Peoplexp › culture okrs
- [ ] Peoplexp › culture os
- [ ] Peoplexp › feed
- [ ] Peoplexp › gift vouchers
- [ ] Peoplexp › gift vouchers › power 1 000 points 1
- [ ] Peoplexp › gift vouchers › pro 2 500 points 2
- [ ] Peoplexp › my insights
- [ ] Peoplexp › recognition
- [ ] Peoplexp › settings

### Assets
- [x] Assets (hub)
- [x] Assets › asset register
- [x] Assets › categories
- [x] Assets › hub
- [x] Assets › requests

### Loans
- [x] Loans (hub)

### Directory
- [x] Directory (hub)
- [x] Directory › insights
- [x] Directory › lifecycle
- [x] Directory › org chart
- [x] Directory › overview
- [x] Directory › people
- [x] Directory › settings

### Home
- [ ] Home (hub)

### Onboarding
- [ ] Onboarding (hub)

### Company Profile
- [x] Company Profile (hub)

### Insurance
- [x] Insurance (hub)

### Hiring
- [ ] Hiring (hub)

### Reports
- [x] Reports (hub) — all 36 reports in 8 categories, Excel/CSV, recently generated, custom builder with saved templates, scheduled reminders (AI Report Studio skipped as agreed)

### Statutory
- [x] Statutory (hub)

### Referrals
- [ ] Referrals (hub)

### Settings
- [x] Settings (hub)

### Idstudio
- [x] Idstudio (hub)

### Holiday
- [x] Holiday (hub)

### Directory My Network
- [x] Directory My Network (hub)

### Directory Directory
- [x] Directory Directory (hub)

### Attendance Calendar
- [x] Attendance Calendar (hub)

### Attendance Logs
- [x] Attendance Logs (hub)

### Attendance My Rule
- [x] Attendance My Rule (hub)

### Attendance My Requests
- [x] Attendance My Requests (hub)

### Attendance My Insights
- [x] Attendance My Insights (hub)

### Leave Calendar
- [x] Leave Calendar (hub)

### Leave Requests
- [x] Leave Requests (hub)

### Leave My Leave Rules
- [x] Leave My Leave Rules (hub)

### Leave Balances
- [x] Leave Balances (hub)

### Leave Accrual History
- [x] Leave Accrual History (hub)

### Leave Insights
- [x] Leave Insights (hub)

### Timesheet Approvals
- [x] Timesheet Approvals (hub)

### Payroll Payslips
- [x] Payroll Payslips (hub)

### Payroll Tax Center
- [x] Payroll Tax Center (hub)

### Payroll Salary Structure
- [x] Payroll Salary Structure (hub)

### Payroll Reimbursements
- [x] Payroll Reimbursements (hub)

### Payroll Bank Account
- [x] Payroll Bank Account (hub)

### Expense My Claims
- [ ] Expense My Claims (hub)

### Loans Eligibility Simulator
- [x] Loans Eligibility Simulator (hub)

### Loans Statements
- [x] Loans Statements (hub)

### Assets My Requests
- [x] Assets My Requests (hub)

### Peoplexp Recognition
- [ ] Peoplexp Recognition (hub)

### Peoplexp Gift Vouchers
- [ ] Peoplexp Gift Vouchers (hub)

### Peoplexp My Insights
- [ ] Peoplexp My Insights (hub)

### Peoplexp Me
- [ ] Peoplexp Me (hub)

### Learn My Journeys
- [ ] Learn My Journeys (hub)

### Learn Explore
- [ ] Learn Explore (hub)

### Learn Calendar
- [ ] Learn Calendar (hub)

### Learn Me
- [ ] Learn Me (hub)
