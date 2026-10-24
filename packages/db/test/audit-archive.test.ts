import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

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

const hex = (s: string) => createHash('sha256').update(s).digest('hex');

describe('the audit log’s daily archive', () => {
  it('records days in order with a hash chain; counts must match the log; records can’t change; audit readers check it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const day = (n: number) => tx.query<{ d: string }>(`select to_char((now() at time zone 'UTC')::date - $1::int, 'YYYY-MM-DD') as d`, [n]).then((r) => r.rows[0]!.d);
      const [d3, d2, d1] = [await day(3), await day(2), await day(1)];
      await tx.query(`update organizations set created_at = (($2::date)::timestamp at time zone 'UTC') + interval '9 hours' where id = $1`, [f.orgA, d3]);
      await tx.query(`insert into audit_events (organization_id, occurred_at, action, entity_type) values
                      ($1, ($2::date)::timestamp at time zone 'UTC' + interval '10 hours', 'insert', 'archive_test'),
                      ($1, ($2::date)::timestamp at time zone 'UTC' + interval '11 hours', 'update', 'archive_test')`, [f.orgA, d2]);
      await tx.exec('set local role service_role');

      const due = (await tx.query<{ organization_id: string; day: string }>(`select organization_id, to_char(day, 'YYYY-MM-DD') as day from worker_audit_archive_due(500) where organization_id = $1`, [f.orgA])).rows;
      expect(due.map((r) => r.day)).toEqual([d3, d2, d1]);
      const rows2 = (await tx.query<{ id: number }>('select id from worker_audit_day($1, $2)', [f.orgA, d2])).rows;
      expect(rows2.length).toBeGreaterThanOrEqual(2);

      expect((await failure(tx, 'select worker_record_audit_archive($1, $2, 0, null, null, $3, null)', [f.orgA, d2, hex('')])).message).toMatch(/is not the next day/);
      const chain3 = (await tx.query<{ c: string }>('select worker_record_audit_archive($1, $2, 0, null, null, $3, null) as c', [f.orgA, d3, hex('')])).rows[0]!.c;
      expect(chain3).toBe(hex(`\n${d3}\n0\n${hex('')}`));
      expect((await failure(tx, `select worker_record_audit_archive($1, $2, 1, 1, 1, $3, $4)`, [f.orgA, d2, hex('x'), `${f.orgA}/${d2.slice(0, 4)}/${d2}.jsonl.gz`])).message)
        .toMatch(/^The day has \d+ events, not 1\.$/);
      expect((await failure(tx, `select worker_record_audit_archive($1, $2, $3, 1, 2, $4, 'elsewhere.gz')`, [f.orgA, d2, rows2.length, hex('x')])).code).toBe('23514');
      const chain2 = (await tx.query<{ c: string }>(`select worker_record_audit_archive($1, $2, $3, $4, $5, $6, $7) as c`,
        [f.orgA, d2, rows2.length, rows2[0]!.id, rows2.at(-1)!.id, hex('two days ago'), `${f.orgA}/${d2.slice(0, 4)}/${d2}.jsonl.gz`])).rows[0]!.c;
      expect(chain2).toBe(hex(`${chain3}\n${d2}\n${rows2.length}\n${hex('two days ago')}`));
      expect((await failure(tx, `select worker_record_audit_archive($1, (now() at time zone 'UTC')::date, 0, null, null, $2, null)`, [f.orgA, hex('')])).code).toBe('22023');

      for (const sql of ['update audit_archives set row_count = 0', 'delete from audit_archives']) {
        expect((await failure(tx, sql)).code, sql).toBe('42501'); // the worker may only add days
      }
      await tx.exec('reset role'); // and even the database owner can't change one
      for (const sql of ['update audit_archives set row_count = 0', 'delete from audit_archives']) {
        expect((await failure(tx, sql)).message, sql).toBe('audit_archives is append-only');
      }
      await tx.exec('set local role service_role');

      await tx.exec('reset role');
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [f.users.icA]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: f.users.icA, role: 'authenticated', aal: 'aal2' })]);
      await tx.exec('set local role authenticated');
      expect((await tx.query('select * from audit_archive_check($1)', [f.orgA])).rows).toHaveLength(0);
      expect((await tx.query('select 1 from audit_archives')).rows).toHaveLength(0);
      expect((await failure(tx, 'select * from worker_audit_archive_due()')).code).toBe('42501');

      await tx.exec('reset role');
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [f.users.ownerA]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: f.users.ownerA, role: 'authenticated', aal: 'aal2' })]);
      await tx.exec('set local role authenticated');
      const check = (await tx.query<{ day: string; row_count: number; rows_now: number }>(
        `select to_char(day, 'YYYY-MM-DD') as day, row_count, rows_now from audit_archive_check($1)`, [f.orgA])).rows;
      expect(check).toEqual([{ day: d2, row_count: rows2.length, rows_now: rows2.length }, { day: d3, row_count: 0, rows_now: 0 }]);
    });
  });
});
