import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/**
 * Migration 20261019000300: leave rules (save_leave_rule), assignments, rule limits on requests, quarterly and
 * catch-up accrual, carry-forward expiry, balance buckets and edits, encashment, donation, skip-level approval,
 * the team calendar and the balance sheet's visibility.
 */
const ctx = useDatabase();
const types: Record<string, string> = {};
let monday = ''; // a Monday at least two weeks ahead (org-local)
let today = '';

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

const day = (offset: number, from = monday) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const rule = (tx: Transaction, type: string | null, p: Record<string, unknown>) =>
  tx.query<{ id: string }>('select save_leave_rule($1, $2, $3) as id', [ctx.f.orgA, type, JSON.stringify(p)]).then((r) => r.rows[0]!.id);
const grant = (tx: Transaction, employee: string, type: string, days: number) =>
  tx.query(`select adjust_leave_balance($1, $2, $3, 'Opening balance', 'opening')`, [employee, type, days]);
const ledgerSum = (tx: Transaction, employee: string, type: string, kind?: string) =>
  tx.query<{ s: string }>(`select coalesce(sum(days), 0) as s from leave_ledger where employee_id = $1 and leave_type_id = $2 and ($3::text is null or kind::text = $3)`,
    [employee, type, kind ?? null]).then((r) => Number(r.rows[0]!.s));

beforeAll(async () => {
  const { rows } = await ctx.t.db.query<{ code: string; id: string }>('select code, id from leave_types where organization_id = $1', [ctx.f.orgA]);
  for (const r of rows) types[r.code] = r.id;
  const d = (await ctx.t.db.query<{ m: string; t: string }>(
    `select to_char(t + 14 + ((8 - extract(isodow from t + 14)::int) % 7), 'YYYY-MM-DD') as m, to_char(t, 'YYYY-MM-DD') as t from (select app.org_today($1) as t) x`,
    [ctx.f.orgA])).rows[0]!;
  monday = d.m;
  today = d.t;
});

