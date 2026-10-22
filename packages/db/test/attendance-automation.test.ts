import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/**
 * Migration 20261021000600 (Kredily second pass, batch 2): penalty rules with an allowance, an interval, a method and
 * a leave ladder; automatic deduction of absent days (and payroll not counting them twice); rule effective dates;
 * rectangle and polygon zones; comp-off approval; regularization limits; automatic clock-in/out; the daily summary
 * and punch reminders; saved views; one attendance cycle shared with payroll.
 */
const ctx = useDatabase();
let cycleMonth = '';          // the previous month: a cycle that has ended
const prevWeekdays: string[] = [];
const prevSaturdays: string[] = [];

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

let seq = 0;
const punch = (tx: Transaction, employee: string, date: string, time: string) =>
  tx.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key)
            values ($1, $2, ($3::date + $4::time)::timestamp at time zone 'Asia/Kolkata', 'import', $5)`,
  [ctx.f.orgA, employee, date, time, `aa-${++seq}`]);
const defaultShift = (tx: Transaction) =>
  tx.query<{ id: string }>('select id from shifts where organization_id = $1 and is_default', [ctx.f.orgA]).then((r) => r.rows[0]!.id);
const leaveType = (tx: Transaction, code: string) =>
  tx.query<{ id: string }>('select id from leave_types where organization_id = $1 and code = $2', [ctx.f.orgA, code]).then((r) => r.rows[0]!.id);
const balance = (tx: Transaction, employee: string, type: string) =>
  tx.query<{ b: string }>('select coalesce(sum(days), 0)::text as b from leave_ledger where employee_id = $1 and leave_type_id = $2', [employee, type])
    .then((r) => Number(r.rows[0]!.b));
const penalties = (tx: Transaction, employee: string) =>
  tx.query<{ id: string; kind: string; total: string; lop: string; split: Array<{ days: number }>; reverted: boolean; occurrences: number }>(
    `select id, kind, total_days::text as total, days::text as lop, leave_split as split, reverted_at is not null as reverted, occurrences
       from attendance_penalties where employee_id = $1 and cycle_month = $2 order by kind`, [employee, cycleMonth]).then((r) => r.rows);
const runInputs = async (tx: Transaction, lopFromAbsence: boolean) => {
  await tx.exec('reset role');
  const existing = (await tx.query<{ id: string }>(`update payroll_runs set lop_from_absence = $3 where organization_id = $1 and period_month = $2 and status <> 'cancelled' returning id`,
    [ctx.f.orgA, cycleMonth, lopFromAbsence])).rows[0]?.id;
  const run = existing ?? (await tx.query<{ id: string }>(`insert into payroll_runs (organization_id, period_month, rule_set_id, lop_from_absence)
    select $1, $2, id, $3 from statutory_rule_sets order by effective_from desc limit 1 returning id`, [ctx.f.orgA, cycleMonth, lopFromAbsence])).rows[0]!.id;
  await as(tx, ctx.f.users.payrollA);
  const inputs = (await tx.query<{ r: { employees: Array<{ employeeId: string; penaltyDays: number; payableDays: number; daysInPeriod: number }> } }>(
    'select payroll_run_inputs($1) as r', [run])).rows[0]!.r;
  await tx.exec('reset role');
  return inputs.employees;
};

beforeAll(async () => {
  const { t, f } = ctx;
  cycleMonth = (await t.db.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)) - interval '1 month', 'YYYY-MM-DD') as m`, [f.orgA])).rows[0]!.m;
  const days = (await t.db.query<{ d: string; dow: number }>(
    `select to_char(d, 'YYYY-MM-DD') as d, extract(isodow from d)::int as dow
       from generate_series($1::date, ($1::date + interval '1 month - 1 day')::date, interval '1 day') d order by d`, [cycleMonth])).rows;
  prevWeekdays.push(...days.filter((d) => d.dow < 6).map((d) => d.d));
  prevSaturdays.push(...days.filter((d) => d.dow === 6).map((d) => d.d));
});

