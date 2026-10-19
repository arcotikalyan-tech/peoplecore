/**
 * The report catalogue (Kredily's 36 reports in 8 categories): names, descriptions, parameters and output format.
 * Plain data, shared by the Reports page and its parameter panel; the generators live in server/reports.ts.
 */

export type ParamKind = 'range' | 'month' | 'year' | 'quarter' | 'asof' | 'none';
export type Access = 'attendance' | 'directory' | 'leave' | 'payroll' | 'statutory' | 'expense' | 'compensation' | 'diversity';
export type CategoryKey = 'attendance' | 'directory' | 'leave' | 'payroll' | 'expense' | 'compliance' | 'workforce' | 'custom';

export interface ReportInfo {
  key: string;
  category: CategoryKey;
  title: string;
  description: string;
  param: ParamKind;
  /** What the file is: most are Excel (CSV on request); statutory text files keep their own format. */
  format: 'xlsx' | 'txt' | 'csv';
  access: Access;
  /** Where to explore the same figures in the app. */
  explore?: string;
  /** Filters by department and location apply. */
  filters?: boolean;
}

export const CATEGORIES: Array<{ key: CategoryKey; label: string; icon: string }> = [
  { key: 'attendance', label: 'Attendance', icon: '📅' },
  { key: 'directory', label: 'Directory', icon: '📄' },
  { key: 'leave', label: 'Leave', icon: '🏖️' },
  { key: 'payroll', label: 'Payroll', icon: '💼' },
  { key: 'expense', label: 'Expense', icon: '🧾' },
  { key: 'compliance', label: 'Compliance', icon: '🛡️' },
  { key: 'workforce', label: 'Workforce Intelligence', icon: '📊' },
  { key: 'custom', label: 'Custom & Builder', icon: '＋' },
];

const r = (category: CategoryKey, key: string, title: string, description: string, param: ParamKind, access: Access, extra: Partial<ReportInfo> = {}): ReportInfo =>
  ({ key, category, title, description, param, access, format: 'xlsx', filters: true, ...extra });

export const REPORTS: ReportInfo[] = [
  r('attendance', 'consolidated_attendance', 'Consolidated Attendance', 'Per-employee present/absent/leave summary for a period.', 'range', 'attendance'),
  r('attendance', 'muster_roll', 'Muster Roll', 'Statutory daily attendance muster for a date range.', 'range', 'attendance'),
  r('attendance', 'form_t', 'Form T (Muster-cum-Wages)', 'Combined Muster Roll-cum-Register of Wages.', 'month', 'attendance'),
  r('attendance', 'form_d', 'Form D', 'Statutory attendance register (Form D) for a date range.', 'range', 'attendance'),
  r('attendance', 'late_early', 'Late / Early', 'Late-in and early-out log.', 'range', 'attendance'),
  r('attendance', 'comp_off_log', 'Comp-off Log', 'Compensatory-off accrual and consumption log.', 'range', 'attendance'),

  r('directory', 'employee_master', 'Employee Master', 'Full employee master data export.', 'asof', 'directory'),
  r('directory', 'join_exit', 'Join / Exit', 'New joiners and exits for a period.', 'range', 'directory'),
  r('directory', 'probation_confirmation', 'Probation / Confirmation', 'Employees on probation and confirmations due.', 'asof', 'directory'),

  r('leave', 'leave_register', 'Leave Register', 'Leave requests and status for a month.', 'month', 'leave'),
  r('leave', 'leave_balance', 'Leave Balance', 'Leave summary for the leave year — opening / credited / availed / closing.', 'year', 'leave'),

  r('payroll', 'consolidated_net_pay', 'Consolidated Net Pay', 'Net pay by employee for the month.', 'month', 'payroll'),
  r('payroll', 'gross_vs_net', 'Gross vs Net Pay', 'Gross-to-net breakdown by employee.', 'month', 'payroll'),
  r('payroll', 'reconciliation', 'Reconciliation', 'Consolidated month-over-month reconciliation.', 'month', 'payroll'),
  r('payroll', 'jv_output', 'JV Output', 'Journal voucher credit/debit sheet.', 'month', 'payroll', { filters: false }),
  r('payroll', 'salary_variance', 'Salary Variance', 'Month-over-month salary variance by employee.', 'month', 'payroll'),
  r('payroll', 'salary_revision', 'Salary Revision', 'Salary revisions applied in a financial year.', 'year', 'payroll'),
  r('payroll', 'tax_computation', 'Tax Computation', 'Per-employee income-tax computation for the financial year so far.', 'year', 'statutory'),
  r('payroll', 'department_wise', 'Department Wise', 'Department-wise salary summary.', 'month', 'payroll'),
  r('payroll', 'yearly_consolidated_pay', 'Yearly Consolidated Pay', 'Yearly consolidated pay register.', 'year', 'payroll'),

  r('expense', 'pending_expenses', 'Pending Expenses', 'Expense claims awaiting approval.', 'none', 'expense'),
  r('expense', 'approved_expenses', 'Approved Expenses', 'Approved expense claims for a period.', 'range', 'expense'),
  r('expense', 'expense_payout', 'Expense Payout', 'Expense reimbursement payout register.', 'range', 'expense'),

  r('compliance', 'pf_register', 'PF Register', 'Provident Fund register for the month.', 'month', 'statutory'),
  r('compliance', 'pf_ecr', 'PF ECR', 'PF Electronic Challan-cum-Return (EPFO text file).', 'month', 'statutory', { format: 'txt', filters: false }),
  r('compliance', 'esi_contribution', 'ESI Contribution', 'ESI monthly contribution challan.', 'month', 'statutory'),
  r('compliance', 'pt_report', 'PT Report', 'Professional Tax report.', 'month', 'statutory'),
  r('compliance', 'tds_report', 'TDS Report', 'Consolidated TDS report.', 'month', 'statutory'),
  r('compliance', 'form_24q', 'Form 24Q', 'Quarterly TDS return (Form 24Q) working.', 'quarter', 'statutory', { format: 'csv', filters: false }),
  r('compliance', 'form_16', 'Form 16', 'Annual salary TDS summary; print each Form 16 Part B from Payroll.', 'year', 'statutory'),

  r('workforce', 'attrition', 'Attrition Analytics', 'Attrition trend over the last 12 months.', 'none', 'directory', { explore: '/insights' }),
  r('workforce', 'headcount', 'Headcount', 'Headcount today by department, location and type.', 'none', 'directory', { explore: '/employees?tab=insights' }),
  r('workforce', 'diversity', 'Diversity', 'Gender mix by department.', 'none', 'diversity', { explore: '/employees?tab=insights' }),
  r('workforce', 'ctc', 'Cost-to-Company', 'CTC and cost per head by department.', 'none', 'compensation', { explore: '/payroll?tab=insights' }),

  r('custom', 'custom_builder', 'Custom Report Builder', 'Build a report from chosen columns and grouping.', 'none', 'directory'),
  r('custom', 'saved_templates', 'Saved Templates', 'Run a saved custom-report template.', 'none', 'directory'),
];

