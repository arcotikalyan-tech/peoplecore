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
  { key: 'company', group: 'Company', title: 'Company details', required: true, check: 'data', href: 'company',
    what: 'Legal name, PAN and the registered address. They appear on offer letters, payslips and statutory forms.' },
  { key: 'locations', group: 'Company', title: 'Offices and locations', required: true, check: 'data', href: 'company?tab=offices',
    what: 'Every place people work from. Holidays, attendance and professional tax follow the location.' },
  { key: 'structure', group: 'Company', title: 'Departments and designations', required: true, check: 'data', href: 'company?tab=departments',
    what: 'Your teams and the job titles people hold.' },
  { key: 'attendance', group: 'Time and attendance', title: 'Shift timings', required: true, check: 'confirm', module: 'attendance', href: 'attendance?tab=rules',
    what: 'When the working day starts and ends, the grace time for late arrival, breaks, and what counts as a half day. You start with a General shift, 9:30 to 6:30.' },
  { key: 'work_week', group: 'Time and attendance', title: 'Weekly offs', required: true, check: 'confirm', module: 'attendance', href: 'attendance?tab=rules&view=workweek',
    what: 'Which days are off each week, such as Saturday and Sunday, or the second and fourth Saturdays.' },
  { key: 'holidays', group: 'Leave and holidays', title: 'Holiday calendar', required: true, check: 'data', module: 'holidays', href: 'holidays?tab=list',
    what: 'This year’s public and optional holidays for each location.' },
  { key: 'leave', group: 'Leave and holidays', title: 'Leave policy', required: true, check: 'confirm', module: 'leave', href: 'leave?tab=rules',
    what: 'The leave you offer and how many days people get, how it builds up and carries forward. You start with casual, sick, earned and event leave.' },
  { key: 'flows', group: 'Leave and holidays', title: 'Who approves what', required: false, check: 'confirm', href: 'workflows',
    what: 'Leave, attendance corrections, expenses and loans go to the reporting manager unless you choose otherwise.' },
  { key: 'employees', group: 'People', title: 'Add your employees', required: true, check: 'data', href: 'employees',
    what: 'One at a time, or everyone at once from a spreadsheet (with a dry run first).' },
  { key: 'managers', group: 'People', title: 'Reporting managers', required: false, check: 'data', href: 'employees',
    what: 'Who each person reports to. Managers approve their team’s leave and attendance.' },
  { key: 'invite', group: 'People', title: 'Invite your people to sign in', required: true, check: 'data', href: 'onboarding?tab=activation',
    what: 'Each person gets an email to choose a password. Then they can punch in, apply for leave and see payslips, on the web and in the phone app.' },
  { key: 'hr_team', group: 'People', title: 'Give your HR and payroll team access', required: false, check: 'data', href: 'members',
    what: 'Invite the people who run HR and payroll with you and give them their roles.' },
  { key: 'statutory', group: 'Payroll', title: 'Pay day and statutory settings', required: true, check: 'confirm', module: 'payroll', href: 'payroll?tab=settings',
    what: 'The day salaries are paid, PF, ESI and professional tax, and the default income tax regime.' },
  { key: 'salaries', group: 'Payroll', title: 'Salaries', required: true, check: 'data', module: 'payroll', href: 'payroll?tab=people',
    what: 'A salary structure (basic, HRA, allowances) and each employee’s CTC.' },
  { key: 'bank', group: 'Payroll', title: 'Salary bank account', required: false, check: 'data', module: 'payroll', href: 'payroll?tab=settings&view=bank',
    what: 'The account salaries are paid from, for the bank transfer file.' },
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
