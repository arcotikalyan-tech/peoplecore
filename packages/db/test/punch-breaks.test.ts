import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261102120000: punches say what they are (check in, lunch, break, check out); breaks come off worked time. */
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

/**
 * Punches at clock times on a past day (yesterday, or earlier), in the organization's time zone: always in the past,
 * within the 72 hours a punch may be late, and inside one work day whenever the tests run.
 */
async function dayClock(tx: Transaction, org: string, daysAgo: number) {
  await tx.exec('reset role');
  const { rows } = await tx.query<{ d: string; tz: string }>(
    `select (app.org_today(id) - $2::int)::text as d, timezone as tz from organizations where id = $1`, [org, daysAgo]);
  const { d, tz } = rows[0]!;
  return {
    date: d,
    at: async (hhmm: string) => (await tx.query<{ t: string }>(`select (($1::date + $2::time)::timestamp at time zone $3)::text as t`, [d, hhmm, tz])).rows[0]!.t,
  };
}

describe('lunch and breaks', () => {
  it('keeps the day in order: check in first, one lunch or break at a time, end the one that is on', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const day = await dayClock(tx, f.orgA, 1);
      await as(tx, f.users.icA);
      const punch = async (hhmm: string, kind: string | null) => {
        const at = await day.at(hhmm);
        return `select record_punch(p_client_id => 'punch-${randomUUID()}', p_punched_at => '${at}', p_method => 'web', p_org => '${f.orgA}'${kind ? `, p_kind => '${kind}'` : ''})`;
      };
      const refused = async (hhmm: string, kind: string) => (await failure(tx, await punch(hhmm, kind))).message;

      expect(await refused('08:50', 'lunch_start')).toBe('Check in first.');
      await tx.query(await punch('09:00', 'in'));
      expect(await refused('09:05', 'in')).toBe('You’re already checked in.');
      expect(await refused('09:10', 'lunch_end')).toBe('You aren’t on lunch.');
      await tx.query(await punch('13:00', 'lunch_start'));
      expect(await refused('13:10', 'break_start')).toBe('You’re on lunch already: end it first.');
      expect(await refused('13:15', 'break_end')).toBe('You aren’t on a break.');
      await tx.query(await punch('13:45', 'lunch_end'));
      await tx.query(await punch('16:00', 'break_start'));
      await tx.query(await punch('16:15', 'break_end'));
      await tx.query(await punch('18:30', 'out'));
      expect(await refused('18:40', 'out')).toBe('Check in first.');

      await tx.exec('reset role');
      const kinds = (await tx.query<{ kind: string }>(
        `select kind::text from attendance_punches where employee_id = $1 and punched_at::date between $2::date - 1 and $2::date + 1 order by punched_at`,
        [f.employees.icA, day.date])).rows.map((r) => r.kind);
      expect(kinds).toEqual(['in', 'lunch_start', 'lunch_end', 'break_start', 'break_end', 'out']);
    });
  });

  it('takes the larger of the rule’s break and the breaks taken off worked time; punch_count counts check-ins and check-outs', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const days = await Promise.all([1, 2].map((n) => dayClock(tx, f.orgA, n)));
      await tx.exec('reset role');
      // Straight into the table, as a device import would (kinds included), so any past day can be used.
      const add = async (day: (typeof days)[number], hhmm: string, kind: string | null) =>
        tx.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key, kind) values ($1, $2, $3, 'web', $4, $5)`,
          [f.orgA, f.employees.icA, await day.at(hhmm), `test:${randomUUID()}`, kind]);
      const figures = async (date: string) => (await tx.query<{ worked_minutes: number; break_minutes: number; punch_count: number }>(
        'select worked_minutes, break_minutes, punch_count from attendance_days where employee_id = $1 and work_date = $2', [f.employees.icA, date])).rows[0];

      // 9 hours at work with 45 minutes of lunch and a 15-minute break: the hour comes off, a full 8 hours.
      const [one, two] = days as [(typeof days)[number], (typeof days)[number]];
      for (const [hhmm, kind] of [['09:00', 'in'], ['13:00', 'lunch_start'], ['13:45', 'lunch_end'], ['16:00', 'break_start'], ['16:15', 'break_end'], ['18:00', 'out']] as const) {
        await add(one, hhmm, kind);
      }
      expect(await figures(one.date)).toEqual({ worked_minutes: 480, break_minutes: 60, punch_count: 2 });

      // An hour and a half of lunch and breaks: the extra half hour comes off too.
      for (const [hhmm, kind] of [['09:00', null], ['12:30', 'lunch_start'], ['13:45', 'lunch_end'], ['16:00', 'break_start'], ['16:15', 'break_end'], ['18:00', null]] as const) {
        await add(two, hhmm, kind);
      }
      expect(await figures(two.date)).toEqual({ worked_minutes: 450, break_minutes: 90, punch_count: 2 });
    });
  });

  it('a break with no recorded breaks keeps the rule’s break, and checking out ends a lunch that was left on', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const day = await dayClock(tx, f.orgA, 1);
      await tx.exec('reset role');
      const add = async (hhmm: string, kind: string | null) =>
        tx.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key, kind) values ($1, $2, $3, 'biometric', $4, $5)`,
          [f.orgA, f.employees.icA, await day.at(hhmm), `test:${randomUUID()}`, kind]);
      const figures = async () => (await tx.query<{ worked_minutes: number; break_minutes: number }>(
        'select worked_minutes, break_minutes from attendance_days where employee_id = $1 and work_date = $2', [f.employees.icA, day.date])).rows[0];

      await add('09:00', null);
      await add('18:00', null);
      expect(await figures()).toEqual({ worked_minutes: 480, break_minutes: 0 });
      // Lunch started at 17:00 and never ended: it runs to the check-out.
      await add('17:00', 'lunch_start');
      expect(await figures()).toEqual({ worked_minutes: 480, break_minutes: 60 });
    });
  });

  it('asks for the selfie with lunch and break punches too when the rule asks for one', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const day = await dayClock(tx, f.orgA, 1);
      await tx.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key, kind) values ($1, $2, $3, 'web', $4, 'in')`,
        [f.orgA, f.employees.icA, await day.at('09:00'), `test:${randomUUID()}`]);
      await tx.query('update shifts set verify_selfie = true where organization_id = $1', [f.orgA]);
      await as(tx, f.users.icA);
      const lunch = await failure(tx, `select record_punch(p_client_id => $1, p_punched_at => $2, p_method => 'web', p_org => $3, p_kind => 'lunch_start')`,
        [`punch-${randomUUID()}`, await day.at('13:00'), f.orgA]);
      expect(lunch.message).toBe('Your attendance rule needs a selfie with every punch.');
    });
  });
});
