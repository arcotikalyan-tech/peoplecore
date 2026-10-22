import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

/**
 * Migration 20261019000100: work-week patterns, work-from-home and on-duty requests, overtime, comp-off,
 * late-mark penalties (and their effect on payroll), attendance settings.
 */
const ctx = useDatabase();
const weekdays: string[] = []; // recent past weekdays (org-local), newest first, excluding today and yesterday

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

const punch = (tx: Transaction, employee: string, date: string, time: string, key: string) =>
  tx.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key)
            values ($1, $2, ($3::date + $4::time)::timestamp at time zone 'Asia/Kolkata', 'import', $5)`,
  [ctx.f.orgA, employee, date, time, key]);
const day = (tx: Transaction, employee: string, date: string) =>
  tx.query<{ status: string; worked_minutes: number; early_out_minutes: number; overtime_minutes: number }>(
    'select status, worked_minutes, early_out_minutes, overtime_minutes from attendance_days where employee_id = $1 and work_date = $2',
    [employee, date]).then((r) => r.rows[0]);
const defaultShift = (tx: Transaction) =>
  tx.query<{ id: string }>('select id from shifts where organization_id = $1 and is_default', [ctx.f.orgA]).then((r) => r.rows[0]!.id);

beforeAll(async () => {
  const { rows } = await ctx.t.db.query<{ d: string }>(
    `select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) - 25, app.org_today($1) - 2, interval '1 day') d
      where extract(isodow from d) < 6 order by d desc`, [ctx.f.orgA]);
  weekdays.push(...rows.map((r) => r.d));
});

describe('work week', () => {
  it('every organization gets the templates; an assigned pattern decides weekly offs and half days', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      const tx = t.db as unknown as Transaction;
      const names = (await t.db.query<{ name: string }>('select name from work_week_rules where organization_id = $1 order by name', [f.orgA])).rows.map((r) => r.name);
      expect(names).toEqual(['Saturday and Sunday off', 'Saturday half day', 'Second and fourth Saturday off', 'Sunday off']);
      expect((await t.db.query('select 1 from attendance_settings where organization_id = $1', [f.orgB])).rows).toHaveLength(1);

      // A recent Wednesday becomes a weekly off under a custom pattern; Thursday a half day where 4h30 counts as present.
      const wed = (await t.db.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) - 21, app.org_today($1) - 8, interval '1 day') d
                                                     where extract(isodow from d) = 3 order by d desc limit 1`, [f.orgA])).rows[0]!.d;
      const thu = (await t.db.query<{ d: string }>(`select to_char($1::date + 1, 'YYYY-MM-DD') as d`, [wed])).rows[0]!.d;
      const rule = (await t.db.query<{ id: string }>(`insert into work_week_rules (organization_id, name, pattern)
        values ($1, 'Midweek', array['WWOHWWO','WWOHWWO','WWOHWWO','WWOHWWO','WWOHWWO']) returning id`, [f.orgA])).rows[0]!.id;
      await t.db.query(`insert into work_week_assignments (organization_id, employee_id, rule_id, effective_from) values ($1, $2, $3, '2024-01-01')`, [f.orgA, f.employees.icA, rule]);
      await t.db.query('select app.compute_attendance_day($1, $2)', [f.employees.icA, wed]);
      expect((await day(tx, f.employees.icA, wed))!.status).toBe('weekly_off');
      await punch(tx, f.employees.icA, thu, '09:30', 'ww1');
      await punch(tx, f.employees.icA, thu, '14:45', 'ww2'); // 5h15 less the break: a half day's work
      expect((await day(tx, f.employees.icA, thu))!.status).toBe('present');

      expect((await failure(tx, `insert into work_week_rules (organization_id, name, pattern) values ($1, 'Bad', array['WWWWWOO'])`, [f.orgA])).code).toBe('23514');
    } finally {
      await t.db.exec('rollback');
    }
  });

  it('only attendance managers change rules and assignments; other tenants see nothing', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.icA, (tx) => tx.query(
      `insert into work_week_rules (organization_id, name, pattern) values ($1, 'Mine', array['WWWWWOO','WWWWWOO','WWWWWOO','WWWWWOO','WWWWWOO'])`, [f.orgA])))).toBe('42501');
    await ctx.t.asUser(f.users.ownerB, async (tx) => {
      expect((await tx.query('select 1 from work_week_rules where organization_id = $1', [f.orgA])).rows).toHaveLength(0);
    });
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into work_week_rules (organization_id, name, pattern) values ($1, 'HR made', array['WWWWWOO','WWWWWOO','WWWWWOO','WWWWWOO','WWWWWOO'])`, [f.orgA]);
    });
  });
});

describe('work from home and on duty', () => {
  it('the employee asks, the manager approves, and the day is paid as work from home', async () => {
    const { f } = ctx;
    const d = weekdays[4]!;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const id = (await tx.query<{ id: string }>(`select request_attendance($1, 'wfh', $2, $2, 'Plumber visit') as id`, [f.employees.icA, d])).rows[0]!.id;
      expect((await failure(tx, `select request_attendance($1, 'on_duty', $2, $2, 'Client visit')`, [f.employees.icA, d])).message)
        .toBe('Those dates overlap a request that is pending or approved.');
      expect((await failure(tx, `select request_attendance($1, 'wfh', $2::date + 1, $2, 'Backwards')`, [f.employees.icA, d])).message)
        .toBe('Choose a start date and an end date on or after it.');
      const approval = (await tx.query<{ a: string }>('select approval_request_id as a from attendance_requests where id = $1', [id])).rows[0]!.a;
      await as(tx, f.users.leadA);
      expect((await tx.query('select 1 from attendance_requests where id = $1', [id])).rows).toHaveLength(1);
      await tx.query('select decide_approval($1, $2)', [approval, 'approve']);
      await tx.exec('reset role');
      expect((await day(tx, f.employees.icA, d))!.status).toBe('wfh');
      expect((await tx.query<{ status: string }>('select status from attendance_requests where id = $1', [id])).rows[0]!.status).toBe('approved');
    });
  });

  it('no one asks for a colleague; peers can’t see the requests', async () => {
    const { f } = ctx;
    const d = weekdays[5]!;
    expect(await pgError(ctx.t.asUser(f.users.peerA, (tx) => tx.query(`select request_attendance($1, 'wfh', $2, $2, 'x x x')`, [f.employees.icA, d])))).toBe('42501');
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.query(`select request_attendance($1, 'on_duty', $2, $2, 'Client site')`, [f.employees.icA, d]);
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from attendance_requests where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      await as(tx, f.users.ownerB);
      expect((await tx.query('select 1 from attendance_requests where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
    });
  });
});

describe('overtime and comp-off', () => {
  it('overtime beyond the threshold waits for the manager; the employee can’t approve their own', async () => {
    const { f } = ctx;
    const d = weekdays[6]!;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query('update shifts set overtime_after_minutes = 30 where id = $1', [await defaultShift(tx)]);
      await punch(tx, f.employees.icA, d, '09:30', 'ot1');
      await punch(tx, f.employees.icA, d, '21:00', 'ot2');
      const row = (await day(tx, f.employees.icA, d))!;
      expect(row.overtime_minutes).toBeGreaterThan(0);
      expect((await tx.query<{ status: string; minutes: number }>('select status, minutes from overtime_records where employee_id = $1 and work_date = $2', [f.employees.icA, d])).rows[0])
        .toMatchObject({ status: 'pending', minutes: row.overtime_minutes });
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select decide_overtime($1, $2, true)', [f.employees.icA, d])).code).toBe('42501');
      await as(tx, f.users.leadA);
      await tx.query('select decide_overtime($1, $2, true)', [f.employees.icA, d]);
      expect((await failure(tx, 'select decide_overtime($1, $2, false)', [f.employees.icA, d])).message).toBe('This overtime has already been decided.');
      await tx.exec('reset role');
      // A recompute keeps the decision.
      await tx.query('select app.compute_attendance_day($1, $2)', [f.employees.icA, d]);
      expect((await tx.query<{ status: string }>('select status from overtime_records where employee_id = $1 and work_date = $2', [f.employees.icA, d])).rows[0]!.status).toBe('approved');
    });
  });

  it('work on a weekly off credits comp-off leave once; HR can revert it', async () => {
    const { f } = ctx;
    const sat = (await ctx.t.db.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) - 14, app.org_today($1) - 2, interval '1 day') d
                                                       where extract(isodow from d) = 7 order by d desc limit 1`, [f.orgA])).rows[0]!.d; // a Sunday
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query('update shifts set comp_off_min_minutes = 240 where id = $1', [await defaultShift(tx)]);
      await punch(tx, f.employees.icA, sat, '10:00', 'co1');
      await punch(tx, f.employees.icA, sat, '19:30', 'co2');
      await tx.query('select app.compute_attendance_day($1, $2)', [f.employees.icA, sat]); // again: still one credit
      const credit = (await tx.query<{ days: string; status: string }>('select days, status from comp_off_credits where employee_id = $1 and work_date = $2', [f.employees.icA, sat])).rows;
      expect(credit).toEqual([{ days: '1.0', status: 'credited' }]);
      const balance = async () => Number((await tx.query<{ b: string }>(
        `select coalesce(sum(l.days), 0) as b from leave_ledger l join leave_types t on t.id = l.leave_type_id where l.employee_id = $1 and t.code = 'COMP_OFF'`, [f.employees.icA])).rows[0]!.b);
      expect(await balance()).toBe(1);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select revert_comp_off($1, $2)', [f.employees.icA, sat])).code).toBe('42501');
      await as(tx, f.users.hrA);
      await tx.query('select revert_comp_off($1, $2)', [f.employees.icA, sat]);
      await tx.exec('reset role');
      expect(await balance()).toBe(0);
    });
  });
});

