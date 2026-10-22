/**
 * The guided implementation plan (Kredily's six-week onboarding). `auto` steps are done when the data shows the
 * matching organization setup step (lib/org-setup.ts); the rest are marked done by hand.
 */
export const PLAN: Array<{ week: number; title: string; steps: Array<{ key: string; title: string; note: string; auto?: string; href?: string }> }> = [
  { week: 1, title: 'Company and structure', steps: [
    { key: 'company', title: 'Company details and statutory IDs', note: 'Legal name, PAN, TAN, GST, PF and ESI codes', auto: 'company', href: 'company' },
    { key: 'locations', title: 'Offices and locations', note: 'Registered and working addresses', auto: 'locations', href: 'company?tab=offices' },
    { key: 'structure', title: 'Departments and designations', note: 'With heads and grades', auto: 'structure', href: 'company?tab=departments' },
    { key: 'flows', title: 'Approval flows', note: 'Who approves leave, expenses, loans', auto: 'flows', href: 'workflows' },
  ] },
  { week: 2, title: 'People', steps: [
    { key: 'employees', title: 'Import employees', note: 'CSV import with a dry run on the People page', auto: 'employees', href: 'employees' },
    { key: 'managers', title: 'Reporting managers', note: 'Every employee reports to someone', auto: 'managers', href: 'employees' },
    { key: 'documents', title: 'Collect documents', note: 'ID proofs and bank details from employees', href: 'employees' },
  ] },
  { week: 3, title: 'Time', steps: [
    { key: 'leave', title: 'Leave types and rules', note: 'Accrual, carry forward, encashment', auto: 'leave', href: 'leave?tab=rules' },
    { key: 'holidays', title: 'Holiday calendar', note: 'Per location, optional holidays', auto: 'holidays', href: 'holidays?tab=list' },
    { key: 'attendance', title: 'Shifts and attendance rules', note: 'Work week, penalties, devices', auto: 'attendance', href: 'attendance?tab=rules' },
  ] },
  { week: 4, title: 'Pay', steps: [
    { key: 'salaries', title: 'Salary structures and CTCs', note: 'Assign salaries to everyone', auto: 'salaries', href: 'payroll?tab=people' },
    { key: 'statutory', title: 'PF, ESI, PT and TDS settings', note: 'Per state and per employee', href: 'payroll?tab=settings' },
    { key: 'bank', title: 'Bank file format', note: 'The salary bank file your bank accepts', href: 'payroll?tab=settings&view=bank' },
  ] },
  { week: 5, title: 'Parallel run', steps: [
    { key: 'parallel_payroll', title: 'Run last month’s payroll in parallel', note: 'Compare with your current payroll; fix differences', href: 'payroll?tab=run' },
    { key: 'review_payslips', title: 'Review payslips with finance', note: 'Spot-check a few employees end to end', href: 'payroll' },
  ] },
  { week: 6, title: 'Go live', steps: [
    { key: 'invite', title: 'Invite everyone to sign in', note: 'Activation sends each employee an invitation', auto: 'invite', href: 'onboarding?tab=activation' },
    { key: 'announce', title: 'Announce the launch', note: 'An announcement with how to apply for leave and see payslips', href: 'engagement' },
    { key: 'go_live', title: 'First live payroll', note: 'Lock the run and pay salaries', href: 'payroll?tab=run' },
  ] },
];
