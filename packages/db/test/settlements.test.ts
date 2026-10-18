import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { canonicalJson, computeSettlement, SETTLEMENT_VERSION, type SettlementInput } from '@peoplecore/payroll';
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

/** Ishan: joined 2019-01-01, ₹40,000 basic (₹80,000 gross), 10 days of earned leave, an approved resignation. */
async function leaver(tx: Transaction, lastDay: string, status = 'approved', shortfall = 0, treatment: string | null = null) {
  const { f } = ctx;
  await tx.exec('reset role');
  await tx.query(`update employees set date_of_joining = '2019-01-01' where id = $1`, [f.employees.icA]);
  const comps = (await tx.query<{ id: string; code: string }>('select id, code from salary_components where organization_id = $1', [f.orgA])).rows;
  const id = (code: string) => comps.find((c) => c.code === code)!.id;
  const rec = (await tx.query<{ id: string }>(`insert into compensation_records (organization_id, employee_id, effective_from, annual_ctc)
                                               values ($1, $2, '2025-01-01', 960000) returning id`, [f.orgA, f.employees.icA])).rows[0]!.id;
  for (const [code, amount] of [['BASIC', 40000], ['HRA', 20000], ['SPECIAL', 20000]] as const) {
    await tx.query('insert into compensation_lines (organization_id, record_id, component_id, monthly_amount) values ($1, $2, $3, $4)', [f.orgA, rec, id(code), amount]);
  }
  const el = (await tx.query<{ id: string }>(`select id from leave_types where organization_id = $1 and code = 'EL'`, [f.orgA])).rows[0]!.id;
  await tx.query(`insert into leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note) values ($1, $2, $3, '2026-01-01', 'opening', 10, 'Opening')`,
    [f.orgA, f.employees.icA, el]);
  const sep = (await tx.query<{ id: string }>(
    `insert into separations (organization_id, employee_id, type, initiated_by, submitted_on, requested_last_day, notice_days, notice_end, last_working_day,
                              shortfall_days, shortfall_treatment, status)
     values ($1, $2, 'resignation', $3, $4::date - 30, $4, 30, $4::date + $5::int, $4, $5::int, $6, $7) returning id`,
    [f.orgA, f.employees.icA, f.users.icA, lastDay, shortfall, treatment, status])).rows[0]!.id;
  return sep;
}

/** What the app does: inputs from the database, the engine, a fingerprint, then store. */
async function prepare(tx: Transaction, sep: string, extraLines: SettlementInput['extraLines'] = []) {
  const base = (await tx.query<{ i: Omit<SettlementInput, 'extraLines'> }>('select settlement_inputs($1) as i', [sep])).rows[0]!.i;
  const inputs: SettlementInput = { ...base, components: base.components.map((c) => ({ ...c, monthly: Number(c.monthly) })), extraLines };
  const result = computeSettlement(inputs);
  const hash = createHash('sha256').update(canonicalJson(inputs)).digest('hex');
  const id = (await tx.query<{ id: string }>('select store_settlement($1, $2, $3, $4, $5) as id',
    [sep, SETTLEMENT_VERSION, JSON.stringify(inputs), hash, JSON.stringify(result.lines)])).rows[0]!.id;
  return { id, hash, result, inputs };
}