describe('leave rules', () => {
  it('HR creates and edits a rule; only HR may; existing types were given categories and annual days', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const cats = (await tx.query<{ code: string; category: string; annual: string }>(
        `select t.code, t.category, p.annual_days::text as annual from leave_types t join leave_policies p on p.leave_type_id = t.id
          where t.organization_id = $1 order by t.code`, [f.orgA])).rows;
      expect(cats).toEqual([
        { code: 'CL', category: 'casual', annual: '12.00' }, { code: 'EL', category: 'earned', annual: '15.00' },
        { code: 'EVL', category: 'event', annual: '3.00' }, { code: 'LOP', category: 'lop', annual: '0.00' }, { code: 'SL', category: 'sick', annual: '12.00' },
      ]);

      const id = await rule(tx, null, {
        name: 'Event leave', category: 'event', short_name: 'ev', annual_days: 4, accrue_over_year: true, accrual_frequency: 'quarterly',
        carry_forward: true, carry_forward_max: 2, count_weekends: true, max_continuous: 2,
      });
      const t = (await tx.query<{ code: string; short_name: string; count_weekends: boolean; count_holidays: boolean }>(
        'select code, short_name, count_weekends, count_holidays from leave_types where id = $1', [id])).rows[0];
      expect(t).toEqual({ code: 'EV', short_name: 'EV', count_weekends: true, count_holidays: false });
      const p = (await tx.query<{ accrual_period: string; accrual_days: string; carry_forward_max: string; max_continuous: string }>(
        'select accrual_period, accrual_days::text, carry_forward_max::text, max_continuous::text from leave_policies where leave_type_id = $1', [id])).rows;
      expect(p).toEqual([{ accrual_period: 'quarterly', accrual_days: '1.00', carry_forward_max: '2.00', max_continuous: '2.0' }]);

      // Editing the same day replaces today's version; upfront grants become "yearly"; no carry-forward → cap 0.
      await rule(tx, id, { name: 'Event leave', category: 'event', short_name: 'EV', annual_days: 6, accrue_over_year: false });
      const p2 = (await tx.query<{ accrual_period: string; accrual_days: string; carry_forward_max: string }>(
        'select accrual_period, accrual_days::text, carry_forward_max::text from leave_policies where leave_type_id = $1', [id])).rows;
      expect(p2).toEqual([{ accrual_period: 'yearly', accrual_days: '6.00', carry_forward_max: '0.00' }]);
      // A second rule with the same short name gets a unique code.
      const again = await rule(tx, null, { name: 'Event leave two', short_name: 'EV', annual_days: 1 });
      expect((await tx.query<{ code: string }>('select code from leave_types where id = $1', [again])).rows[0]!.code).toBe('EV2');

      expect((await failure(tx, 'select save_leave_rule($1, null, $2)', [f.orgA, JSON.stringify({ name: 'X' })])).message)
        .toBe('Give the leave rule a name (2 to 60 characters).');
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select save_leave_rule($1, null, $2)', [f.orgA, JSON.stringify({ name: 'Mine' })])).code).toBe('42501');
      expect((await failure(tx, 'select save_leave_rule($1, null, $2)', [f.orgB, JSON.stringify({ name: 'Theirs' })])).code).toBe('42501');
    });
  });

  it('a rule for assigned employees applies only to them, from the assignment date', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = await rule(tx, null, { name: 'Paternity leave', category: 'paternity', annual_days: 0, allow_negative: true, applies_to: 'assigned' });
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select apply_leave($1, $2, $3, $4)', [f.employees.icA, id, day(0), day(0)])).message)
        .toBe('Paternity leave isn’t one of the leave rules assigned to Ishan Demo.');
      expect((await tx.query('select 1 from leave_balances($1) where leave_type_id = $2', [f.employees.icA, id])).rows).toHaveLength(0);
      // Employees can't assign rules to themselves.
      expect((await failure(tx, 'insert into leave_type_assignments (organization_id, employee_id, leave_type_id, effective_from) values ($1, $2, $3, $4)',
        [f.orgA, f.employees.icA, id, today])).code).toBe('42501');

      await as(tx, f.users.hrA);
      await tx.query('insert into leave_type_assignments (organization_id, employee_id, leave_type_id, effective_from) values ($1, $2, $3, $4)',
        [f.orgA, f.employees.icA, id, today]);
      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from leave_balances($1) where leave_type_id = $2', [f.employees.icA, id])).rows).toHaveLength(1);
      await tx.query('select apply_leave($1, $2, $3, $4)', [f.employees.icA, id, day(0), day(0)]);
      // Visible to the employee, not to a peer.
      expect((await tx.query('select 1 from leave_type_assignments where leave_type_id = $1', [id])).rows).toHaveLength(1);
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from leave_type_assignments where leave_type_id = $1', [id])).rows).toHaveLength(0);
    });
  });
});

