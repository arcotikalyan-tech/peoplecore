import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261022001800: check-in photos must be in storage, fresh and used once; phone punches without one are flagged. */
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

describe('check-in photos', () => {
  it('a phone punch with a fresh photo counts; without one it is flagged; a photo is used once', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.exec('reset role');
      await tx.query('update shifts set verify_selfie = true where organization_id = $1', [f.orgA]);
      const stored = async (age = '1 minute') => {
        const name = `${f.orgA}/${f.employees.icA}/${randomUUID()}`;
        await tx.query(`insert into storage.objects (bucket_id, name, created_at) values ('attendance-selfies', $1, now() - $2::interval)`, [name, age]);
        return name;
      };
      const photo = await stored();
      const stale = await stored('2 hours');
      // Review flags are HR's to read, not the employee's: looked up as the database owner.
      const flags = async (punch: string) => {
        await tx.exec('reset role');
        const rules = (await tx.query<{ rule: string }>(`select rule from anomaly_flags where subject_id = $1`, [punch])).rows.map((r) => r.rule);
        await as(tx, f.users.icA);
        return rules;
      };
      const punch = (client: string, method: string, path: string | null) =>
        tx.query<{ id: string }>(`select record_punch($1, null, $2::punch_method, null, null, null, $3, null, $4) as id`, [client, method, f.orgA, path]).then((r) => r.rows[0]!.id);

      await as(tx, f.users.icA);
      const withPhoto = await punch(`mob-${randomUUID()}`, 'mobile', photo);
      expect(await flags(withPhoto)).not.toContain('no_selfie');
      expect((await tx.query<{ p: string }>('select selfie_path as p from attendance_punches where id = $1', [withPhoto])).rows[0]!.p).toBe(photo);

      const without = await punch(`mob-${randomUUID()}`, 'mobile', null);
      expect(await flags(without)).toContain('no_selfie');

      const msg = async (path: string, method = 'mobile') =>
        (await failure(tx, `select record_punch($1, null, $2::punch_method, null, null, null, $3, null, $4)`, [`x-${randomUUID()}`, method, f.orgA, path])).message;
      expect(await msg(photo)).toBe('That selfie was already used for a punch. Please take a new one.');
      expect(await msg(stale)).toBe('The selfie didn’t arrive. Please take it again.');
      expect(await msg(`${f.orgA}/${f.employees.icA}/${randomUUID()}`)).toBe('The selfie didn’t arrive. Please take it again.'); // never stored
      expect(await msg(`${f.orgA}/${f.employees.peerA}/${randomUUID()}`)).toBe('Invalid selfie.'); // someone else's folder
      expect((await failure(tx, `select record_punch($1, null, 'web', null, null, null, $2)`, [`w-${randomUUID()}`, f.orgA])).message)
        .toBe('Your attendance rule needs a selfie to check in.');
    });
  });
});