describe('full and final settlement', () => {
  it('payroll prepares it from the database’s inputs; a different approver turns it into payroll adjustments', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const sep = await leaver(tx, '2026-06-30');
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select settlement_inputs($1)', [sep])).code).toBe('42501');

      await as(tx, f.users.payrollA);
      const { id, hash, result, inputs } = await prepare(tx, sep, [{ name: 'Laptop not returned', kind: 'deduction', amount: 15000, taxable: false }]);
      // 7 years 6 months → 8 years: 40,000 × 15/26 × 8 = 184,615; encashment 10 × 40,000/30 = 13,333; less 15,000.
      expect(result.lines.map((l) => [l.code, l.amount])).toEqual([['FNF_LEAVE', 13333], ['FNF_GRATUITY', 184615], ['FNF_OTHER_1', 15000]]);
      expect((await tx.query<{ net: string }>('select net from fnf_settlements where id = $1', [id])).rows[0]!.net).toBe('182948.00');

      const tampered = { ...inputs, dateOfJoining: '2010-01-01' };
      expect((await failure(tx, 'select store_settlement($1, $2, $3, $4, $5)', [sep, SETTLEMENT_VERSION, JSON.stringify(tampered), hash, JSON.stringify(result.lines)])).message)
        .toBe('The employee’s details changed. Prepare the settlement again.');
      expect((await failure(tx, 'select store_settlement($1, $2, $3, $4, $5)', [sep, SETTLEMENT_VERSION, JSON.stringify(inputs), hash,
        JSON.stringify([{ code: 'BONUS', name: 'Bonus', kind: 'earning', amount: 1 }])])).message).toBe('Invalid settlement line.');

      expect((await failure(tx, 'select approve_settlement($1, $2)', [id, hash])).message).toBe('Someone other than the preparer must approve it.');
      await as(tx, f.users.ownerA); // payroll.approve
      expect((await failure(tx, 'select approve_settlement($1, $2)', [id, '0'.repeat(64)])).message).toBe('The settlement changed since you opened it. Review it again.');
      await tx.query('select approve_settlement($1, $2)', [id, hash]);
      expect((await failure(tx, 'select approve_settlement($1, $2)', [id, hash])).message).toBe('This settlement is already approved.');
      const adj = (await tx.query<{ code: string; kind: string; amount: string; taxable: boolean }>(
        'select code, kind, amount, taxable from payroll_adjustments where employee_id = $1 order by code', [f.employees.icA])).rows;
      expect(adj).toEqual([
        { code: 'FNF_GRATUITY', kind: 'earning', amount: '184615.00', taxable: false },
        { code: 'FNF_LEAVE', kind: 'earning', amount: '13333.00', taxable: true },
        { code: 'FNF_OTHER_1', kind: 'deduction', amount: '15000.00', taxable: false },
      ]);

      await as(tx, f.users.payrollA);
      expect((await failure(tx, 'select store_settlement($1, $2, $3, $4, $5)', [sep, SETTLEMENT_VERSION, JSON.stringify(inputs), hash, JSON.stringify(result.lines)])).message)
        .toBe('This settlement is approved and can’t change.');
      await as(tx, f.users.icA); // the employee sees it once approved
      expect((await tx.query<{ status: string }>('select status from fnf_settlements')).rows).toEqual([{ status: 'approved' }]);
      expect((await tx.query(`select 1 from notifications where kind = 'settlement.approved'`)).rows).toHaveLength(1);
      await as(tx, f.users.managerA);
      expect((await tx.query('select 1 from fnf_settlements')).rows).toHaveLength(0);
    });
  });

  it('a leaver whose settlement is still unpaid joins the next payroll run with no salary days', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      // The run is this month's; Ishan left at the end of last month, before it.
      const month = (await tx.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)), 'YYYY-MM-DD') as m`, [f.orgA])).rows[0]!.m;
      const exit = (await tx.query<{ d: string }>(`select ($1::date - interval '1 day')::date::text as d`, [month])).rows[0]!.d;
      const sep = await leaver(tx, exit, 'completed');
      await tx.query(`update employees set status = 'exited', date_of_exit = $2 where id = $1`, [f.employees.icA, exit]);
      await as(tx, f.users.payrollA);
      const { id, hash } = await prepare(tx, sep);
      await as(tx, f.users.ownerA);
      await tx.query('select approve_settlement($1, $2)', [id, hash]);

      await as(tx, f.users.payrollA);
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const inputs = (await tx.query<{ i: { employees: Array<{ employeeId: string; payableDays: number; adjustments: Array<{ code: string }> }> } }>(
        'select payroll_run_inputs($1) as i', [run])).rows[0]!.i;
      const ishan = inputs.employees.find((e) => e.employeeId === f.employees.icA)!;
      expect(ishan.payableDays).toBe(0);
      expect(ishan.adjustments.map((a) => a.code).sort()).toEqual(['FNF_GRATUITY', 'FNF_LEAVE']);
    });
  });

  it('cancelling the separation voids an approved settlement and takes back its unpaid adjustments', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const sep = await leaver(tx, '2026-12-31');
      await tx.query(`update employees set status = 'on_notice' where id = $1`, [f.employees.icA]);
      await as(tx, f.users.payrollA);
      const { id, hash } = await prepare(tx, sep);
      await as(tx, f.users.ownerA);
      await tx.query('select approve_settlement($1, $2)', [id, hash]);
      expect((await tx.query('select 1 from payroll_adjustments where settlement_id = $1', [id])).rows.length).toBeGreaterThan(0);
      await as(tx, f.users.hrA);
      await tx.query('select withdraw_separation($1)', [sep]);
      await tx.exec('reset role');
      expect((await tx.query('select 1 from payroll_adjustments where settlement_id = $1', [id])).rows).toHaveLength(0);
      expect((await tx.query<{ status: string }>('select status from fnf_settlements where id = $1', [id])).rows[0]!.status).toBe('voided');
    });
  });

  it('blocks when the separation isn’t approved', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const sep = await leaver(tx, '2026-12-31', 'submitted');
      await as(tx, f.users.payrollA);
      expect((await failure(tx, 'select settlement_inputs($1)', [sep])).message).toBe('A settlement is prepared once the separation is approved.');
    });
  });
});

describe('retention', () => {
  it('deletes each class of a leaver’s personal data once its period has passed, once, and logs it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update employees set status = 'exited', date_of_joining = '2015-01-01', date_of_exit = app.org_today($1) - interval '37 months' where id = $2`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into employee_personal (organization_id, employee_id, personal_email) values ($1, $2, 'ishan.home@example.test')`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into emergency_contacts (organization_id, employee_id, name, relationship, phone) values ($1, $2, 'Asha', 'Sister', '+919900000000')`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into restricted.employee_identity (organization_id, employee_id, pan) values ($1, $2, 'ABCPE1234F')`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into employee_personal (organization_id, employee_id, personal_email) values ($1, $2, 'pia.home@example.test')`, [f.orgA, f.employees.peerA]); // still employed

      const run = async () => {
        await tx.exec('set local role service_role');
        const r = (await tx.query<{ r: { actions: number; storagePaths: string[] } }>('select worker_retention() as r')).rows[0]!.r;
        await tx.exec('reset role');
        return r;
      };
      expect(await run()).toEqual({ actions: 3, storagePaths: [] }); // identity, bank, personal (documents keep 96 months)
      expect(await run()).toEqual({ actions: 0, storagePaths: [] });
      expect((await tx.query('select 1 from employee_personal where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      expect((await tx.query('select 1 from emergency_contacts where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      expect((await tx.query('select 1 from restricted.employee_identity where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      expect((await tx.query('select 1 from employee_personal where employee_id = $1', [f.employees.peerA])).rows).toHaveLength(1);
      expect((await tx.query<{ first_name: string }>('select first_name from employees where id = $1', [f.employees.icA])).rows).toEqual([{ first_name: 'Ishan' }]); // archive stays
      const log = (await tx.query<{ record_class: string; rows_removed: number }>('select record_class, rows_removed from retention_actions order by record_class')).rows;
      expect(log).toEqual([{ record_class: 'bank', rows_removed: 0 }, { record_class: 'identity', rows_removed: 1 }, { record_class: 'personal', rows_removed: 2 }]);

      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from retention_actions')).rows).toHaveLength(3);
      await tx.query(`update retention_policies set retain_months = 12 where organization_id = $1 and record_class = 'documents'`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from retention_actions')).rows).toHaveLength(0);
    });
  });
});
