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

describe('personal-data deletion requests', () => {
  it('an employee asks; HR erases only what was asked; identity data stays; colleagues see nothing', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into employee_personal (organization_id, employee_id, personal_email, personal_phone, city) values ($1, $2, 'ishan@example.test', '+919800000000', 'Pune')`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into emergency_contacts (organization_id, employee_id, name, relationship, phone) values ($1, $2, 'Asha Demo', 'Sister', '+919800000001')`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into restricted.employee_identity (organization_id, employee_id, pan) values ($1, $2, 'ABCDE1234F')`, [f.orgA, f.employees.icA]);

      await as(tx, f.users.icA);
      const id = (await tx.query<{ id: string }>(`select request_data_deletion($1, '{contact,emergency}', 'Leaving soon') as id`, [f.orgA])).rows[0]!.id;
      expect((await failure(tx, `select request_data_deletion($1, '{address}')`, [f.orgA])).message).toContain('already have');
      expect((await failure(tx, `select decide_data_deletion($1, true)`, [id])).message).toContain('not found');

      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from data_deletion_requests')).rows).toHaveLength(0);

      await as(tx, f.users.hrA);
      expect((await failure(tx, `select decide_data_deletion($1, false)`, [id])).message).toContain('reason');
      await tx.query(`select decide_data_deletion($1, true, 'Done')`, [id]);
      await tx.exec('reset role');
      const p = (await tx.query<{ personal_email: string | null; personal_phone: string | null; city: string | null }>('select personal_email, personal_phone, city from employee_personal where employee_id = $1', [f.employees.icA])).rows[0]!;
      expect(p).toEqual({ personal_email: null, personal_phone: null, city: 'Pune' });
      expect((await tx.query('select 1 from emergency_contacts where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      expect((await tx.query<{ pan: string }>('select pan from restricted.employee_identity where employee_id = $1', [f.employees.icA])).rows[0]!.pan).toBe('ABCDE1234F');
      expect((await tx.query<{ status: string }>('select status from data_deletion_requests where id = $1', [id])).rows[0]!.status).toBe('completed');
    });
  });
});
