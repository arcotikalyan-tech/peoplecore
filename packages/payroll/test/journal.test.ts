import { describe, expect, it } from 'vitest';
import { computePayslip, DEFAULT_ACCOUNTS, IN_FY2025_26, payrollJournal, type EmployeeInput, type JournalItem } from '../src/index.ts';

const salary = (basic: number, hra: number, special: number) => [
  { code: 'BASIC', name: 'Basic salary', kind: 'earning' as const, monthly: basic, taxable: true, pfWage: true },
  { code: 'HRA', name: 'House rent allowance', kind: 'earning' as const, monthly: hra, taxable: true, pfWage: false },
  { code: 'SPECIAL', name: 'Special allowance', kind: 'earning' as const, monthly: special, taxable: true, pfWage: false },
];
const employee = (id: string, over: Partial<EmployeeInput>): EmployeeInput => ({
  employeeId: id, employeeCode: id.toUpperCase(), name: 'Demo', components: salary(25000, 12500, 12500), daysInPeriod: 30, payableDays: 30,
  statutory: { pf: true, esi: null, ptState: 'KA' }, ytd: { taxableIncome: 0, tds: 0 }, reimbursements: 0, ...over,
});

describe('payrollJournal: the accounting export for a locked run', () => {
  it('debits earnings and employer contributions, credits deductions and net pay, and balances', () => {
    const slips = [
      employee('a', { reimbursements: 1200, adjustments: [{ code: 'ARREAR', name: 'Salary arrears', kind: 'earning', amount: 6000, taxable: true }] }),
      employee('b', { components: [...salary(10000, 5000, 3000), { code: 'CANTEEN', name: 'Canteen', kind: 'deduction', monthly: 500, taxable: false, pfWage: false }] }),
    ].map((e) => computePayslip(e, IN_FY2025_26, { month: '2025-06' }));
    const items = slips.flatMap((s) => s.lines);
    const j = payrollJournal(items);

    const gross = slips.reduce((s, x) => s + x.gross, 0);
    const employerCost = slips.reduce((s, x) => s + x.employerCost, 0);
    const net = slips.reduce((s, x) => s + x.net, 0);
    expect(j.totals.debit).toBe(employerCost); // gross + employer contributions
    expect(j.totals.credit).toBe(j.totals.debit);
    expect(j.lines.find((l) => l.account === 'Salaries payable')).toEqual({ account: 'Salaries payable', code: null, description: 'Net pay', debit: 0, credit: net });

    const at = (account: string, side: 'debit' | 'credit') => j.lines.filter((l) => l.account === account).reduce((s, l) => s + l[side], 0);
    expect(at('Salaries – basic', 'debit')).toBe(35000);
    expect(at('Salaries – arrears', 'debit')).toBe(6000);
    expect(at('Employee expense reimbursements', 'debit')).toBe(1200);
    expect(gross).toBe(35000 + 17500 + 15500 + 6000 + 1200);
    // PF payable: both employees' PF plus all of the employer's PF, pension, EDLI and admin charges.
    const sumCodes = (codes: string[]) => items.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);
    expect(at('PF payable', 'credit')).toBe(sumCodes(['PF', 'EPF_ER', 'EPS_ER', 'EDLI_ER', 'PFADM_ER']));
    expect(at('Employer PF contribution', 'debit')).toBe(sumCodes(['EPF_ER', 'EPS_ER', 'EDLI_ER']));
    // b earns 18,000, under the ESI ceiling: employee and employer ESI.
    expect(at('ESI payable', 'credit')).toBe(sumCodes(['ESI', 'ESI_ER']));
    expect(at('ESI payable', 'credit')).toBeGreaterThan(0);
    expect(at('Professional tax payable', 'credit')).toBe(200); // Karnataka: none under ₹25,000
    expect(j.lines.find((l) => l.code === 'CANTEEN')).toEqual({ account: 'Other deductions payable', code: 'CANTEEN', description: 'Canteen', debit: 0, credit: 500 });

    // Debits first (earnings, then employer contributions), then credits; per-employee or pre-summed input gives the same journal.
    expect(j.lines.map((l) => [l.code, l.debit > 0 ? 'Dr' : 'Cr']).slice(0, 4)).toEqual([['ARREAR', 'Dr'], ['BASIC', 'Dr'], ['HRA', 'Dr'], ['REIMB', 'Dr']]);
    const summed = new Map<string, JournalItem>();
    for (const l of [...items].reverse()) {
      const k = `${l.kind}:${l.code}`;
      summed.set(k, { ...l, amount: (summed.get(k)?.amount ?? 0) + l.amount });
    }
    expect(payrollJournal([...summed.values()])).toEqual(j);
  });

  it('rounds to paise, falls back for unknown codes, moves negative totals to the other side, and takes a custom mapping', () => {
    const items: JournalItem[] = [
      { code: 'BASIC', name: 'Basic salary', kind: 'earning', amount: 1000.105 },
      { code: 'FNF_LEAVE', name: 'Leave encashment', kind: 'earning', amount: 333.33 },
      { code: 'LWF_ER', name: 'Labour welfare fund (employer)', kind: 'employer', amount: 20.5 },
      { code: 'TDS', name: 'Income tax (TDS)', kind: 'deduction', amount: 100.1 },
      { code: 'RECOVERY', name: 'Recovery reversed', kind: 'deduction', amount: -50 },
      { code: 'ZERO', name: 'Nothing', kind: 'deduction', amount: 0 },
    ];
    const j = payrollJournal(items);
    expect(j.lines).toEqual([
      { account: 'Salaries – basic', code: 'BASIC', description: 'Basic salary', debit: 1000.11, credit: 0 },
      { account: 'Salaries – other earnings', code: 'FNF_LEAVE', description: 'Leave encashment', debit: 333.33, credit: 0 },
      { account: 'Employer contributions – other', code: 'LWF_ER', description: 'Labour welfare fund (employer)', debit: 20.5, credit: 0 },
      { account: 'Other deductions payable', code: 'RECOVERY', description: 'Recovery reversed', debit: 50, credit: 0 },
      { account: 'Other statutory dues payable', code: 'LWF_ER', description: 'Labour welfare fund (employer)', debit: 0, credit: 20.5 },
      { account: 'TDS payable', code: 'TDS', description: 'Income tax (TDS)', debit: 0, credit: 100.1 },
      { account: 'Salaries payable', code: null, description: 'Net pay', debit: 0, credit: 1283.34 },
    ]);
    expect(j.totals).toEqual({ debit: 1403.94, credit: 1403.94 });

    const custom = payrollJournal(items, { ...DEFAULT_ACCOUNTS, byCode: { ...DEFAULT_ACCOUNTS.byCode, FNF_LEAVE: { debit: '5010 Leave encashment' } }, netPay: '2100 Net salaries' });
    expect(custom.lines.map((l) => l.account)).toContain('5010 Leave encashment');
    expect(custom.lines.at(-1)!.account).toBe('2100 Net salaries');
    expect(payrollJournal([])).toEqual({ lines: [], totals: { debit: 0, credit: 0 } });
  });

  it('always balances to the paisa, whatever the amounts and order', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const kinds = ['earning', 'deduction', 'employer'] as const;
    for (let run = 0; run < 200; run++) {
      const items: JournalItem[] = Array.from({ length: 1 + Math.floor(rand() * 40) }, () => ({
        code: `C${Math.floor(rand() * 8)}`, name: 'Component', kind: kinds[Math.floor(rand() * 3)]!, amount: Math.round((rand() * 200000 - 20000) * 1000) / 1000,
      }));
      const j = payrollJournal(items);
      expect(j.totals.debit).toBe(j.totals.credit);
      expect(Math.abs(Math.round(j.lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100))).toBe(0);
      expect(payrollJournal([...items].reverse())).toEqual(j);
    }
  });
});
