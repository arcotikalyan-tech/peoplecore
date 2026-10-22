import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();
const types: Record<string, string> = {};
let monday = ''; // a Monday at least two weeks ahead (org-local)

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

const day = (offset: number) => {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const apply = (tx: Transaction, employee: string, code: string, start: string, end: string, halfStart = false, halfEnd = false) =>
  tx.query<{ id: string }>('select apply_leave($1, $2, $3, $4, $5, $6) as id', [employee, types[code], start, end, halfStart, halfEnd])
    .then((r) => r.rows[0]!.id);
const approvalOf = (tx: Transaction, request: string) =>
  tx.query<{ a: string }>('select approval_request_id as a from leave_requests where id = $1', [request]).then((r) => r.rows[0]!.a);
const balance = (tx: Transaction, employee: string, code: string) =>
  tx.query<{ balance: string; pending: string; available: string }>(
    'select balance, pending, available from leave_balances($1) where code = $2', [employee, code])
    .then((r) => ({ balance: Number(r.rows[0]!.balance), pending: Number(r.rows[0]!.pending), available: Number(r.rows[0]!.available) }));
const grant = (tx: Transaction, employee: string, code: string, days: number) =>
  tx.query(`select adjust_leave_balance($1, $2, $3, 'Opening balance', 'opening')`, [employee, types[code], days]);

beforeAll(async () => {
  const { rows } = await ctx.t.db.query<{ code: string; id: string }>('select code, id from leave_types where organization_id = $1', [ctx.f.orgA]);
  for (const r of rows) types[r.code] = r.id;
  monday = (await ctx.t.db.query<{ d: string }>(
    `select to_char(t + ((8 - extract(isodow from t)::int) % 7), 'YYYY-MM-DD') as d from (select app.org_today($1) + 14 as t) x`, [ctx.f.orgA])).rows[0]!.d;
});

describe('defaults', () => {
  it('every organization starts with CL, SL, EL, Event leave and LOP, policies, a default calendar and a leave flow', async () => {
    const { db } = ctx.t;
    expect(Object.keys(types).sort()).toEqual(['CL', 'EL', 'EVL', 'LOP', 'SL']);
    const pol = await db.query<{ code: string; accrual_period: string; accrual_days: string; carry_forward_max: string | null }>(
      `select t.code, p.accrual_period, p.accrual_days::text, p.carry_forward_max::text from leave_policies p join leave_types t on t.id = p.leave_type_id
        where t.organization_id = $1 order by t.code`, [ctx.f.orgA]);
    expect(pol.rows).toEqual([
      { code: 'CL', accrual_period: 'monthly', accrual_days: '1.00', carry_forward_max: '0.00' },
      { code: 'EL', accrual_period: 'monthly', accrual_days: '1.25', carry_forward_max: '30.00' },
      { code: 'EVL', accrual_period: 'yearly', accrual_days: '3.00', carry_forward_max: '0.00' },
      { code: 'LOP', accrual_period: 'none', accrual_days: '0.00', carry_forward_max: null },
      { code: 'SL', accrual_period: 'monthly', accrual_days: '1.00', carry_forward_max: '0.00' },
    ]);
    expect((await db.query(`select 1 from holiday_calendars where organization_id = $1 and location_id is null`, [ctx.f.orgA])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from approval_flows where organization_id = $1 and subject_type = 'leave_request'`, [ctx.f.orgA])).rows).toHaveLength(1);
  });
});

describe('counting days', () => {
  it('skips weekly offs and holidays, counts half days, and can count every day', async () => {
    const { db } = ctx.t;
    const { f } = ctx;
    const days = async (code: string, start: string, end: string, hs = false, he = false) =>
      Number((await db.query<{ d: string }>('select app.leave_days($1, $2, $3, $4, $5, $6) as d', [f.employees.icA, types[code], start, end, hs, he])).rows[0]!.d);
    const cal = (await db.query<{ id: string }>(`select id from holiday_calendars where organization_id = $1 and location_id is null`, [f.orgA])).rows[0]!.id;

    expect(await days('CL', day(0), day(6))).toBe(5); // Mon–Sun
    await db.query(`insert into holidays (organization_id, calendar_id, holiday_date, name) values ($1, $2, $3, 'Test holiday')`, [f.orgA, cal, day(2)]);
    await db.query(`insert into holidays (organization_id, calendar_id, holiday_date, name, is_optional) values ($1, $2, $3, 'Optional', true)`, [f.orgA, cal, day(3)]);
    expect(await days('CL', day(0), day(6))).toBe(4);
    expect(await days('CL', day(0), day(1), true, false)).toBe(1.5);
    expect(await days('CL', day(0), day(0), false, true)).toBe(0.5);
    expect(await days('CL', day(5), day(6))).toBe(0); // weekend

    await db.query(`update leave_types set count_all_days = true where id = $1`, [types.LOP]);
    expect(await days('LOP', day(0), day(6))).toBe(7);
    await db.query(`update leave_types set count_all_days = false where id = $1`, [types.LOP]);
    await db.query(`delete from holidays where calendar_id = $1`, [cal]);
  });
});

describe('requests', () => {
  it('reserve balance while pending; the manager approves; cancelling before the start reverses the debit', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await grant(tx, f.employees.icA, 'CL', 3);
      await as(tx, f.users.icA);
      const id = await apply(tx, f.employees.icA, 'CL', day(0), day(1));
      expect(await balance(tx, f.employees.icA, 'CL')).toEqual({ balance: 3, pending: 2, available: 1 });
      expect((await failure(tx, 'select apply_leave($1, $2, $3, $4)', [f.employees.icA, types.CL, day(7), day(8)])).message)
        .toBe('Only 1 day(s) of Casual leave available; this request needs 2.');
      expect((await failure(tx, 'select apply_leave($1, $2, $3, $4)', [f.employees.icA, types.LOP, day(1), day(2)])).message)
        .toBe('This overlaps another leave request.');

      const approval = await approvalOf(tx, id);
      await as(tx, f.users.leadA); // icA's manager
      expect((await tx.query<{ s: string }>('select decide_approval($1, $2) as s', [approval, 'approve'])).rows[0]!.s).toBe('approved');
      await as(tx, f.users.icA);
      expect((await tx.query<{ s: string }>('select status as s from leave_requests where id = $1', [id])).rows[0]!.s).toBe('approved');
      expect(await balance(tx, f.employees.icA, 'CL')).toEqual({ balance: 1, pending: 0, available: 1 });

      await tx.query('select cancel_leave($1)', [id]);
      expect(await balance(tx, f.employees.icA, 'CL')).toEqual({ balance: 3, pending: 0, available: 3 });
      const kinds = (await tx.query<{ kind: string; days: string }>(
        `select kind, days::text from leave_ledger where employee_id = $1 order by id`, [f.employees.icA])).rows;
      expect(kinds).toEqual([{ kind: 'opening', days: '3.00' }, { kind: 'debit', days: '-2.00' }, { kind: 'reversal', days: '2.00' }]);
    });
  });

  it('rejections close the request without touching the balance; withdrawals cancel the approval', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await grant(tx, f.employees.icA, 'SL', 2);
      await as(tx, f.users.icA);
      const a = await apply(tx, f.employees.icA, 'SL', day(0), day(0));
      await as(tx, f.users.leadA);
      await tx.query('select decide_approval($1, $2, $3)', [await approvalOf(tx, a), 'reject', 'Release week']);
      await as(tx, f.users.icA);
      expect((await tx.query<{ s: string }>('select status as s from leave_requests where id = $1', [a])).rows[0]!.s).toBe('rejected');
      expect(await balance(tx, f.employees.icA, 'SL')).toEqual({ balance: 2, pending: 0, available: 2 });

      const b = await apply(tx, f.employees.icA, 'SL', day(0), day(0));
      await tx.query('select cancel_leave($1)', [b]);
      await tx.exec('reset role');
      expect((await tx.query<{ s: string }>('select r.status as s from approval_requests r join leave_requests l on l.approval_request_id = r.id where l.id = $1', [b])).rows[0]!.s).toBe('cancelled');
    });
  });

  it('enforces type rules: half days, unpaid leave without balance, people who have left', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      expect((await failure(tx, 'select apply_leave($1, $2, $3, $4, true)', [f.employees.icA, types.EL, day(0), day(0)])).message)
        .toBe('Earned leave can’t be taken in half days.');
      await apply(tx, f.employees.icA, 'LOP', day(0), day(4)); // no balance needed
      expect(await balance(tx, f.employees.icA, 'LOP')).toMatchObject({ pending: 5, available: -5 });
      expect((await failure(tx, 'select apply_leave($1, $2, $3, $4)', [f.employees.icA, types.CL, day(5), day(6)])).message)
        .toBe('Those dates are all weekly offs or holidays.');
    });
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update employees set status = 'exited', date_of_exit = '2026-01-31' where id = $1`, [f.employees.peerA]);
      await tx.exec('set local role authenticated');
      expect((await failure(tx, 'select apply_leave($1, $2, $3, $4)', [f.employees.peerA, types.LOP, day(0), day(0)])).message)
        .toBe('Leave can’t be requested for someone who has left.');
    });
  });

  it('only the employee or HR can apply; HR can’t approve what they raised; team leads see their line', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.peerA, (tx) => apply(tx, f.employees.icA, 'LOP', day(0), day(0))))).toBe('42501');
    expect(await pgError(ctx.t.asUser(f.users.leadA, (tx) => apply(tx, f.employees.icA, 'LOP', day(0), day(0))))).toBe('42501');
    expect(await pgError(ctx.t.asUser(f.users.peerA, (tx) => balance(tx, f.employees.icA, 'CL')))).toBe('42501');
    await ctx.t.asUser(f.users.managerA, async (tx) => { await balance(tx, f.employees.icA, 'CL'); }); // team scope

    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = await apply(tx, f.employees.icA, 'LOP', day(0), day(0)); // on behalf
      const approval = await approvalOf(tx, id);
      expect((await failure(tx, 'select decide_approval($1, $2)', [approval, 'approve'])).code).toBe('42501');
      await as(tx, f.users.leadA);
      expect((await tx.query<{ s: string }>('select decide_approval($1, $2) as s', [approval, 'approve'])).rows[0]!.s).toBe('approved');
    });
  });

  it('approved leave that has started can only be cancelled by HR', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await grant(tx, f.employees.icA, 'CL', 2);
      await as(tx, f.users.icA);
      const past = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) - 1, app.org_today($1) - 7, interval '-1 day') d
                                                       where extract(isodow from d) < 6 order by d desc limit 1`, [f.orgA])).rows[0]!.d;
      const id = (await tx.query<{ id: string }>('select apply_leave($1, $2, $3, $3) as id', [f.employees.icA, types.LOP, past])).rows[0]!.id;
      await as(tx, f.users.leadA);
      await tx.query('select decide_approval($1, $2)', [await approvalOf(tx, id), 'approve']);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select cancel_leave($1)', [id])).message).toBe('This leave has already started. Ask HR to change it.');
      await as(tx, f.users.hrA);
      await tx.query('select cancel_leave($1)', [id]);
      expect((await tx.query<{ s: string }>('select status as s from leave_requests where id = $1', [id])).rows[0]!.s).toBe('cancelled');
    });
  });

  it('the ledger can’t be written or edited directly', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await grant(tx, f.employees.icA, 'CL', 1);
      expect((await failure(tx, `insert into leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days)
        values ($1, $2, $3, current_date, 'adjust', 50)`, [f.orgA, f.employees.icA, types.CL])).code).toBe('42501');
      expect((await failure(tx, `update leave_ledger set days = 50 where employee_id = $1`, [f.employees.icA])).code).toBe('42501');
      expect((await failure(tx, `delete from leave_ledger where employee_id = $1`, [f.employees.icA])).code).toBe('42501');
      expect((await failure(tx, `update leave_requests set status = 'approved' where employee_id = $1`, [f.employees.icA])).code).toBe('42501');
    });
  });
});

describe('accrual and lapse', () => {
  it('credits each eligible employee once per period, pro-rates yearly policies, and lapses above the carry-forward cap', async () => {
    const { db } = ctx.t;
    const { f } = ctx;
    await db.exec('begin');
    try {
      const run = async () => (await db.query<{ r: { credited: number; lapsed: number } }>('select worker_leave_accrual() as r')).rows[0]!.r;
      // Last year's closing balances: 5 CL (cap 0) and 40 EL (cap 30) for icA.
      for (const [code, d] of [['CL', 5], ['EL', 40]] as const) {
        await db.query(`insert into leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days)
          values ($1, $2, $3, date_trunc('year', app.org_today($1))::date - 10, 'opening', $4)`, [f.orgA, f.employees.icA, types[code], d]);
      }
      // A yearly type, and a joiner from the first of this month.
      const bl = (await db.query<{ id: string }>(`insert into leave_types (organization_id, code, name) values ($1, 'BL', 'Birthday leave') returning id`, [f.orgA])).rows[0]!.id;
      await db.query(`insert into leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days) values ($1, $2, '2000-01-01', 'yearly', 12)`, [f.orgA, bl]);
      await db.query(`update employees set date_of_joining = date_trunc('month', app.org_today(organization_id))::date where id = $1`, [f.employees.peerA]);

      const first = await run();
      expect(first.lapsed).toBe(2);
      const second = await run();
      expect(second).toEqual({ credited: 0, lapsed: 0 });

      const sum = async (employee: string, code: string, kind: string) => Number((await db.query<{ s: string }>(
        `select coalesce(sum(days), 0) as s from leave_ledger where employee_id = $1 and leave_type_id = $2 and kind = $3`, [employee, code === 'BL' ? bl : types[code], kind])).rows[0]!.s);
      expect(await sum(f.employees.icA, 'CL', 'lapse')).toBe(-5);
      expect(await sum(f.employees.icA, 'EL', 'lapse')).toBe(-10);
      expect(await sum(f.employees.icA, 'CL', 'accrual')).toBe(1);
      expect(await sum(f.employees.icA, 'EL', 'accrual')).toBe(1.25);
      expect(await sum(f.employees.icA, 'BL', 'accrual')).toBe(12);
      const month = Number((await db.query<{ m: string }>(`select extract(month from app.org_today($1)) as m`, [f.orgA])).rows[0]!.m);
      expect(await sum(f.employees.peerA, 'BL', 'accrual')).toBe(Math.round((12 * (13 - month)) / 12 * 2) / 2);
    } finally {
      await db.exec('rollback');
    }
  });

  it('skips probation for EL, people who joined after the 15th, and people who have not joined', async () => {
    const { db } = ctx.t;
    const { f } = ctx;
    await db.exec('begin');
    try {
      await db.query(`update employees set probation_end_date = app.org_today(organization_id) + 30 where id = $1`, [f.employees.icA]);
      await db.query(`update employees set date_of_joining = date_trunc('month', app.org_today(organization_id))::date + 20 where id = $1`, [f.employees.leadA]);
      await db.query('select worker_leave_accrual()');
      const accrued = async (employee: string, code: string) => (await db.query(
        `select 1 from leave_ledger where employee_id = $1 and leave_type_id = $2 and kind = 'accrual'`, [employee, types[code]])).rows.length;
      expect(await accrued(f.employees.icA, 'EL')).toBe(0);
      expect(await accrued(f.employees.icA, 'CL')).toBe(1);
      expect(await accrued(f.employees.leadA, 'CL')).toBe(0);
    } finally {
      await db.exec('rollback');
    }
  });
});

describe('balance = ledger sum (property-based)', () => {
  type Op =
    | { op: 'grant'; days: number }
    | { op: 'apply'; start: number; len: number }
    | { op: 'decide'; which: number; approve: boolean }
    | { op: 'cancel'; which: number };

  const ops = fc.array(fc.oneof(
    fc.record({ op: fc.constant('grant' as const), days: fc.integer({ min: -2, max: 4 }).filter((d) => d !== 0) }),
    fc.record({ op: fc.constant('apply' as const), start: fc.integer({ min: 0, max: 20 }), len: fc.integer({ min: 0, max: 3 }) }),
    fc.record({ op: fc.constant('decide' as const), which: fc.nat(), approve: fc.boolean() }),
    fc.record({ op: fc.constant('cancel' as const), which: fc.nat() }),
  ), { maxLength: 14 });

  it('holds after any sequence of grants, requests, decisions and cancellations', async () => {
    const { f } = ctx;
    await fc.assert(fc.asyncProperty(ops, async (sequence: Op[]) => {
      await ctx.t.asUser(f.users.hrA, async (tx) => {
        const requests: string[] = [];
        let negativeAdjustment = false;
        const attempt = async (sql: string, params: unknown[]) => {
          await tx.exec('savepoint step');
          try {
            const r = await tx.query<{ v: string }>(sql, params);
            await tx.exec('release savepoint step');
            return r.rows[0]?.v;
          } catch {
            await tx.exec('rollback to savepoint step'); // refused operations are part of the property
            return undefined;
          }
        };
        for (const step of sequence) {
          if (step.op === 'grant') {
            await as(tx, f.users.hrA);
            await attempt(`select adjust_leave_balance($1, $2, $3, 'prop')::text as v`, [f.employees.icA, types.CL, step.days]);
            if (step.days < 0) negativeAdjustment = true;
          } else if (step.op === 'apply') {
            await as(tx, f.users.icA);
            const id = await attempt('select apply_leave($1, $2, $3, $4) as v', [f.employees.icA, types.CL, day(step.start), day(step.start + step.len)]);
            if (id) requests.push(id);
          } else if (step.op === 'decide' && requests.length) {
            await as(tx, f.users.leadA);
            const req = requests[step.which % requests.length]!;
            const approval = await attempt('select approval_request_id::text as v from leave_requests where id = $1', [req]);
            if (approval) await attempt('select decide_approval($1, $2, $3)::text as v', [approval, step.approve ? 'approve' : 'reject', 'no']);
          } else if (step.op === 'cancel' && requests.length) {
            await as(tx, f.users.icA);
            await attempt('select cancel_leave($1)::text as v', [requests[step.which % requests.length]!]);
          }

          await as(tx, f.users.hrA); // check as HR, who can see everything about icA
          const { rows } = await tx.query<{ balance: string; pending: string; available: string; ledger: string; pending_sum: string }>(
            `select b.balance, b.pending, b.available,
                    (select coalesce(sum(days), 0) from leave_ledger where employee_id = $1 and leave_type_id = $2) as ledger,
                    (select coalesce(sum(days), 0) from leave_requests where employee_id = $1 and leave_type_id = $2 and status = 'pending') as pending_sum
               from leave_balances($1) b where b.code = 'CL'`,
            [f.employees.icA, types.CL]);
          const r = rows[0]!;
          expect(Number(r.balance)).toBe(Number(r.ledger));
          expect(Number(r.pending)).toBe(Number(r.pending_sum));
          expect(Number(r.available)).toBe(Number(r.balance) - Number(r.pending));
          // Requests never take a non-negative type below zero; only an HR adjustment can.
          if (!negativeAdjustment) expect(Number(r.available)).toBeGreaterThanOrEqual(0);
        }
      });
    }), { numRuns: 25 });
  });
});
