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

type Row = { change: string; member_name: string; relationship: string };
const endorsement = async (tx: Transaction, org: string) =>
  (await tx.query<Row>('select change, member_name, relationship from insurance_endorsement($1) order by change, member_name', [org])).rows;

describe('insurance', () => {
  it('HR sets the policy and coverage; endorsements list additions and deletions since the last sync; employees see their cover', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into insurance_policies (organization_id, insurer, policy_number, valid_from, valid_to, sum_insured, hidden_fields)
        values ($1, 'Example General Insurance', 'GHI-001', '2026-04-01', '2027-03-31', 300000, '{policy_number}')`, [f.orgA]);
      await tx.query(`insert into insurance_coverage (organization_id, employee_id) values ($1, $2), ($1, $3)`, [f.orgA, f.employees.icA, f.employees.peerA]);
      await tx.query(`insert into insurance_coverage (organization_id, employee_id, covered) values ($1, $2, false)`, [f.orgA, f.employees.leadA]);
      await tx.exec('reset role');
      await tx.query(`insert into employee_family_members (organization_id, employee_id, name, relationship) values
        ($1, $2, 'Asha Demo', 'spouse'), ($1, $2, 'Kiran Demo', 'child'), ($1, $2, 'Ravi Demo', 'father')`, [f.orgA, f.employees.icA]);

      await as(tx, f.users.hrA);
      expect(await endorsement(tx, f.orgA)).toEqual([
        { change: 'addition', member_name: 'Asha Demo', relationship: 'spouse' },
        { change: 'addition', member_name: 'Ishan Demo', relationship: 'self' },
        { change: 'addition', member_name: 'Kiran Demo', relationship: 'child' },
        { change: 'addition', member_name: 'Pia Demo', relationship: 'self' },
      ]); // the father isn't covered under ESC
      expect((await tx.query<{ r: unknown }>('select lock_insurance_endorsement($1) as r', [f.orgA])).rows[0]!.r).toEqual({ additions: 4, deletions: 0 });
      expect((await endorsement(tx, f.orgA)).every((r) => r.change === 'covered')).toBe(true);
      expect((await failure(tx, 'select lock_insurance_endorsement($1)', [f.orgA])).message).toBe('Nothing has changed since the last endorsement.');

      await tx.query(`update insurance_policies set cover_type = 'ESCP' where organization_id = $1`, [f.orgA]);
      await tx.query(`update insurance_coverage set covered = false where employee_id = $1`, [f.employees.peerA]);
      expect((await endorsement(tx, f.orgA)).filter((r) => r.change !== 'covered')).toEqual([
        { change: 'addition', member_name: 'Ravi Demo', relationship: 'parent' },
        { change: 'deletion', member_name: 'Pia Demo', relationship: 'self' },
      ]);

      await as(tx, f.users.icA);
      const mine = (await tx.query<{ m: { covered: boolean; policy: Record<string, unknown>; members: Array<{ name: string }> } }>('select my_insurance($1) as m', [f.orgA])).rows[0]!.m;
      expect(mine.covered).toBe(true);
      expect(mine.policy.insurer).toBe('Example General Insurance');
      expect(mine.policy).not.toHaveProperty('policy_number'); // hidden from employees
      expect(mine.members.map((m) => m.name).sort()).toEqual(['Asha Demo', 'Ishan Demo', 'Kiran Demo', 'Ravi Demo']);
      expect((await tx.query('select 1 from insurance_policies')).rows).toHaveLength(0);
      expect((await failure(tx, 'select * from insurance_endorsement($1)', [f.orgA])).code).toBe('42501');
      expect((await tx.query('update insurance_coverage set sum_insured = 999999 where employee_id = $1', [f.employees.icA])).affectedRows).toBe(0);

      await as(tx, f.users.leadA);
      expect((await tx.query<{ m: unknown }>('select my_insurance($1) as m', [f.orgA])).rows[0]!.m).toEqual({ covered: false });

      await as(tx, f.users.recruiterA);
      expect((await failure(tx, 'select lock_insurance_endorsement($1)', [f.orgA])).code).toBe('42501');
      expect((await tx.query('select 1 from insurance_coverage')).rows).toHaveLength(0);

      await as(tx, f.users.ownerB);
      expect((await tx.query('select 1 from insurance_coverage')).rows).toHaveLength(0);
      expect((await failure(tx, 'select * from insurance_endorsement($1)', [f.orgA])).code).toBe('42501');
    });
  });
});
