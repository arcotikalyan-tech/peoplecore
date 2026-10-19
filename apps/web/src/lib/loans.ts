/**
 * Loan arithmetic, the same as the database's (app.loan_emi and disburse_loan): a reducing-balance EMI to the paisa,
 * interest each month on the opening balance, and the last instalment clearing whatever principal is left.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export function loanEmi(amount: number, annualRate: number, months: number): number {
  if (months < 1 || amount <= 0) return 0;
  if (annualRate === 0) return r2(amount / months);
  const r = annualRate / 1200;
  const f = (1 + r) ** months;
  return r2((amount * r * f) / (f - 1));
}

export interface Instalment { seq: number; opening: number; principal: number; interest: number; emi: number }

export function loanSchedule(amount: number, annualRate: number, months: number): Instalment[] {
  const emi = loanEmi(amount, annualRate, months);
  const rows: Instalment[] = [];
  let balance = r2(amount);
  for (let seq = 1; seq <= months; seq++) {
    const interest = r2((balance * annualRate) / 1200);
    const principal = seq === months ? balance : Math.min(balance, r2(emi - interest));
    rows.push({ seq, opening: balance, principal, interest, emi: r2(principal + interest) });
    balance = r2(balance - principal);
  }
  return rows;
}

export const LOAN_STATUS: Record<string, { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: 'In approval', tone: 'warning' },
  approved: { label: 'Approved · to disburse', tone: 'primary' },
  active: { label: 'Active', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
};
export const KIND_LABEL: Record<string, string> = { loan: 'Personal loan', advance: 'Salary advance' };
export const INSTALMENT_LABEL: Record<string, string> = { scheduled: 'Scheduled', queued: 'In payroll run', paid: 'Paid', foreclosed: 'Foreclosed' };
