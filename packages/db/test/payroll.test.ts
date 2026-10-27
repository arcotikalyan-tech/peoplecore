import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { canonicalJson, computePayslip, ENGINE_VERSION, IN_FY2025_26, payrollJournal, resultsDigestSource, ruleSetSchema, type EmployeeInput } from '@peoplecore/payroll';
import { pgError, useDatabase } from './setup.ts';

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

interface Inputs { runId: string; month: string; ruleSet: { id: string; code: string; validated: boolean; rules: unknown }; employees: EmployeeInput[] }

/** What the app does: fetch inputs, run the engine, store results with the inputs' fingerprint. */
async function compute(tx: Transaction, run: string) {
  const inputs = (await tx.query<{ i: Inputs }>('select payroll_run_inputs($1) as i', [run])).rows[0]!.i;
  const rules = ruleSetSchema.parse(inputs.ruleSet.rules);
  const results = inputs.employees.map((e) => ({ ...computePayslip(e, rules, { month: inputs.month }), input: e }));
  const hash = createHash('sha256').update(canonicalJson(inputs)).digest('hex');
  await tx.query('select store_payroll_results($1, $2, $3, $4)', [run, ENGINE_VERSION, hash, JSON.stringify(results)]);
  return { inputs, results, hash, digest: createHash('sha256').update(resultsDigestSource(results)).digest('hex') };
}

const salary = async (tx: Transaction, employee: string, from: string, basic: number, hra: number, special: number) => {
  const comps = (await tx.query<{ id: string; code: string }>('select id, code from salary_components where organization_id = $1', [ctx.f.orgA])).rows;
  const id = (code: string) => comps.find((c) => c.code === code)!.id;
  await tx.query('select set_compensation($1, $2, $3, $4)', [employee, from, (basic + hra + special) * 12,
    JSON.stringify([{ component_id: id('BASIC'), monthly_amount: basic }, { component_id: id('HRA'), monthly_amount: hra }, { component_id: id('SPECIAL'), monthly_amount: special }])]);
};

describe('statutory rule sets', () => {
  it('in the database match the engine’s bundled rules, and are marked unvalidated', async () => {
    const { rows } = await ctx.t.db.query<{ code: string; rules: unknown; validated: boolean }>('select code, rules, validated from statutory_rule_sets order by effective_from');
    expect(rows.map((r) => r.code)).toEqual(['IN_FY2025_26', 'IN_FY2026_27_PROVISIONAL']);
    for (const r of rows) {
      expect(ruleSetSchema.parse(r.rules)).toEqual(IN_FY2025_26);
      expect(r.validated).toBe(false);
    }
  });
});

describe('compensation', () => {
  it('payroll sets it from a date (closing the previous record); the employee and auditors read it; HR and managers don’t', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      await salary(tx, f.employees.icA, '2026-01-01', 25000, 12500, 12500);
      await salary(tx, f.employees.icA, '2026-07-01', 30000, 15000, 15000);
      expect((await failure(tx, `select set_compensation($1, '2026-03-01', 100, '[]')`, [f.employees.icA])).message).toBe('Give at least one salary component.');
      const recs = (await tx.query<{ from: string; to: string | null }>(
        `select to_char(effective_from, 'YYYY-MM-DD') as from, to_char(effective_to, 'YYYY-MM-DD') as to from compensation_records where employee_id = $1 order by effective_from`, [f.employees.icA])).rows;
      expect(recs).toEqual([{ from: '2026-01-01', to: '2026-06-30' }, { from: '2026-07-01', to: null }]);

      const sees = async (user: string) => { await as(tx, user); return (await tx.query('select 1 from compensation_lines')).rows.length; };
      expect(await sees(f.users.icA)).toBe(6);
      expect(await sees(f.users.auditorA)).toBe(6);
      expect(await sees(f.users.hrA)).toBe(0);
      expect(await sees(f.users.managerA)).toBe(0);
      expect(await sees(f.users.peerA)).toBe(0);
      await tx.exec('reset role');
      const audit = await tx.query<{ changes: { monthly_amount: string } }>(`select changes from audit_events where entity_type = 'compensation_lines' limit 1`);
      expect(audit.rows[0]!.changes.monthly_amount).toBe('[redacted]');
    });
    expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) => tx.query(`select set_compensation($1, '2026-01-01', 100, '[]')`, [f.employees.icA])))).toBe('42501');
  });
});

