import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

/** Migration 20261022001600: changing an employee's type through the history, and correcting a joining date. */
const ctx = useDatabase();

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

describe('employee corrections', () => {
  it('changes the employee type through Change assignment, kept in the history', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(`select create_employee($1, 'Cora', 'contract', '2025-01-01') as id`, [f.orgA])).rows[0]!.id;
      await tx.query(`select change_employee_assignment($1, '2025-07-01', 'type_change', null, null, null, null, 'Confirmed after the contract', 'permanent')`, [id]);
      expect((await tx.query<{ employment_type: string }>('select employment_type from employees where id = $1', [id])).rows[0]!.employment_type).toBe('permanent');
      const history = (await tx.query<{ type: string; reason: string }>(
        'select employment_type as type, change_reason as reason from employment_records where employee_id = $1 order by effective_from', [id])).rows;
      expect(history).toEqual([{ type: 'contract', reason: 'joining' }, { type: 'permanent', reason: 'type_change' }]);
      // Other changes keep the type.
      await tx.query(`select change_employee_assignment($1, '2025-08-01', 'transfer', $2, null, null, null)`, [id, f.deptA]);
      expect((await tx.query<{ t: string }>('select employment_type as t from employment_records where employee_id = $1 and change_reason = $2', [id, 'transfer'])).rows[0]!.t).toBe('permanent');
    });
  });

  it('corrects a joining date, moving the joining entry and the status; never past a later change', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(`select create_employee($1, 'Ravi', 'permanent', '2025-01-10') as id`, [f.orgA])).rows[0]!.id;
      await tx.query(`select correct_joining_date($1, '2025-01-01')`, [id]);
      expect((await tx.query<{ d: string; s: string }>('select date_of_joining::text as d, status::text as s from employees where id = $1', [id])).rows[0]).toEqual({ d: '2025-01-01', s: 'active' });
      expect((await tx.query<{ d: string }>(`select effective_from::text as d from employment_records where employee_id = $1 and change_reason = 'joining'`, [id])).rows[0]!.d).toBe('2025-01-01');

      // A joining date in the future makes them pre-joining again.
      await tx.query(`select correct_joining_date($1, (current_date + 30))`, [id]);
      expect((await tx.query<{ s: string }>('select status::text as s from employees where id = $1', [id])).rows[0]!.s).toBe('pre_joining');
      await tx.query(`select correct_joining_date($1, '2025-01-01')`, [id]);

      await tx.query(`select change_employee_assignment($1, '2025-03-01', 'transfer', $2, null, null, null)`, [id, f.deptA]);
      expect((await failure(tx, `select correct_joining_date($1, '2025-03-15')`, [id])).message).toBe('The joining date must be before the first change in their history (1 Mar 2025).');
    });
    expect(await pgError(ctx.t.asUser(f.users.icA, (tx) => tx.query(`select correct_joining_date($1, '2020-01-01')`, [f.employees.peerA])))).toBe('42501');
  });
});
