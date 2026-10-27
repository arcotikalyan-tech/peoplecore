import type { RuleSet } from './rules.ts';

/**
 * Deterministic monthly payroll (ADR-010): pure functions, no I/O, no clock, no randomness. The same input and
 * rule set always produce the same payslip. Every amount is rounded to whole rupees, line by line, so totals
 * are exact sums of the lines.
 */
export const ENGINE_VERSION = 'payroll-engine/1.4.0'; // 1.1: one-off adjustments; 1.2: old regime and declarations, wage-based pay, TDS override; 1.3: adjustments that are ESI/PT wages (overtime); 1.4: the PF and ESI wages it used, for the statutory files

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
  /**
   * One-off corrections for earlier months (arrears) or recoveries, paid in full this month: never prorated
   * for loss of pay. Taxable arrears count towards this month's taxable pay but aren't projected forward.
   * `esiWage`: wages for this month (overtime), so part of ESI and professional-tax wages; arrears are not.
   */
  adjustments?: Array<{ code: string; name: string; kind: 'earning' | 'deduction'; amount: number; taxable: boolean; esiWage?: boolean }>;
  /**
   * Wage-based pay: each earning's `monthly` is a rate per day or per hour, paid for `units` worked (no proration
   * for loss of pay). Monthly (the default) prorates contracted amounts by payable days.
   */
  payBasis?: 'monthly' | 'daily' | 'hourly';
  units?: number;
  /** The employee's tax declaration for the financial year (regime choice, exemptions, deductions, earlier employer). */
  declaration?: Declaration;
  /** A TDS amount set by payroll for this month, replacing the computed one. */
  tdsOverride?: number | null;
}

/** Annual amounts the employee declared (or payroll approved); caps are applied by the engine. */
export interface Declaration {
  regime: 'old' | 'new';
  rentPaidAnnual?: number;
  metro?: boolean;
  sec80C?: number;
  sec80CCD1B?: number;
  sec80DSelf?: number;
  sec80DParents?: number;
  seniorSelf?: boolean;
  seniorParents?: boolean;
  sec80E?: number;
  sec80G?: number;
  sec80TTA?: number;
  homeLoanInterest?: number;
  lta?: number;
  otherDeductions?: number;
  prevEmployerTaxable?: number;
  prevEmployerTds?: number;
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
  tax: { projectedAnnualTaxable: number; annualTax: number; monthsRemaining: number; regime?: 'old' | 'new'; exemptions?: number; deductions?: number } | null;
  /** The wages PF and ESI were worked out on (0 where they don't apply): the PF ECR and ESI return report these. */
  statutoryWages: { pf: number; esi: number };
}

const rupees = (n: number) => Math.round(n);

