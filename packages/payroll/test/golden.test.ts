import { describe, expect, it } from 'vitest';
import { annualIncomeTax, canonicalJson, computePayslip, IN_FY2025_26, monthsRemainingInFy, professionalTax, ruleSetSchema, type EmployeeInput } from '../src/index.ts';

/**
 * Golden vectors, worked out by hand from the FY 2025-26 rules (see each case). They pin the engine's
 * behaviour; a professional reviewing the rules should review these too.
 */
const rules = IN_FY2025_26;
const salary = (basic: number, hra: number, special: number) => [
  { code: 'BASIC', name: 'Basic', kind: 'earning' as const, monthly: basic, taxable: true, pfWage: true },
  { code: 'HRA', name: 'House rent allowance', kind: 'earning' as const, monthly: hra, taxable: true, pfWage: false },
  { code: 'SPECIAL', name: 'Special allowance', kind: 'earning' as const, monthly: special, taxable: true, pfWage: false },
];
const employee = (over: Partial<EmployeeInput>): EmployeeInput => ({
  employeeId: 'e1', employeeCode: 'E1', name: 'Demo', components: salary(25000, 12500, 12500), daysInPeriod: 31, payableDays: 31,
  statutory: { pf: true, esi: null, ptState: 'KA' }, ytd: { taxableIncome: 0, tds: 0 }, reimbursements: 0, ...over,
});
const amount = (slip: ReturnType<typeof computePayslip>, code: string) => slip.lines.find((l) => l.code === code)?.amount ?? 0;

describe('rules', () => {
  it('the bundled rule set satisfies the schema', () => {
    expect(ruleSetSchema.parse(IN_FY2025_26)).toEqual(IN_FY2025_26);
  });
});

describe('income tax (new regime, FY 2025-26)', () => {
  it('is nil up to the rebate limit and applies marginal relief just above it', () => {
    expect(annualIncomeTax(700000, rules.incomeTax)).toBe(0);
    expect(annualIncomeTax(1200000, rules.incomeTax)).toBe(0);
    // 1,210,000: slab tax 20,000 + 40,000 + 1,500 = 61,500, relief caps it at 10,000; + 4% cess = 10,400.
    expect(annualIncomeTax(1210000, rules.incomeTax)).toBe(10400);
  });

  it('applies the slabs and cess above the relief zone', () => {
    // 2,325,000: 20,000 + 40,000 + 60,000 + 80,000 + 25% × 325,000 (81,250) = 281,250; + 4% = 292,500.
    expect(annualIncomeTax(2325000, rules.incomeTax)).toBe(292500);
    // 1,500,000: 20,000 + 40,000 + 15% × 300,000 (45,000) = 105,000 (relief cap 300,000 doesn't bite); + 4% = 109,200.
    expect(annualIncomeTax(1500000, rules.incomeTax)).toBe(109200);
  });

  it('counts the months left in the financial year, this one included', () => {
    expect([4, 10, 12, 1, 3].map((m) => monthsRemainingInFy(`2026-${String(m).padStart(2, '0')}`))).toEqual([12, 6, 4, 3, 1]);
  });
});

describe('professional tax', () => {
  it('follows the state slabs, with the February top-up', () => {
    expect(professionalTax(24999, 'KA', '2026-10', rules.pt)).toBe(0);
    expect(professionalTax(25000, 'KA', '2026-10', rules.pt)).toBe(200);
    expect(professionalTax(50000, 'KA', '2027-02', rules.pt)).toBe(300);
    expect(professionalTax(9000, 'MH', '2026-10', rules.pt)).toBe(175);
    expect(professionalTax(9000, null, '2026-10', rules.pt)).toBe(0);
    expect(professionalTax(9000, 'ZZ', '2026-10', rules.pt)).toBeNull();
  });
});

