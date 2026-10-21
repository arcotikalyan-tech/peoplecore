import {
  BarChart3, BookOpen, Briefcase, CalendarDays, Clock, FileSpreadsheet, GraduationCap, HandCoins, Heart, HeartPulse, IdCard, Laptop,
  LifeBuoy, Mail, Megaphone, Receipt, Scale, ShieldAlert, Smartphone, Timer, TreePalm, Trophy, UserMinus, UserPlus, Users, Wallet,
  Workflow, type LucideIcon,
} from 'lucide-react';

/** Website copy for the module pages. Describes only what PeopleCore does today. */
export interface SiteModule {
  id: string;
  group: 'People' | 'Time' | 'Pay' | 'Grow' | 'Workplace';
  icon: LucideIcon;
  name: string;
  tagline: string;
  hr: string[];
  employees: string[];
}

export const SITE_MODULES: SiteModule[] = [
  {
    id: 'people', group: 'People', icon: Users, name: 'People & profiles',
    tagline: 'One employee record that every other module reads from.',
    hr: ['Directory with search, filters and export', 'Effective-dated job history: department, designation, manager, location', 'Documents and ID proofs with HR verification', 'Custom fields, bulk import from CSV, org chart', 'Personal-data deletion requests, decided by HR'],
    employees: ['My Profile with personal, work, family, education and documents', 'A colleague directory with only the fields your company allows', 'Profile-complete score so nothing is missing at payroll time'],
  },
  {
    id: 'hiring', group: 'People', icon: Briefcase, name: 'Hiring OS',
    tagline: 'From job requisition to signed offer, without the spreadsheet.',
    hr: ['Jobs, a public careers page and an org-wide candidate pool', 'Pipeline board across jobs, interviews, panel feedback and scorecards', 'Offers with approvals, talent pools and email templates', 'Hiring plans by department and insights: time to hire, sources, cost per hire'],
    employees: ['Hiring managers see their own openings and give interview feedback'],
  },
  {
    id: 'onboarding', group: 'People', icon: UserPlus, name: 'Onboarding',
    tagline: 'New joiners arrive with everything ready.',
    hr: ['Checklists per role and department with owners and due dates', 'Joiners activate automatically on their first day'],
    employees: ['My Onboarding: tasks, documents to submit and who to meet'],
  },
  {
    id: 'letters', group: 'People', icon: Mail, name: 'Letters',
    tagline: 'Offer, appointment, experience and 9 more letters in a click.',
    hr: ['12 standard letter templates with merge tags and live preview', 'Your letterhead and authorised signatures', 'Generate for one person or many; release when ready'],
    employees: ['Download released letters and request self-serve letters'],
  },
  {
    id: 'separations', group: 'People', icon: UserMinus, name: 'Separations',
    tagline: 'Exits that are fair, documented and settled on time.',
    hr: ['Resignations and terminations with notice and last day', 'Clearance checklist, asset returns and full-and-final settlement', 'Records kept for the retention period your policy sets'],
    employees: ['Resign from the app and follow every step of the exit'],
  },
  {
    id: 'id-cards', group: 'People', icon: IdCard, name: 'ID Studio',
    tagline: 'Designed, printed ID cards with QR codes.',
    hr: ['15 layouts, your colours and logo, front and back', 'Print-ready sheets for everyone or one department'],
    employees: ['See and print your own card'],
  },
  {
    id: 'attendance', group: 'Time', icon: Clock, name: 'Attendance',
    tagline: 'Check-in rules your office actually enforces.',
    hr: ['Rules per team: shifts, grace, half days, penalties feeding payroll', 'Verification by office network, geofence and selfie', 'Rotating shifts, 5-week work-week patterns, overtime and comp-off', 'Live hub, daily logs, anomalies, biometric import and analytics'],
    employees: ['Check in from the web or the Android app', 'Calendar, punches, regularisation and WFH or on-duty requests', 'Reminders before a missed check-out'],
  },
  {
    id: 'leave', group: 'Time', icon: TreePalm, name: 'Leave',
    tagline: 'Every leave rule in one place, balances that update themselves.',
    hr: ['Per-type rules: accrual, carry-forward, encashment, probation, limits', 'Approvals with skip-level, bulk approve, revoke and apply on behalf', 'Balances, accrual ledgers and leave-year settings'],
    employees: ['Apply in seconds, see balances, team calendar and plain-English rules', 'Donate leave to a colleague where your policy allows it'],
  },
  {
    id: 'holidays', group: 'Time', icon: CalendarDays, name: 'Holidays',
    tagline: 'Location-wise calendars and optional holidays.',
    hr: ['Holiday lists per location, copied forward each year', 'Optional-holiday limits per calendar'],
    employees: ['A calendar of holidays, leave and WFH, and optional holidays to pick'],
  },
  {
    id: 'timesheet', group: 'Time', icon: Timer, name: 'Timesheets',
    tagline: 'Time on projects, approved and billed.',
    hr: ['Clients, projects, tasks, budgets and billing rates', 'Approval flows, lock dates, blocked days and daily targets', 'Invoices from approved billable time, utilisation reports'],
    employees: ['Timer or start–end entries, copy last week, reminders on missing hours'],
  },
  {
    id: 'payroll', group: 'Pay', icon: Wallet, name: 'Payroll',
    tagline: 'A monthly run you can explain line by line.',
    hr: ['Salary structures, revisions with sign-off and arrears', 'Monthly inputs, loans, reimbursements, encashment and attendance penalties', 'Old and new tax regimes, declarations and TDS', 'Lock, pay by bank advice, and statutory rows for PF, ESI and PT'],
    employees: ['My Pay: payslips, salary structure, tax declarations and Form 16'],
  },
  {
    id: 'expenses', group: 'Pay', icon: Receipt, name: 'Expenses & mileage',
    tagline: 'Claims in, reimbursements out, with receipts attached.',
    hr: ['Categories with limits and receipt rules, multi-level approvals', 'Pay with the next payroll or by bank file', 'Mileage at your organisation’s rate per km'],
    employees: ['Add expenses and trips from the phone, follow every claim'],
  },
  {
    id: 'loans', group: 'Pay', icon: HandCoins, name: 'Loans & advances',
    tagline: 'Salary advances and loans recovered through payroll.',
    hr: ['Loan policy, approvals, disbursal and EMI schedules', 'EMIs deducted automatically; foreclosure settles the rest'],
    employees: ['Eligibility, an EMI simulator and statements'],
  },
  {
    id: 'insurance', group: 'Pay', icon: HeartPulse, name: 'Insurance',
    tagline: 'Group health cover, kept in sync with your roster.',
    hr: ['Policy details and benefits, members and dependants', 'Endorsements since the last sync and reconciliation with the insurer'],
    employees: ['My Insurance: cover, benefits and how to claim'],
  },
  {
    id: 'reports', group: 'Pay', icon: FileSpreadsheet, name: 'Reports & insights',
    tagline: '36 ready reports, real Excel files, and live insights.',
    hr: ['Attendance, leave, payroll, expense, compliance and workforce reports', 'Department and location filters, scheduled reminders, a custom builder', 'Headcount, attrition, diversity and cost insights'],
    employees: ['Managers see reports for their own team only'],
  },
  {
    id: 'performance', group: 'Grow', icon: Trophy, name: 'Performance',
    tagline: 'Goals and reviews that finish on time.',
    hr: ['Review cycles, KRA and skills libraries, rating scales', 'Self, manager and peer reviews with progress tracking'],
    employees: ['Goals, self-review and feedback; managers review their team'],
  },
  {
    id: 'learning', group: 'Grow', icon: GraduationCap, name: 'Learning',
    tagline: 'Courses, journeys and a skill graph.',
    hr: ['Courses with lessons and versions, journeys and assignment rules', 'Skills taxonomy, role requirements, learners and analytics'],
    employees: ['Explore, enrol, finish lessons and earn certificates and points'],
  },
  {
    id: 'peoplexp', group: 'Grow', icon: Heart, name: 'PeopleXP',
    tagline: 'Recognition and culture people actually use.',
    hr: ['Feed, recognition with badges and points, values and nominations', 'Culture health, pulse check-ins and rewards redeemed with points'],
    employees: ['Recognise colleagues, react, comment and redeem rewards'],
  },
  {
    id: 'engagement', group: 'Grow', icon: Megaphone, name: 'Engagement',
    tagline: 'Announcements and kudos that reach everyone.',
    hr: ['Announcements to the whole company or the right audience', 'Kudos that make good work visible'],
    employees: ['Read announcements and give kudos to colleagues'],
  },
  {
    id: 'helpdesk', group: 'Workplace', icon: LifeBuoy, name: 'Helpdesk',
    tagline: 'HR questions answered, with SLAs.',
    hr: ['Tickets by category with owners, SLAs and breach alerts'],
    employees: ['Raise a ticket and follow it to resolution'],
  },
  {
    id: 'knowledge', group: 'Workplace', icon: BookOpen, name: 'Knowledge base & policies',
    tagline: 'One source of truth for how things work.',
    hr: ['Articles and policies with acknowledgements'],
    employees: ['Search answers and read the policies that apply to you'],
  },
  {
    id: 'assets', group: 'Workplace', icon: Laptop, name: 'Assets',
    tagline: 'Every laptop, phone and access card accounted for.',
    hr: ['Asset register, categories, requests, repairs and book value', 'Dues for lost or damaged assets recovered through payroll'],
    employees: ['My Assets, receipt confirmation and equipment requests'],
  },
  {
    id: 'grievances', group: 'Workplace', icon: ShieldAlert, name: 'Grievances',
    tagline: 'A safe, confidential way to raise concerns.',
    hr: ['Case handling with internal notes the reporter never sees', 'Status updates and outcomes recorded'],
    employees: ['Raise a concern and follow replies privately'],
  },
  {
    id: 'workflows', group: 'Workplace', icon: Workflow, name: 'Approval workflows',
    tagline: 'Who approves what, configured once.',
    hr: ['Multi-step approvals, delegation and escalation timers', 'One inbox for every approval across modules'],
    employees: ['Managers approve from the inbox or the dashboard'],
  },
  {
    id: 'mobile', group: 'Workplace', icon: Smartphone, name: 'Mobile app',
    tagline: 'Check in, apply for leave and see payslips on the go.',
    hr: ['The same attendance rules apply on the phone'],
    employees: ['Android app today; iPhone coming soon'],
  },
  {
    id: 'insights', group: 'Workplace', icon: BarChart3, name: 'Dashboards',
    tagline: 'What needs you today, the moment you sign in.',
    hr: ['Headcount, payroll, presence, compliance and approvals at a glance', 'Admin and Me views for people who manage and are managed'],
    employees: ['Today’s check-in, leave balance and holidays on one screen'],
  },
];

export const MODULE_GROUPS = ['People', 'Time', 'Pay', 'Grow', 'Workplace'] as const;

export const COMPLIANCE_ICON = Scale;
