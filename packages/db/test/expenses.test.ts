import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { canonicalJson, computePayslip, ENGINE_VERSION, ruleSetSchema, type EmployeeInput } from '@peoplecore/payroll';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();
const cats: Record<string, string> = {};

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

async function failure(tx: Transaction, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await tx.exec('savepoint expect_failure');
  try {
    await tx.query(sql, params);
  } catch (err) {
    await tx.exec('rollback to savepoint expect_failure');
    return { code: (err as { code?: string }).code, message: (err as Error).message };
  }
  throw new Error(`expected to fail: ${sql}`);
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const claim = async (tx: Transaction, title: string) =>
  (await tx.query<{ id: string }>('select create_expense_claim($1, $2) as id', [ctx.f.orgA, title])).rows[0]!.id;
const item = (tx: Transaction, c: string, cat: string, amount: number, receipt: string | null = null, daysAgo = 3) =>
  tx.query(`select add_expense_item($1, $2, $3, current_date - $4::int, $5, 'Shop', null, $6, $7)`,
    [c, randomUUID(), cats[cat], daysAgo, amount, receipt ? 'receipt.pdf' : null, receipt ? hash(receipt) : null]);
const approvalOf = async (tx: Transaction, c: string) =>
  (await tx.query<{ a: string }>('select approval_request_id as a from expense_claims where id = $1', [c])).rows[0]!.a;

beforeAll(async () => {
  const { rows } = await ctx.t.db.query<{ code: string; id: string }>('select code, id from expense_categories where organization_id = $1', [ctx.f.orgA]);
  for (const r of rows) cats[r.code] = r.id;
});

describe('expense claims', () => {
  it('enforce category rules; submit; manager then finance approve; possible duplicates are flagged', async () => {
    const { f } = ctx;
    expect(Object.keys(cats).sort()).toEqual(['CONVEYANCE', 'MEALS', 'OTHER', 'PHONE', 'TRAVEL']);
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const c = await claim(tx, 'Client visit');
      await item(tx, c, 'CONVEYANCE', 450); // no receipt needed
      expect((await failure(tx, `select add_expense_item($1, $2, $3, current_date, 900, null, null, null, null)`, [c, randomUUID(), cats.MEALS])).message).toBe('Meals needs a receipt.');
      expect((await failure(tx, `select add_expense_item($1, $2, $3, current_date, 6000, null, null, 'r.pdf', $4)`, [c, randomUUID(), cats.MEALS, hash('x')])).message).toBe('Meals items are limited to ₹5000.');
      expect((await failure(tx, `select add_expense_item($1, $2, $3, current_date + 2, 100, null, null, null, null)`, [c, randomUUID(), cats.CONVEYANCE])).message).toBe('Expenses can’t be dated in the future.');
      await item(tx, c, 'MEALS', 1200.5, 'dinner-receipt');
      expect((await tx.query<{ total: string }>('select total from expense_claims where id = $1', [c])).rows[0]!.total).toBe('1650.50');
      await tx.query('select submit_expense_claim($1)', [c]);
      expect((await failure(tx, `select add_expense_item($1, $2, $3, current_date, 10, null, null, null, null)`, [c, randomUUID(), cats.CONVEYANCE])).message).toBe('Only a draft claim can be changed.');

      // The same receipt again, on a second claim: flagged for the approvers, not refused.
      const again = await claim(tx, 'Team dinner');
      await item(tx, again, 'MEALS', 1200.5, 'dinner-receipt', 2);
      await tx.query('select submit_expense_claim($1)', [again]);
      const notes = (await tx.query<{ duplicate_note: string | null }>('select duplicate_note from expense_items where claim_id = $1', [again])).rows;
      expect(notes[0]!.duplicate_note).toBe('Same receipt file as an item on “Client visit”.');
      expect((await tx.query<{ summary: string }>('select r.summary from approval_requests r join expense_claims c on c.approval_request_id = r.id where c.id = $1', [again])).rows[0]!.summary)
        .toMatch(/possible duplicate$/);

      // Manager, then finance.
      const approval = await approvalOf(tx, c);
      await as(tx, f.users.leadA);
      expect((await tx.query('select 1 from expense_items where claim_id = $1', [c])).rows).toHaveLength(2); // the approver sees the items
      expect((await tx.query<{ s: string }>(`select decide_approval($1, 'approve') as s`, [approval])).rows[0]!.s).toBe('pending');
      await as(tx, f.users.payrollA);
      expect((await tx.query<{ s: string }>(`select decide_approval($1, 'approve') as s`, [approval])).rows[0]!.s).toBe('approved');
      expect((await tx.query<{ status: string }>('select status from expense_claims where id = $1', [c])).rows[0]!.status).toBe('approved');

      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from expense_claims where id = $1', [c])).rows).toHaveLength(0);
      expect((await failure(tx, `select * from expense_receipt((select id from expense_items where claim_id = $1 and receipt_path is not null))`, [c])).code).toBe('42501');
    });
  });

  it('a withdrawn claim goes back to draft; a rejected one stays rejected', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const a = await claim(tx, 'Withdraw me');
      await item(tx, a, 'CONVEYANCE', 100);
      await tx.query('select submit_expense_claim($1)', [a]);
      await tx.query('select cancel_approval($1)', [await approvalOf(tx, a)]);
      expect((await tx.query<{ status: string }>('select status from expense_claims where id = $1', [a])).rows[0]!.status).toBe('draft');
      await item(tx, a, 'CONVEYANCE', 50); // editable again

      const b = await claim(tx, 'Reject me');
      await item(tx, b, 'CONVEYANCE', 100);
      await tx.query('select submit_expense_claim($1)', [b]);
      const approval = await approvalOf(tx, b);
      await as(tx, f.users.leadA);
      await tx.query(`select decide_approval($1, 'reject', 'Not a business expense')`, [approval]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ status: string }>('select status from expense_claims where id = $1', [b])).rows[0]!.status).toBe('rejected');
    });
  });

  it('approved claims are paid with the next payroll run, once', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const c = await claim(tx, 'Cab fares');
      await item(tx, c, 'CONVEYANCE', 800);
      await tx.query('select submit_expense_claim($1)', [c]);
      const approval = await approvalOf(tx, c);
      await as(tx, f.users.leadA);
      await tx.query(`select decide_approval($1, 'approve')`, [approval]);
      await as(tx, f.users.ownerA);
      await tx.query(`select decide_approval($1, 'approve')`, [approval]);

      await as(tx, f.users.payrollA);
      const month = (await tx.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)), 'YYYY-MM-DD') as m`, [f.orgA])).rows[0]!.m;
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const inputs = (await tx.query<{ i: { month: string; ruleSet: { rules: unknown }; employees: Array<EmployeeInput & { reimbursementClaims: string[] }> } }>(
        'select payroll_run_inputs($1) as i', [run])).rows[0]!.i;
      const ic = inputs.employees.find((e) => e.employeeId === f.employees.icA)!;
      expect(ic.reimbursements).toBe(800);
      expect(ic.reimbursementClaims).toEqual([c]);
      const rules = ruleSetSchema.parse(inputs.ruleSet.rules);
      const results = inputs.employees.map((e) => ({ ...computePayslip(e, rules, { month: inputs.month }), input: e }));
      const fingerprint = createHash('sha256').update(canonicalJson(inputs)).digest('hex');
      await tx.query('select store_payroll_results($1, $2, $3, $4)', [run, ENGINE_VERSION, fingerprint, JSON.stringify(results)]);
      expect((await tx.query<{ amount: string }>(`select amount from payroll_line_items where run_id = $1 and employee_id = $2 and code = 'REIMB'`, [run, f.employees.icA])).rows)
        .toEqual([{ amount: '800.00' }]);
      await as(tx, f.users.ownerA);
      await tx.query('select approve_payroll_run($1, $2)', [run, fingerprint]);
      await tx.query('select lock_payroll_run($1)', [run]);
      const paid = (await tx.query<{ status: string; paid_run_id: string }>('select status, paid_run_id from expense_claims where id = $1', [c])).rows[0]!;
      expect(paid).toEqual({ status: 'paid', paid_run_id: run });

      await as(tx, f.users.payrollA);
      const next = (await tx.query<{ id: string }>(`select create_payroll_run($1, ($2::date + interval '1 month')::date) as id`, [f.orgA, month])).rows[0]!.id;
      const nextIc = (await tx.query<{ i: { employees: EmployeeInput[] } }>('select payroll_run_inputs($1) as i', [next])).rows[0]!.i.employees.find((e) => e.employeeId === f.employees.icA)!;
      expect(nextIc.reimbursements).toBe(0);
    });
  });

  it('only the employee works on their own drafts', async () => {
    const { f } = ctx;
    const c = await ctx.t.asUser(f.users.icA, (tx) => claim(tx, 'Mine'));
    expect(c).toBeTruthy();
    expect(await pgError(ctx.t.asUser(f.users.outsider, (tx) => tx.query(`select create_expense_claim($1, 'x')`, [f.orgA])))).toBe('42501');
  });
});
