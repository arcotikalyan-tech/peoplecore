import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();
const cats: Record<string, string> = {};

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}
async function failure(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec('savepoint f');
  try { await tx.query(sql, params); } catch (e) { await tx.exec('rollback to savepoint f'); return e as { code?: string; message: string }; }
  throw new Error(`expected to fail: ${sql}`);
}

const submitted = async (tx: Transaction, title: string, amount: number) => {
  const c = (await tx.query<{ id: string }>('select create_expense_claim($1, $2) as id', [ctx.f.orgA, title])).rows[0]!.id;
  await tx.query(`select add_expense_item($1, $2, $3, current_date - 1, $4, 'Cab', null, null, null)`, [c, randomUUID(), cats.CONVEYANCE, amount]);
  await tx.query('select submit_expense_claim($1)', [c]);
  return c;
};
const flowOf = async (tx: Transaction, c: string) =>
  (await tx.query<{ t: string }>('select r.subject_type as t from approval_requests r join expense_claims c on c.approval_request_id = r.id where c.id = $1', [c])).rows[0]!.t;
const requestOf = async (tx: Transaction, c: string) =>
  (await tx.query<{ a: string }>('select approval_request_id as a from expense_claims where id = $1', [c])).rows[0]!.a;
const statusOf = async (tx: Transaction, c: string) =>
  (await tx.query<{ status: string }>('select status from expense_claims where id = $1', [c])).rows[0]!.status;

beforeAll(async () => {
  const { rows } = await ctx.t.db.query<{ code: string; id: string }>('select code, id from expense_categories where organization_id = $1', [ctx.f.orgA]);
  for (const r of rows) cats[r.code] = r.id;
});

