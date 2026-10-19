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
async function failure(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec('savepoint f');
  try { await tx.query(sql, params); } catch (e) { await tx.exec('rollback to savepoint f'); return e as { code?: string; message: string }; }
  throw new Error(`expected to fail: ${sql}`);
}

describe('letters', () => {
  it('every organization starts with the 12 standard templates; employees see only self-serve ones', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      expect((await tx.query('select 1 from letter_templates where organization_id = $1', [f.orgA])).rows).toHaveLength(12);
      await as(tx, f.users.icA);
      const mine = (await tx.query<{ letter_type: string }>('select letter_type from letter_templates where organization_id = $1 order by 1', [f.orgA])).rows;
      expect(mine.map((r) => r.letter_type)).toEqual(['Address Proof Letter', 'Employment Letter', 'Relieving Letter']);
      expect((await tx.query(`update letter_templates set self_serve = true returning 1`)).rows).toHaveLength(0);
    });
  });

  it('an employee requests a letter; HR generates and releases it; the employee sees only released letters', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const tpl = (await tx.query<{ id: string }>(`select id from letter_templates where organization_id = $1 and letter_type = 'Address Proof Letter'`, [f.orgA])).rows[0]!.id;
      const offer = (await tx.query<{ id: string }>(`select id from letter_templates where organization_id = $1 and letter_type = 'Employment Letter'`, [f.orgA])).rows[0]!.id;
      const req = (await tx.query<{ id: string }>(`select request_letter($1, $2, 'Bank account') as id`, [f.orgA, tpl])).rows[0]!.id;
      expect((await failure(tx, `select request_letter($1, $2)`, [f.orgA, tpl])).code).toBe('23505');
      expect((await failure(tx, `insert into letters (organization_id, employee_id, letter_type, body) values ($1, $2, 'Fake', 'Self-made letter body')`, [f.orgA, f.employees.icA])).code).toBe('42501');

      await as(tx, f.users.hrA);
      expect((await failure(tx, `select request_letter($1, $2)`, [f.orgA, offer])).code).toBe('42501'); // HR has no employee record here
      const draft = (await tx.query<{ id: string }>(`insert into letters (organization_id, employee_id, template_id, letter_type, body, request_id)
        values ($1, $2, $3, 'Address Proof Letter', 'This is to certify that Ishan works here.', $4) returning id`, [f.orgA, f.employees.icA, tpl, req])).rows[0]!.id;

      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from letters')).rows).toHaveLength(0); // drafts are HR's

      await as(tx, f.users.hrA);
      expect((await tx.query<{ n: number }>('select release_letters($1) as n', [[draft]])).rows[0]!.n).toBe(1);
      expect((await failure(tx, `update letters set body = 'Changed after release' where id = $1`, [draft])).code).toBe('55000');
      expect((await tx.query<{ status: string; letter_id: string }>('select status, letter_id from letter_requests where id = $1', [req])).rows[0])
        .toEqual({ status: 'released', letter_id: draft });

      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from letters where id = $1', [draft])).rows).toHaveLength(1);
      expect((await tx.query<{ kind: string }>(`select kind from notifications where kind = 'letter.released'`)).rows).toHaveLength(1);
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from letters where id = $1', [draft])).rows).toHaveLength(0);
      expect((await tx.query('select 1 from letter_requests where id = $1', [req])).rows).toHaveLength(0);
    });
  });

  it('HR declines a request with a note; the employee withdraws only their own; signatories are HR-only', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const tpl = (await tx.query<{ id: string }>(`select id from letter_templates where organization_id = $1 and letter_type = 'Employment Letter'`, [f.orgA])).rows[0]!.id;
      const req = (await tx.query<{ id: string }>(`select request_letter($1, $2, 'Visa') as id`, [f.orgA, tpl])).rows[0]!.id;
      await as(tx, f.users.peerA);
      expect((await failure(tx, `select close_letter_request($1, 'withdrawn')`, [req])).code).toBe('42501');
      await as(tx, f.users.hrA);
      await tx.query(`select close_letter_request($1, 'rejected', 'Please ask your manager first')`, [req]);
      await tx.query(`insert into letter_signatories (organization_id, name, designation) values ($1, 'Demo Signatory', 'HR Head')`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ status: string }>('select status from letter_requests where id = $1', [req])).rows[0]!.status).toBe('rejected');
      expect((await tx.query('select 1 from letter_signatories')).rows).toHaveLength(0);
      expect((await tx.query(`select 1 from notifications where kind = 'letter.rejected'`)).rows).toHaveLength(1);
    });
  });
});