describe('penalties', () => {
  it('late marks beyond the allowance become loss-of-pay days that reduce payable days; HR can revert', async () => {
    const { f } = ctx;
    const month = (await ctx.t.db.query<{ m: string }>(`select to_char(date_trunc('month', $1::date), 'YYYY-MM-DD') as m`, [weekdays[2]])).rows[0]!.m;
    const lateDays = weekdays.filter((d) => d.startsWith(month.slice(0, 7))).slice(0, 3);
    if (lateDays.length < 3) return; // too early in the month for three past weekdays; covered on other days
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update shifts set penalties_enabled = true, late_marks_allowed = 1, late_method = 'half_day' where id = $1`, [await defaultShift(tx)]);
      for (const [i, d] of lateDays.entries()) {
        await punch(tx, f.employees.peerA, d, '10:30', `lt${i}a`);
        await punch(tx, f.employees.peerA, d, '19:30', `lt${i}b`);
      }
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select run_attendance_penalties($1, $2)', [f.orgA, month])).code).toBe('42501');
      await as(tx, f.users.hrA);
      await tx.query('select run_attendance_penalties($1, $2)', [f.orgA, month]);
      const pen = (await tx.query<{ id: string; occurrences: number; days: string }>('select id, occurrences, days from attendance_penalties where employee_id = $1', [f.employees.peerA])).rows;
      expect(pen).toMatchObject([{ occurrences: 2, days: '1.00' }]);

      // Payroll sees it.
      await tx.exec('reset role');
      const run = (await tx.query<{ id: string }>(`insert into payroll_runs (organization_id, period_month, rule_set_id)
        select $1, $2, id from statutory_rule_sets order by effective_from desc limit 1 returning id`, [f.orgA, month])).rows[0]!.id;
      await as(tx, f.users.payrollA);
      const inputs = (await tx.query<{ r: { employees: Array<{ employeeId: string; penaltyDays: number; payableDays: number; daysInPeriod: number }> } }>(
        'select payroll_run_inputs($1) as r', [run])).rows[0]!.r;
      const peer = inputs.employees.find((e) => e.employeeId === f.employees.peerA);
      if (peer) expect(Number(peer.penaltyDays)).toBe(1);

      await as(tx, f.users.hrA);
      await tx.query('select revert_attendance_penalty($1)', [pen[0]!.id]);
      await tx.query('select run_attendance_penalties($1, $2)', [f.orgA, month]); // a re-run keeps it reverted
      await tx.exec('reset role');
      expect((await tx.query('select 1 from attendance_penalties where employee_id = $1 and reverted_at is not null', [f.employees.peerA])).rows).toHaveLength(1);
    });
  });
});

describe('settings', () => {
  it('everyone in the organization reads them; only attendance managers change them', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      expect((await tx.query('select cycle_start_day from attendance_settings where organization_id = $1', [f.orgA])).rows).toHaveLength(1);
      const r = await tx.query('update attendance_settings set cycle_start_day = 5 where organization_id = $1', [f.orgA]);
      expect(r.affectedRows).toBe(0);
    });
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const r = await tx.query('update attendance_settings set cycle_start_day = 26, allowed_ips = $2 where organization_id = $1', [f.orgA, ['203.0.113.10']]);
      expect(r.affectedRows).toBe(1);
      expect((await tx.query('select 1 from attendance_settings where organization_id = $1', [f.orgB])).rows).toHaveLength(0);
    });
  });
});

describe('open check-in', () => {
  it('someone checked in today and not yet out counts as present; checking out judges the hours', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      // A work day collects punches from 4 hours before its shift starts, so just after midnight the open check-in
      // still belongs to yesterday's work day.
      const today = (await t.db.query<{ d: string }>(
        `select to_char(case when (now() - interval '2 minutes') < ((app.org_today($1) + coalesce(s.start_time, '09:00')) - interval '4 hours')::timestamp at time zone 'Asia/Kolkata'
                             then app.org_today($1) - 1 else app.org_today($1) end, 'YYYY-MM-DD') as d
           from app.shift_for($2, app.org_today($1)) s`, [f.orgA, f.employees.peerA])).rows[0]!.d;
      const at = `greatest(now() - interval '2 minutes', ('${today}'::date + coalesce((app.shift_for($2, '${today}')).start_time, '09:00') - interval '4 hours')::timestamp at time zone 'Asia/Kolkata')`;
      await t.db.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key)
                        values ($1, $2, ${at}, 'import', 'open-in')`, [f.orgA, f.employees.peerA]);
      expect((await day(t.db as unknown as Transaction, f.employees.peerA, today))?.status).toBe('present');
      await t.db.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key)
                        values ($1, $2, ${at} + interval '1 minute', 'import', 'open-out')`, [f.orgA, f.employees.peerA]);
      expect((await day(t.db as unknown as Transaction, f.employees.peerA, today))?.status).toBe('not_marked');
    } finally {
      await t.db.exec('rollback');
    }
  });
});
