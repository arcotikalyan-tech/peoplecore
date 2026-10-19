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

describe('id studio', () => {
  it('HR keeps card designs with one default; everyone reads them; fields and colours are checked', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const a = (await tx.query<{ id: string }>(`insert into id_card_designs (organization_id, name, is_default) values ($1, 'Classic', true) returning id`, [f.orgA])).rows[0]!.id;
      const b = (await tx.query<{ id: string }>(`insert into id_card_designs (organization_id, name, template, primary_color) values ($1, 'Bold', 'bold', '#0f766e') returning id`, [f.orgA])).rows[0]!.id;
      expect((await failure(tx, `insert into id_card_designs (organization_id, name, is_default) values ($1, 'Other', true)`, [f.orgA])).code).toBe('23505');
      expect((await failure(tx, `insert into id_card_designs (organization_id, name, fields) values ($1, 'Bad', '{salary}')`, [f.orgA])).code).toBe('23514');
      expect((await failure(tx, `insert into id_card_designs (organization_id, name, primary_color) values ($1, 'Bad', 'red')`, [f.orgA])).code).toBe('23514');
      await tx.query('select set_default_id_card($1)', [b]);
      expect((await tx.query<{ name: string }>('select name from id_card_designs where is_default')).rows).toEqual([{ name: 'Bold' }]);

      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from id_card_designs')).rows).toHaveLength(2);
      expect((await failure(tx, 'select set_default_id_card($1)', [a])).code).toBe('42501');
      expect((await tx.query(`update id_card_designs set name = 'Mine' where id = $1`, [a])).affectedRows).toBe(0);
      await as(tx, f.users.employeeB);
      expect((await tx.query('select 1 from id_card_designs')).rows).toHaveLength(0);
    });
  });
});
