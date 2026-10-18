import type { RuleSet } from './rules.ts';

/**
 * Deterministic monthly payroll (ADR-010): pure functions, no I/O, no clock, no randomness. The same input and
 * rule set always produce the same payslip. Every amount is rounded to whole rupees, line by line, so totals
 * are exact sums of the lines.
 */
export const ENGINE_VERSION = 'payroll-engine/1.0.0';

export interface ComponentInput {
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  monthly: number;     // contracted monthly amount
  taxable: boolean;
  pfWage: boolean;     // part of PF wages (basic, DA)
}

export interface EmployeeInput {
  employeeId: string;
  employeeCode: string;
  name: string;
  components: ComponentInput[];
  daysInPeriod: number;
  payableDays: number;
  statutory: { pf: boolean; esi: boolean | null; ptState: string | null }; // esi null: decide by wage
  ytd: { taxableIncome: number; tds: number };  // earlier months of this financial year (locked runs)
  reimbursements: number;  // approved expense claims to pay, not taxable
}

export interface Period {
  month: string; // YYYY-MM
}

export interface Line {
  code: string;
  name: string;
  kind: 'earning' | 'deduction' | 'employer';
  amount: number;
}

export interface Exception {
  code: string;
  message: string;
  blocking: boolean;
}

export interface Payslip {
  employeeId: string;
  lines: Line[];
  gross: number;
  deductions: number;
  net: number;
  taxableThisMonth: number;
  employerCost: number;
  exceptions: Exception[];
  tax: { projectedAnnualTaxable: number; annualTax: number; monthsRemaining: number } | null;
}

const rupees = (n: number) => Math.round(n);

/** Income tax for a year's taxable income under the rule set (new regime), including rebate, relief and cess. */
export function annualIncomeTax(taxable: number, rules: RuleSet['incomeTax']): number {
  if (taxable <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const s of rules.slabs) {
    const upper = s.upTo ?? Number.POSITIVE_INFINITY;
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * s.rate;
    lower = upper;
    if (taxable <= upper) break;
  }
  if (taxable <= rules.rebateIncomeLimit) return 0;
  if (rules.marginalRelief) tax = Math.min(tax, taxable - rules.rebateIncomeLimit);
  return rupees(tax * (1 + rules.cessRate));
}

/** Months from this period to March, inclusive (the Indian financial year runs April–March). */
export function monthsRemainingInFy(month: string): number {
  const m = Number(month.slice(5, 7));
  return m >= 4 ? 16 - m : 4 - m; // April → 12 … March → 1
}

export function professionalTax(gross: number, state: string | null, month: string, rules: RuleSet['pt']): number | null {
  if (!state) return 0;
  const slabs = rules[state];
  if (!slabs) return null; // unknown state: reported as an exception
  const s = slabs.find((x) => gross >= x.min && (x.max === null || gross <= x.max));
  if (!s) return 0;
  return month.slice(5, 7) === '02' && s.februaryAmount !== undefined ? s.februaryAmount : s.amount;
}