describe('payroll runs', () => {
  it('compute → maker ≠ checker approval on verified inputs → lock: immutable, payslips visible, YTD carried, bank file audited', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = (await tx.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)) - interval '1 month', 'YYYY-MM-DD') as m`, [f.orgA])).rows[0]!.m;
      await salary(tx, f.employees.icA, '2025-01-01', 25000, 12500, 12500);
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      expect((await failure(tx, 'select create_payroll_run($1, $2)', [f.orgA, month])).message).toMatch(/^There is already a payroll run for /);

      const { inputs, results, hash, digest } = await compute(tx, run);
      const ic = inputs.employees.find((e) => e.employeeId === f.employees.icA)!;
      expect(ic.payableDays).toBe(ic.daysInPeriod); // absences aren't LOP unless the run says so
      expect(ic.components.map((c) => c.code)).toEqual(['BASIC', 'HRA', 'SPECIAL']);
      expect(inputs.ruleSet.validated).toBe(false);
      const icSlip = results.find((r) => r.employeeId === f.employees.icA)!;
      expect(icSlip.net).toBe(50000 - 1800); // no PT state on file, income under the rebate limit
      const noPay = results.find((r) => r.employeeId === f.employees.peerA)!;
      expect(noPay.exceptions.map((e) => e.code)).toEqual(['no_compensation']);

      const stored = (await tx.query<{ total_net: string; status: string; employee_count: number }>('select total_net, status, employee_count from payroll_runs where id = $1', [run])).rows[0]!;
      expect(stored).toEqual({ total_net: String(results.reduce((s, r) => s + r.net, 0).toFixed(2)), status: 'computed', employee_count: inputs.employees.length });

      // Results stored straight through the function (not what the engine gives for these inputs) can't be approved,
      // even with the right inputs fingerprint: the checker's recomputed results must match.
      const tampered = results.map((r) => r.employeeId !== f.employees.icA ? r
        : { ...r, lines: r.lines.map((l) => (l.code === 'BASIC' ? { ...l, amount: l.amount + 5000 } : l)) });
      await tx.query('select store_payroll_results($1, $2, $3, $4)', [run, ENGINE_VERSION, hash, JSON.stringify(tampered)]);
      await as(tx, f.users.ownerA);
      expect((await failure(tx, 'select approve_payroll_run($1, $2, $3)', [run, hash, digest])).message)
        .toBe('The stored payslips don’t match what these inputs give. Recompute the run and check again.');
      await as(tx, f.users.payrollA);
      await tx.query('select store_payroll_results($1, $2, $3, $4)', [run, ENGINE_VERSION, hash, JSON.stringify(results)]);

      // The preparer can't approve; the checker must have verified the same inputs.
      expect((await failure(tx, 'select approve_payroll_run($1, $2, $3)', [run, hash, digest])).message).toBe('The person who prepared a payroll run can’t approve it.');
      await as(tx, f.users.ownerA);
      expect((await failure(tx, 'select approve_payroll_run($1, $2, $3)', [run, 'f'.repeat(64), digest])).message).toBe('The results don’t match the inputs you verified. Recompute and check again.');
      await tx.query('select approve_payroll_run($1, $2, $3)', [run, hash, digest]);
      await tx.exec('reset role');
      expect((await failure(tx, `update payroll_line_items set amount = 1 where run_id = $1`, [run])).message).toBe('This payroll run is approved and its results can’t change.');
      expect((await failure(tx, `update payroll_runs set approved_by = prepared_by where id = $1`, [run])).code).toBe('23514'); // maker = checker, on the row

      await as(tx, f.users.payrollA);
      expect((await failure(tx, 'select * from payroll_journal_items($1)', [run])).message).toBe('Lock the run before exporting the journal.');
      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from payroll_run_employees where run_id = $1', [run])).rows).toHaveLength(0); // not until locked
      await as(tx, f.users.payrollA);
      await tx.query('select lock_payroll_run($1)', [run]);
      expect((await failure(tx, 'select cancel_payroll_run($1)', [run])).message).toBe('A locked payroll run can’t be changed. Make corrections in the next run.');

      await as(tx, f.users.icA);
      const mine = await tx.query<{ net: string }>('select net from payroll_run_employees where run_id = $1', [run]);
      expect(mine.rows).toEqual([{ net: '48200.00' }]);
      expect((await tx.query<{ kind: string }>(`select kind from notifications where kind = 'payroll.payslip'`)).rows).toHaveLength(1);
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from payroll_line_items where run_id = $1 and employee_id = $2', [run, f.employees.icA])).rows).toHaveLength(0);

      // Next month carries this month's taxable pay into the year-to-date figures.
      await as(tx, f.users.payrollA);
      const next = (await tx.query<{ id: string }>(`select create_payroll_run($1, ($2::date + interval '1 month')::date) as id`, [f.orgA, month])).rows[0]!.id;
      const nextInputs = (await tx.query<{ i: Inputs }>('select payroll_run_inputs($1) as i', [next])).rows[0]!.i;
      const fyStart = Number(month.slice(5, 7)) === 3;
      expect(nextInputs.employees.find((e) => e.employeeId === f.employees.icA)!.ytd.taxableIncome).toBe(fyStart ? 0 : 50000);

      const bank = await tx.query('select * from payroll_bank_file($1)', [run]);
      expect(bank.rows.length).toBeGreaterThan(0);
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from audit_events where action = 'bank_file_export' and entity_id = $1`, [run])).rows).toHaveLength(1);
      await as(tx, f.users.hrA);
      expect((await failure(tx, 'select * from payroll_bank_file($1)', [run])).code).toBe('42501');

      // The accounting export: line items summed per component (the preparer may export it too), balanced, audited.
      expect((await failure(tx, 'select * from payroll_journal_items($1)', [run])).code).toBe('42501');
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select * from payroll_journal_items($1)', [run])).code).toBe('42501');
      await as(tx, f.users.payrollA);
      const items = (await tx.query<{ code: string; name: string; kind: 'earning' | 'deduction' | 'employer'; amount: string; employees: number }>(
        'select * from payroll_journal_items($1)', [run])).rows;
      expect(items.find((i) => i.code === 'BASIC')).toMatchObject({ kind: 'earning', amount: String(results.reduce((s, r) => s + (r.lines.find((l) => l.code === 'BASIC')?.amount ?? 0), 0).toFixed(2)) });
      const journal = payrollJournal(items.map((i) => ({ ...i, amount: Number(i.amount) })));
      expect(journal.totals.credit).toBe(journal.totals.debit);
      expect(journal.lines.find((l) => l.account === 'Salaries payable')!.credit).toBe(results.reduce((s, r) => s + r.net, 0));
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from audit_events where action = 'journal_export' and entity_id = $1`, [run])).rows).toHaveLength(1);
    });
  });

  it('unpaid leave becomes loss of pay; absences count only when the run says so; blocking exceptions stop approval', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = (await tx.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)) - interval '2 months', 'YYYY-MM-DD') as m`, [f.orgA])).rows[0]!.m;
      await salary(tx, f.employees.icA, '2025-01-01', 25000, 12500, 12500);
      await tx.exec('reset role');
      const lop = (await tx.query<{ id: string }>(`select id from leave_types where organization_id = $1 and code = 'LOP'`, [f.orgA])).rows[0]!.id;
      const firstMonday = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series($1::date, $1::date + 6, interval '1 day') d where extract(isodow from d) = 1`, [month])).rows[0]!.d;
      await tx.query(`insert into leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, days, status, requested_by)
                      values ($1, $2, $3, $4, $4::date + 1, 2, 'approved', $5)`, [f.orgA, f.employees.icA, lop, firstMonday, f.users.icA]);
      await as(tx, f.users.payrollA);

      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const { inputs } = await compute(tx, run);
      const ic = inputs.employees.find((e) => e.employeeId === f.employees.icA)!;
      expect(ic.daysInPeriod - ic.payableDays).toBe(2);

      await tx.query('select cancel_payroll_run($1)', [run]);
      const strict = (await tx.query<{ id: string }>('select create_payroll_run($1, $2, true) as id', [f.orgA, month])).rows[0]!.id;
      const strictInputs = (await compute(tx, strict)).inputs;
      // No punches at all: every working day without leave is an absence.
      expect(strictInputs.employees.find((e) => e.employeeId === f.employees.icA)!.payableDays).toBeLessThan(ic.payableDays);

      // A blocking exception (here: an unknown PT state) stops approval.
      await tx.query(`insert into employee_statutory_profiles (organization_id, employee_id, pt_state) values ($1, $2, 'ZZ')`, [f.orgA, f.employees.icA]);
      const { hash, digest } = await compute(tx, strict);
      await as(tx, f.users.ownerA);
      expect((await failure(tx, 'select approve_payroll_run($1, $2, $3)', [strict, hash, digest])).message).toBe('Resolve the blocking exceptions before approving.');
    });
  });

  it('arrears and recoveries go through the next run once, then become history', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = (await tx.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)), 'YYYY-MM-DD') as m`, [f.orgA])).rows[0]!.m;
      await salary(tx, f.employees.icA, '2025-01-01', 25000, 12500, 12500);
      const adj = (await tx.query<{ id: string }>(
        `insert into payroll_adjustments (organization_id, employee_id, code, name, kind, amount, taxable, reason)
         values ($1, $2, 'ARREAR', 'Salary arrears', 'earning', 6000, true, 'Revision effective last month') returning id`, [f.orgA, f.employees.icA])).rows[0]!.id;
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const { results, hash, digest } = await compute(tx, run);
      const ic = results.find((r) => r.employeeId === f.employees.icA)!;
      expect(ic.lines.find((l) => l.code === 'ARREAR')?.amount).toBe(6000);
      expect(ic.gross).toBe(56000);

      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from payroll_adjustments')).rows).toHaveLength(0); // payroll staff only
      await as(tx, f.users.ownerA);
      await tx.query('select approve_payroll_run($1, $2, $3)', [run, hash, digest]);
      await tx.query('select lock_payroll_run($1)', [run]);
      expect((await tx.query<{ r: string }>('select applied_run_id as r from payroll_adjustments where id = $1', [adj])).rows[0]!.r).toBe(run);

      await as(tx, f.users.payrollA);
      expect((await failure(tx, 'delete from payroll_adjustments where id = $1', [adj])).message)
        .toBe('This adjustment was paid in a locked run and can’t change. Record a new adjustment instead.');
      const next = (await tx.query<{ id: string }>(`select create_payroll_run($1, ($2::date + interval '1 month')::date) as id`, [f.orgA, month])).rows[0]!.id;
      const nextInputs = (await tx.query<{ i: Inputs }>('select payroll_run_inputs($1) as i', [next])).rows[0]!.i;
      expect(nextInputs.employees.find((e) => e.employeeId === f.employees.icA)!.adjustments).toEqual([]);
    });
  });

  it('a run computed late (for an earlier month) still picks up corrections recorded since', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      await tx.query(`insert into payroll_adjustments (organization_id, employee_id, code, name, kind, amount, taxable, reason)
                      values ($1, $2, 'BONUS', 'Bonus', 'earning', 1000, true, 'Recorded today')`, [f.orgA, f.employees.icA]);
      const old = (await tx.query<{ id: string }>(`select create_payroll_run($1, (date_trunc('month', app.org_today($1)) - interval '3 months')::date) as id`, [f.orgA])).rows[0]!.id;
      const inputs = (await tx.query<{ i: Inputs }>('select payroll_run_inputs($1) as i', [old])).rows[0]!.i;
      expect(inputs.employees.find((e) => e.employeeId === f.employees.icA)!.adjustments).toEqual([
        { code: 'BONUS', name: 'Bonus', kind: 'earning', amount: 1000, taxable: true },
      ]);
    });
  });

  it('locked runs can be purged by the service role in demo organizations only', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      const rules = (await t.db.query<{ id: string }>(`select id from statutory_rule_sets where code = 'IN_FY2025_26'`)).rows[0]!.id;
      const demo = (await t.db.query<{ id: string }>(`insert into payroll_runs (organization_id, period_month, rule_set_id, status) values ($1, '2025-05-01', $2, 'locked') returning id`, [f.orgA, rules])).rows[0]!.id;
      await t.db.exec('savepoint s');
      await expect(t.db.query('delete from payroll_runs where id = $1', [demo])).rejects.toThrow('A locked payroll run can’t be changed.');
      await t.db.exec('rollback to savepoint s');
      await t.db.query('select purge_demo_payroll_run($1)', [demo]);
      expect((await t.db.query('select 1 from payroll_runs where id = $1', [demo])).rows).toHaveLength(0);

      await t.db.query('update organizations set is_demo = false where id = $1', [f.orgB]);
      const real = (await t.db.query<{ id: string }>(`insert into payroll_runs (organization_id, period_month, rule_set_id, status) values ($1, '2025-05-01', $2, 'locked') returning id`, [f.orgB, rules])).rows[0]!.id;
      await expect(t.db.query('select purge_demo_payroll_run($1)', [real])).rejects.toThrow('Only payroll runs in demo organizations can be purged.');
    } finally {
      await t.db.exec('rollback');
    }
    expect(await pgError(ctx.t.asUser(f.users.ownerA, (tx) => tx.query('select purge_demo_payroll_run(gen_random_uuid())')))).toBe('42501');
  });

  it('only payroll staff run payroll', async () => {
    const { f } = ctx;
    for (const user of [f.users.hrA, f.users.managerA, f.users.icA, f.users.ownerB]) {
      expect(await pgError(ctx.t.asUser(user, (tx) => tx.query(`select create_payroll_run($1, current_date)`, [f.orgA])))).toBe('42501');
    }
  });
});
