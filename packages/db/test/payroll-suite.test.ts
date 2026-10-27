import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { canonicalJson, computePayslip, ENGINE_VERSION, resultsDigestSource, ruleSetSchema, type EmployeeInput } from '@peoplecore/payroll';
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

type Input = EmployeeInput & { onHold?: boolean; encashmentIds?: string[] };
interface Inputs { runId: string; month: string; ruleSet: { rules: unknown }; employees: Input[] }

async function compute(tx: Transaction, run: string) {
  const inputs = (await tx.query<{ i: Inputs }>('select payroll_run_inputs($1) as i', [run])).rows[0]!.i;
  const rules = ruleSetSchema.parse(inputs.ruleSet.rules);
  const results = inputs.employees.map((e) => ({ ...computePayslip(e, rules, { month: inputs.month }), input: e }));
  const hash = createHash('sha256').update(canonicalJson(inputs)).digest('hex');
  await tx.query('select store_payroll_results($1, $2, $3, $4)', [run, ENGINE_VERSION, hash, JSON.stringify(results)]);
  return { inputs, results, hash, digest: createHash('sha256').update(resultsDigestSource(results)).digest('hex') };
}

const monthOffset = async (tx: Transaction, org: string, months: number) =>
  (await tx.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)) + make_interval(months => $2), 'YYYY-MM-DD') as m`, [org, months])).rows[0]!.m;

/** Lines for a monthly gross from the org's general structure (40% basic, 40% of basic HRA, balance special). */
async function general(tx: Transaction, org: string, monthly: number) {
  const s = (await tx.query<{ id: string }>(`select id from salary_structures where organization_id = $1 and is_default`, [org])).rows[0]!.id;
  const c = (await tx.query<{ id: string; code: string }>('select id, code from salary_components where organization_id = $1', [org])).rows;
  const id = (code: string) => c.find((x) => x.code === code)!.id;
  const basic = Math.round(monthly * 0.4);
  const hra = Math.round(basic * 0.4);
  return { structure: s, lines: JSON.stringify([
    { component_id: id('BASIC'), monthly_amount: basic }, { component_id: id('HRA'), monthly_amount: hra },
    { component_id: id('SPECIAL'), monthly_amount: monthly - basic - hra }]) };
}

describe('payroll setup', () => {
  it('every organization gets settings and four structures; members read structures, only payroll staff read the bank settings', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const names = (await tx.query<{ name: string; pay_basis: string; is_default: boolean }>(
        'select name, pay_basis, is_default from salary_structures order by name')).rows;
      expect(names.map((n) => n.name)).toEqual(['Contractor Salary Structure', 'Daily Wage', 'General Salary Structure', 'Hourly Wage']);
      expect(names.find((n) => n.is_default)!.name).toBe('General Salary Structure');
      expect((await tx.query('select 1 from payroll_settings')).rows).toHaveLength(1);
      expect((await tx.query('select 1 from payroll_bank_settings')).rows).toHaveLength(0);
      expect((await tx.query('update payroll_settings set pay_day = 1 returning 1')).rows).toHaveLength(0); // RLS: payroll only
    });
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      expect((await tx.query('select 1 from payroll_bank_settings')).rows).toHaveLength(1);
      await tx.query(`update payroll_settings set pay_day = 28, default_regime = 'new' where organization_id = $1`, [f.orgA]);
      const lines = (await tx.query<{ code: string; calc: string; value: string }>(
        `select c.code, l.calc, l.value::int::text as value from salary_structure_lines l join salary_components c on c.id = l.component_id
          join salary_structures s on s.id = l.structure_id where s.is_default order by l.position`)).rows;
      expect(lines).toEqual([
        { code: 'BASIC', calc: 'percent_of_gross', value: '40' }, { code: 'HRA', calc: 'percent_of_basic', value: '40' },
        { code: 'LTA', calc: 'fixed', value: '0' }, { code: 'SPECIAL', calc: 'balance', value: '0' }]);
    });
  });
});

describe('salary assignment and revisions', () => {
  it('a first salary is assigned directly; a revision needs another approver’s sign-off and pays arrears for locked months', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const twoBack = await monthOffset(tx, f.orgA, -2);
      const lastMonth = await monthOffset(tx, f.orgA, -1);
      const first = await general(tx, f.orgA, 50000);
      await tx.query('select assign_salary($1, $2, $3, 600000, $4)', [f.employees.icA, '2025-01-01', first.structure, first.lines]);
      expect((await failure(tx, 'select assign_salary($1, $2, $3, 600000, $4)', [f.employees.icA, '2025-06-01', first.structure, first.lines])).message)
        .toBe('This employee already has a salary. Propose a salary revision instead.');
      expect((await tx.query<{ s: string }>('select structure_id::text as s from compensation_records where employee_id = $1', [f.employees.icA])).rows[0]!.s).toBe(first.structure);

      // Pay last month at the old salary and lock it.
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, lastMonth])).rows[0]!.id;
      const { hash, digest } = await compute(tx, run);
      await as(tx, f.users.ownerA);
      await tx.query('select approve_payroll_run($1, $2, $3)', [run, hash, digest]);
      await tx.query('select lock_payroll_run($1)', [run]);

      // Revision to 60,000 from two months ago: one locked month (last month) is owed 10,000 more, full month paid.
      await as(tx, f.users.payrollA);
      const raise = await general(tx, f.orgA, 60000);
      const rev = (await tx.query<{ id: string }>('select request_salary_revision($1, $2, $3, 720000, $4, $5) as id',
        [f.employees.icA, twoBack, raise.structure, raise.lines, 'Annual appraisal'])).rows[0]!.id;
      expect((await failure(tx, 'select request_salary_revision($1, $2, $3, 720000, $4, $5)', [f.employees.icA, twoBack, raise.structure, raise.lines, 'Again'])).message)
        .toBe('A revision for this employee is already waiting for sign-off.');
      expect((await failure(tx, 'select decide_salary_revision($1, true)', [rev])).message).toBe('You proposed this revision, so someone else must sign it off.');
      await as(tx, f.users.hrA);
      expect((await failure(tx, 'select decide_salary_revision($1, true)', [rev])).code).toBe('42501');
      expect((await tx.query('select 1 from salary_revisions')).rows).toHaveLength(0);

      await as(tx, f.users.ownerA);
      expect((await failure(tx, 'select decide_salary_revision($1, false)', [rev])).message).toBe('Give a reason for rejecting it.');
      await tx.query('select decide_salary_revision($1, true, $2)', [rev, 'Approved']);
      const after = (await tx.query<{ status: string; arrears: string }>('select status, arrears from salary_revisions where id = $1', [rev])).rows[0]!;
      expect(after).toEqual({ status: 'approved', arrears: '10000.00' });
      await as(tx, f.users.payrollA);
      const arrear = (await tx.query<{ amount: string; code: string }>(`select amount, code from payroll_adjustments where employee_id = $1 and applied_run_id is null`, [f.employees.icA])).rows;
      expect(arrear).toEqual([{ amount: '10000.00', code: 'ARREAR' }]);
      const records = (await tx.query<{ ctc: string; to: string | null }>(
        `select annual_ctc::int::text as ctc, to_char(effective_to, 'YYYY-MM-DD') as to from compensation_records where employee_id = $1 order by effective_from`, [f.employees.icA])).rows;
      expect(records.map((r) => r.ctc)).toEqual(['600000', '720000']);
      await as(tx, f.users.icA);
      expect((await tx.query(`select 1 from notifications where kind = 'payroll.revision'`)).rows).toHaveLength(1);
    });
  });
});

describe('run inputs', () => {
  it('LOP and TDS overrides change the inputs; held salaries become on-hold payouts; inputs freeze once approved', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = await monthOffset(tx, f.orgA, -1);
      const s = await general(tx, f.orgA, 50000);
      await tx.query('select assign_salary($1, $2, $3, 600000, $4)', [f.employees.icA, '2025-01-01', s.structure, s.lines]);
      await tx.query('select assign_salary($1, $2, $3, 600000, $4)', [f.employees.peerA, '2025-01-01', s.structure, s.lines]);
      await tx.query(`insert into payroll_employee_inputs (organization_id, period_month, employee_id, lop_days, tds_override) values ($1, $2, $3, 3, 1234)`,
        [f.orgA, month, f.employees.icA]);
      expect((await failure(tx, `insert into payroll_employee_inputs (organization_id, period_month, employee_id, on_hold) values ($1, $2, $3, true)`,
        [f.orgA, month, f.employees.peerA])).code).toBe('23514'); // a hold needs a reason
      await tx.query(`insert into payroll_employee_inputs (organization_id, period_month, employee_id, on_hold, hold_reason) values ($1, $2, $3, true, 'Exit formalities pending')`,
        [f.orgA, month, f.employees.peerA]);

      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const { inputs, results, hash, digest } = await compute(tx, run);
      const ic = inputs.employees.find((e) => e.employeeId === f.employees.icA)!;
      expect(ic.daysInPeriod - ic.payableDays).toBe(3);
      expect(ic.tdsOverride).toBe(1234);
      expect(results.find((r) => r.employeeId === f.employees.icA)!.lines.find((l) => l.code === 'TDS')!.amount).toBe(1234);
      expect(inputs.employees.find((e) => e.employeeId === f.employees.peerA)!.onHold).toBe(true);

      await as(tx, f.users.ownerA);
      await tx.query('select approve_payroll_run($1, $2, $3)', [run, hash, digest]);
      await as(tx, f.users.payrollA);
      expect((await failure(tx, `update payroll_employee_inputs set lop_days = 0 where employee_id = $1`, [f.employees.icA])).message)
        .toBe('This month’s payroll is already approved; its inputs can’t change.');
      await tx.query('select lock_payroll_run($1)', [run]);
      const payouts = (await tx.query<{ employee_id: string; status: string }>('select employee_id, status from payroll_payouts where run_id = $1', [run])).rows;
      expect(payouts.find((p) => p.employee_id === f.employees.peerA)!.status).toBe('on_hold');
      expect(payouts.find((p) => p.employee_id === f.employees.icA)!.status).toBe('pending');

      // Payouts: the approver marks them paid with a reference; the bank advice skips held and paid salaries.
      expect((await failure(tx, `select update_payouts($1, $2, 'paid')`, [run, [f.employees.icA]])).message).toBe('Enter the payment date.');
      const advice = (await tx.query<{ employee_code: string }>('select employee_code from payroll_bank_advice($1)', [run])).rows;
      expect(advice.map((a) => a.employee_code)).not.toContain('A-004');
      await tx.query(`select update_payouts($1, $2, 'paid', 'UTR123', current_date)`, [run, [f.employees.icA]]);
      expect((await tx.query('select 1 from payroll_bank_advice($1) where employee_code = $2', [run, 'A-003'])).rows).toHaveLength(0);
      await as(tx, f.users.icA);
      expect((await tx.query<{ status: string; reference: string }>('select status, reference from payroll_payouts')).rows).toEqual([{ status: 'paid', reference: 'UTR123' }]);
      expect((await failure(tx, `select update_payouts($1, $2, 'pending')`, [run, [f.employees.icA]])).code).toBe('42501');

      // Statutory rows: payroll staff only, and every download is in the export log.
      await as(tx, f.users.payrollA);
      const rows = (await tx.query<{ employee_code: string; pf_employee: string; pf_wages: string }>('select employee_code, pf_employee, pf_wages from payroll_statutory_rows($1, $2)', [run, 'pf_ecr'])).rows;
      expect(rows.find((r) => r.employee_code === 'A-003')).toMatchObject({ pf_employee: '1800.00', pf_wages: '15000.00' });
      expect((await failure(tx, 'select * from payroll_statutory_rows($1, $2)', [run, 'nope'])).message).toBe('Unknown report.');
      const log = (await tx.query<{ report: string }>('select report from payroll_export_log($1)', [f.orgA])).rows.map((r) => r.report);
      expect(log).toEqual(expect.arrayContaining(['pf_ecr', 'bank_advice']));
      await as(tx, f.users.hrA);
      expect((await failure(tx, 'select * from payroll_statutory_rows($1, $2)', [run, 'pf_ecr'])).code).toBe('42501');
      expect((await failure(tx, 'select * from payroll_readiness($1)', [f.orgA])).code).toBe('42501');
    });
  });

  it('approved leave encashments are paid at basic ÷ 30 a day and marked paid when the run locks', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = await monthOffset(tx, f.orgA, -1);
      const s = await general(tx, f.orgA, 75000); // basic 30,000 → 1,000 a day
      await tx.query('select assign_salary($1, $2, $3, 900000, $4)', [f.employees.icA, '2025-01-01', s.structure, s.lines]);
      await tx.exec('reset role');
      const type = (await tx.query<{ id: string }>(`select id from leave_types where organization_id = $1 order by code limit 1`, [f.orgA])).rows[0]!.id;
      const enc = (await tx.query<{ id: string }>(`insert into leave_encashments (organization_id, employee_id, leave_type_id, days, status, requested_by)
        values ($1, $2, $3, 2.5, 'approved', $4) returning id`, [f.orgA, f.employees.icA, type, f.users.icA])).rows[0]!.id;
      await as(tx, f.users.payrollA);
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const { results, hash, digest } = await compute(tx, run);
      expect(results.find((r) => r.employeeId === f.employees.icA)!.lines.find((l) => l.code === 'LEAVE_ENC')!.amount).toBe(2500);
      await as(tx, f.users.ownerA);
      await tx.query('select approve_payroll_run($1, $2, $3)', [run, hash, digest]);
      await tx.query('select lock_payroll_run($1)', [run]);
      await tx.exec('reset role');
      expect((await tx.query<{ r: string }>('select payroll_run_id as r from leave_encashments where id = $1', [enc])).rows[0]!.r).toBe(run);
    });
  });
});

describe('tax declarations', () => {
  it('the employee declares (old regime) while the window is open; payroll reviews; the run uses the approved amounts', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const month = await monthOffset(tx, f.orgA, 0);
      const fy = (await tx.query<{ fy: string }>(`select case when extract(month from $1::date) >= 4 then to_char($1::date, 'YYYY') || '-' || to_char($1::date + interval '1 year', 'YY')
        else to_char($1::date - interval '1 year', 'YYYY') || '-' || to_char($1::date, 'YY') end as fy`, [month])).rows[0]!.fy;
      const items = JSON.stringify([
        { section: 'hra', label: 'Rent', declared: 240000, details: { landlord: 'Example Landlord' } },
        { section: '80C', label: 'PPF', declared: 200000 },
        { section: 'prev_employer', label: 'Earlier employer', declared: 100000, tds: 5000 },
      ]);
      const id = (await tx.query<{ id: string }>('select save_tax_declaration($1, $2, $3, true, false, false, $4, true) as id', [f.orgA, fy, 'old', items])).rows[0]!.id;
      expect((await tx.query<{ status: string }>('select status from tax_declarations where id = $1', [id])).rows[0]!.status).toBe('submitted');
      expect((await failure(tx, 'select review_tax_declaration($1, true, $2)', [id, '[]'])).code).toBe('42501');

      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from tax_declaration_items')).rows).toHaveLength(0);
      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from tax_declarations')).rows).toHaveLength(0);

      await as(tx, f.users.payrollA);
      const its = (await tx.query<{ id: string; section: string }>('select id, section from tax_declaration_items where declaration_id = $1', [id])).rows;
      const ppf = its.find((i) => i.section === '80C')!.id;
      await tx.query('select review_tax_declaration($1, true, $2, $3)', [id, JSON.stringify([{ id: ppf, approved: 150000, note: 'Proof for 1.5 lakh' }]), 'Reviewed']);
      const s = await general(tx, f.orgA, 100000);
      await tx.query('select assign_salary($1, $2, $3, 1200000, $4)', [f.employees.icA, '2025-01-01', s.structure, s.lines]);
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const inputs = (await tx.query<{ i: Inputs }>('select payroll_run_inputs($1) as i', [run])).rows[0]!.i;
      expect(inputs.employees.find((e) => e.employeeId === f.employees.icA)!.declaration).toEqual({
        regime: 'old', metro: true, seniorSelf: false, seniorParents: false, rentPaidAnnual: 240000, sec80C: 150000, prevEmployerTaxable: 100000, prevEmployerTds: 5000 });

      // Closing the window stops changes.
      await tx.query('update payroll_settings set declaration_open = false where organization_id = $1', [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select save_tax_declaration($1, $2, $3, false, false, false, $4, false)', [f.orgA, fy, 'new', '[]'])).message)
        .toBe('The declaration window is closed. Ask payroll to reopen it.');
      expect((await tx.query(`select 1 from notifications where kind = 'payroll.declaration'`)).rows).toHaveLength(1);
    });
  });
});