export function computePayslip(input: EmployeeInput, rules: RuleSet, period: Period): Payslip {
  const exceptions: Exception[] = [];
  const lines: Line[] = [];
  if (input.payableDays < 0 || input.payableDays > input.daysInPeriod) {
    exceptions.push({ code: 'payable_days', message: `Payable days (${input.payableDays}) must be between 0 and ${input.daysInPeriod}.`, blocking: true });
  }
  const ratio = input.daysInPeriod > 0 ? Math.min(Math.max(input.payableDays, 0), input.daysInPeriod) / input.daysInPeriod : 0;

  // Earnings, prorated for loss of pay.
  let gross = 0;
  let taxable = 0;
  let pfWage = 0;
  let contractedGross = 0;
  for (const c of input.components) {
    if (c.kind !== 'earning') continue;
    const earned = rupees(c.monthly * ratio);
    contractedGross += c.monthly;
    lines.push({ code: c.code, name: c.name, kind: 'earning', amount: earned });
    gross += earned;
    if (c.taxable) taxable += earned;
    if (c.pfWage) pfWage += earned;
  }
  if (input.reimbursements > 0) {
    const r = rupees(input.reimbursements);
    lines.push({ code: 'REIMB', name: 'Expense reimbursements', kind: 'earning', amount: r });
    gross += r; // paid, not taxable
  }

  // Provident fund (employee and employer), on PF wages up to the ceiling.
  const deductions: Line[] = [];
  const employer: Line[] = [];
  if (input.statutory.pf && pfWage > 0) {
    const base = rules.pf.capAtCeiling ? Math.min(pfWage, rules.pf.wageCeiling) : pfWage;
    const employeePf = rupees(base * rules.pf.employeeRate);
    const eps = rupees(Math.min(base, rules.pf.wageCeiling) * rules.pf.employerEpsRate);
    const employerTotal = rupees(base * rules.pf.employerTotalRate);
    deductions.push({ code: 'PF', name: 'Provident fund', kind: 'deduction', amount: employeePf });
    employer.push(
      { code: 'EPF_ER', name: 'Employer PF', kind: 'employer', amount: employerTotal - eps },
      { code: 'EPS_ER', name: 'Employer pension (EPS)', kind: 'employer', amount: eps },
      { code: 'EDLI_ER', name: 'EDLI', kind: 'employer', amount: rupees(base * rules.pf.edliRate) },
      { code: 'PFADM_ER', name: 'PF admin charges', kind: 'employer', amount: rupees(base * rules.pf.adminRate) },
    );
  }

  // ESI: eligibility by contracted monthly gross; contributions on what was earned.
  const esiApplies = input.statutory.esi ?? contractedGross <= rules.esi.grossCeiling;
  if (esiApplies && gross > 0) {
    const wages = gross - (input.reimbursements > 0 ? rupees(input.reimbursements) : 0);
    deductions.push({ code: 'ESI', name: 'Employees’ state insurance', kind: 'deduction', amount: Math.ceil(wages * rules.esi.employeeRate) });
    employer.push({ code: 'ESI_ER', name: 'Employer ESI', kind: 'employer', amount: Math.ceil(wages * rules.esi.employerRate) });
  }

  // Professional tax on the month's gross wages (state slabs).
  const ptWages = gross - (input.reimbursements > 0 ? rupees(input.reimbursements) : 0);
  const pt = professionalTax(ptWages, input.statutory.ptState, period.month, rules.pt);
  if (pt === null) {
    exceptions.push({ code: 'pt_state', message: `No professional tax rules for state ${input.statutory.ptState}.`, blocking: true });
  } else if (pt > 0) {
    deductions.push({ code: 'PT', name: 'Professional tax', kind: 'deduction', amount: pt });
  }

  // Income tax (TDS): project the year at this month's taxable pay, then spread what's still due.
  const monthsRemaining = monthsRemainingInFy(period.month);
  const projected = input.ytd.taxableIncome + taxable * monthsRemaining - rules.incomeTax.standardDeduction;
  let taxInfo: Payslip['tax'] = null;
  if (projected > rules.incomeTax.surchargeThreshold) {
    exceptions.push({ code: 'surcharge', message: 'Projected income is above the surcharge threshold, which this engine does not compute. Work out TDS manually.', blocking: true });
  } else {
    const annualTax = annualIncomeTax(projected, rules.incomeTax);
    const tds = Math.max(0, rupees((annualTax - input.ytd.tds) / monthsRemaining));
    if (tds > 0) deductions.push({ code: 'TDS', name: 'Income tax (TDS)', kind: 'deduction', amount: tds });
    taxInfo = { projectedAnnualTaxable: Math.max(0, projected), annualTax, monthsRemaining };
  }

  for (const c of input.components) {
    if (c.kind === 'deduction') deductions.push({ code: c.code, name: c.name, kind: 'deduction', amount: rupees(c.monthly) });
  }

  const totalDeductions = deductions.reduce((s, l) => s + l.amount, 0);
  const net = gross - totalDeductions;
  if (net < 0) exceptions.push({ code: 'negative_net', message: 'Deductions exceed earnings this month.', blocking: true });
  if (contractedGross === 0) exceptions.push({ code: 'no_compensation', message: 'No salary components on record.', blocking: false });

  return {
    employeeId: input.employeeId,
    lines: [...lines, ...deductions, ...employer],
    gross,
    deductions: totalDeductions,
    net,
    taxableThisMonth: taxable,
    employerCost: gross + employer.reduce((s, l) => s + l.amount, 0),
    exceptions,
    tax: taxInfo,
  };
}

/** A stable fingerprint of the inputs (sorted keys), stored with results so a checker can verify a run. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
