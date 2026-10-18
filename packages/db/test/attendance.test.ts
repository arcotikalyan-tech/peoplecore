import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

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

/** Inserts a raw punch at a local (IST) wall-clock time, as a device would; the trigger recomputes the day. */
const punch = (tx: Transaction, employee: string, date: string, time: string, key: string) =>
  tx.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key)
            values ($1, $2, ($3::date + $4::time)::timestamp at time zone 'Asia/Kolkata', 'import', $5)`,
  [ctx.f.orgA, employee, date, time, key]);
const dayRow = (tx: Transaction, employee: string, date: string) =>
  tx.query<{ status: string; worked_minutes: number; late_minutes: number; punch_count: number; is_regularized: boolean; leave_paid: boolean | null }>(
    'select status, worked_minutes, late_minutes, punch_count, is_regularized, leave_paid from attendance_days where employee_id = $1 and work_date = $2',
    [employee, date]).then((r) => r.rows[0]);

beforeAll(async () => {
  const { rows } = await ctx.t.db.query<{ d: string }>(
    `select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) - 20, app.org_today($1) - 2, interval '1 day') d
      where extract(isodow from d) < 6 order by d desc`, [ctx.f.orgA]);
  weekdays.push(...rows.map((r) => r.d));
});

describe('setup', () => {
  it('every organization has a default shift and a regularization flow', async () => {
    const { rows } = await ctx.t.db.query<{ code: string; is_default: boolean }>('select code, is_default from shifts where organization_id = $1', [ctx.f.orgA]);
    expect(rows).toEqual([{ code: 'GEN', is_default: true }]);
    expect((await ctx.t.db.query(`select 1 from approval_flows where organization_id = $1 and subject_type = 'regularization'`, [ctx.f.orgA])).rows).toHaveLength(1);
  });
});

describe('record_punch', () => {
  it('is idempotent per client punch id, so offline sync records a punch once', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const a = (await tx.query<{ id: string }>(`select record_punch('client-0001', now() - interval '5 hours', 'mobile') as id`)).rows[0]!.id;
      const b = (await tx.query<{ id: string }>(`select record_punch('client-0001', now() - interval '5 hours', 'mobile') as id`)).rows[0]!.id;
      expect(b).toBe(a);
      expect((await tx.query(`select 1 from attendance_punches where employee_id = $1`, [f.employees.icA])).rows).toHaveLength(1);
      await tx.exec('reset role');
      const flags = await tx.query<{ rule: string }>(`select rule from anomaly_flags where subject_id = $1`, [a]);
      expect(flags.rows.map((r) => r.rule)).toContain('late_sync'); // synced five hours late
    });
  });

  it('refuses future punches, stale offline punches, device methods and people without an employee record', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      expect((await failure(tx, `select record_punch('client-0002', now() + interval '1 hour')`)).message)
        .toBe('A punch can’t be in the future. Check the device clock.');
      expect((await failure(tx, `select record_punch('client-0003', now() - interval '4 days')`)).message)
        .toBe('Punches older than 72 hours can’t be synced; request a regularization instead.');
      expect((await failure(tx, `select record_punch('client-0004', now(), 'biometric')`)).message).toBe('Use web or mobile for your own punches.');
    });
    expect(await pgError(ctx.t.asUser(f.users.ownerA, (tx) => tx.query(`select record_punch('client-0005')`)))).toBe('42501');
  });

  it('flags punches without a location or outside the geofence, never refusing them', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      const loc = (await t.db.query<{ id: string }>(`insert into locations (organization_id, code, name) values ($1, 'GEO', 'Geo office') returning id`, [f.orgA])).rows[0]!.id;
      await t.db.query(`insert into geofences (organization_id, location_id, name, latitude, longitude, radius_m) values ($1, $2, 'Office', 12.9716, 77.5946, 200)`, [f.orgA, loc]);
      await t.db.query('update employees set location_id = $1 where id = $2', [loc, f.employees.peerA]);
      await as(t.db as unknown as Transaction, f.users.peerA);
      const inside = (await t.db.query<{ id: string }>(`select record_punch('geo-in-001', now(), 'mobile', 12.9717, 77.5947, 10) as id`)).rows[0]!.id;
      const outside = (await t.db.query<{ id: string }>(`select record_punch('geo-out-001', now(), 'mobile', 13.0827, 80.2707, 10) as id`)).rows[0]!.id;
      const none = (await t.db.query<{ id: string }>(`select record_punch('geo-none-01', now(), 'web') as id`)).rows[0]!.id;
      await t.db.exec('reset role');
      // Location rules only: between midnight and the end of yesterday's shift window a lone punch also reads as a
      // missing check-out for yesterday, which is about pairing, not location.
      const rules = async (id: string) => (await t.db.query<{ rule: string }>(`select rule from anomaly_flags where subject_id = $1 and rule <> 'missing_punch'`, [id])).rows.map((r) => r.rule);
      expect(await rules(inside)).toEqual([]);
      expect(await rules(outside)).toEqual(['outside_geofence']);
      expect(await rules(none)).toEqual(['no_location']);
    } finally {
      await t.db.exec('rollback');
    }
  });
});

describe('attendance days', () => {
  it('derive present, half day, missing punch, weekly off, holiday and leave from the source data', async () => {
    const { f, t } = ctx;
    const [d1, d2, d3, d4] = weekdays;
    await t.db.exec('begin');
    try {
      const tx = t.db as unknown as Transaction;
      await punch(tx, f.employees.icA, d1!, '09:40', 'k1');
      await punch(tx, f.employees.icA, d1!, '18:45', 'k2');
      expect(await dayRow(tx, f.employees.icA, d1!)).toMatchObject({ status: 'present', worked_minutes: 485, late_minutes: 0, punch_count: 2 });

      await punch(tx, f.employees.icA, d2!, '10:05', 'k3'); // 35 minutes after 09:30 → 20 late after grace
      await punch(tx, f.employees.icA, d2!, '15:20', 'k4');
      expect(await dayRow(tx, f.employees.icA, d2!)).toMatchObject({ status: 'half_day', worked_minutes: 255, late_minutes: 20 });

      await punch(tx, f.employees.icA, d3!, '09:31', 'k5');
      expect(await dayRow(tx, f.employees.icA, d3!)).toMatchObject({ status: 'absent', punch_count: 1 });
      expect((await t.db.query(`select 1 from anomaly_flags where employee_id = $1 and rule = 'missing_punch' and status = 'open'`, [f.employees.icA])).rows).toHaveLength(1);

      const cal = (await t.db.query<{ id: string }>(`select id from holiday_calendars where organization_id = $1 and location_id is null`, [f.orgA])).rows[0]!.id;
      await t.db.query(`insert into holidays (organization_id, calendar_id, holiday_date, name) values ($1, $2, $3, 'Test')`, [f.orgA, cal, d4]);
      await t.db.query('select app.compute_attendance_day($1, $2)', [f.employees.icA, d4]);
      expect((await dayRow(tx, f.employees.icA, d4!))!.status).toBe('holiday');

      const saturday = (await t.db.query<{ d: string }>(`select to_char($1::date + (6 - extract(isodow from $1::date)::int), 'YYYY-MM-DD') as d`, [weekdays.at(-1)])).rows[0]!.d;
      await t.db.query('select app.compute_attendance_day($1, $2)', [f.employees.icA, saturday]);
      expect((await dayRow(tx, f.employees.icA, saturday))!.status).toBe('weekly_off');

      // Approved paid leave.
      const cl = (await t.db.query<{ id: string }>(`select id from leave_types where organization_id = $1 and code = 'CL'`, [f.orgA])).rows[0]!.id;
      const d5 = weekdays[4]!;
      await t.db.query(`insert into leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, days, status, requested_by)
                        values ($1, $2, $3, $4, $4, 1, 'approved', $5)`, [f.orgA, f.employees.icA, cl, d5, f.users.icA]);
      await t.db.query('select app.compute_attendance_day($1, $2)', [f.employees.icA, d5]);
      expect(await dayRow(tx, f.employees.icA, d5)).toMatchObject({ status: 'on_leave', leave_paid: true });
    } finally {
      await t.db.exec('rollback');
    }
  });

  it('assigns night-shift punches to the day the shift starts', async () => {
    const { f, t } = ctx;
    const d = weekdays[1]!;
    const next = (await t.db.query<{ d: string }>(`select to_char($1::date + 1, 'YYYY-MM-DD') as d`, [d])).rows[0]!.d;
    await t.db.exec('begin');
    try {
      const tx = t.db as unknown as Transaction;
      const night = (await t.db.query<{ id: string }>(
        `insert into shifts (organization_id, code, name, start_time, end_time, full_day_minutes) values ($1, 'NIGHT', 'Night', '22:00', '06:00', 420) returning id`, [f.orgA])).rows[0]!.id;
      await t.db.query(`insert into roster_assignments (organization_id, employee_id, shift_id, effective_from) values ($1, $2, $3, '2024-01-01')`, [f.orgA, f.employees.leadA, night]);
      await punch(tx, f.employees.leadA, d, '22:05', 'n1');
      await punch(tx, f.employees.leadA, next, '06:10', 'n2');
      expect(await dayRow(tx, f.employees.leadA, d)).toMatchObject({ status: 'present', worked_minutes: 425, punch_count: 2 });
    } finally {
      await t.db.exec('rollback');
    }
  });
});

describe('regularization', () => {
  it('approval adds the missing punch, recomputes the day and resolves the flag', async () => {
    const { f } = ctx;
    const d = weekdays[2]!;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.exec('reset role');
      await punch(tx, f.employees.icA, d, '09:35', 'r1');
      await as(tx, f.users.icA);
      expect((await failure(tx, `select request_regularization($1, app.org_today($2), '09:30', '18:30', 'Forgot')`, [f.employees.icA, f.orgA])).message)
        .toBe('Regularize days that have ended; today can still be punched.');
      const id = (await tx.query<{ id: string }>(`select request_regularization($1, $2, null, '18:40', 'Forgot to check out') as id`, [f.employees.icA, d])).rows[0]!.id;
      expect((await failure(tx, `select request_regularization($1, $2, null, '18:45', 'Again')`, [f.employees.icA, d])).message)
        .toBe('There is already a pending regularization for that day.');

      const approval = (await tx.query<{ a: string }>('select approval_request_id as a from regularization_requests where id = $1', [id])).rows[0]!.a;
      await as(tx, f.users.leadA);
      await tx.query('select decide_approval($1, $2)', [approval, 'approve']);
      await tx.exec('reset role');
      expect(await dayRow(tx, f.employees.icA, d)).toMatchObject({ status: 'present', is_regularized: true, punch_count: 2 });
      expect((await tx.query(`select 1 from anomaly_flags where employee_id = $1 and rule = 'missing_punch' and status = 'open'`, [f.employees.icA])).rows).toHaveLength(0);
    });
  });

  it('only the employee or HR can request; peers can’t see others’ attendance', async () => {
    const { f } = ctx;
    const d = weekdays[3]!;
    expect(await pgError(ctx.t.asUser(f.users.peerA, (tx) => tx.query(`select request_regularization($1, $2, '09:30', null, 'x x x')`, [f.employees.icA, d])))).toBe('42501');
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.exec('reset role');
      await punch(tx, f.employees.icA, d, '09:30', 'v1');
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from attendance_punches where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      await as(tx, f.users.managerA); // team scope
      expect((await tx.query('select 1 from attendance_punches where employee_id = $1', [f.employees.icA])).rows).toHaveLength(1);
      expect((await failure(tx, `insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key) values ($1, $2, now(), 'web', 'x')`,
        [f.orgA, f.employees.icA])).code).toBe('42501');
    });
  });
});

describe('biometric import', () => {
  it('reads device-local times in the org time zone and skips records it has already seen', async () => {
    const { f } = ctx;
    const d = weekdays[5]!;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const dev = (await tx.query<{ id: string }>(`insert into biometric_devices (organization_id, serial_number, name) values ($1, 'ZK-001', 'Front door') returning id`, [f.orgA])).rows[0]!.id;
      const rows = [
        { line: 2, employee_code: 'A-003', punched_at: `${d} 09:28:00`, record_id: '101' },
        { line: 3, employee_code: 'A-003', punched_at: `${d} 18:41:00`, record_id: '102' },
        { line: 4, employee_code: 'NOPE', punched_at: `${d} 09:00:00`, record_id: '103' },
      ];
      const first = (await tx.query<{ r: unknown }>('select import_device_punches($1, $2) as r', [dev, JSON.stringify(rows)])).rows[0]!.r;
      expect(first).toEqual({ inserted: 2, duplicates: 0, errors: [{ line: 4, message: 'Unknown employee code “NOPE”.' }] });
      const again = (await tx.query<{ r: { inserted: number; duplicates: number } }>('select import_device_punches($1, $2) as r', [dev, JSON.stringify(rows.slice(0, 2))])).rows[0]!.r;
      expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
      const local = await tx.query<{ t: string }>(`select to_char(punched_at at time zone 'Asia/Kolkata', 'HH24:MI') as t from attendance_punches where device_id = $1 order by punched_at`, [dev]);
      expect(local.rows.map((r) => r.t)).toEqual(['09:28', '18:41']);
    });
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) => tx.query(`select import_device_punches(gen_random_uuid(), '[]')`)))).toBe('42501');
  });
});

describe('attendance_days_for', () => {
  it('recomputes and returns one employee’s month for those who may see it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const { rows } = await tx.query<{ work_date: string; status: string }>(
        `select to_char(work_date, 'YYYY-MM-DD') as work_date, status from attendance_days_for($1, app.org_today($2))`, [f.employees.icA, f.orgA]);
      const today = (await tx.query<{ d: string; day: number }>(`select to_char(app.org_today($1), 'YYYY-MM-DD') as d, extract(day from app.org_today($1))::int as day`, [f.orgA])).rows[0]!;
      expect(rows).toHaveLength(today.day); // every day so far this month
      expect(rows[0]!.work_date).toBe(today.d);
    });
    expect(await pgError(ctx.t.asUser(f.users.peerA, (tx) => tx.query('select * from attendance_days_for($1, current_date)', [f.employees.icA])))).toBe('42501');
  });
});

describe('monthly summary', () => {
  it('is reproducible and counts presence, absences and weekly offs for payroll; HR and payroll only', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const month = (await tx.query<{ m: string }>(`select to_char(date_trunc('month', app.org_today($1)) - interval '1 month', 'YYYY-MM-DD') as m`, [f.orgA])).rows[0]!.m;
      const summary = async () => (await tx.query<Record<string, unknown>>(
        `select days_in_period, present::text, absent, weekly_offs, payable_days::text, lop_days::text from attendance_month_summary($1, $2) where employee_id = $3`,
        [f.orgA, month, f.employees.peerA])).rows[0]!;
      const before = await summary();
      expect(await summary()).toEqual(before); // same inputs, same output
      const days = before.days_in_period as number;
      expect(Number(before.present)).toBe(0);
      expect((before.absent as number) + (before.weekly_offs as number)).toBe(days);
      expect(Number(before.lop_days)).toBe(before.absent);

      await tx.exec('reset role');
      const firstWeekday = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series($1::date, $1::date + 6, interval '1 day') d where extract(isodow from d) < 6 order by d limit 1`, [month])).rows[0]!.d;
      await punch(tx, f.employees.peerA, firstWeekday, '09:30', 's1');
      await punch(tx, f.employees.peerA, firstWeekday, '18:30', 's2');
      await as(tx, f.users.payrollA);
      const after = await summary();
      expect(Number(after.present)).toBe(1);
      expect(after.absent).toBe((before.absent as number) - 1);
    });
    for (const user of [f.users.icA, f.users.managerA]) {
      expect(await pgError(ctx.t.asUser(user, (tx) => tx.query(`select * from attendance_month_summary($1, current_date)`, [f.orgA])))).toBe('42501');
    }
  });
});
