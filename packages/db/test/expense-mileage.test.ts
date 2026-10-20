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

describe('mileage', () => {
  it('trips are priced at the rate and collected in one draft claim per month; the rate can be changed or switched off', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const day = (await tx.query<{ d: string }>(`select to_char(app.org_today($1) - 1, 'YYYY-MM-DD') as d`, [f.orgA])).rows[0]!.d;
      const claim = (await tx.query<{ id: string }>(`select log_mileage($1, $2, 25.5, 'Office', 'Client') as id`, [f.orgA, day])).rows[0]!.id;
      const again = (await tx.query<{ id: string }>(`select log_mileage($1, $2, 10, 'Client', 'Office') as id`, [f.orgA, day])).rows[0]!.id;
      expect(again).toBe(claim);
      const items = (await tx.query<{ amount: string; distance_km: string; rate_per_km: string; merchant: string }>(
        'select amount, distance_km, rate_per_km, merchant from expense_items where claim_id = $1 order by amount desc', [claim])).rows;
      expect(items.map((i) => [i.amount, i.distance_km, i.rate_per_km])).toEqual([['306.00', '25.5', '12.00'], ['120.00', '10.0', '12.00']]);
      expect(items[0]!.merchant).toBe('Office → Client');
      expect((await failure(tx, `select log_mileage($1, current_date + 5, 5, 'A1', 'B1')`, [f.orgA])).message).toContain('future');

      await as(tx, f.users.hrA);
      await tx.exec('reset role');
      await tx.query(`insert into expense_settings (organization_id, mileage_enabled) values ($1, false) on conflict (organization_id) do update set mileage_enabled = false`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, `select log_mileage($1, $2, 5, 'Office', 'Client')`, [f.orgA, day])).message).toContain('switched off');
    });
  });
});