describe('penalty rules', () => {
  it('late, early and short-hours penalties follow the allowance, interval and method, and come out of leave before pay', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const cl = await leaveType(tx, 'CL');
      await tx.query(`insert into leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days, note)
                      values ($1, $2, $3, $4, 'adjust', 1.5, 'Opening')`, [f.orgA, f.employees.peerA, cl, cycleMonth]);
      const w = prevWeekdays;
      for (const d of w.slice(0, 5)) { await punch(tx, f.employees.peerA, d, '10:30'); await punch(tx, f.employees.peerA, d, '19:30'); }  // late, full day
      await punch(tx, f.employees.peerA, w[5]!, '09:30'); await punch(tx, f.employees.peerA, w[5]!, '17:30');  // an hour early: short
      await punch(tx, f.employees.peerA, w[6]!, '10:30'); await punch(tx, f.employees.peerA, w[6]!, '17:30');  // late, early and short

      await as(tx, f.users.hrA);
      // Penalties only come out of the organization's paid leave.
      const lop = await leaveType(tx, 'LOP');
      expect((await failure(tx, 'update shifts set penalty_leave_order = $2 where id = $1', [await defaultShift(tx), [lop]])).code).toBe('23503');
      await tx.query(`update shifts set penalties_enabled = true,
                        late_marks_allowed = 1, late_interval = 2, late_method = 'half_day',
                        early_marks_allowed = 0, early_method = 'hourly',
                        short_marks_allowed = 0, short_interval = 1, short_method = 'full_day',
                        penalty_leave_order = $2 where id = $1`, [await defaultShift(tx), [cl]]);
      expect((await tx.query<{ n: number }>('select run_attendance_penalties($1, $2) as n', [f.orgA, cycleMonth])).rows[0]!.n).toBeGreaterThanOrEqual(3);

      await tx.exec('reset role');
      // Under a short-hours penalty a short day stays present.
      expect((await tx.query<{ s: string }>('select status::text as s from attendance_days where employee_id = $1 and work_date = $2', [f.employees.peerA, w[5]])).rows[0]!.s).toBe('present');
      const rows = await penalties(tx, f.employees.peerA);
      const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
      // Late: 6 late arrivals, 1 allowed, half a day for every 2 more: 1 day, all from casual leave.
      expect([byKind.late_marks!.total, byKind.late_marks!.lop, byKind.late_marks!.occurrences]).toEqual(['1.00', '0.00', 5]);
      // Early leaving, hourly: 2 hours of 8 = 0.25 days, from casual leave.
      expect([byKind.early_exits!.total, byKind.early_exits!.lop]).toEqual(['0.25', '0.00']);
      // Short hours, a full day each beyond none allowed: the late-and-short day was counted by the late rule already,
      // so 1 day; the last 0.25 of casual leave, then 0.75 loss of pay.
      expect([byKind.short_hours!.total, byKind.short_hours!.lop]).toEqual(['1.00', '0.75']);
      expect(await balance(tx, f.employees.peerA, cl)).toBe(0);
      const peer = (await runInputs(tx, false)).find((e) => e.employeeId === f.employees.peerA);
      expect(Number(peer!.penaltyDays)).toBe(0.75);

      // Reverting gives the leave back and the loss of pay goes; a re-run leaves it reverted and the rest unchanged.
      await as(tx, f.users.hrA);
      await tx.query('select revert_attendance_penalty($1)', [byKind.short_hours!.id]);
      await tx.query('select run_attendance_penalties($1, $2)', [f.orgA, cycleMonth]);
      await tx.exec('reset role');
      expect(await balance(tx, f.employees.peerA, cl)).toBe(0.25);
      const again = Object.fromEntries((await penalties(tx, f.employees.peerA)).map((r) => [r.kind, r]));
      expect(again.short_hours!.reverted).toBe(true);
      expect(again.late_marks!.split).toEqual(byKind.late_marks!.split);

      // A stricter interval re-applies the late penalty: its old leave comes back first, then 2.5 days are taken.
      await tx.query(`update shifts set late_interval = 1 where id = $1`, [await defaultShift(tx)]);
      await as(tx, f.users.hrA);
      await tx.query('select run_attendance_penalties($1, $2)', [f.orgA, cycleMonth]);
      await tx.exec('reset role');
      const stricter = Object.fromEntries((await penalties(tx, f.employees.peerA)).map((r) => [r.kind, r]));
      expect([stricter.late_marks!.total, stricter.late_marks!.lop]).toEqual(['2.50', '1.25']);
      expect(await balance(tx, f.employees.peerA, cl)).toBe(0);

      // Bulk revert: everything still applied, in one go (only attendance admins).
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select revert_attendance_penalties($1)', [[stricter.late_marks!.id]])).code).toBe('42501');
      await as(tx, f.users.hrA);
      expect((await tx.query<{ n: number }>('select revert_attendance_penalties($1) as n', [[stricter.late_marks!.id, stricter.early_exits!.id, stricter.short_hours!.id]])).rows[0]!.n).toBe(2);
      await tx.exec('reset role');
      expect(await balance(tx, f.employees.peerA, cl)).toBe(1.5);
    });
  });

  it('with the master switch off nothing is deducted, and a half day by duration stays a half day', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const d = prevWeekdays[8]!;
      await punch(tx, f.employees.peerA, d, '09:30'); await punch(tx, f.employees.peerA, d, '17:30');
      await tx.query(`update shifts set penalties_enabled = false, late_marks_allowed = 0, early_marks_allowed = 0 where id = $1`, [await defaultShift(tx)]);
      await as(tx, f.users.hrA);
      await tx.query('select run_attendance_penalties($1, $2)', [f.orgA, cycleMonth]);
      await tx.exec('reset role');
      expect((await tx.query<{ s: string }>('select status::text as s from attendance_days where employee_id = $1 and work_date = $2', [f.employees.peerA, d])).rows[0]!.s).toBe('half_day');
      expect((await penalties(tx, f.employees.peerA)).filter((p) => Number(p.total) > 0)).toHaveLength(0);
    });
  });
});

