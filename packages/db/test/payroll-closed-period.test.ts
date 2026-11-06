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

async function failure(tx: Transaction, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint expect_failure');
  try {
    await tx.query(sql, params);
  } catch (err) {
    await tx.exec('rollback to savepoint expect_failure');
    return (err as Error).message;
  }
  await tx.exec('release savepoint expect_failure');
  throw new Error(`expected this to fail: ${sql}`);
}

/** A run for the month holding this day, paying these people, as it would be once decided. */
async function decidedRun(tx: Transaction, org: string, day: string, status: string, people: string[]) {
  await tx.exec('reset role');
  const run = (await tx.query<{ id: string; m: string }>(
    `insert into payroll_runs (organization_id, period_month, status, rule_set_id)
     select $1, date_trunc('month', $2::date)::date, 'computed', id from statutory_rule_sets limit 1 returning id, period_month::text as m`, [org, day])).rows[0]!;
  for (const e of people) {
    await tx.query(
      `insert into payroll_run_employees (organization_id, run_id, employee_id, period_month, input, payable_days, lop_days, gross, deductions, net, employer_cost, taxable)
       values ($1, $2, $3, $4, '{}', 30, 0, 1000, 0, 1000, 1000, 1000)`, [org, run.id, e, run.m]);
  }
  await tx.query('update payroll_runs set status = $2::payroll_status where id = $1', [run.id, status]);
  return run.id;
}

describe('attendance and leave after payroll is decided', () => {
  it('a correction is refused, for the people that run paid; someone it left out can still correct the day', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const day = (await tx.query<{ d: string }>(`select (current_date - 20)::text as d`)).rows[0]!.d;
      await decidedRun(tx, f.orgA, day, 'locked', [f.employees.icA]);

      await as(tx, f.users.icA);
      const fix = `select request_regularization($1, $2, '09:30', '18:00', 'Forgot to punch')`;
      const said = await failure(tx, fix, [f.employees.icA, day]);
      expect(said).toMatch(/^Payroll for \w+ \d{4} is already approved, so these days can't change\./);
      expect(await failure(tx, `select request_attendance($1, 'wfh', $2, $2, 'Worked from home')`, [f.employees.icA, day])).toContain('Payroll for');

      await as(tx, f.users.peerA);
      expect((await tx.query<{ id: string }>(fix.replace('$1', '$1::uuid') + ' as id', [f.employees.peerA, day])).rows[0]!.id).toBeTruthy();
    });
  });

  it('one waiting when the run was decided can’t be approved any more, but can be rejected', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const day = (await tx.query<{ d: string }>(`select (current_date - 20)::text as d`)).rows[0]!.d;
      await as(tx, f.users.icA);
      const id = (await tx.query<{ id: string }>(`select request_regularization($1, $2, '09:30', '18:00', 'Forgot to punch') as id`, [f.employees.icA, day])).rows[0]!.id;
      const approval = (await tx.query<{ a: string }>('select approval_request_id as a from regularization_requests where id = $1', [id])).rows[0]!.a;
      await decidedRun(tx, f.orgA, day, 'approved', [f.employees.icA]);

      await as(tx, f.users.leadA);
      expect(await failure(tx, `select decide_approval($1, 'approve')`, [approval])).toContain('Payroll for');
      await tx.exec('reset role');
      expect((await tx.query<{ status: string }>('select status from regularization_requests where id = $1', [id])).rows[0]!.status).toBe('pending');
      expect((await tx.query('select 1 from attendance_punches where employee_id = $1 and method = $2', [f.employees.icA, 'regularization'])).rows).toHaveLength(0);

      await as(tx, f.users.leadA);
      await tx.query(`select decide_approval($1, 'reject', 'Payroll is closed')`, [approval]);
      await tx.exec('reset role');
      expect((await tx.query<{ status: string }>('select status from regularization_requests where id = $1', [id])).rows[0]!.status).toBe('rejected');
    });
  });

  it('leave: new requests are refused, approved ones can’t be cancelled, pending ones can', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      // Three days of one month, so one request each.
      const [first, second, third] = (await tx.query<{ d: string }>(
        `select (date_trunc('month', current_date - 40)::date + n)::text as d from generate_series(1, 3) n order by n`)).rows.map((r) => r.d);
      const type = (await tx.query<{ id: string }>(
        `insert into leave_types (organization_id, code, name) values ($1, 'TST', 'Test leave') returning id`, [f.orgA])).rows[0]!.id;
      const leave = async (day: string, status: string) => (await tx.query<{ id: string }>(
        `insert into leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, days, status, requested_by)
         values ($1, $2, $3, $4, $4, 1, $5::leave_status, $6) returning id`, [f.orgA, f.employees.icA, type, day, status, f.users.hrA])).rows[0]!.id;
      const taken = await leave(first!, 'approved');
      const waiting = await leave(second!, 'pending');
      await decidedRun(tx, f.orgA, first!, 'locked', [f.employees.icA]);

      expect(await failure(tx, `insert into leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, days, requested_by)
        values ($1, $2, $3, $4, $4, 1, $5)`, [f.orgA, f.employees.icA, type, third, f.users.hrA])).toContain('Payroll for');
      await as(tx, f.users.hrA);
      expect(await failure(tx, 'select cancel_leave($1)', [taken])).toContain('Payroll for');
      await tx.query('select cancel_leave($1)', [waiting]);
    });
  });

  it('the inputs cycle decides which days a run covers; a draft or a cancelled run closes nothing', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const closed = async (d: string) => (await tx.query<{ m: string | null }>('select app.payroll_closed_month($1, $2, $2)::text as m', [f.employees.icA, d])).rows[0]!.m;
      await decidedRun(tx, f.orgA, '2026-03-15', 'locked', [f.employees.icA]);
      expect(await closed('2026-03-01')).toBe('2026-03-01');
      expect(await closed('2026-03-31')).toBe('2026-03-01');
      expect(await closed('2026-04-01')).toBeNull();

      await tx.query('update payroll_settings set input_cycle_start_day = 26 where organization_id = $1', [f.orgA]);
      expect(await closed('2026-02-26')).toBe('2026-03-01');
      expect(await closed('2026-03-25')).toBe('2026-03-01');
      expect(await closed('2026-02-25')).toBeNull();
      expect(await closed('2026-03-26')).toBeNull();

      // Approved closes the period; cancelling the run opens it again. A run still being worked on closes nothing.
      const approved = await decidedRun(tx, f.orgA, '2026-05-15', 'approved', [f.employees.icA]);
      expect(await closed('2026-05-10')).toBe('2026-05-01');
      await tx.query(`update payroll_runs set status = 'cancelled' where id = $1`, [approved]);
      expect(await closed('2026-05-10')).toBeNull();
      await decidedRun(tx, f.orgA, '2026-07-15', 'computed', [f.employees.icA]);
      expect(await closed('2026-07-10')).toBeNull();
    });
  });
});
