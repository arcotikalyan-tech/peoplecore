import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

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

async function salary(tx: Transaction, employee: string, basic: number, hra: number, special: number) {
  const comps = (await tx.query<{ id: string; code: string }>('select id, code from salary_components where organization_id = $1', [ctx.f.orgA])).rows;
  const id = (code: string) => comps.find((c) => c.code === code)!.id;
  await tx.query(`select set_compensation($1, '2024-01-01', $2, $3)`, [employee, (basic + hra + special) * 12,
    JSON.stringify([{ component_id: id('BASIC'), monthly_amount: basic }, { component_id: id('HRA'), monthly_amount: hra }, { component_id: id('SPECIAL'), monthly_amount: special }])]);
}

const approvalOf = async (tx: Transaction, loan: string) =>
  (await tx.query<{ approval_request_id: string }>('select approval_request_id from loans where id = $1', [loan])).rows[0]!.approval_request_id;

describe('loans', () => {
  it('EMIs use the reducing-balance formula', async () => {
    const r = await ctx.t.db.query<{ a: string; b: string }>('select app.loan_emi(100000, 12, 12) as a, app.loan_emi(120000, 0, 12) as b');
    expect(r.rows[0]).toEqual({ a: '8884.88', b: '10000.00' });
  });

  it('eligibility, apply, manager then payroll approve, disburse, EMIs through payroll, foreclose', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      await salary(tx, f.employees.icA, 30000, 12000, 18000);

      await as(tx, f.users.peerA); // no salary set up
      const peer = (await tx.query<{ e: { eligible: boolean; reasons: string[] } }>('select loan_eligibility($1) as e', [f.orgA])).rows[0]!.e;
      expect(peer.eligible).toBe(false);
      expect(peer.reasons).toContain('Your salary isn’t set up yet.');
      expect((await failure(tx, `select apply_loan($1, 'loan', 1000, 2, 'Rent deposit')`, [f.orgA])).message).toBe('Your salary isn’t set up yet.');

      await as(tx, f.users.icA);
      const el = (await tx.query<{ e: Record<string, unknown> }>('select loan_eligibility($1) as e', [f.orgA])).rows[0]!.e;
      expect(el).toMatchObject({ eligible: true, monthlyGross: 60000, maxAmount: 180000, maxEmi: 24000, maxTenure: 24, interestRate: 0 });
      expect((await failure(tx, `select apply_loan($1, 'loan', 200000, 12, 'Wedding')`, [f.orgA])).message).toBe('You can borrow up to ₹180000.');
      expect((await failure(tx, `select apply_loan($1, 'advance', 30000, 6, 'Medical')`, [f.orgA])).message).toBe('A salary advance is repaid within 3 months.');
      expect((await failure(tx, `select apply_loan($1, 'loan', 120000, 4, 'Wedding')`, [f.orgA])).message).toMatch(/^The EMI of ₹30000 is more than you can repay each month \(₹24000\)/);
      const loan = (await tx.query<{ id: string }>(`select apply_loan($1, 'loan', 120000, 12, 'Home repairs') as id`, [f.orgA])).rows[0]!.id;
      expect((await tx.query<{ emi: string; status: string }>('select emi, status from loans where id = $1', [loan])).rows[0]).toEqual({ emi: '10000.00', status: 'pending' });
      expect((await failure(tx, `select apply_loan($1, 'advance', 1000, 1, 'Bills')`, [f.orgA])).message).toBe('You already have a loan open.');
      expect((await failure(tx, `insert into loans (organization_id, employee_id, kind, amount, interest_rate, tenure_months, emi, purpose)
        values ($1, $2, 'loan', 1, 0, 1, 1, 'direct')`, [f.orgA, f.employees.icA])).code).toBe('42501');
      const req = await approvalOf(tx, loan);

      await as(tx, f.users.leadA); // Ishan's manager sees the application while deciding it, and after
      expect((await tx.query('select 1 from loans')).rows).toHaveLength(1);
      expect((await tx.query('select 1 from loan_installments')).rows).toHaveLength(0);
      expect((await tx.query<{ s: string }>(`select decide_approval($1, 'approve') as s`, [req])).rows[0]!.s).toBe('pending');
      expect((await tx.query('select 1 from loans')).rows).toHaveLength(1);

      await as(tx, f.users.peerA); // not involved
      expect((await tx.query('select 1 from loans')).rows).toHaveLength(0);

      await as(tx, f.users.recruiterA); // not payroll, not an approver
      expect((await tx.query('select 1 from loans')).rows).toHaveLength(0);

      await as(tx, f.users.payrollA);
      expect((await failure(tx, `select disburse_loan($1, 'bank', 'UTR1')`, [loan])).message).toBe('Only an approved loan can be disbursed.');
      expect((await tx.query<{ s: string }>(`select decide_approval($1, 'approve') as s`, [req])).rows[0]!.s).toBe('approved');
      expect((await tx.query<{ status: string }>('select status from loans where id = $1', [loan])).rows[0]!.status).toBe('approved');
      expect((await failure(tx, `select disburse_loan($1, 'bank', '')`, [loan])).message).toBe('Enter the bank reference.');
      await tx.query(`select disburse_loan($1, 'bank', 'UTR42')`, [loan]);
      const sched = (await tx.query<{ seq: number; principal: string; due: string }>(
        `select seq, principal, to_char(due_month, 'YYYY-MM-DD') as due from loan_installments where loan_id = $1 order by seq`, [loan])).rows;
      expect(sched).toHaveLength(12);
      expect(sched.reduce((s, r) => s + Number(r.principal), 0)).toBe(120000);
      const first = sched[0]!.due;

      // A run for the first EMI month queues exactly that EMI as a deduction.
      await tx.exec('reset role');
      const run = (await tx.query<{ id: string }>(`insert into payroll_runs (organization_id, period_month, rule_set_id)
        values ($1, $2, (select id from statutory_rule_sets limit 1)) returning id`, [f.orgA, first])).rows[0]!.id;
      await as(tx, f.users.payrollA);
      const adj = (await tx.query<{ id: string; amount: string; kind: string }>(`select id, amount, kind from payroll_adjustments where code = 'LOAN_EMI'`)).rows;
      expect(adj.map((a) => [a.amount, a.kind])).toEqual([['10000.00', 'deduction']]);
      expect((await tx.query<{ status: string }>('select status from loan_installments where loan_id = $1 and seq = 1', [loan])).rows[0]!.status).toBe('queued');

      // Payroll removes the deduction: the EMI goes back on the schedule, and is queued again for the run.
      await tx.query('delete from payroll_adjustments where id = $1', [adj[0]!.id]);
      expect((await tx.query<{ status: string }>('select status from loan_installments where loan_id = $1 and seq = 1', [loan])).rows[0]!.status).toBe('scheduled');
      await tx.exec('reset role');
      await tx.query('select app.queue_loan_emis($1, $2)', [f.orgA, first]);
      await tx.query(`update payroll_adjustments set applied_run_id = $1 where code = 'LOAN_EMI'`, [run]); // the run is locked
      await as(tx, f.users.icA);
      expect((await tx.query<{ status: string; paid: boolean }>('select status, paid_at is not null as paid from loan_installments where loan_id = $1 and seq = 1', [loan])).rows[0])
        .toEqual({ status: 'paid', paid: true });
      expect((await tx.query('select 1 from loan_installments')).rows).toHaveLength(12); // the borrower reads their statement
      expect((await failure(tx, `select foreclose_loan($1, 'Paid back')`, [loan])).code).toBe('42501');

      await as(tx, f.users.payrollA);
      expect((await failure(tx, `select foreclose_loan($1, '')`, [loan])).message).toBe('Say how the balance was settled.');
      expect((await tx.query<{ due: string }>(`select foreclose_loan($1, 'Repaid by bank transfer UTR77') as due`, [loan])).rows[0]!.due).toBe('110000.00');
      expect((await tx.query<{ status: string }>('select status from loans where id = $1', [loan])).rows[0]!.status).toBe('closed');
      expect((await tx.query<{ n: number }>(`select count(*)::int as n from loan_installments where loan_id = $1 and status = 'foreclosed'`, [loan])).rows[0]!.n).toBe(11);

      await as(tx, f.users.employeeB); // another organization
      expect((await tx.query('select 1 from loans')).rows).toHaveLength(0);
    });
  });

  it('applications can be withdrawn or rejected; advances are interest-free; the last EMI closes the loan', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      await salary(tx, f.employees.icA, 30000, 12000, 18000);
      await tx.query('update loan_settings set interest_rate = 12 where organization_id = $1', [f.orgA]);

      await as(tx, f.users.icA);
      const a = (await tx.query<{ id: string }>(`select apply_loan($1, 'loan', 100000, 12, 'Car repairs') as id`, [f.orgA])).rows[0]!.id;
      expect((await tx.query<{ emi: string; interest_rate: string }>('select emi, interest_rate from loans where id = $1', [a])).rows[0])
        .toEqual({ emi: '8884.88', interest_rate: '12.00' });
      await tx.query('select cancel_loan($1)', [a]);
      expect((await tx.query<{ status: string }>('select status from loans where id = $1', [a])).rows[0]!.status).toBe('cancelled');
      expect((await failure(tx, 'select cancel_loan($1)', [a])).message).toBe('Only a pending application can be withdrawn.');

      const b = (await tx.query<{ id: string }>(`select apply_loan($1, 'advance', 20000, 2, 'Medical bills') as id`, [f.orgA])).rows[0]!.id;
      expect((await tx.query<{ emi: string; interest_rate: string }>('select emi, interest_rate from loans where id = $1', [b])).rows[0])
        .toEqual({ emi: '10000.00', interest_rate: '0.00' });
      const reqB = await approvalOf(tx, b);
      await as(tx, f.users.leadA);
      await tx.query(`select decide_approval($1, 'reject', 'Use the medical insurance first')`, [reqB]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ status: string }>('select status from loans where id = $1', [b])).rows[0]!.status).toBe('rejected');

      const c = (await tx.query<{ id: string }>(`select apply_loan($1, 'advance', 5000, 1, 'School fees') as id`, [f.orgA])).rows[0]!.id;
      const reqC = await approvalOf(tx, c);
      await as(tx, f.users.leadA);
      await tx.query(`select decide_approval($1, 'approve')`, [reqC]);
      await as(tx, f.users.payrollA);
      await tx.query(`select decide_approval($1, 'approve')`, [reqC]);
      await tx.query(`select disburse_loan($1, 'payroll', null, date_trunc('month', current_date)::date)`, [c]);
      expect((await tx.query<{ kind: string; amount: string }>(`select kind, amount from payroll_adjustments where code = 'LOAN_DISBURSAL'`)).rows)
        .toEqual([{ kind: 'earning', amount: '5000.00' }]);
      await tx.exec('reset role');
      const run = (await tx.query<{ id: string }>(`insert into payroll_runs (organization_id, period_month, rule_set_id)
        values ($1, date_trunc('month', current_date)::date, (select id from statutory_rule_sets limit 1)) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`update payroll_adjustments set applied_run_id = $1`, [run]);
      expect((await tx.query<{ status: string; note: string }>('select status, closure_note as note from loans where id = $1', [c])).rows[0])
        .toEqual({ status: 'closed', note: 'Repaid through payroll' });
    });
  });
});