describe('automatic deduction', () => {
  it('absent days come out of salary once the cycle ends, and a run that counts absences doesn’t count them again', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      for (const d of prevWeekdays.slice(2)) { await punch(tx, f.employees.icA, d, '09:30'); await punch(tx, f.employees.icA, d, '18:30'); }
      await tx.query(`update shifts set deduct_absent = true where id = $1`, [await defaultShift(tx)]);
      await tx.query(`update attendance_settings set last_deduction_cycle = null where organization_id = $1`, [f.orgA]);

      // Outside the three days after the cycle ends nothing happens; inside, once.
      const cycleEnd = (await tx.query<{ d: string }>(`select to_char(($1::date + interval '1 month - 1 day')::date, 'YYYY-MM-DD') as d`, [cycleMonth])).rows[0]!.d;
      const at = (date: string, time: string) => `(('${date}'::date + '${time}'::time)::timestamp at time zone 'Asia/Kolkata')`;
      expect((await tx.query<{ r: { organizations: number } }>(`select worker_attendance_deductions(${at(cycleEnd, '23:00')} + interval '10 days') as r`)).rows[0]!.r.organizations).toBe(0);
      expect((await tx.query<{ r: { organizations: number } }>(`select worker_attendance_deductions(${at(cycleEnd, '23:00')} + interval '1 day' - interval '20 hours') as r`)).rows[0]!.r.organizations).toBe(0);
      expect((await tx.query<{ r: { organizations: number } }>(`select worker_attendance_deductions(${at(cycleEnd, '09:00')} + interval '1 day') as r`)).rows[0]!.r.organizations).toBe(1);
      expect((await tx.query<{ r: { organizations: number } }>(`select worker_attendance_deductions(${at(cycleEnd, '10:00')} + interval '1 day') as r`)).rows[0]!.r.organizations).toBe(0);

      const absent = (await penalties(tx, f.employees.icA)).find((p) => p.kind === 'absent')!;
      expect([absent.total, absent.lop, absent.occurrences]).toEqual(['2.00', '2.00', 2]);
      expect((await tx.query(`select 1 from notifications where user_id = $1 and kind = 'attendance.deductions'`, [f.users.hrA])).rows).toHaveLength(1);

      const ic = (await runInputs(tx, true)).find((e) => e.employeeId === f.employees.icA);
      expect(Number(ic!.daysInPeriod) - Number(ic!.payableDays)).toBe(2);
      const ic2 = (await runInputs(tx, false)).find((e) => e.employeeId === f.employees.icA);
      expect(Number(ic2!.daysInPeriod) - Number(ic2!.payableDays)).toBe(2);
    });
  });
});