/** Income tax for a year's taxable income under a regime's slabs, including rebate, relief and cess. */
export function annualIncomeTax(taxable: number, rules: Pick<RuleSet['incomeTax'], 'slabs' | 'rebateIncomeLimit' | 'marginalRelief' | 'cessRate'>): number {
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

/**
 * Old-regime exemptions and deductions for a year (HRA, LTA, chapter VI-A within their caps, home-loan interest).
 * HRA: the least of the HRA received, rent paid less 10% of basic, and 50% (metro) or 40% of basic.
 */
export function oldRegimeReliefs(d: Declaration, annual: { basic: number; hra: number }, caps: NonNullable<RuleSet['incomeTax']['deductionCaps']>) {
  const pos = (n: number | undefined) => Math.max(0, n ?? 0);
  const hra = pos(d.rentPaidAnnual) > 0
    ? Math.max(0, Math.min(annual.hra, pos(d.rentPaidAnnual) - 0.1 * annual.basic, (d.metro ? 0.5 : 0.4) * annual.basic))
    : 0;
  const exemptions = rupees(hra + pos(d.lta));
  const deductions = rupees(
    Math.min(pos(d.sec80C), caps.sec80C)
    + Math.min(pos(d.sec80CCD1B), caps.sec80CCD1B)
    + Math.min(pos(d.sec80DSelf), d.seniorSelf ? caps.sec80DSelfSenior : caps.sec80DSelf)
    + Math.min(pos(d.sec80DParents), d.seniorParents ? caps.sec80DParentsSenior : caps.sec80DParents)
    + pos(d.sec80E) + pos(d.sec80G) + Math.min(pos(d.sec80TTA), caps.sec80TTA)
    + Math.min(pos(d.homeLoanInterest), caps.sec24b) + pos(d.otherDeductions));
  return { exemptions, deductions };
}

export function computePayslip(input: EmployeeInput, rules: RuleSet, period: Period): Payslip {
  const exceptions: Exception[] = [];
  const lines: Line[] = [];
  if (input.payableDays < 0 || input.payableDays > input.daysInPeriod) {
    exceptions.push({ code: 'payable_days', message: `Payable days (${input.payableDays}) must be between 0 and ${input.daysInPeriod}.`, blocking: true });
  }
  const ratio = input.daysInPeriod > 0 ? Math.min(Math.max(input.payableDays, 0), input.daysInPeriod) / input.daysInPeriod : 0;
  const wageBased = input.payBasis === 'daily' || input.payBasis === 'hourly';
  const units = Math.max(0, input.units ?? (input.payBasis === 'daily' ? input.payableDays : 0));
  if (wageBased && input.units !== undefined && input.units < 0) {
    exceptions.push({ code: 'units', message: 'Days or hours worked can’t be negative.', blocking: true });
  }

  // Earnings: prorated for loss of pay, or rate × days/hours worked for wage-based pay.
  let gross = 0;
  let taxable = 0;
  let pfWage = 0;
  let contractedGross = 0;
  for (const c of input.components) {
    if (c.kind !== 'earning') continue;
    const earned = rupees(wageBased ? c.monthly * units : c.monthly * ratio);
    contractedGross += wageBased ? earned : c.monthly;
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
  let oneOffTaxable = 0;
  let nonWageEarnings = input.reimbursements > 0 ? rupees(input.reimbursements) : 0;
  for (const a of input.adjustments ?? []) {
    if (a.kind !== 'earning') continue;
    const amount = rupees(a.amount);
    lines.push({ code: a.code, name: a.name, kind: 'earning', amount });
    gross += amount;
    if (!a.esiWage) nonWageEarnings += amount; // arrears belong to earlier months' wages: no ESI or PT on them here
    if (a.taxable) oneOffTaxable += amount;
  }

  // Provident fund (employee and employer), on PF wages up to the ceiling.
  const deductions: Line[] = [];
  const employer: Line[] = [];
  const statutoryWages = { pf: 0, esi: 0 };
  if (input.statutory.pf && pfWage > 0) {
    const base = rules.pf.capAtCeiling ? Math.min(pfWage, rules.pf.wageCeiling) : pfWage;
    statutoryWages.pf = base;
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
    const wages = gross - nonWageEarnings;
    statutoryWages.esi = wages;
    deductions.push({ code: 'ESI', name: 'Employees’ state insurance', kind: 'deduction', amount: Math.ceil(wages * rules.esi.employeeRate) });
    employer.push({ code: 'ESI_ER', name: 'Employer ESI', kind: 'employer', amount: Math.ceil(wages * rules.esi.employerRate) });
  }

  // Professional tax on the month's gross wages (state slabs).
  const ptWages = gross - nonWageEarnings;
  const pt = professionalTax(ptWages, input.statutory.ptState, period.month, rules.pt);
  if (pt === null) {
    exceptions.push({ code: 'pt_state', message: `No professional tax rules for state ${input.statutory.ptState}.`, blocking: true });
  } else if (pt > 0) {
    deductions.push({ code: 'PT', name: 'Professional tax', kind: 'deduction', amount: pt });
  }

  // Income tax (TDS): project the year at this month's taxable pay, then spread what's still due. Employees who
  // chose the old regime get their exemptions and deductions; earlier employers' income and TDS count too.
  const monthsRemaining = monthsRemainingInFy(period.month);
  const d = input.declaration;
  const old = d?.regime === 'old' && rules.incomeTax.oldRegime && rules.incomeTax.deductionCaps ? rules.incomeTax.oldRegime : null;
  const regimeRules = old ?? rules.incomeTax;
  let reliefs = { exemptions: 0, deductions: 0 };
  if (old && d) {
    const monthly = (code: string) => input.components.filter((c) => c.code === code && c.kind === 'earning').reduce((s, c) => s + c.monthly, 0);
    reliefs = oldRegimeReliefs(d, { basic: monthly('BASIC') * 12, hra: monthly('HRA') * 12 }, rules.incomeTax.deductionCaps!);
  }
  if (d?.regime === 'old' && !old) {
    exceptions.push({ code: 'old_regime', message: 'The employee chose the old regime, but this rule set has no old-regime rules; TDS uses the new regime.', blocking: false });
  }
  const prevTaxable = Math.max(0, d?.prevEmployerTaxable ?? 0);
  const prevTds = Math.max(0, d?.prevEmployerTds ?? 0);
  // Regular pay is projected for the rest of the year; one-off taxable arrears count once.
  const projected = input.ytd.taxableIncome + taxable * monthsRemaining + oneOffTaxable + prevTaxable
    - regimeRules.standardDeduction - reliefs.exemptions - reliefs.deductions;
  let taxInfo: Payslip['tax'] = null;
  if (projected > rules.incomeTax.surchargeThreshold) {
    exceptions.push({ code: 'surcharge', message: 'Projected income is above the surcharge threshold, which this engine does not compute. Work out TDS manually.', blocking: input.tdsOverride == null });
  } else {
    const annualTax = annualIncomeTax(projected, regimeRules);
    const tds = Math.max(0, rupees((annualTax - input.ytd.tds - prevTds) / monthsRemaining));
    if (input.tdsOverride == null && tds > 0) deductions.push({ code: 'TDS', name: 'Income tax (TDS)', kind: 'deduction', amount: tds });
    taxInfo = { projectedAnnualTaxable: Math.max(0, projected), annualTax, monthsRemaining };
    if (d) Object.assign(taxInfo, { regime: old ? 'old' : 'new', exemptions: reliefs.exemptions, deductions: reliefs.deductions });
  }
  if (input.tdsOverride != null) {
    if (input.tdsOverride < 0) exceptions.push({ code: 'tds_override', message: 'The TDS override can’t be negative.', blocking: true });
    else if (input.tdsOverride > 0) deductions.push({ code: 'TDS', name: 'Income tax (TDS)', kind: 'deduction', amount: rupees(input.tdsOverride) });
  }

  for (const c of input.components) {
    if (c.kind === 'deduction') deductions.push({ code: c.code, name: c.name, kind: 'deduction', amount: rupees(c.monthly) });
  }
  for (const a of input.adjustments ?? []) {
    if (a.kind === 'deduction') deductions.push({ code: a.code, name: a.name, kind: 'deduction', amount: rupees(a.amount) });
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
    taxableThisMonth: taxable + oneOffTaxable,
    employerCost: gross + employer.reduce((s, l) => s + l.amount, 0),
    exceptions,
    tax: taxInfo,
    statutoryWages,
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