describe('expense suite', () => {
  it('settings route claims: manager only at/below the threshold, manager then finance above it, finance only when chosen; escalation follows the days', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      await tx.query('update expense_settings set threshold = 1000, escalation_days = 5 where organization_id = $1', [f.orgA]);
      expect((await tx.query<{ h: number }>(`select distinct s.escalate_after_hours as h from approval_flow_steps s join approval_flows fl on fl.id = s.flow_id
        where fl.organization_id = $1 and fl.subject_type like 'expense_claim%'`, [f.orgA])).rows).toEqual([{ h: 120 }]);
      await as(tx, f.users.icA);
      const small = await submitted(tx, 'Cab to client', 450);
      const large = await submitted(tx, 'Airport cabs', 1500);
      expect(await flowOf(tx, small)).toBe('expense_claim_manager');
      expect(await flowOf(tx, large)).toBe('expense_claim');
      await as(tx, f.users.leadA);
      await tx.query(`select decide_approval($1, 'approve')`, [await requestOf(tx, small)]);
      expect(await statusOf(tx, small)).toBe('approved'); // the manager alone finalizes small claims

      await as(tx, f.users.payrollA);
      await tx.query('update expense_settings set finance_only = true where organization_id = $1', [f.orgA]);
      await as(tx, f.users.icA);
      expect(await flowOf(tx, await submitted(tx, 'Parking', 200))).toBe('expense_claim_finance');
      await as(tx, f.users.hrA);
      expect((await tx.query(`update expense_settings set finance_only = false where organization_id = $1 returning 1`, [f.orgA])).rows).toHaveLength(0); // HR isn't finance
    });
  });

  it('an approver puts a claim on hold for information; the employee answers; colleagues can’t; finance may skip only when allowed', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const c = await submitted(tx, 'Toll and parking', 300);
      await as(tx, f.users.peerA);
      expect((await failure(tx, `select hold_expense_claim($1, 'Which trip?')`, [c])).code).toBe('42501');
      await as(tx, f.users.leadA);
      await tx.query(`select hold_expense_claim($1, 'Which client was this for?')`, [c]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ n: string }>(`select hold_note as n from expense_claims where id = $1 and held_at is not null`, [c])).rows[0]!.n).toBe('Which client was this for?');
      expect((await tx.query(`select 1 from notifications where kind = 'expense.on_hold'`)).rows).toHaveLength(1);
      await tx.query(`select reply_expense_claim($1, 'The Example Ltd visit')`, [c]);
      expect((await tx.query<{ held: boolean; r: string }>(`select held_at is not null as held, hold_reply as r from expense_claims where id = $1`, [c])).rows[0])
        .toEqual({ held: false, r: 'The Example Ltd visit' });

      await as(tx, f.users.payrollA);
      expect((await failure(tx, `select finalize_expense_claim($1, 'Urgent')`, [c])).code).toBe('42501'); // skipping is off by default
      await tx.query('update expense_settings set allow_skip = true where organization_id = $1', [f.orgA]);
      await tx.query(`select finalize_expense_claim($1, 'Manager on leave')`, [c]);
      expect(await statusOf(tx, c)).toBe('approved');
      expect((await tx.query<{ comment: string }>(`select comment from approval_actions where request_id = $1`, [await requestOf(tx, c)])).rows[0]!.comment)
        .toMatch(/^Approved by finance, skipping the remaining approvers: Manager on leave/);
    });
  });

  it('finance records an expense for someone; pays by bank (never a claim already in a payroll being processed); payroll payouts are stamped', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const rec = (await tx.query<{ id: string }>(`select record_expense($1, $2, $3, current_date - 2, 640, 'Example Cabs') as id`, [f.orgA, f.employees.icA, cats.CONVEYANCE])).rows[0]!.id;
      expect((await tx.query<{ status: string; recorded_by_finance: boolean; total: string }>('select status, recorded_by_finance, total from expense_claims where id = $1', [rec])).rows[0])
        .toEqual({ status: 'approved', recorded_by_finance: true, total: '640.00' });
      const held = (await tx.query<{ id: string }>(`select record_expense($1, $2, $3, current_date - 2, 300) as id`, [f.orgA, f.employees.peerA, cats.CONVEYANCE])).rows[0]!.id;

      // A payroll run being processed already includes `held`.
      await tx.exec('reset role');
      const run = (await tx.query<{ id: string }>(`insert into payroll_runs (organization_id, period_month, status, rule_set_id)
        values ($1, date_trunc('month', current_date)::date, 'computed', (select id from statutory_rule_sets limit 1)) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into payroll_run_employees (organization_id, run_id, employee_id, period_month, input, payable_days, lop_days, gross, deductions, net, employer_cost, taxable)
        values ($1, $2, $3, date_trunc('month', current_date)::date, jsonb_build_object('reimbursementClaims', jsonb_build_array($4::text)), 30, 0, 300, 0, 300, 300, 0)`,
        [f.orgA, run, f.employees.peerA, held]);
      await as(tx, f.users.payrollA);
      expect((await failure(tx, `select pay_expense_claims(array[$1]::uuid[], 'bank', 'UTR1')`, [held])).message).toMatch(/is in a payroll run being processed/);
      expect((await tx.query<{ n: number }>(`select pay_expense_claims(array[$1]::uuid[], 'bank', 'UTR123') as n`, [rec])).rows[0]!.n).toBe(1);
      expect((await tx.query<{ status: string; payout_mode: string; payout_reference: string; paid: boolean }>(
        'select status, payout_mode, payout_reference, paid_at is not null as paid from expense_claims where id = $1', [rec])).rows[0])
        .toEqual({ status: 'paid', payout_mode: 'bank', payout_reference: 'UTR123', paid: true });

      await as(tx, f.users.hrA);
      expect((await failure(tx, `select * from expense_bank_advice($1, array[$2]::uuid[])`, [f.orgA, held])).code).toBe('42501');
      await as(tx, f.users.icA);
      expect((await failure(tx, `select record_expense($1, $2, $3, current_date, 100)`, [f.orgA, f.employees.icA, cats.CONVEYANCE])).code).toBe('42501');
      expect((await tx.query(`select 1 from notifications where kind = 'expense.paid'`)).rows).toHaveLength(1);

      await tx.exec('reset role');
      await tx.query(`update payroll_runs set status = 'locked' where id = $1`, [run]);
      await tx.query(`update expense_claims set status = 'paid', paid_run_id = $2 where id = $1`, [held, run]);
      expect((await tx.query<{ payout_mode: string; paid: boolean }>('select payout_mode, paid_at is not null as paid from expense_claims where id = $1', [held])).rows[0])
        .toEqual({ payout_mode: 'payroll', paid: true });
    });
  });

  it('sub-categories: items may only name one their category has', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      await tx.query(`update expense_categories set subcategories = '{Cab,Auto,Metro}' where id = $1`, [cats.CONVEYANCE]);
      await as(tx, f.users.icA);
      const c = (await tx.query<{ id: string }>('select create_expense_claim($1, $2) as id', [f.orgA, 'Metro rides'])).rows[0]!.id;
      await tx.query(`select add_expense_item($1, $2, $3, current_date - 1, 80, null, null, null, null, 'Metro')`, [c, randomUUID(), cats.CONVEYANCE]);
      expect((await failure(tx, `select add_expense_item($1, $2, $3, current_date - 1, 80, null, null, null, null, 'Ferry')`, [c, randomUUID(), cats.CONVEYANCE])).message)
        .toBe('Choose one of the sub-categories of Local conveyance.');
    });
  });
});
