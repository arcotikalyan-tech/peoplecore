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

describe('my profile', () => {
  it('employees keep their own education and family; colleagues and managers cannot read them; HR can', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.query(`insert into employee_qualifications (organization_id, employee_id, level, degree, institution, start_year, end_year)
        values ($1, $2, 'bachelors', 'B.E.', 'Example Institute', 2014, 2018)`, [f.orgA, f.employees.icA]);
      expect((await failure(tx, `insert into employee_qualifications (organization_id, employee_id, level, degree, institution, start_year, end_year)
        values ($1, $2, 'masters', 'M.Tech', 'Example Institute', 2020, 2019)`, [f.orgA, f.employees.icA])).code).toBe('23514');
      await tx.query(`insert into employee_family_members (organization_id, employee_id, name, relationship, is_dependent)
        values ($1, $2, 'Demo Parent', 'mother', true)`, [f.orgA, f.employees.icA]);
      await tx.query(`update employee_personal set blood_group = 'O+' where employee_id = $1`, [f.employees.icA]);
      expect((await failure(tx, `insert into employee_family_members (organization_id, employee_id, name, relationship)
        values ($1, $2, 'Not mine', 'spouse')`, [f.orgA, f.employees.peerA])).code).toBe('42501');

      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from employee_qualifications where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      await as(tx, f.users.leadA); // the direct manager
      expect((await tx.query('select 1 from employee_family_members where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from employee_family_members where employee_id = $1', [f.employees.icA])).rows).toHaveLength(1);
      expect((await tx.query('select 1 from employee_qualifications where employee_id = $1', [f.employees.icA])).rows).toHaveLength(1);
    });
  });

  it('documents: the owner says what they prove; HR verifies, never their own; a change clears verification', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const id = '00000000-0000-4000-8000-0000000000d1';
      await tx.query(`select add_employee_document($1, $2, 'identity', 'PAN card', 'pan.pdf', 'application/pdf', 1000)`, [f.employees.icA, id]);
      await tx.query(`select set_document_proofs($1, '{photo_id,date_of_birth}')`, [id]);
      expect((await failure(tx, `select set_document_proofs($1, '{passport}')`, [id])).code).toBe('22023');
      expect((await failure(tx, `select verify_employee_document($1, true)`, [id])).code).toBe('42501');

      await as(tx, f.users.hrA);
      await tx.query(`select verify_employee_document($1, true)`, [id]);
      expect((await tx.query<{ proves: string[]; verified: boolean }>('select proves, verified_at is not null as verified from employee_documents where id = $1', [id])).rows)
        .toEqual([{ proves: ['date_of_birth', 'photo_id'], verified: true }]);

      await as(tx, f.users.icA);
      await tx.query(`select set_document_proofs($1, '{date_of_birth,photo_id}')`, [id]); // same set: still verified
      expect((await tx.query<{ v: boolean }>('select verified_at is not null as v from employee_documents where id = $1', [id])).rows[0]!.v).toBe(true);
      await tx.query(`select set_document_proofs($1, '{current_address}')`, [id]);
      expect((await tx.query<{ v: boolean }>('select verified_at is not null as v from employee_documents where id = $1', [id])).rows[0]!.v).toBe(false);
    });
  });

  it('file activity shows only the caller’s own exports and downloads', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into audit_events (organization_id, actor_user_id, action, entity_type) values
        ($1, $2, 'export', 'employees'), ($1, $3, 'export', 'employees'), ($1, $2, 'update', 'employees')`, [f.orgA, f.users.hrA, f.users.payrollA]);
      await as(tx, f.users.hrA);
      const mine = (await tx.query<{ action: string }>('select action from my_file_activity($1)', [f.orgA])).rows;
      expect(mine.map((r) => r.action)).toEqual(['export']);
      await as(tx, f.users.employeeB);
      expect((await tx.query('select 1 from my_file_activity($1)', [f.orgA])).rows).toHaveLength(0);
    });
  });
});
