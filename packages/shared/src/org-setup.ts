/**
 * Organization setup: the steps a new company's owner and HR team finish before everyone starts using PeopleCore,
 * in the order that works best (each builds on the one before). Shown on their dashboard with a percentage and in
 * full on the Organization setup page.
 *
 * - `data` steps are done when the live data shows it (org_setup_status), so nobody has to tick them.
 * - `confirm` steps start with defaults every new company gets (the General shift, the standard leave types, weekly
 *   offs, approval by the reporting manager, PF/ESI/PT on): done once someone confirms the defaults are right, or
 *   changes them.
 * - Optional steps can be marked "Not needed".
 */

export type SetupGroup = 'Company' | 'Time and attendance' | 'Leave and holidays' | 'People' | 'Payroll';

export interface SetupStepDef {
  key: string;
  group: SetupGroup;
  title: string;
  /** What to fill in, in a sentence. */
  what: string;
  required: boolean;
  check: 'data' | 'confirm';
  /** Hidden when the organization switched this module off. */
  module?: string;
  /** Under /app/[org]/. */
  href: string;
}

export interface SetupFacts {
  company: boolean;
  locations: boolean;
  structure: boolean;
  shifts_changed: boolean;
  leave_changed: boolean;
  holidays: boolean;
  employees: number;
  signed_in: number;
  managers: boolean;
  members: number;
  hr_team: boolean;
  salaries: boolean;
  bank: boolean;
  marks: Record<string, 'done' | 'skipped'>;
}

export const SETUP_STEPS: SetupStepDef[] = [
  { key: 'company', group: 'Company', title: 'Company details', required: true, check: 'data', href: 'company?tab=statutory&edit=ids',
    what: 'Opens Company Profile › Statutory. Enter the company PAN, and the TAN, GST, PF and ESI codes you have; the step ticks once the PAN is saved. Check the legal name on the Overview tab and the registered office on the Address tab. These print on offer letters, payslips and statutory forms.' },
  { key: 'locations', group: 'Company', title: 'Offices and locations', required: true, check: 'data', href: 'company?tab=address#locations',
    what: 'Opens Company Profile › Address. Under Locations, add every office or site people work from, with its city and state. Holidays, attendance rules and professional tax follow the location.' },
  { key: 'structure', group: 'Company', title: 'Departments and designations', required: true, check: 'data', href: 'company?tab=department',
    what: 'Opens Company Profile › Department. Add your teams and their heads, then open the Designation tab and add the job titles people hold.' },
  { key: 'attendance', group: 'Time and attendance', title: 'Shift timings', required: true, check: 'confirm', module: 'attendance', href: 'attendance?tab=rules',
    what: 'Opens Attendance › Attendance Rules. You start with a General shift, 9:30 to 6:30. Change the start and end times, grace for late arrival, breaks and the half-day rule if yours differ, then come back and press Looks right.' },
  { key: 'work_week', group: 'Time and attendance', title: 'Weekly offs', required: true, check: 'confirm', module: 'attendance', href: 'attendance?tab=rules&view=workweek',
    what: 'Opens Attendance › Attendance Rules › Work week. Choose the weekly offs, such as Saturday and Sunday or the second and fourth Saturdays, then come back and press Looks right.' },
  { key: 'holidays', group: 'Leave and holidays', title: 'Holiday calendar', required: true, check: 'data', module: 'holidays', href: 'holidays?tab=list',
    what: 'Opens Holidays › Holiday List. Add this year’s public and optional holidays for each location, or start from the national list.' },
  { key: 'leave', group: 'Leave and holidays', title: 'Leave policy', required: true, check: 'confirm', module: 'leave', href: 'leave?tab=rules',
    what: 'Opens Leave › Leave rules. You start with casual, sick, earned and event leave. Set how many days each gives, how it builds up and what carries forward, then come back and press Looks right.' },
  { key: 'flows', group: 'Leave and holidays', title: 'Who approves what', required: false, check: 'confirm', href: 'workflows',
    what: 'Opens Workflows. Leave, attendance corrections, expenses and loans go to the reporting manager. Add a second approver or send a request type to HR if you want, or press Looks right to keep this.' },
  { key: 'employees', group: 'People', title: 'Add your employees', required: true, check: 'data', href: 'employees?tab=people',
    what: 'Opens Employees › Directory. Press + Add employee for one person, or Import to add everyone from a spreadsheet; the import checks every row before anything is saved.' },
  { key: 'managers', group: 'People', title: 'Reporting managers', required: false, check: 'data', href: 'employees?tab=people&flag=no_manager',
    what: 'Opens Employees › Directory showing the people with no reporting manager. Tick them, choose “move to Manager” and pick who they report to. Managers approve their team’s leave and attendance.' },
  { key: 'invite', group: 'People', title: 'Invite your people to sign in', required: true, check: 'data', href: 'onboarding?tab=activation',
    what: 'Opens Onboarding › Activation. Send each employee an invitation email to choose a password; then they can punch in, apply for leave and see payslips on the web and the phone app.' },
  { key: 'hr_team', group: 'People', title: 'Give your HR and payroll team access', required: false, check: 'data', href: 'members',
    what: 'Opens Members. Invite the people who run HR and payroll with you and give each the right role, such as HR admin or Payroll admin.' },
  { key: 'statutory', group: 'Payroll', title: 'Pay day and statutory settings', required: true, check: 'confirm', module: 'payroll', href: 'payroll?tab=settings',
    what: 'Opens Payroll › Settings. In Pay Settings set the pay day, in PF & ESI and Professional Tax set your registrations and rules, then come back and press Looks right.' },
  { key: 'salaries', group: 'Payroll', title: 'Salaries', required: true, check: 'data', module: 'payroll', href: 'payroll?tab=people',
    what: 'Opens Payroll › People & Salaries. Give each employee a CTC; the salary structure splits it into basic, HRA and allowances.' },
  { key: 'bank', group: 'Payroll', title: 'Salary bank account', required: false, check: 'data', module: 'payroll', href: 'payroll?tab=settings&view=bank',
    what: 'Opens Payroll › Settings › Bank Integration. Enter the account salaries are paid from and your bank, so payroll can make the bank transfer file.' },
];