describe('rule limits on requests', () => {
  it('continuous, monthly, future-notice, backdated, probation and notice-period limits; HR is not held to timing limits', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = await rule(tx, null, {
        name: 'Limited leave', annual_days: 0, allow_negative: true, max_continuous: 2, max_per_month: 3,
        allow_future: true, future_notice_days: 3, allow_backdated: true, backdated_max_days: 5,
      });
      await as(tx, f.users.icA);
      const msg = async (start: string, end: string) => (await failure(tx, 'select apply_leave($1, $2, $3, $4)', [f.employees.icA, id, start, end])).message;
      expect(await msg(day(0), day(2))).toBe('At most 2 day(s) of Limited leave in one request.');
      expect(await msg(day(1, today), day(1, today))).toBe('Request Limited leave at least 3 day(s) ahead.');
      expect(await msg(day(-9, today), day(-9, today))).toBe('Limited leave can be requested at most 5 day(s) back.');

      // Monthly cap: two days in one request, then two more in the same month go over 3. Pick a month with room.
      const first = (await tx.query<{ d: string }>(`select to_char(date_trunc('month', $1::date + 40)::date, 'YYYY-MM-DD') as d`, [today])).rows[0]!.d;
      const mon = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series($1::date, $1::date + 6, interval '1 day') d
                                                  where extract(isodow from d) = 1 limit 1`, [first])).rows[0]!.d;
      await tx.query('select apply_leave($1, $2, $3, $4)', [f.employees.icA, id, mon, day(1, mon)]);
      expect(await msg(day(7, mon), day(8, mon))).toMatch(/^At most 3 day\(s\) of Limited leave a month; \w+ already has 2\.$/);
      await tx.query('select apply_leave($1, $2, $3, $4)', [f.employees.icA, id, day(7, mon), day(7, mon)]);

      // HR applying for icA isn't held to the notice period: a working day within it (tomorrow, the day after, or
      // today, whichever is first a weekday: on a Friday both of the next days are weekly offs).
      await as(tx, f.users.hrA);
      const soon = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from unnest(array[$1::date + 1, $1::date + 2, $1::date]) d
                                                   where extract(isodow from d) < 6 limit 1`, [today])).rows[0]!.d;
      await tx.query('select apply_leave($1, $2, $3, $4)', [f.employees.icA, id, soon, soon]);

      // No future dates at all; then probation.
      await rule(tx, id, { name: 'Limited leave', annual_days: 0, allow_negative: true, allow_future: false, applies_during_probation: false, allowed_on_notice: false });
      await as(tx, f.users.icA);
      expect(await msg(day(0), day(0))).toBe('Limited leave can’t be requested for future dates.');
      await as(tx, f.users.hrA);
      await tx.query(`update employees set probation_end_date = $2::date + 90 where id = $1`, [f.employees.icA, today]);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select apply_leave($1, $2, $3, $4)', [f.employees.icA, id, day(-1, today), day(-1, today)])).message)
        .toMatch(/^Limited leave can’t be taken during probation \(until /);
    });
  });

  it('weekends and holidays count separately', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const cal = (await tx.query<{ id: string }>(`select id from holiday_calendars where organization_id = $1 and location_id is null`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into holidays (organization_id, calendar_id, holiday_date, name) values ($1, $2, $3, 'Test holiday')`, [f.orgA, cal, day(2)]);
      const weekends = await rule(tx, null, { name: 'Weekend counter', annual_days: 0, allow_negative: true, count_weekends: true });
      const holidays = await rule(tx, null, { name: 'Holiday counter', annual_days: 0, allow_negative: true, count_holidays: true });
      await tx.exec('reset role'); // app.leave_days is internal
      const days = async (type: string) => Number((await tx.query<{ d: string }>('select app.leave_days($1, $2, $3, $4, false, false) as d',
        [f.employees.icA, type, day(0), day(6)])).rows[0]!.d);
      expect(await days(types.CL!)).toBe(4);
      expect(await days(weekends)).toBe(6);
      expect(await days(holidays)).toBe(5);
    });
  });
});

describe('accrual', () => {
  it('quarterly accrual credits each quarter once; catch-up stops at the organization’s accrual start', async () => {
    const { db } = ctx.t;
    const { f } = ctx;
    await db.exec('begin');
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [f.users.hrA]);
      await db.query(`update leave_settings set accrual_start = date_trunc('year', app.org_today(organization_id))::date where organization_id = $1`, [f.orgA]);
      await db.query(`update employees set date_of_joining = date_trunc('year', app.org_today(organization_id))::date - 400 where organization_id = $1`, [f.orgA]);
      const q = (await db.query<{ id: string }>(`insert into leave_types (organization_id, code, name) values ($1, 'QL', 'Quarterly leave') returning id`, [f.orgA])).rows[0]!.id;
      await db.query(`insert into leave_policies (organization_id, leave_type_id, effective_from, accrual_period, accrual_days, annual_days)
                      values ($1, $2, '2000-01-01', 'quarterly', 2, 8)`, [f.orgA, q]);
      await db.query('select worker_leave_accrual()');
      await db.query('select worker_leave_accrual()');
      const month = Number((await db.query<{ m: string }>(`select extract(month from app.org_today($1)) as m`, [f.orgA])).rows[0]!.m);
      const tx = db as unknown as Transaction;
      expect(await ledgerSum(tx, f.employees.icA, q, 'accrual')).toBe(2 * Math.ceil(month / 3));
      // Monthly CL catches up every month since the start of the year.
      expect(await ledgerSum(tx, f.employees.icA, types.CL!, 'accrual')).toBe(month);
    } finally {
      await db.exec('rollback');
    }
  });

  it('carried-forward leave expires at the end of the next year when unused; carry is recorded once', async () => {
    const { db } = ctx.t;
    const { f } = ctx;
    await db.exec('begin');
    try {
      const tx = db as unknown as Transaction;
      await db.query(`update leave_settings set carry_forward_expiry = 'year_end' where organization_id = $1`, [f.orgA]);
      await db.query(`update employees set date_of_joining = '2020-01-01' where organization_id = $1`, [f.orgA]);
      // icA carried 10 EL into last year (recorded), used 4 of it last year and has 6 + 20 more.
      const y = (await db.query<{ s: string; p: string }>(`select to_char(date_trunc('year', app.org_today($1)), 'YYYY-MM-DD') as s,
        to_char(date_trunc('year', app.org_today($1)) - interval '1 year', 'YYYY-MM-DD') as p`, [f.orgA])).rows[0]!;
      await db.query(`insert into leave_carry_forwards (organization_id, employee_id, leave_type_id, cycle_start, days) values ($1, $2, $3, $4, 10)`,
        [f.orgA, f.employees.icA, types.EL, y.p]);
      await db.query(`insert into leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days) values
        ($1, $2, $3, $4::date - 1, 'opening', 10), ($1, $2, $3, $4::date + 10, 'debit', -4), ($1, $2, $3, $4::date + 20, 'accrual', 20)`,
        [f.orgA, f.employees.icA, types.EL, y.p]);
      const r = (await db.query<{ r: { lapsed: number } }>('select worker_leave_accrual() as r')).rows[0]!.r;
      expect(r.lapsed).toBe(1);
      expect(await ledgerSum(tx, f.employees.icA, types.EL!, 'lapse')).toBe(-6);
      const carried = (await db.query<{ days: string }>('select days::text from leave_carry_forwards where employee_id = $1 and leave_type_id = $2 and cycle_start = $3',
        [f.employees.icA, types.EL, y.s])).rows[0]!.days;
      expect(carried).toBe('20.00');
      await db.query('select worker_leave_accrual()');
      expect(await ledgerSum(tx, f.employees.icA, types.EL!, 'lapse')).toBe(-6);
    } finally {
      await db.exec('rollback');
    }
  });

  it('only HR may run the recalculation, for their own organization', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const r = (await tx.query<{ r: { credited: number } }>('select recalculate_leave($1) as r', [f.orgA])).rows[0]!.r;
      expect(r).toHaveProperty('credited');
      expect((await failure(tx, 'select recalculate_leave($1)', [f.orgB])).code).toBe('42501');
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select recalculate_leave($1)', [f.orgA])).code).toBe('42501');
    });
  });
});

describe('balances', () => {
  it('buckets add up; HR edits carried, credited and penalty as ledger rows; employees see only themselves', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query('select set_leave_balance($1, $2, 4, 6, 1, $3)', [f.employees.icA, types.CL, 'Migrated from the old system']);
      const sheet = async () => (await tx.query<{ carried: string; credited: string; applied: string; penalty: string; balance: string }>(
        `select carried::text, credited::text, applied::text, penalty::text, balance::text from leave_balance_sheet($1) where employee_id = $2 and leave_type_id = $3`,
        [f.orgA, f.employees.icA, types.CL])).rows[0]!;
      const before = await sheet();
      expect(Number(before.carried)).toBe(4);
      expect(Number(before.credited)).toBe(6);
      expect(Number(before.penalty)).toBe(1);
      expect(Number(before.balance)).toBe(9);
      // Saving the same figures writes nothing.
      const rows = async () => Number((await tx.query<{ n: string }>('select count(*) as n from leave_ledger where employee_id = $1', [f.employees.icA])).rows[0]!.n);
      const n = await rows();
      await tx.query('select set_leave_balance($1, $2, 4, 6, 1, $3)', [f.employees.icA, types.CL, 'No change']);
      expect(await rows()).toBe(n);
      expect((await failure(tx, 'select set_leave_balance($1, $2, 4, 6, 1, $3)', [f.employees.icA, types.CL, ' '])).message).toBe('Say why the balance is being changed.');

      await as(tx, f.users.icA);
      expect((await failure(tx, 'select set_leave_balance($1, $2, 4, 6, 1, $3)', [f.employees.icA, types.CL, 'Mine'])).code).toBe('42501');
      const visible = (await tx.query<{ e: string }>('select distinct employee_id as e from leave_balance_sheet($1)', [f.orgA])).rows.map((r) => r.e);
      expect(visible).toEqual([f.employees.icA]);
      await as(tx, f.users.managerA); // team scope: their reporting line and themselves
      const team = (await tx.query<{ e: string }>('select distinct employee_id as e from leave_balance_sheet($1)', [f.orgA])).rows.map((r) => r.e).sort();
      expect(team).toEqual([f.employees.managerA, f.employees.leadA, f.employees.icA].sort());
    });
  });
});

describe('encashment and donation', () => {
  it('an encashment request goes to HR; approval debits the ledger', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await grant(tx, f.employees.icA, types.EL!, 10);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select request_leave_encashment($1, $2, 2)', [f.employees.icA, types.CL])).message).toBe('That leave type can’t be encashed.');
      expect((await failure(tx, 'select request_leave_encashment($1, $2, 11)', [f.employees.icA, types.EL])).message).toBe('Only 10 day(s) of Earned leave available to encash.');
      const id = (await tx.query<{ id: string }>('select request_leave_encashment($1, $2, 3, $3) as id', [f.employees.icA, types.EL, 'School fees'])).rows[0]!.id;
      const approval = (await tx.query<{ a: string }>('select approval_request_id as a from leave_encashments where id = $1', [id])).rows[0]!.a;
      await as(tx, f.users.leadA); // a manager can't decide an HR step
      expect((await failure(tx, 'select decide_approval($1, $2)', [approval, 'approve'])).code).toBe('42501');
      await as(tx, f.users.hrA);
      await tx.query('select decide_approval($1, $2)', [approval, 'approve']);
      expect(await ledgerSum(tx, f.employees.icA, types.EL!, 'encashment')).toBe(-3);
      expect((await tx.query<{ s: string }>('select status as s from leave_encashments where id = $1', [id])).rows[0]!.s).toBe('approved');
    });
  });

  it('donation needs the setting, a balance and a colleague; it moves days and tells the recipient', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await grant(tx, f.employees.icA, types.CL!, 5);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select donate_leave($1, $2, 2)', [f.employees.peerA, types.CL])).message).toBe('Leave donation isn’t turned on in this organization.');
      await as(tx, f.users.hrA);
      await tx.query('update leave_settings set donation_enabled = true where organization_id = $1', [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select donate_leave($1, $2, 6)', [f.employees.peerA, types.CL])).message).toBe('Only 5 day(s) of Casual leave available to donate.');
      expect((await failure(tx, 'select donate_leave($1, $2, 1)', [f.employees.icA, types.CL])).message).toBe('Choose a colleague to donate to.');
      expect((await failure(tx, 'select donate_leave($1, $2, 1)', [f.employees.peerA, types.LOP])).message).toBe('Choose a paid leave type with a balance.');
      await tx.query('select donate_leave($1, $2, 2, $3)', [f.employees.peerA, types.CL, 'Get well soon']);
      await as(tx, f.users.hrA);
      expect(await ledgerSum(tx, f.employees.icA, types.CL!, 'donation')).toBe(-2);
      expect(await ledgerSum(tx, f.employees.peerA, types.CL!, 'donation')).toBe(2);
      await as(tx, f.users.peerA);
      expect((await tx.query(`select 1 from notifications where kind = 'leave.donated'`)).rows).toHaveLength(1);
    });
  });
});

describe('skip-level approval', () => {
  it('turning it on adds the manager’s manager as a second step; turning it off removes it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query('update leave_settings set skip_level_approval = true where organization_id = $1', [f.orgA]);
      await grant(tx, f.employees.icA, types.CL!, 3);
      await as(tx, f.users.icA);
      const req = (await tx.query<{ id: string }>('select apply_leave($1, $2, $3, $4) as id', [f.employees.icA, types.CL, day(0), day(0)])).rows[0]!.id;
      const approval = (await tx.query<{ a: string }>('select approval_request_id as a from leave_requests where id = $1', [req])).rows[0]!.a;
      await as(tx, f.users.managerA); // the skip-level manager can't act before the manager
      expect((await failure(tx, 'select decide_approval($1, $2)', [approval, 'approve'])).code).toBe('42501');
      await as(tx, f.users.leadA);
      expect((await tx.query<{ s: string }>('select decide_approval($1, $2) as s', [approval, 'approve'])).rows[0]!.s).toBe('pending');

      await as(tx, f.users.hrA); // can't turn it off while a request waits at that step
      expect((await failure(tx, 'update leave_settings set skip_level_approval = false where organization_id = $1', [f.orgA])).message)
        .toBe('Some requests are waiting for the manager’s manager. Decide them before turning skip-level approval off.');
      await as(tx, f.users.managerA);
      expect((await tx.query<{ s: string }>('select decide_approval($1, $2) as s', [approval, 'approve'])).rows[0]!.s).toBe('approved');

      await as(tx, f.users.hrA);
      await tx.query('update leave_settings set skip_level_approval = false where organization_id = $1', [f.orgA]);
      const steps = (await tx.query<{ n: string }>(`select count(*) as n from approval_flow_steps s join approval_flows w on w.id = s.flow_id
        where w.organization_id = $1 and w.subject_type = 'leave_request' and w.is_active`, [f.orgA])).rows[0]!.n;
      expect(Number(steps)).toBe(1);
    });
  });

  it('attendance settings drive the same for regularizations', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query('update attendance_settings set skip_level_approval = true where organization_id = $1', [f.orgA]);
      const rules = (await tx.query<{ r: string }>(`select s.approver_rule::text as r from approval_flow_steps s join approval_flows w on w.id = s.flow_id
        where w.organization_id = $1 and w.subject_type = 'regularization' and w.is_active order by s.step_no`, [f.orgA])).rows.map((x) => x.r);
      expect(rules).toEqual(['reporting_manager', 'skip_level_manager']);
    });
  });
});

describe('team calendar', () => {
  it('shows the team’s leave without type or reason, and nothing from other teams', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await grant(tx, f.employees.icA, types.CL!, 3);
      await as(tx, f.users.icA);
      await tx.query('select apply_leave($1, $2, $3, $4, false, false, $5)', [f.employees.icA, types.CL, day(0), day(1), 'Private reason']);
      await as(tx, f.users.leadA); // icA reports to leadA
      const rows = (await tx.query<Record<string, unknown>>('select * from team_leave_calendar($1, $2, $3)', [f.orgA, day(0), day(30)])).rows;
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]!).sort()).toEqual(['employee_id', 'end_date', 'half_day_end', 'half_day_start', 'name', 'start_date', 'status']);
      await as(tx, f.users.peerA); // a different team
      expect((await tx.query('select * from team_leave_calendar($1, $2, $3)', [f.orgA, day(0), day(30)])).rows).toHaveLength(0);
    });
  });
});
