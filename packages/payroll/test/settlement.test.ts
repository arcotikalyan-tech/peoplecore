import { describe, expect, it } from 'vitest';
import { canonicalJson, computeSettlement, serviceLength, type SettlementInput } from '../src/index.ts';

/**
 * Golden vectors for full and final settlement, worked out by hand (see each case). Like the payroll vectors, a
 * professional reviewing the rules should review these.
 */
const salary = (basic: number, hra: number, special: number) => [
  { code: 'BASIC', name: 'Basic', kind: 'earning' as const, monthly: basic, taxable: true, pfWage: true },
  { code: 'HRA', name: 'House rent allowance', kind: 'earning' as const, monthly: hra, taxable: true, pfWage: false },
  { code: 'SPECIAL', name: 'Special allowance', kind: 'earning' as const, monthly: special, taxable: true, pfWage: false },
];
const input = (over: Partial<SettlementInput>): SettlementInput => ({
  employeeId: 'e1', name: 'Demo', dateOfJoining: '2020-01-01', lastWorkingDay: '2026-07-31', components: salary(40000, 20000, 20000),
  encashableLeaveDays: 0, noticeShortfallDays: 0, shortfallTreatment: null, extraLines: [], ...over,
});
const line = (s: ReturnType<typeof computeSettlement>, code: string) => s.lines.find((l) => l.code === code)?.amount;

describe('service length', () => {
  it('counts completed years, months and days, inclusive of the last working day', () => {
    expect(serviceLength('2020-01-01', '2026-07-31')).toEqual({ years: 6, months: 7, days: 0 });
    expect(serviceLength('2023-10-18', '2026-10-17')).toEqual({ years: 3, months: 0, days: 0 });
    expect(serviceLength('2024-01-10', '2024-03-24')).toEqual({ years: 0, months: 2, days: 15 });
  });
});

describe('full and final settlement', () => {
  it('6 years 7 months, 10 days of earned leave: gratuity for 7 years and encashment', () => {
    const s = computeSettlement(input({ encashableLeaveDays: 10 }));
    // Gratuity: 40,000 × 15/26 × 7 = 161,538.46 → 161,538. Encashment: 10 × 40,000 / 30 = 13,333.33 → 13,333.
    expect(line(s, 'FNF_GRATUITY')).toBe(161538);
    expect(line(s, 'FNF_LEAVE')).toBe(13333);
    expect(s.service.gratuityYears).toBe(7);
    expect({ earnings: s.earnings, deductions: s.deductions, net: s.net }).toEqual({ earnings: 174871, deductions: 0, net: 174871 });
    expect(s.lines.find((l) => l.code === 'FNF_GRATUITY')!.taxable).toBe(false);
    expect(s.exceptions).toEqual([]);
  });

  it('under 5 years: no gratuity; a recovered shortfall and an unreturned laptop are deducted', () => {
    const s = computeSettlement(input({
      dateOfJoining: '2023-08-01', lastWorkingDay: '2026-07-31', noticeShortfallDays: 10, shortfallTreatment: 'recovered',
      extraLines: [{ name: 'Laptop not returned', kind: 'deduction', amount: 15000, taxable: false }],
    }));
    // Notice: 80,000 / 30 × 10 = 26,666.67 → 26,667. Net: -(26,667 + 15,000) = -41,667.
    expect(line(s, 'FNF_GRATUITY')).toBeUndefined();
    expect(line(s, 'FNF_NOTICE')).toBe(26667);
    expect(line(s, 'FNF_OTHER_1')).toBe(15000);
    expect(s.net).toBe(-41667);
    expect(s.exceptions.map((e) => e.code)).toEqual(['NET_RECOVERY']);
  });

  it('caps gratuity at ₹20 lakh; a waived shortfall recovers nothing', () => {
    const s = computeSettlement(input({ dateOfJoining: '1996-04-01', components: salary(500000, 0, 0), noticeShortfallDays: 20, shortfallTreatment: 'waived' }));
    // 500,000 × 15/26 × 30 = 8,653,846 → capped at 2,000,000.
    expect(line(s, 'FNF_GRATUITY')).toBe(2000000);
    expect(line(s, 'FNF_NOTICE')).toBeUndefined();
  });

  it('blocks when the shortfall is undecided or there is no salary', () => {
    expect(computeSettlement(input({ noticeShortfallDays: 5, shortfallTreatment: null })).exceptions)
      .toEqual([{ code: 'SHORTFALL_UNDECIDED', message: 'Decide whether the notice shortfall is waived or recovered.', blocking: true }]);
    expect(computeSettlement(input({ components: [] })).exceptions.map((e) => [e.code, e.blocking])).toEqual([['NO_COMPENSATION', true]]);
  });

  it('is deterministic', () => {
    const i = input({ encashableLeaveDays: 7.5, extraLines: [{ name: 'Bonus due', kind: 'earning', amount: 12000.4, taxable: true }] });
    expect(canonicalJson(computeSettlement(i))).toBe(canonicalJson(computeSettlement(structuredClone(i))));
    expect(line(computeSettlement(i), 'FNF_OTHER_1')).toBe(12000);
  });
});