/** What the live data shows for a step (marks aside). */
export function shownByData(key: string, f: SetupFacts): boolean {
  switch (key) {
    case 'company': return f.company;
    case 'locations': return f.locations;
    case 'structure': return f.structure;
    case 'attendance': return f.shifts_changed;
    case 'holidays': return f.holidays;
    case 'leave': return f.leave_changed;
    case 'employees': return f.employees > 0;
    case 'managers': return f.managers;
    case 'invite': return f.members > 1;
    case 'hr_team': return f.hr_team;
    case 'salaries': return f.salaries;
    case 'bank': return f.bank;
    default: return false;
  }
}

export type StepStatus = 'done' | 'skipped' | 'todo';

export interface SetupStep extends SetupStepDef {
  status: StepStatus;
  /** Done because the data shows it (rather than marked by hand). */
  byData: boolean;
  /** Progress note, e.g. "12 employees · 3 can sign in". */
  detail?: string;
}

export interface SetupProgress {
  steps: SetupStep[];
  done: number;
  total: number;
  percent: number;
  requiredLeft: number;
  /** Up next: required steps first, in order. */
  next: SetupStep[];
}

/** Applies the facts and marks to the steps for the modules this organization uses. */
export function evaluateSetup(f: SetupFacts, disabled: ReadonlySet<string>): SetupProgress {
  const steps = SETUP_STEPS.filter((s) => !s.module || !disabled.has(s.module)).map((def): SetupStep => {
    const byData = shownByData(def.key, f);
    const mark = f.marks[def.key];
    const status: StepStatus = byData || mark === 'done' ? 'done' : mark === 'skipped' && !def.required ? 'skipped' : 'todo';
    const href = def.key === 'invite' && disabled.has('onboarding') ? 'members' : def.href;
    const detail = def.key === 'employees' ? `${f.employees} employee${f.employees === 1 ? '' : 's'}`
      : def.key === 'invite' ? `${f.signed_in} of ${f.employees} employees can sign in` : undefined;
    return { ...def, href, status, byData, detail };
  });
  const done = steps.filter((s) => s.status !== 'todo').length;
  const todo = steps.filter((s) => s.status === 'todo');
  return {
    steps, done, total: steps.length,
    percent: steps.length ? Math.floor((done / steps.length) * 100) : 100,
    requiredLeft: todo.filter((s) => s.required).length,
    next: [...todo.filter((s) => s.required), ...todo.filter((s) => !s.required)],
  };
}

export const SETUP_GROUPS: SetupGroup[] = ['Company', 'Time and attendance', 'Leave and holidays', 'People', 'Payroll'];
