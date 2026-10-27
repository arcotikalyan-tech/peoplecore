import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { canonicalJson, computePayslip, ENGINE_VERSION, resultsDigestSource, ruleSetSchema, type EmployeeInput } from '@peoplecore/payroll';
import { pgError, useDatabase } from './setup.ts';

/** Kredily second pass, batch 1: directory access, company-change notices, closing the company, payroll settings, payouts. */
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

type Input = EmployeeInput & { penaltyDays?: number };
interface Inputs { runId: string; month: string; ruleSet: { rules: unknown }; employees: Input[] }

const inputsOf = async (tx: Transaction, run: string) => (await tx.query<{ i: Inputs }>('select payroll_run_inputs($1) as i', [run])).rows[0]!.i;

const monthOffset = async (tx: Transaction, org: string, months: number) =>
  (await tx.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)) + make_interval(months => $2), 'YYYY-MM-DD') as m`, [org, months])).rows[0]!.m;

async function salary(tx: Transaction, org: string, employee: string, monthly: number) {
  const s = (await tx.query<{ id: string }>(`select id from salary_structures where organization_id = $1 and is_default`, [org])).rows[0]!.id;
  const c = (await tx.query<{ id: string; code: string }>('select id, code from salary_components where organization_id = $1', [org])).rows;
  const id = (code: string) => c.find((x) => x.code === code)!.id;
  const basic = Math.round(monthly * 0.4);
  const hra = Math.round(basic * 0.4);
  const lines = JSON.stringify([{ component_id: id('BASIC'), monthly_amount: basic }, { component_id: id('HRA'), monthly_amount: hra },
    { component_id: id('SPECIAL'), monthly_amount: monthly - basic - hra }]);
  await tx.query('select assign_salary($1, $2, $3, $4, $5)', [employee, '2024-01-01', s, monthly * 12, lines]);
}

describe('directory access', () => {
  it('everyone, managers or HR only; people outside the audience see only themselves; birthdays without the year', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const count = async (user: string) => { await as(tx, user); return (await tx.query('select 1 from people_directory($1)', [f.orgA])).rows.length; };
      const everyone = await count(f.users.icA);
      expect(everyone).toBeGreaterThan(1);

      await as(tx, f.users.hrA);
      await tx.query(`update directory_settings set access = 'managers', show_birthday = true where organization_id = $1`, [f.orgA]);
      expect(await count(f.users.icA)).toBe(1);        // no reports: just themselves
      expect(await count(f.users.managerA)).toBe(everyone);
      expect(await count(f.users.hrA)).toBe(everyone);

      await as(tx, f.users.hrA);
      await tx.query(`update directory_settings set access = 'hr' where organization_id = $1`, [f.orgA]);
      expect(await count(f.users.managerA)).toBe(1);
      expect(await count(f.users.hrA)).toBe(everyone);

      await tx.exec('reset role');
      await tx.query(`insert into employee_personal (organization_id, employee_id, date_of_birth, marital_status) values ($1, $2, '1990-03-07', 'married')
                      on conflict (employee_id) do update set date_of_birth = excluded.date_of_birth, marital_status = excluded.marital_status`, [f.orgA, f.employees.peerA]);
      await tx.query(`update directory_settings set access = 'everyone' where organization_id = $1`, [f.orgA]);
      await as(tx, f.users.icA);
      const pia = (await tx.query<{ birthday: string | null; marital_status: string | null }>(
        'select birthday, marital_status from people_directory($1) where id = $2', [f.orgA, f.employees.peerA])).rows[0]!;
      expect(pia).toEqual({ birthday: '7 Mar', marital_status: null }); // marital status stays hidden until switched on
    });
  });
});

describe('company data changes', () => {
  it('when switched on, org.manage holders other than the editor are told once per 10 minutes', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      await tx.exec('reset role');
      await tx.query('insert into company_profiles (organization_id) values ($1) on conflict do nothing', [f.orgA]);
      await as(tx, f.users.ownerA);
      await tx.query(`update company_profiles set brand_name = 'Quiet' where organization_id = $1`, [f.orgA]);
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from notifications where kind = 'company.changed'`)).rows).toHaveLength(0); // off by default
      await as(tx, f.users.ownerA);
      await tx.query('update org_controls set notify_data_changes = true where organization_id = $1', [f.orgA]);
      await tx.query(`update company_profiles set brand_name = 'Acme' where organization_id = $1`, [f.orgA]);
      await tx.query(`update company_profiles set brand_name = 'Acme 2' where organization_id = $1`, [f.orgA]);
      await tx.exec('reset role');
      const told = (await tx.query<{ user_id: string }>(`select user_id from notifications where kind = 'company.changed'`)).rows.map((r) => r.user_id);
      expect(told).toContain(f.users.hrA);
      expect(told).not.toContain(f.users.ownerA);
      expect(new Set(told).size).toBe(told.length); // the second change within 10 minutes adds nothing
    });
  });
});

