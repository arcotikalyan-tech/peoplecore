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

describe('holiday calendar', () => {
  it('employees choose optional holidays from their calendar within the yearly limit, before the day', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      let cal = (await tx.query<{ id: string }>('select id from holiday_calendars where organization_id = $1 and location_id is null', [f.orgA])).rows[0]?.id;
      cal ??= (await tx.query<{ id: string }>(`insert into holiday_calendars (organization_id, name) values ($1, 'Default') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('update holiday_calendars set optional_limit = 1 where id = $1', [cal]);
      const add = async (date: string, name: string, optional: boolean) => (await tx.query<{ id: string }>(
        'insert into holidays (organization_id, calendar_id, holiday_date, name, is_optional, description) values ($1, $2, $3, $4, $5, $6) returning id',
        [f.orgA, cal, date, name, optional, `${name} holiday`])).rows[0]!.id;
      const diwali = await add('2099-11-01', 'Diwali', true);
      const onam = await add('2099-09-01', 'Onam', true);
      const republic = await add('2099-01-26', 'Republic Day', false);
      const past = await add('2001-03-01', 'Holi', true);

      await as(tx, f.users.icA);
      expect((await tx.query<{ c: string }>('select my_holiday_calendar($1) as c', [f.orgA])).rows[0]!.c).toBe(cal);
      await tx.query('select choose_optional_holiday($1, true)', [diwali]);
      expect((await failure(tx, 'select choose_optional_holiday($1, true)', [onam])).message).toBe('You can take 1 optional holiday a year.');
      expect((await failure(tx, 'select choose_optional_holiday($1, true)', [republic])).message).toBe('This holiday applies to everyone.');
      expect((await failure(tx, 'select choose_optional_holiday($1, true)', [past])).message).toBe('Choose or drop an optional holiday before the day.');
      await tx.query('select choose_optional_holiday($1, false)', [diwali]);
      await tx.query('select choose_optional_holiday($1, true)', [onam]);
      expect((await tx.query<{ holiday_id: string }>('select holiday_id from optional_holiday_choices')).rows).toEqual([{ holiday_id: onam }]);
      expect((await failure(tx, `insert into optional_holiday_choices (organization_id, employee_id, holiday_id) values ($1, $2, $3)`, [f.orgA, f.employees.icA, diwali])).code).toBe('42501');

      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from optional_holiday_choices')).rows).toHaveLength(0);
      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from optional_holiday_choices')).rows).toHaveLength(1);
      await as(tx, f.users.employeeB);
      expect((await failure(tx, 'select choose_optional_holiday($1, true)', [diwali])).code).toBe('42501');
    });
  });
});
