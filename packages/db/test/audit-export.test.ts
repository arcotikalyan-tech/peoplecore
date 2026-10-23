import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261023000200: downloading the audit log is recorded in it; only people who may read it can. */
const ctx = useDatabase();

async function failure(tx: Transaction, sql: string, params: unknown[] = []): Promise<string | undefined> {
  await tx.exec('savepoint expect_failure');
  try {
    await tx.query(sql, params);
  } catch (err) {
    await tx.exec('rollback to savepoint expect_failure');
    return (err as { code?: string }).code;
  }
  throw new Error(`expected to fail: ${sql}`);
}

describe('audit log export', () => {
  it('is recorded with the period and the number of entries; others are refused', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      await tx.query(`select log_audit_export($1, 42, '2026-10-01', '2026-10-23')`, [f.orgA]);
      await tx.query(`select log_audit_export($1, 0)`, [f.orgA]);
      const rows = (await tx.query<{ actor_user_id: string; action: string; entity_type: string; metadata: unknown }>(
        `select actor_user_id, action, entity_type, metadata from audit_events where entity_type = 'audit_events' order by id`)).rows;
      expect(rows).toEqual([
        { actor_user_id: f.users.ownerA, action: 'export', entity_type: 'audit_events', metadata: { format: 'csv', row_count: 42, from: '2026-10-01', to: '2026-10-23' } },
        { actor_user_id: f.users.ownerA, action: 'export', entity_type: 'audit_events', metadata: { format: 'csv', row_count: 0, from: null, to: null } },
      ]);
      expect(await failure(tx, `select log_audit_export($1, -1)`, [f.orgA])).toBe('22023');
      expect(await failure(tx, `select log_audit_export($1, 1)`, [f.orgB])).toBe('42501'); // another organization
    });
    await ctx.t.asUser(f.users.icA, async (tx) => {
      expect(await failure(tx, `select log_audit_export($1, 1)`, [f.orgA])).toBe('42501');
    });
    await ctx.t.asAnon(async (tx) => {
      expect(await failure(tx, `select log_audit_export($1, 1)`, [f.orgA])).toBe('42501');
    });
  });
});