export const REPORT_BY_KEY = new Map(REPORTS.map((x) => [x.key, x]));

/** Custom builder columns. `personal` columns need personal-details access and are left out otherwise. */
export const BUILDER_COLUMNS: Array<{ key: string; label: string; personal?: boolean }> = [
  { key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' },
  { key: 'employment_type', label: 'Employee type' }, { key: 'doj', label: 'Date of joining' }, { key: 'tenure', label: 'Tenure (years)' },
  { key: 'probation_end', label: 'Probation ends' }, { key: 'confirmed_on', label: 'Confirmed on' }, { key: 'exit_date', label: 'Date of exit' },
  { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' }, { key: 'job_title', label: 'Job title' },
  { key: 'location', label: 'Location' }, { key: 'manager', label: 'Reporting manager' }, { key: 'legal_entity', label: 'Legal entity' },
  { key: 'work_email', label: 'Work email' }, { key: 'work_phone', label: 'Work phone' }, { key: 'billable', label: 'Billing status' },
  { key: 'dob', label: 'Date of birth', personal: true }, { key: 'gender', label: 'Gender', personal: true },
  { key: 'blood_group', label: 'Blood group', personal: true }, { key: 'marital_status', label: 'Marital status', personal: true },
  { key: 'personal_email', label: 'Personal email', personal: true }, { key: 'personal_phone', label: 'Personal phone', personal: true },
  { key: 'city', label: 'City', personal: true },
];

export const BUILDER_GROUPS = [
  { key: 'department', label: 'Department' }, { key: 'location', label: 'Location' }, { key: 'designation', label: 'Designation' },
  { key: 'employment_type', label: 'Employee type' }, { key: 'status', label: 'Status' }, { key: 'manager', label: 'Reporting manager' },
];

/** Relative periods a schedule can use, resolved when the reminder is opened. */
export const SCHEDULE_PERIODS: Record<ParamKind, Array<{ key: string; label: string }>> = {
  range: [{ key: 'last_7_days', label: 'Last 7 days' }, { key: 'previous_month', label: 'Previous month' }, { key: 'month_to_date', label: 'Month to date' }],
  month: [{ key: 'previous_month', label: 'Previous month' }, { key: 'current_month', label: 'Current month' }],
  year: [{ key: 'current_year', label: 'Current year' }, { key: 'previous_year', label: 'Previous year' }],
  quarter: [{ key: 'previous_quarter', label: 'Previous quarter' }],
  asof: [{ key: 'today', label: 'On the day' }],
  none: [{ key: 'none', label: 'Latest data' }],
};