describe('rules', () => {
  it('an assigned rule applies from its effective date; before it, the default rule', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const later = (await tx.query<{ id: string }>(`insert into shifts (organization_id, code, name, start_time, end_time, effective_from)
        values ($1, 'LATER', 'Later rule', '11:00', '20:00', app.org_today($1) + 10) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into roster_assignments (organization_id, employee_id, shift_id, effective_from) values ($1, $2, $3, '2024-01-01')`, [f.orgA, f.employees.icA, later]);
      await tx.exec('reset role');
      const name = async (offset: number) => (await tx.query<{ n: string }>('select (app.shift_for($1, app.org_today($2) + $3::int)).name as n', [f.employees.icA, f.orgA, offset])).rows[0]!.n;
      expect(await name(0)).toBe('General shift');
      expect(await name(10)).toBe('Later rule');
      await as(tx, f.users.icA);
      expect((await tx.query<{ name: string }>('select name from attendance_rule_for($1, app.org_today($2) + 10)', [f.employees.icA, f.orgA])).rows[0]!.name).toBe('Later rule');
      await as(tx, f.users.peerA);
      expect((await failure(tx, 'select * from attendance_rule_for($1, current_date)', [f.employees.icA])).code).toBe('42501');
    });
  });

  it('automatic clock-in at the shift start and clock-out at its end, on working days only, once', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update shifts set auto_clock_in = true, auto_clock_out = true where id = $1`, [await defaultShift(tx)]);
      const day = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) - 9, app.org_today($1) - 3, interval '1 day') d
                                                   where extract(isodow from d) < 6 order by d desc limit 1`, [f.orgA])).rows[0]!.d;
      const sat = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) - 9, app.org_today($1) - 3, interval '1 day') d
                                                   where extract(isodow from d) = 6 limit 1`, [f.orgA])).rows[0]!.d;
      const at = (date: string, time: string) => `(('${date}'::date + '${time}'::time)::timestamp at time zone 'Asia/Kolkata')`;
      await punch(tx, f.employees.peerA, day, '09:20');  // already in: no automatic check-in for her
      const first = (await tx.query<{ r: { clocked_in: number; clocked_out: number } }>(`select worker_attendance_auto_clock(${at(day, '12:00')}) as r`)).rows[0]!.r;
      expect(first.clocked_in).toBe(3);  // Mira, Lalit and Ishan in org A
      expect((await tx.query<{ r: { clocked_in: number } }>(`select worker_attendance_auto_clock(${at(day, '12:15')}) as r`)).rows[0]!.r.clocked_in).toBe(0);
      expect((await tx.query<{ r: { clocked_out: number } }>(`select worker_attendance_auto_clock(${at(day, '19:00')}) as r`)).rows[0]!.r.clocked_out).toBe(4);
      expect((await tx.query<{ s: string; w: number }>('select status::text as s, worked_minutes as w from attendance_days where employee_id = $1 and work_date = $2',
        [f.employees.icA, day])).rows[0]).toEqual({ s: 'present', w: 480 });
      expect((await tx.query(`select 1 from attendance_punches where employee_id = $1 and method = 'auto'`, [f.employees.icA])).rows).toHaveLength(2);
      // A weekly off gets nothing.
      expect((await tx.query<{ r: { clocked_in: number } }>(`select worker_attendance_auto_clock(${at(sat, '12:00')}) as r`)).rows[0]!.r.clocked_in).toBe(0);
    });
  });
});

describe('zones', () => {
  it('rectangles and polygons decide check-ins by their shape, and a test point says where it falls', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const loc = (await tx.query<{ id: string }>(`insert into locations (organization_id, code, name, latitude, longitude) values ($1, 'PLANT', 'Plant', 12.97, 77.59) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('update employees set location_id = $1 where id = $2', [loc, f.employees.icA]);
      await tx.query(`update shifts set verify_geofence = true where id = $1`, [await defaultShift(tx)]);
      await as(tx, f.users.hrA);
      // An L-shaped yard: the square's south-west part only.
      await tx.query(`insert into geofences (organization_id, location_id, name, shape, points, latitude, longitude)
        values ($1, $2, 'Yard', 'polygon', '[[12.969,77.589],[12.969,77.591],[12.970,77.591],[12.970,77.590],[12.971,77.590],[12.971,77.589]]', 0, 0)`, [f.orgA, loc]);
      const g = (await tx.query<{ latitude: string; longitude: string; radius_m: number | null }>(`select latitude::text, longitude::text, radius_m from geofences where name = 'Yard'`)).rows[0]!;
      expect(g).toEqual({ latitude: '12.970000', longitude: '77.590000', radius_m: null });
      expect((await failure(tx, `insert into geofences (organization_id, location_id, name, shape, points, latitude, longitude) values ($1, $2, 'Bad', 'rectangle', '[[1,2]]', 0, 0)`, [f.orgA, loc])).code).toBe('23514');
      expect((await failure(tx, `insert into geofences (organization_id, location_id, name, shape, points, latitude, longitude) values ($1, $2, 'Bad', 'polygon', '[[1,2],[3,"x"],[5,6]]', 0, 0)`, [f.orgA, loc])).message).toContain('latitude and a longitude');

      const test = async (lat: number, lng: number) => (await tx.query<{ r: Array<{ name: string; inside: boolean; metres: number }> }>(
        'select test_geofence($1, $2, $3, $4, 0) as r', [f.orgA, loc, lat, lng])).rows[0]!.r[0]!;
      expect(await test(12.9695, 77.5895)).toMatchObject({ name: 'Yard', inside: true, metres: 0 });
      const notch = await test(12.9705, 77.5905);  // in the square, but in the L's cut-out
      expect(notch.inside).toBe(false);
      expect(notch.metres).toBeGreaterThan(40);
      expect(notch.metres).toBeLessThan(60);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select test_geofence($1, null, 12.97, 77.59)', [f.orgA])).code).toBe('42501');

      // A check-in in the cut-out is refused; in the yard it counts. A rectangle works the same way.
      expect((await failure(tx, `select record_punch('zone-punch-1', null, 'web', 12.9705, 77.5905, 5, p_org => $1)`, [f.orgA])).message).toContain('outside the workplace');
      await tx.query(`select record_punch('zone-punch-2', null, 'web', 12.9695, 77.5895, 5, p_org => $1)`, [f.orgA]);
      await as(tx, f.users.hrA);
      await tx.query(`insert into geofences (organization_id, location_id, name, shape, points, latitude, longitude) values ($1, $2, 'Gate', 'rectangle', '[[12.9704,77.5904],[12.9706,77.5906]]', 0, 0)`, [f.orgA, loc]);
      await as(tx, f.users.icA);
      await tx.query(`select record_punch('zone-punch-3', null, 'web', 12.9705, 77.5905, 5, p_org => $1)`, [f.orgA]);
    });
  });
});

