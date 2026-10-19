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

const PROOF = '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';

describe('statutory', () => {
  it('HR and payroll record filings, registrations and scope; employees and other tenants see nothing', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      await tx.query(`insert into statutory_filings (organization_id, form_id, period_start, period_end, due_on, status, filed_on, reference)
        values ($1, 'IN-P-01', '2026-09-01', '2026-09-30', '2026-10-15', 'filed', '2026-10-12', 'TRRN-1')`, [f.orgA]);
      await tx.query(`insert into statutory_scope (organization_id, contract_labour) values ($1, true)`, [f.orgA]);
      await tx.exec('reset role');
      const loc = (await tx.query<{ id: string }>(`insert into locations (organization_id, code, name, state_code) values ($1, 'BLR', 'Bengaluru', 'KA') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('update employees set location_id = $1 where id = $2', [loc, f.employees.icA]);
      await as(tx, f.users.payrollA);
      await tx.query(`insert into establishment_registrations (organization_id, location_id, pt_number) values ($1, $2, 'PT-123')`, [f.orgA, loc]);

      const facts = (await tx.query<{ v: Record<string, unknown> }>('select statutory_facts($1) as v', [f.orgA])).rows[0]!.v;
      expect(facts.headcount).toBeGreaterThan(0);
      expect((facts.scope as { contract_labour: boolean }).contract_labour).toBe(true);
      expect((facts.establishments as Array<{ pt_number: string | null; state: string; headcount: number }>).find((e) => e.pt_number === 'PT-123'))
        .toMatchObject({ state: 'KA', headcount: 1 });
      expect(facts).not.toHaveProperty('pan');

      // A filed obligation needs its date, and the same period can't be recorded twice.
      expect((await failure(tx, `insert into statutory_filings (organization_id, form_id, period_start, period_end, status)
        values ($1, 'IN-E-01', '2026-09-01', '2026-09-30', 'filed')`, [f.orgA])).code).toBe('23514');
      expect((await failure(tx, `insert into statutory_filings (organization_id, form_id, period_start, period_end, status)
        values ($1, 'IN-P-01', '2026-09-01', '2026-09-30', 'not_applicable')`, [f.orgA])).code).toBe('23505');

      await as(tx, f.users.icA);
      expect((await tx.query('select * from statutory_filings')).rows).toHaveLength(0);
      expect((await failure(tx, 'select statutory_facts($1)', [f.orgA])).code).toBe('42501');
      await as(tx, f.users.ownerB);
      expect((await tx.query('select * from statutory_filings')).rows).toHaveLength(0);
      expect((await tx.query('select * from establishment_registrations')).rows).toHaveLength(0);
    });
  });

  it('proof of filing is kept for five years after the period', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(`insert into statutory_filings (organization_id, form_id, period_start, period_end, status, filed_on, proof_path, proof_name)
        values ($1, 'KA-LWF-01', '2025-01-01', '2025-12-31', 'filed', '2026-01-10', $2, 'lwf.pdf') returning id`, [f.orgA, PROOF])).rows[0]!.id;
      expect((await tx.query<{ d: string }>(`select to_char(retain_until, 'YYYY-MM-DD') as d from statutory_filings where id = $1`, [id])).rows[0]!.d).toBe('2030-12-31');
      expect((await failure(tx, 'delete from statutory_filings where id = $1', [id])).message).toContain('Proof of filing is kept until 31 Dec 2030');
      expect((await failure(tx, 'update statutory_filings set proof_path = null, proof_name = null where id = $1', [id])).code).toBe('42501');
      await tx.query(`update statutory_filings set reference = 'ACK-9' where id = $1`, [id]);

      // Without a proof, a record can be reopened (deleted).
      const plain = (await tx.query<{ id: string }>(`insert into statutory_filings (organization_id, form_id, period_start, period_end, status)
        values ($1, 'IN-T-02', '2026-04-01', '2026-06-30', 'not_applicable') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('delete from statutory_filings where id = $1', [plain]);
      expect((await tx.query('select 1 from statutory_filings where id = $1', [plain])).rows).toHaveLength(0);
    });
  });
});
