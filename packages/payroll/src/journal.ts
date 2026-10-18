import type { Line } from './engine.ts';

/**
 * Accounting export for a locked run (deterministic, no I/O): a double-entry journal summary of the run's line
 * items. Earnings are debited to salary expense, employer contributions to expense and credited to the
 * liability they're paid into, deductions are credited to their liability, and net pay to salaries payable.
 * Amounts are summed in paise, so debits always equal credits exactly.
 */

export interface AccountRule {
  debit?: string;   // expense account (earnings, employer contributions)
  credit?: string;  // liability account (deductions, employer contributions)
}

/** Account names by component code, with fallbacks per kind. Data, so a tenant's chart of accounts can replace it. */
export interface AccountMapping {
  byCode: Record<string, AccountRule>;
  fallback: { earning: string; deduction: string; employerDebit: string; employerCredit: string };
  netPay: string;
}

export const DEFAULT_ACCOUNTS: AccountMapping = {
  byCode: {
    BASIC: { debit: 'Salaries – basic' },
    HRA: { debit: 'Salaries – house rent allowance' },
    SPECIAL: { debit: 'Salaries – special allowance' },
    ARREAR: { debit: 'Salaries – arrears' },
    BONUS: { debit: 'Bonus' },
    REIMB: { debit: 'Employee expense reimbursements' },
    PF: { credit: 'PF payable' },
    ESI: { credit: 'ESI payable' },
    PT: { credit: 'Professional tax payable' },
    TDS: { credit: 'TDS payable' },
    EPF_ER: { debit: 'Employer PF contribution', credit: 'PF payable' },
    EPS_ER: { debit: 'Employer PF contribution', credit: 'PF payable' },
    EDLI_ER: { debit: 'Employer PF contribution', credit: 'PF payable' },
    PFADM_ER: { debit: 'PF admin charges', credit: 'PF payable' },
    ESI_ER: { debit: 'Employer ESI contribution', credit: 'ESI payable' },
  },
  fallback: {
    earning: 'Salaries – other earnings',
    deduction: 'Other deductions payable',
    employerDebit: 'Employer contributions – other',
    employerCredit: 'Other statutory dues payable',
  },
  netPay: 'Salaries payable',
};

export type JournalItem = Pick<Line, 'code' | 'name' | 'kind' | 'amount'>;

export interface JournalLine {
  account: string;
  /** The component this line comes from (null for net pay). */
  code: string | null;
  description: string;
  debit: number;
  credit: number;
}

export interface Journal {
  lines: JournalLine[];
  totals: { debit: number; credit: number };
}

const paise = (n: number) => Math.round(n * 100);
const rupees = (p: number) => p / 100;
const KIND_ORDER = { earning: 0, employer: 1, deduction: 2 } as const;

/**
 * Builds the journal from line items: per employee, or already summed per component (the result is the same).
 * One line per component and side; a negative total moves to the other side.
 */
export function payrollJournal(items: readonly JournalItem[], accounts: AccountMapping = DEFAULT_ACCOUNTS): Journal {
  // Sum each component in paise; the name shown is the first in sort order, so input order doesn't matter.
  const byComponent = new Map<string, { code: string; name: string; kind: JournalItem['kind']; total: number }>();
  for (const i of items) {
    const key = `${i.kind}:${i.code}`;
    const c = byComponent.get(key);
    if (c) {
      c.total += paise(Number(i.amount));
      if (i.name < c.name) c.name = i.name;
    } else byComponent.set(key, { code: i.code, name: i.name, kind: i.kind, total: paise(Number(i.amount)) });
  }
  const components = [...byComponent.values()]
    .filter((c) => c.total !== 0)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const debits: Array<{ account: string; code: string | null; description: string; amount: number }> = [];
  const credits: typeof debits = [];
  // A positive amount goes to its natural side; a negative one (a reversal) to the other.
  const post = (side: 'debit' | 'credit', account: string, code: string | null, description: string, amount: number) => {
    const onDebit = (side === 'debit') === amount > 0;
    (onDebit ? debits : credits).push({ account, code, description, amount: Math.abs(amount) });
  };
  let net = 0;
  for (const c of components) {
    const rule = accounts.byCode[c.code] ?? {};
    if (c.kind === 'earning') {
      post('debit', rule.debit ?? accounts.fallback.earning, c.code, c.name, c.total);
      net += c.total;
    } else if (c.kind === 'deduction') {
      post('credit', rule.credit ?? accounts.fallback.deduction, c.code, c.name, c.total);
      net -= c.total;
    } else {
      post('debit', rule.debit ?? accounts.fallback.employerDebit, c.code, c.name, c.total);
      post('credit', rule.credit ?? accounts.fallback.employerCredit, c.code, c.name, c.total);
    }
  }
  if (net !== 0) post('credit', accounts.netPay, null, 'Net pay', net);

  const lines: JournalLine[] = [
    ...debits.map((d) => ({ account: d.account, code: d.code, description: d.description, debit: rupees(d.amount), credit: 0 })),
    ...credits.map((c) => ({ account: c.account, code: c.code, description: c.description, debit: 0, credit: rupees(c.amount) })),
  ];
  const sum = (xs: typeof debits) => rupees(xs.reduce((s, x) => s + x.amount, 0));
  return { lines, totals: { debit: sum(debits), credit: sum(credits) } };
}
