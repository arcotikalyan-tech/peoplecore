import type { ComponentInput, Exception } from './engine.ts';

/**
 * Full and final settlement (ADR-010): the one-off amounts due when someone leaves, worked out deterministically.
 * Salary for the last month is not here: the final payroll run prorates it to the exit date as usual. The lines
 * below are paid (or recovered) through that run as adjustments, so statutory deductions and TDS apply there.
 *
 * - Leave encashment: encashable leave balance × (basic + DA) / 30 per day. Taxable.
 * - Gratuity (Payment of Gratuity Act, 1972): after 5 years' service, 15 days' basic + DA per year of service
 *   (a final part-year of 6 months or more counts as a year), with a month taken as 26 working days, capped
 *   (₹20 lakh). Not taxable up to the cap.
 * - Notice shortfall, when recovered: gross monthly pay / 30 × days short. A deduction.
 * - Anything else HR or payroll records (an unreturned asset, a pending advance, a bonus due).
 *
 * NOT professionally validated: like the statutory rule sets, these rules need sign-off before real use.
 */
export const SETTLEMENT_VERSION = 'settlement/1.0.0';

export const GRATUITY_DEFAULTS = { minYears: 5, daysPerYear: 15, divisor: 26, cap: 2_000_000 } as const;

export interface SettlementInput {
  employeeId: string;
  name: string;
  dateOfJoining: string;   // YYYY-MM-DD
  lastWorkingDay: string;  // YYYY-MM-DD
  components: ComponentInput[];
  encashableLeaveDays: number;
  noticeShortfallDays: number;
  shortfallTreatment: 'waived' | 'recovered' | null;
  extraLines: Array<{ name: string; kind: 'earning' | 'deduction'; amount: number; taxable: boolean }>;
  gratuity?: Partial<{ minYears: number; daysPerYear: number; divisor: number; cap: number }> | null;
}

export interface SettlementLine {
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  amount: number;
  taxable: boolean;
  basis: string;
}

export interface Settlement {
  employeeId: string;
  lines: SettlementLine[];
  earnings: number;
  deductions: number;
  net: number;
  service: { years: number; months: number; days: number; gratuityYears: number };
  exceptions: Exception[];
}

const rupees = (n: number) => Math.round(n);
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Completed years, months and days between two dates (inclusive of the last working day). */
export function serviceLength(from: string, to: string): { years: number; months: number; days: number } {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const end = new Date(Date.UTC(ty, tm - 1, td) + 86_400_000); // the day after the last working day
  let years = end.getUTCFullYear() - fy;
  let months = end.getUTCMonth() + 1 - fm;
  let days = end.getUTCDate() - fd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

export function computeSettlement(input: SettlementInput): Settlement {
  const g = { ...GRATUITY_DEFAULTS, ...(input.gratuity ?? {}) };
  const exceptions: Exception[] = [];
  const lines: SettlementLine[] = [];
  const earnings = input.components.filter((c) => c.kind === 'earning');
  const gross = earnings.reduce((s, c) => s + c.monthly, 0);
  const basic = earnings.filter((c) => c.pfWage).reduce((s, c) => s + c.monthly, 0);
  const service = serviceLength(input.dateOfJoining, input.lastWorkingDay);
  const gratuityYears = service.years + (service.months >= 6 ? 1 : 0);

  if (input.components.length === 0) {
    exceptions.push({ code: 'NO_COMPENSATION', message: 'No salary is recorded for this employee.', blocking: true });
  } else if (basic === 0) {
    exceptions.push({ code: 'NO_BASIC', message: 'No component is marked as basic pay (PF wage), so encashment and gratuity are zero.', blocking: false });
  }
  if (input.noticeShortfallDays > 0 && input.shortfallTreatment === null) {
    exceptions.push({ code: 'SHORTFALL_UNDECIDED', message: 'Decide whether the notice shortfall is waived or recovered.', blocking: true });
  }

  if (input.encashableLeaveDays > 0 && basic > 0) {
    lines.push({
      code: 'FNF_LEAVE', name: 'Leave encashment', kind: 'earning', taxable: true,
      amount: rupees((input.encashableLeaveDays * basic) / 30),
      basis: `${input.encashableLeaveDays} day(s) × ${inr(basic)} / 30`,
    });
  }
  if (service.years >= g.minYears && basic > 0) {
    const due = rupees((basic * g.daysPerYear * gratuityYears) / g.divisor);
    lines.push({
      code: 'FNF_GRATUITY', name: 'Gratuity', kind: 'earning', taxable: false, amount: Math.min(due, g.cap),
      basis: `${inr(basic)} × ${g.daysPerYear}/${g.divisor} × ${gratuityYears} year(s)${due > g.cap ? `, capped at ${inr(g.cap)}` : ''}`,
    });
  }
  if (input.noticeShortfallDays > 0 && input.shortfallTreatment === 'recovered') {
    lines.push({
      code: 'FNF_NOTICE', name: 'Notice period recovery', kind: 'deduction', taxable: false,
      amount: rupees((gross * input.noticeShortfallDays) / 30),
      basis: `${input.noticeShortfallDays} day(s) × ${inr(gross)} / 30`,
    });
  }
  input.extraLines.forEach((x, i) => {
    lines.push({ code: `FNF_OTHER_${i + 1}`, name: x.name, kind: x.kind, taxable: x.kind === 'earning' && x.taxable, amount: rupees(x.amount), basis: 'Recorded by payroll' });
  });

  const totalEarnings = lines.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amount, 0);
  const totalDeductions = lines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amount, 0);
  if (totalDeductions > totalEarnings) {
    exceptions.push({ code: 'NET_RECOVERY', message: 'Recoveries exceed what is due: the balance is recovered from the final salary.', blocking: false });
  }
  return {
    employeeId: input.employeeId, lines, earnings: totalEarnings, deductions: totalDeductions, net: totalEarnings - totalDeductions,
    service: { ...service, gratuityYears }, exceptions,
  };
}