describe('comp-off', () => {
  it('comp-off waits for approval when the rule says so; the employee and HR hear about it; only credited comp-off reverts', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update shifts set comp_off_min_minutes = 240, comp_off_auto_approve = false where id = $1`, [await defaultShift(tx)]);
      await tx.query(`update attendance_settings set comp_off_notify_employee = true, comp_off_notify_hr = true where organization_id = $1`, [f.orgA]);
      const [s1, s2] = prevSaturdays;
      for (const s of [s1!, s2!]) { await punch(tx, f.employees.icA, s, '09:30'); await punch(tx, f.employees.icA, s, '18:30'); }
      const credit = (s: string) => tx.query<{ status: string }>('select status from comp_off_credits where employee_id = $1 and work_date = $2', [f.employees.icA, s]).then((r) => r.rows[0]?.status);
      expect(await credit(s1!)).toBe('pending');
      const comp = await leaveType(tx, 'COMP_OFF');
      expect(await balance(tx, f.employees.icA, comp)).toBe(0);
      expect((await tx.query(`select title from notifications where user_id = $1 and kind = 'attendance.comp_off'`, [f.users.icA])).rows).toHaveLength(2);
      expect((await tx.query(`select title from notifications where user_id = $1 and kind = 'attendance.comp_off'`, [f.users.hrA])).rows).toHaveLength(2);

      const item = (s: string) => JSON.stringify([{ employeeId: f.employees.icA, workDate: s }]);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select decide_comp_offs($1, true)', [item(s1!)])).code).toBe('42501');
      await as(tx, f.users.leadA);
      expect((await tx.query<{ n: number }>('select decide_comp_offs($1, true) as n', [item(s1!)])).rows[0]!.n).toBe(1);
      expect((await tx.query<{ n: number }>('select decide_comp_offs($1, false) as n', [item(s2!)])).rows[0]!.n).toBe(1);
      await tx.exec('reset role');
      expect([await credit(s1!), await credit(s2!)]).toEqual(['credited', 'rejected']);
      expect(await balance(tx, f.employees.icA, comp)).toBe(1);
      expect((await tx.query(`select 1 from notifications where user_id = $1 and title like 'Comp-off credited%'`, [f.users.icA])).rows).toHaveLength(1);

      await as(tx, f.users.hrA);
      expect((await failure(tx, 'select revert_comp_off($1, $2)', [f.employees.icA, s2])).code).toBe('22023');
      expect((await tx.query<{ n: number }>('select revert_comp_offs($1) as n', [item(s1!)])).rows[0]!.n).toBe(1);
      await tx.exec('reset role');
      expect(await balance(tx, f.employees.icA, comp)).toBe(0);
    });
  });

  it('overtime is decided in bulk by the approver', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into overtime_records (organization_id, employee_id, work_date, minutes) values ($1, $2, $3, 90), ($1, $2, $4, 60)`,
        [f.orgA, f.employees.icA, prevWeekdays[0], prevWeekdays[1]]);
      await as(tx, f.users.leadA);
      const items = JSON.stringify([{ employeeId: f.employees.icA, workDate: prevWeekdays[0] }, { employeeId: f.employees.icA, workDate: prevWeekdays[1] }]);
      expect((await tx.query<{ n: number }>('select decide_overtimes($1, true) as n', [items])).rows[0]!.n).toBe(2);
      expect((await tx.query<{ n: number }>('select decide_overtimes($1, false) as n', [items])).rows[0]!.n).toBe(0);
    });
  });
});

