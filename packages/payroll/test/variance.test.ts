import { describe, expect, it } from 'vitest';
import { compareRuns, type VarianceRow } from '../src/index.ts';

const row = (id: string, net: number, o: { basic?: number; lop?: number; adj?: number; reimb?: number } = {}): VarianceRow => ({
  employeeId: id, gross: net + 2000, net, lopDays: o.lop ?? 0,
  input: {
    components: [{ code: 'BASIC', name: 'Basic', kind: 'earning', monthly: o.basic ?? 30000, taxable: true, pfWage: true },
      { code: 'HRA', name: 'HRA', kind: 'earning', monthly: 15000, taxable: true, pfWage: false }],
    reimbursements: o.reimb ?? 0,
    adjustments: o.adj ? [{ code: 'ARREAR', name: 'Arrears', kind: o.adj > 0 ? 'earning' : 'deduction', amount: Math.abs(o.adj), taxable: true }] : [],
  },
});

describe('compareRuns: what changed since the last locked run', () => {
  it('lists material changes with the reasons the inputs show, joiners and leavers, and the totals', () => {
    const previous = [row('a', 43000), row('b', 43000), row('c', 43000), row('d', 43000), row('e', 40000)];
    const current = [
      row('a', 43400),                          // +400: below ₹1,000, steady
      row('b', 48200, { basic: 35000 }),        // salary raise
      row('c', 38700, { lop: 3 }),              // loss of pay
      row('d', 49000, { adj: 6000, reimb: 1200 }), // arrears and an expense claim
      row('f', 41000),                          // joined; e left
    ];
    const r = compareRuns(current, previous);
    expect(r.variances).toEqual([
      { employeeId: 'd', kind: 'changed', previousNet: 43000, currentNet: 49000, change: 6000, changePct: 14, reasons: ['One-off adjustments +₹6,000', 'Reimbursements ₹1,200 (was ₹0)'] },
      { employeeId: 'b', kind: 'changed', previousNet: 43000, currentNet: 48200, change: 5200, changePct: 12.1, reasons: ['Monthly salary up from ₹45,000 to ₹50,000'] },
      { employeeId: 'c', kind: 'changed', previousNet: 43000, currentNet: 38700, change: -4300, changePct: -10, reasons: ['Loss of pay 3 days (was 0)'] },
      { employeeId: 'f', kind: 'joined', previousNet: null, currentNet: 41000, change: null, changePct: null, reasons: ['Not in the last run (new joiner or newly on payroll)'] },
      { employeeId: 'e', kind: 'left', previousNet: 40000, currentNet: null, change: null, changePct: null, reasons: ['In the last run, not in this one (left, or no salary this month)'] },
    ]);
    expect(r.steady).toBe(1);
    expect(r.totals).toEqual({ previousNet: 212000, currentNet: 220300, change: 8300, changePct: 3.9, previousEmployees: 5, currentEmployees: 5 });
  });

  it('needs both thresholds, and says when nothing in the inputs explains a change', () => {
    const r = compareRuns([row('a', 101500), row('b', 9000)], [row('a', 100000), row('b', 7900)]);
    // a: +₹1,500 is over ₹1,000 but only 1.5%; b: +₹1,100 is 13.9% and over ₹1,000.
    expect(r.variances.map((v) => [v.employeeId, v.reasons])).toEqual([['b', ['No change in the inputs: tax or statutory deductions moved']]]);
    expect(compareRuns([], []).totals).toEqual({ previousNet: 0, currentNet: 0, change: 0, changePct: null, previousEmployees: 0, currentEmployees: 0 });
  });
});
