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

describe('company onboarding', () => {
  it('HR marks setup steps done; everyone reads progress; only HR changes it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into org_setup_steps (organization_id, step_key, note) values ($1, 'parallel_payroll', 'Matched last month')`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ step_key: string }>('select step_key from org_setup_steps')).rows).toEqual([{ step_key: 'parallel_payroll' }]);
      expect((await tx.query('delete from org_setup_steps')).affectedRows).toBe(0);
      await as(tx, f.users.employeeB);
      expect((await tx.query('select 1 from org_setup_steps')).rows).toHaveLength(0);
    });
  });
});