describe('closing the company', () => {
  it('owners only, with the exact name; 30 days to cancel; the worker archives it on the day', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) => tx.query('select request_org_closure($1, $2)', [f.orgA, 'x'])))).toBe('42501');
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      const name = (await tx.query<{ name: string }>('select name from organizations where id = $1', [f.orgA])).rows[0]!.name;
      expect((await failure(tx, 'select request_org_closure($1, $2)', [f.orgA, name])).message).toBe('The demo company can’t be closed.');
      await tx.exec('reset role');
      await tx.query('update organizations set is_demo = false where id = $1', [f.orgA]);
      await as(tx, f.users.ownerA);
      expect((await failure(tx, 'select request_org_closure($1, $2)', [f.orgA, name.toUpperCase() + '!'])).code).toBe('22023');
      const on = (await tx.query<{ d: string }>('select request_org_closure($1, $2)::text as d', [f.orgA, name])).rows[0]!.d;
      const expected = (await tx.query<{ d: string }>('select (app.org_today($1) + 30)::text as d', [f.orgA])).rows[0]!.d;
      expect(on).toBe(expected);
      await tx.query('select cancel_org_closure($1)', [f.orgA]);
      expect((await tx.query<{ c: string | null }>('select closes_on::text as c from organizations where id = $1', [f.orgA])).rows[0]!.c).toBeNull();

      await tx.query('select request_org_closure($1, $2)', [f.orgA, name]);
      await tx.exec('reset role');
      expect((await tx.query<{ r: { closed: number } }>('select worker_close_organizations() as r')).rows[0]!.r.closed).toBe(0);
      await tx.query('update organizations set closes_on = app.org_today(id) where id = $1', [f.orgA]);
      expect((await tx.query<{ r: { closed: number } }>('select worker_close_organizations() as r')).rows[0]!.r.closed).toBe(1);
      expect((await tx.query<{ s: string }>('select status::text as s from organizations where id = $1', [f.orgA])).rows[0]!.s).toBe('archived');
    });
  });
});

describe('payroll settings', () => {
  it('pay-day basis: a fixed 30, or working days only; the defaults leave the inputs as they were', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = await monthOffset(tx, f.orgA, -1);
      await salary(tx, f.orgA, f.employees.icA, 60000);
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const ic = async () => (await inputsOf(tx, run)).employees.find((e) => e.employeeId === f.employees.icA)!;
      const calendarDays = (await tx.query<{ n: number }>(`select extract(day from ($1::date + interval '1 month - 1 day'))::int as n`, [month])).rows[0]!.n;
      expect((await ic()).daysInPeriod).toBe(calendarDays);

      await tx.query(`update payroll_settings set pay_days_basis = 'fixed_30' where organization_id = $1`, [f.orgA]);
      expect([(await ic()).daysInPeriod, (await ic()).payableDays]).toEqual([30, 30]);

      await tx.query(`update payroll_settings set pay_days_basis = 'working', holidays_paid = true where organization_id = $1`, [f.orgA]);
      await tx.exec('reset role');
      const working = (await tx.query<{ n: number }>(
        `select count(*)::int as n from generate_series($1::date, $1::date + interval '1 month - 1 day', interval '1 day') d where app.is_pay_day($2, d::date, true)`,
        [month, f.employees.icA])).rows[0]!.n;
      await as(tx, f.users.payrollA);
      const w = await ic();
      expect(w.daysInPeriod).toBe(working);
      expect(working).toBeLessThan(calendarDays); // weekly offs aren't pay days
    });
  });

  it('approved overtime is paid at the multiple of the hourly rate, as an ESI wage only when switched on', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = await monthOffset(tx, f.orgA, -1);
      await salary(tx, f.orgA, f.employees.icA, 48000);
      await tx.exec('reset role');
      await tx.query(`insert into overtime_records (organization_id, employee_id, work_date, minutes, status) values ($1, $2, $3::date + 3, 120, 'approved')`,
        [f.orgA, f.employees.icA, month]);
      await as(tx, f.users.payrollA);
      await tx.query(`update payroll_settings set pay_days_basis = 'fixed_30', overtime_multiplier = 2 where organization_id = $1`, [f.orgA]);
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const adj = (await inputsOf(tx, run)).employees.find((e) => e.employeeId === f.employees.icA)!.adjustments!;
      // 48,000 ÷ 30 days ÷ 8 h = 200 an hour; 2 h at 2× = 800.
      expect(adj.find((a) => a.code === 'OT')).toMatchObject({ amount: 800, taxable: true, esiWage: false });
      await tx.query('update payroll_settings set overtime_in_esi = true where organization_id = $1', [f.orgA]);
      expect((await inputsOf(tx, run)).employees.find((e) => e.employeeId === f.employees.icA)!.adjustments!.find((a) => a.code === 'OT')!.esiWage).toBe(true);
    });
  });

  it('a joiner after the cut-off day is left out of that month and paid joining arrears the next', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const last = await monthOffset(tx, f.orgA, -1);
      const thisMonth = await monthOffset(tx, f.orgA, 0);
      await tx.exec('reset role');
      await tx.query(`update employees set date_of_joining = $2::date + 24 where id = $1`, [f.employees.peerA, last]);
      await as(tx, f.users.payrollA);
      await salary(tx, f.orgA, f.employees.peerA, 31000);
      await tx.exec('reset role');
      await tx.query(`update compensation_records set effective_from = $2::date + 24 where employee_id = $1`, [f.employees.peerA, last]);
      await as(tx, f.users.payrollA);
      await tx.query('update payroll_settings set joiner_cutoff_day = 20 where organization_id = $1', [f.orgA]);
      const runLast = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, last])).rows[0]!.id;
      expect((await inputsOf(tx, runLast)).employees.some((e) => e.employeeId === f.employees.peerA)).toBe(false);
      const runNow = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, thisMonth])).rows[0]!.id;
      const arrears = (await inputsOf(tx, runNow)).employees.find((e) => e.employeeId === f.employees.peerA)!.adjustments!.find((a) => a.code === 'JOIN_ARREARS')!;
      const days = (await tx.query<{ n: number }>(`select extract(day from ($1::date + interval '1 month - 1 day'))::int as n`, [last])).rows[0]!.n;
      expect(arrears.amount).toBe(Math.round((31000 * (days - 24)) / days));
    });
  });
});

