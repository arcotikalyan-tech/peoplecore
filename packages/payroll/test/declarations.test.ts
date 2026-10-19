import { describe, expect, it } from 'vitest';
import { annualIncomeTax, computePayslip, IN_FY2025_26, oldRegimeReliefs, structureBreakup, type EmployeeInput } from '../src/index.ts';

const rules = IN_FY2025_26;
const caps = rules.incomeTax.deductionCaps!;
const salary = (basic: number, hra: number, special: number) => [
  { code: 'BASIC', name: 'Basic', kind: 'earning' as const, monthly: basic, taxable: true, pfWage: true },
  { code: 'HRA', name: 'House rent allowance', kind: 'earning' as const, monthly: hra, taxable: true, pfWage: false },
  { code: 'SPECIAL', name: 'Special allowance', kind: 'earning' as const, monthly: special, taxable: true, pfWage: false },
];
const employee = (over: Partial<EmployeeInput>): EmployeeInput => ({
  employeeId: 'e1', employeeCode: 'E1', name: 'Demo', components: salary(50000, 25000, 25000), daysInPeriod: 30, payableDays: 30,
  statutory: { pf: false, esi: false, ptState: null }, ytd: { taxableIncome: 0, tds: 0 }, reimbursements: 0, ...over,
});
const tds = (slip: ReturnType<typeof computePayslip>) => slip.lines.find((l) => l.code === 'TDS')?.amount ?? 0;

describe('old regime', () => {
  it('slabs: nil up to the 87A limit, then 5/20/30% with cess', () => {
    const old = rules.incomeTax.oldRegime!;
    expect(annualIncomeTax(500000, old)).toBe(0);
    // 1,000,000: 12,500 + 100,000 = 112,500; + 4% = 117,000.
    expect(annualIncomeTax(1000000, old)).toBe(117000);
    // 1,500,000: 112,500 + 150,000 = 262,500; + 4% = 273,000.
    expect(annualIncomeTax(1500000, old)).toBe(273000);
  });

  it('HRA is the least of HRA received, rent − 10% of basic, and 50%/40% of basic; deductions are capped', () => {
    // Basic 600,000, HRA 300,000, rent 240,000: rent − 60,000 = 180,000; 50% basic 300,000 → 180,000 (metro).
    expect(oldRegimeReliefs({ regime: 'old', rentPaidAnnual: 240000, metro: true }, { basic: 600000, hra: 300000 }, caps).exemptions).toBe(180000);
    // Non-metro 40% of basic = 240,000 > 180,000, so still 180,000; a smaller HRA wins.
    expect(oldRegimeReliefs({ regime: 'old', rentPaidAnnual: 240000 }, { basic: 600000, hra: 100000 }, caps).exemptions).toBe(100000);
    // 80C 200,000 → 150,000; 80D self 40,000 → 25,000 (50,000 if senior); home loan 300,000 → 200,000; 80TTA 15,000 → 10,000.
    expect(oldRegimeReliefs({ regime: 'old', sec80C: 200000, sec80DSelf: 40000, homeLoanInterest: 300000, sec80TTA: 15000 }, { basic: 0, hra: 0 }, caps).deductions)
      .toBe(150000 + 25000 + 200000 + 10000);
    expect(oldRegimeReliefs({ regime: 'old', sec80DSelf: 40000, seniorSelf: true }, { basic: 0, hra: 0 }, caps).deductions).toBe(40000);
  });

  it('a payslip under the old regime uses the reliefs; under the new regime they are ignored', () => {
    // 1,00,000 a month from April: projected 1,200,000. Old: − 50,000 std − HRA 180,000 − 80C 150,000 = 820,000
    // → 12,500 + 64,000 = 76,500 + 4% = 79,560 a year → 6,630 a month.
    const declaration = { regime: 'old' as const, rentPaidAnnual: 240000, metro: true, sec80C: 150000 };
    const old = computePayslip(employee({ declaration }), rules, { month: '2026-04' });
    expect(old.tax).toMatchObject({ projectedAnnualTaxable: 820000, annualTax: 79560, regime: 'old', exemptions: 180000, deductions: 150000 });
    expect(tds(old)).toBe(6630);
    // New regime: 1,200,000 − 75,000 = 1,125,000 → under the rebate limit, no tax.
    const neu = computePayslip(employee({ declaration: { ...declaration, regime: 'new' } }), rules, { month: '2026-04' });
    expect(tds(neu)).toBe(0);
  });

  it('counts an earlier employer’s income and TDS this year', () => {
    // From October: 600,000 earlier (with 40,000 TDS) + 100,000 × 6 = 1,200,000 + 600,000 = 1,800,000 − 75,000 = 1,725,000
    // new regime: 20,000 + 40,000 + 60,000 + 20% × 125,000 (25,000) = 145,000 + 4% = 150,800; less 40,000 → 110,800 / 6 = 18,467.
    const slip = computePayslip(employee({ declaration: { regime: 'new', prevEmployerTaxable: 600000, prevEmployerTds: 40000 }, ytd: { taxableIncome: 600000, tds: 0 } }), rules, { month: '2026-10' });
    expect(slip.tax?.annualTax).toBe(150800);
    expect(tds(slip)).toBe(18467);
  });
});

describe('overrides and wage-based pay', () => {
  it('a TDS override replaces the computed amount', () => {
    const slip = computePayslip(employee({ tdsOverride: 5000 }), rules, { month: '2026-04' });
    expect(tds(slip)).toBe(5000);
    expect(computePayslip(employee({ tdsOverride: 0 }), rules, { month: '2026-04' }).lines.some((l) => l.code === 'TDS')).toBe(false);
  });

  it('daily and hourly wages pay rate × units, never prorated', () => {
    const daily = computePayslip(employee({ components: salary(800, 0, 0), payBasis: 'daily', units: 22, payableDays: 20 }), rules, { month: '2026-04' });
    expect(daily.gross).toBe(17600);
    const byDays = computePayslip(employee({ components: salary(800, 0, 0), payBasis: 'daily', payableDays: 20 }), rules, { month: '2026-04' });
    expect(byDays.gross).toBe(16000); // no units given: payable days
    const hourly = computePayslip(employee({ components: salary(250, 0, 0), payBasis: 'hourly', units: 120.5 }), rules, { month: '2026-04' });
    expect(hourly.gross).toBe(30125);
  });
});

describe('salary structures', () => {
  const lines = [
    { componentId: 'b', code: 'BASIC', name: 'Basic', calc: 'percent_of_gross' as const, value: 40 },
    { componentId: 'h', code: 'HRA', name: 'HRA', calc: 'percent_of_basic' as const, value: 40 },
    { componentId: 'l', code: 'LTA', name: 'LTA', calc: 'fixed' as const, value: 0 },
    { componentId: 's', code: 'SPECIAL', name: 'Special', calc: 'balance' as const, value: 0 },
  ];
  it('splits a monthly gross like Kredily’s sample (40% basic, 40% of basic HRA, balance special)', () => {
    const b = structureBreakup(100000, lines);
    expect(b.lines.map((l) => l.amount)).toEqual([40000, 16000, 0, 44000]);
    expect(b.total).toBe(100000);
    expect(b.overflow).toBe(false);
  });
  it('rounds to rupees and keeps the total exact; flags fixed amounts above the gross', () => {
    expect(structureBreakup(33333, lines).total).toBe(33333);
    const over = structureBreakup(10000, [...lines.slice(0, 2), { ...lines[2]!, value: 9000 }, lines[3]!]);
    expect(over.overflow).toBe(true);
    expect(over.lines.at(-1)!.amount).toBe(0);
  });
});