describe('payslips', () => {
  it('A: 50,000 a month, full month, Karnataka, income under the rebate limit', () => {
    // PF on the 15,000 ceiling: 1,800. No ESI (gross above 21,000). PT 200. Projected 600,000 − 75,000 = 525,000 → no tax.
    const slip = computePayslip(employee({ ytd: { taxableIncome: 300000, tds: 0 } }), rules, { month: '2026-10' });
    expect(slip.gross).toBe(50000);
    expect([amount(slip, 'PF'), amount(slip, 'ESI'), amount(slip, 'PT'), amount(slip, 'TDS')]).toEqual([1800, 0, 200, 0]);
    expect(slip.net).toBe(48000);
    // Employer: 12% of 15,000 = 1,800, of which EPS 8.33% = 1,250 (1,249.50 rounded) and EPF 550; EDLI 75; admin 75.
    expect([amount(slip, 'EPF_ER'), amount(slip, 'EPS_ER'), amount(slip, 'EDLI_ER'), amount(slip, 'PFADM_ER')]).toEqual([550, 1250, 75, 75]);
    expect(slip.employerCost).toBe(50000 + 1950);
    expect(slip.exceptions).toEqual([]);
  });

  it('B: 2,00,000 a month: TDS spreads the rest of the year’s tax over the remaining months', () => {
    // Projected 1,200,000 YTD + 200,000 × 6 = 2,400,000 − 75,000 = 2,325,000 → 292,500 a year. With 146,250
    // deducted so far, 146,250 / 6 = 24,375 this month.
    const slip = computePayslip(employee({ components: salary(100000, 50000, 50000), ytd: { taxableIncome: 1200000, tds: 146250 } }), rules, { month: '2026-10' });
    expect(amount(slip, 'TDS')).toBe(24375);
    expect(slip.net).toBe(200000 - 1800 - 200 - 24375);
    expect(slip.tax).toEqual({ projectedAnnualTaxable: 2325000, annualTax: 292500, monthsRemaining: 6 });
  });

  it('C: loss of pay prorates every earning and the PF on it', () => {
    // 28 of 31 days: basic 15,000 → 13,548; HRA and special 7,500 → 6,774 each; gross 27,096. PF 12% × 13,548 = 1,626.
    const slip = computePayslip(employee({ components: salary(15000, 7500, 7500), payableDays: 28, ytd: { taxableIncome: 180000, tds: 0 } }), rules, { month: '2026-10' });
    expect([amount(slip, 'BASIC'), amount(slip, 'HRA'), amount(slip, 'SPECIAL')]).toEqual([13548, 6774, 6774]);
    expect(slip.gross).toBe(27096);
    expect(amount(slip, 'PF')).toBe(1626);
    expect(amount(slip, 'ESI')).toBe(0); // contracted 30,000 is above the ESI ceiling
    expect(amount(slip, 'PT')).toBe(200);
    expect(slip.net).toBe(25270);
  });

  it('D: 18,000 a month: ESI applies (0.75% and 3.25%, rounded up), PT doesn’t', () => {
    const slip = computePayslip(employee({ components: salary(10000, 4000, 4000), daysInPeriod: 30, payableDays: 30 }), rules, { month: '2026-11' });
    expect([amount(slip, 'PF'), amount(slip, 'ESI'), amount(slip, 'ESI_ER'), amount(slip, 'PT')]).toEqual([1200, 135, 585, 0]);
    expect(slip.net).toBe(16665);
  });

  it('E: reimbursements are paid but neither taxed nor counted for PT or ESI', () => {
    const slip = computePayslip(employee({ components: salary(10000, 4000, 4000), daysInPeriod: 30, payableDays: 30, reimbursements: 2500.4 }), rules, { month: '2026-11' });
    expect(amount(slip, 'REIMB')).toBe(2500);
    expect(slip.gross).toBe(20500);
    expect(slip.taxableThisMonth).toBe(18000);
    expect(amount(slip, 'ESI')).toBe(135);
    expect(slip.net).toBe(20500 - 1200 - 135);
  });

  it('F: blocking exceptions for impossible inputs and unsupported cases', () => {
    const slip = computePayslip(employee({ payableDays: 40, statutory: { pf: true, esi: null, ptState: 'ZZ' } }), rules, { month: '2026-10' });
    expect(slip.exceptions.map((e) => [e.code, e.blocking])).toEqual([['payable_days', true], ['pt_state', true]]);
    const rich = computePayslip(employee({ components: salary(400000, 200000, 200000) }), rules, { month: '2026-04' });
    expect(rich.exceptions.map((e) => e.code)).toContain('surcharge');
    const none = computePayslip(employee({ components: [] }), rules, { month: '2026-10' });
    expect(none.exceptions).toEqual([{ code: 'no_compensation', message: 'No salary components on record.', blocking: false }]);
  });

  it('is deterministic: the same input gives the same payslip, and the input fingerprint ignores key order', () => {
    const input = employee({ ytd: { taxableIncome: 300000, tds: 1000 } });
    expect(computePayslip(input, rules, { month: '2026-10' })).toEqual(computePayslip(structuredClone(input), rules, { month: '2026-10' }));
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }));
  });
});