describe('payouts', () => {
  it('cheque and cash payouts stay out of the bank advice; statuses with a UTR per employee import in bulk', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = await monthOffset(tx, f.orgA, -1);
      await salary(tx, f.orgA, f.employees.icA, 40000);
      await salary(tx, f.orgA, f.employees.peerA, 40000);
      const run = (await tx.query<{ id: string }>('select create_payroll_run($1, $2) as id', [f.orgA, month])).rows[0]!.id;
      const inputs = await inputsOf(tx, run);
      const rules = ruleSetSchema.parse(inputs.ruleSet.rules);
      const results = inputs.employees.map((e) => ({ ...computePayslip(e, rules, { month: inputs.month }), input: e }));
      const hash = createHash('sha256').update(canonicalJson(inputs)).digest('hex');
      await tx.query('select store_payroll_results($1, $2, $3, $4)', [run, ENGINE_VERSION, hash, JSON.stringify(results)]);
      await as(tx, f.users.ownerA);
      await tx.query('select approve_payroll_run($1, $2, $3)', [run, hash, createHash('sha256').update(resultsDigestSource(results)).digest('hex')]);
      await tx.query('select lock_payroll_run($1)', [run]);

      expect((await tx.query<{ n: number }>(`select set_payout_mode($1, $2, 'cash') as n`, [run, [f.employees.peerA]])).rows[0]!.n).toBe(1);
      const code = async (id: string) => (await tx.query<{ c: string }>('select employee_code as c from employees where id = $1', [id])).rows[0]!.c;
      const icCode = await code(f.employees.icA);
      const codes = (await tx.query<{ employee_code: string }>('select employee_code from payroll_bank_advice($1)', [run])).rows.map((r) => r.employee_code);
      expect(codes).toContain(icCode);
      expect(codes).not.toContain(await code(f.employees.peerA));

      const r = (await tx.query<{ r: { updated: number; skipped: string[] } }>('select import_payout_statuses($1, $2) as r', [run, JSON.stringify([
        { code: icCode, status: 'paid', reference: 'UTR123456', paid_on: month },
        { code: 'NOPE', status: 'paid', reference: 'X', paid_on: month },
        { code: icCode, status: 'paid', reference: 'again', paid_on: month },   // already paid: skipped
      ])])).rows[0]!.r;
      expect(r).toEqual({ updated: 1, skipped: ['NOPE', icCode] });
      expect((await tx.query<{ reference: string }>('select reference from payroll_payouts where run_id = $1 and employee_id = $2', [run, f.employees.icA])).rows[0]!.reference).toBe('UTR123456');
      await as(tx, f.users.hrA);
      expect((await failure(tx, 'select import_payout_statuses($1, $2)', [run, '[]'])).code).toBe('42501');
    });
  });
});
