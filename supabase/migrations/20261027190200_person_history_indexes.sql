-- Indexes for a person's own history, which grows every month and had none starting with the person:
--   * payslips: payroll_run_employees was indexed by (run_id, employee_id) only, so "my payslips" (the phone's Payslips
--     tab, the website's payslips and tax forms) scanned every payslip in the organization; one row per person per month.
--   * leave: the only index by person covers pending and approved requests (the overlap guard), so "my leave" with every
--     status (the phone's Leave tab, the employee's requests) couldn't use it.
-- Both tables are small on the live project today, so a plain create index takes a moment.

create index if not exists payroll_run_employees_employee_month_idx
  on public.payroll_run_employees (employee_id, period_month desc);

create index if not exists leave_requests_employee_start_idx
  on public.leave_requests (employee_id, start_date desc);
