import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

describe('bulk decisions in one request', () => {
  it('decides what it can and reports the rest', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const days = (await tx.query<{ d: string }>('select (current_date - n)::text as d from generate_series(3, 4) n')).rows.map((r) => r.d);
      await as(tx, f.users.icA);
      const approvals: string[] = [];
      for (const day of days) {
        const id = (await tx.query<{ id: string }>(`select request_regularization($1, $2, '09:30', '18:00', 'Forgot to punch') as id`, [f.employees.icA, day])).rows[0]!.id;
        approvals.push((await tx.query<{ a: string }>('select approval_request_id as a from regularization_requests where id = $1', [id])).rows[0]!.a);
      }
      const nobody = '00000000-0000-4000-8000-000000000123';

      // Someone who isn't the approver decides nothing, whatever they send.
      await as(tx, f.users.peerA);
      const refused = (await tx.query<{ r: { decided: number; errors: unknown[] } }>(`select decide_approvals($1::uuid[], 'approve') as r`, [approvals])).rows[0]!.r;
      expect(refused.decided).toBe(0);
      expect(refused.errors).toHaveLength(2);

      await as(tx, f.users.leadA);
      const { r } = (await tx.query<{ r: { decided: number; errors: Array<{ id: string; code: string; message: string | null }> } }>(
        `select decide_approvals($1::uuid[], 'approve') as r`, [[approvals[0], nobody, approvals[1]]])).rows[0]!;
      expect(r.decided).toBe(2);
      expect(r.errors.map((e) => e.id)).toEqual([nobody]);
      await tx.exec('reset role');
      expect((await tx.query<{ status: string }>('select status from regularization_requests where employee_id = $1', [f.employees.icA])).rows.map((x) => x.status)).toEqual(['approved', 'approved']);
    });
  });

  it('takes at most 200 at a time, and nothing from someone signed out', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.leadA, async (tx) => {
      const many = Array.from({ length: 201 }, () => '00000000-0000-4000-8000-000000000123');
      await tx.exec('savepoint s');
      const said = await tx.query(`select decide_approvals($1::uuid[], 'approve')`, [many]).then(() => '', (e: Error) => e.message);
      await tx.exec('rollback to savepoint s');
      expect(said).toContain('at most 200');
      const none = (await tx.query<{ r: { decided: number } }>(`select decide_approvals('{}'::uuid[], 'approve') as r`)).rows[0]!.r;
      expect(none.decided).toBe(0);
    });
    expect(await pgError(ctx.t.asAnon((tx) => tx.query(`select decide_approvals('{}'::uuid[], 'approve')`)))).toBe('42501');
  });

  it('approving a year’s declarations goes through the same review, for those allowed it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const r = (await tx.query<{ r: { decided: number; errors: unknown[] } }>(`select approve_tax_declarations($1, '2026-27') as r`, [f.orgA])).rows[0]!.r;
      expect(r).toEqual({ decided: 0, errors: [] }); // an employee reads only their own, and has none submitted
    });
  });
});
