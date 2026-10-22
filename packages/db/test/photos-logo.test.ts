import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261022001400: profile photos and the company logo. */
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

describe('profile photos and the company logo', () => {
  it('people set their own photo, HR sets anyone’s, nobody else; the self-edit block applies', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const path = (emp: string) => `${f.orgA}/${emp}/${randomUUID()}`;
      const set = (emp: string, p: string | null) => tx.query<{ old: string | null }>('select set_employee_photo($1, $2) as old', [emp, p]).then((r) => r.rows[0]!.old);
      const first = path(f.employees.icA);
      expect(await set(f.employees.icA, first)).toBeNull();
      expect(await set(f.employees.icA, path(f.employees.icA))).toBe(first); // the old file, for the server to remove
      expect((await failure(tx, 'select set_employee_photo($1, $2)', [f.employees.peerA, path(f.employees.peerA)])).code).toBe('42501');
      expect((await failure(tx, 'select set_employee_photo($1, $2)', [f.employees.icA, path(f.employees.peerA)])).code).toBe('23514'); // someone else's folder
      await as(tx, f.users.peerA);
      const { rows } = await tx.query<{ photo_path: string | null }>('select photo_path from employees where id = $1', [f.employees.icA]);
      expect(rows[0]?.photo_path ?? 'not visible').not.toBe(first);

      await as(tx, f.users.hrA);
      await set(f.employees.peerA, path(f.employees.peerA));
      expect(await set(f.employees.peerA, null)).toMatch(new RegExp(`^${f.orgA}/${f.employees.peerA}/`));

      // Colleagues see photos of the people on their page of the directory; other organizations don't.
      await as(tx, f.users.leadA);
      const photos = (await tx.query<{ employee_id: string }>('select employee_id from employee_photos($1, $2)', [f.orgA, [f.employees.icA, f.employees.peerA]])).rows;
      expect(photos.map((r) => r.employee_id)).toEqual([f.employees.icA]);
      await as(tx, f.users.ownerB);
      expect((await tx.query('select * from employee_photos($1, $2)', [f.orgA, [f.employees.icA]])).rows).toEqual([]);

      await tx.exec('reset role');
      await tx.query('update org_controls set block_self_edit = true where organization_id = $1', [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select set_employee_photo($1, null)', [f.employees.icA])).message).toMatch(/doesn’t allow editing your own HR record/);
    });
  });

  it('the owner sets the logo; members see it; nobody else changes it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      const logo = `${f.orgA}/logo/${randomUUID()}`;
      expect((await tx.query<{ old: string | null }>('select set_company_logo($1, $2) as old', [f.orgA, logo])).rows[0]!.old).toBeNull();
      await as(tx, f.users.icA);
      expect((await tx.query<{ logo_path: string }>('select logo_path from company_profiles where organization_id = $1', [f.orgA])).rows[0]!.logo_path).toBe(logo);
      expect((await failure(tx, 'select set_company_logo($1, null)', [f.orgA])).code).toBe('42501');
      await as(tx, f.users.ownerB);
      expect((await failure(tx, 'select set_company_logo($1, null)', [f.orgA])).code).toBe('42501');
    });
  });
});