describe('regularization', () => {
  it('employees ask within the window and under the monthly cap, several days at once; attendance admins go back 90 days', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update attendance_settings set regularize_days_back = 90, regularize_monthly_limit = 2 where organization_id = $1`, [f.orgA]);
      await as(tx, f.users.icA);
      const r = (await tx.query<{ r: { requested: number; errors: Array<{ date: string; message: string }> } }>(
        `select request_regularizations($1, $2::date[], '09:30', '18:30', 'Forgot to punch') as r`, [f.employees.icA, prevWeekdays.slice(0, 3)])).rows[0]!.r;
      expect(r.requested).toBe(2);
      expect(r.errors).toEqual([{ date: prevWeekdays[2], message: 'You can ask for at most 2 regularizations a month.' }]);
      expect((await failure(tx, `select request_regularizations($1, '{}'::date[], '09:30', null, 'x x x')`, [f.employees.icA])).message).toBe('Choose between 1 and 31 days.');
      // Someone else's days: refused outright.
      expect((await failure(tx, `select request_regularizations($1, $2::date[], '09:30', null, 'Forgot')`, [f.employees.peerA, prevWeekdays.slice(0, 1)])).code).toBe('42501');

      await tx.exec('reset role');
      await tx.query(`update attendance_settings set regularize_days_back = 5 where organization_id = $1`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, `select request_regularization($1, app.org_today($2) - 10, '09:30', null, 'Forgot')`, [f.employees.icA, f.orgA])).message)
        .toBe('Only the last 5 days can be regularized.');
      await as(tx, f.users.hrA);
      await tx.query(`select request_regularization($1, app.org_today($2) - 75, '09:30', null, 'Card reader was down')`, [f.employees.icA, f.orgA]);
    });
  });
});

describe('reminders', () => {
  it('a daily summary for attendance admins and punch reminders for employees, once a day', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update attendance_settings set daily_summary = true, punch_reminders = true, last_daily_summary = null, last_punch_reminder = null
                       where organization_id = $1`, [f.orgA]);
      // A recent Tuesday to Friday, so that it and the day before are working days.
      const today = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) - 8, app.org_today($1) - 1, interval '1 day') d
                                                     where extract(isodow from d) between 2 and 5 order by d desc limit 1`, [f.orgA])).rows[0]!.d;
      const yesterday = (await tx.query<{ d: string }>(`select to_char($1::date - 1, 'YYYY-MM-DD') as d`, [today])).rows[0]!.d;
      await punch(tx, f.employees.peerA, yesterday, '09:30');
      await punch(tx, f.employees.peerA, yesterday, '17:00');  // 90 minutes early
      await tx.query(`insert into attendance_days (organization_id, employee_id, work_date, status, punch_count, late_minutes)
                      values ($1, $2, $3, 'present', 1, 25) on conflict (employee_id, work_date) do update set late_minutes = 25, status = 'present'`, [f.orgA, f.employees.icA, today]);
      const at = `(('${today}'::date + '11:30'::time)::timestamp at time zone 'Asia/Kolkata')`;
      const first = (await tx.query<{ r: Record<string, number> }>(`select worker_attendance_reminders(${at}) as r`)).rows[0]!.r;
      expect([first.summaries, first.punch_reminders]).toEqual([1, 2]);
      expect((await tx.query<{ r: Record<string, number> }>(`select worker_attendance_reminders(${at}) as r`)).rows[0]!.r)
        .toEqual({ missing_checkout: 0, digests: 0, late_alerts: 0, summaries: 0, punch_reminders: 0 });
      expect((await tx.query(`select 1 from notifications where user_id = $1 and kind = 'attendance.summary'`, [f.users.hrA])).rows).toHaveLength(1);
      expect((await tx.query<{ title: string }>(`select title from notifications where user_id = $1 and kind = 'attendance.punch'`, [f.users.icA])).rows)
        .toEqual([{ title: 'You checked in 25 minutes late today' }]);
      expect((await tx.query<{ title: string }>(`select title from notifications where user_id = $1 and kind = 'attendance.punch'`, [f.users.peerA])).rows)
        .toEqual([{ title: 'You checked out 1 h 30 min early yesterday' }]);
    });
  });
});

describe('settings', () => {
  it('the attendance cycle and payroll’s input cycle are one setting', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query('update attendance_settings set cycle_start_day = 26 where organization_id = $1', [f.orgA]);
      await tx.exec('reset role');
      expect((await tx.query<{ d: number }>('select input_cycle_start_day as d from payroll_settings where organization_id = $1', [f.orgA])).rows[0]!.d).toBe(26);
      expect((await tx.query<{ f: string; t: string }>(`select to_char(cycle_from, 'YYYY-MM-DD') as f, to_char(cycle_to, 'YYYY-MM-DD') as t from app.attendance_cycle_bounds($1, '2026-10-01')`, [f.orgA])).rows[0])
        .toEqual({ f: '2026-09-26', t: '2026-10-25' });
      expect((await tx.query<{ m: string }>(`select to_char(app.attendance_cycle_month($1, '2026-10-26'), 'YYYY-MM-DD') as m`, [f.orgA])).rows[0]!.m).toBe('2026-11-01');
      await as(tx, f.users.payrollA);
      await tx.query('update payroll_settings set input_cycle_start_day = 21 where organization_id = $1', [f.orgA]);
      await tx.exec('reset role');
      expect((await tx.query<{ d: number }>('select cycle_start_day as d from attendance_settings where organization_id = $1', [f.orgA])).rows[0]!.d).toBe(21);
    });
  });

  it('saved views are private to the person who saved them', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.query(`insert into saved_views (organization_id, page, name, params) values ($1, 'attendance.logs', 'Late in Engineering', '{"view":"penalty"}')`, [f.orgA]);
      expect((await failure(tx, `insert into saved_views (organization_id, user_id, page, name, params) values ($1, $2, 'attendance.logs', 'Planted', '{}')`, [f.orgA, f.users.peerA])).code).toBe('42501');
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from saved_views')).rows).toHaveLength(0);
      await as(tx, f.users.ownerB);
      expect((await failure(tx, `insert into saved_views (organization_id, page, name, params) values ($1, 'attendance.logs', 'Other org', '{}')`, [f.orgA])).code).toBe('42501');
    });
  });
});
