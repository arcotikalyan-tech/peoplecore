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

describe('company profile', () => {
  it('every member reads the profile and offices; only org.manage edits; officers are private to admins and auditors', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`update company_profiles set brand_name = 'Demo', pan = 'AAACD1234E', gstin = '29AAACD1234E1Z5', entity_type = 'private_limited' where organization_id = $1`, [f.orgA]);
      expect((await failure(tx, `update company_profiles set pan = 'BAD' where organization_id = $1`, [f.orgA])).code).toBe('23514');
      await tx.query(`insert into company_addresses (organization_id, kind, line1, city) values ($1, 'registered', 'Sector 6, Example Layout', 'Bengaluru')`, [f.orgA]);
      expect((await failure(tx, `insert into company_addresses (organization_id, kind, line1, city) values ($1, 'registered', 'Another', 'Pune')`, [f.orgA])).code).toBe('23505');
      await tx.query(`insert into company_officers (organization_id, kind, name, email, identifier) values ($1, 'director', 'Demo Director', 'director@example.test', '01234567')`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ brand_name: string }>('select brand_name from company_profiles')).rows).toEqual([{ brand_name: 'Demo' }]);
      expect((await tx.query('select 1 from company_addresses')).rows).toHaveLength(1);
      expect((await tx.query('select 1 from company_officers')).rows).toHaveLength(0);
      expect((await tx.query(`update company_profiles set brand_name = 'X' returning 1`)).rows).toHaveLength(0);
      await as(tx, f.users.auditorA);
      expect((await tx.query('select 1 from company_officers')).rows).toHaveLength(1);
      await as(tx, f.users.employeeB);
      expect((await tx.query('select 1 from company_profiles where organization_id = $1', [f.orgA])).rows).toHaveLength(0);
    });
  });

  it('custom fields: values are checked against the type; employees edit only fields marked editable', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const shirt = (await tx.query<{ id: string }>(`insert into employee_custom_fields (organization_id, label, field_type, options, editable_by_employee)
        values ($1, 'T-shirt size', 'select', '{S,M,L}', true) returning id`, [f.orgA])).rows[0]!.id;
      const badge = (await tx.query<{ id: string }>(`insert into employee_custom_fields (organization_id, label, field_type) values ($1, 'Badge number', 'number') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into employee_custom_values (organization_id, employee_id, field_id, value) values ($1, $2, $3, '42')`, [f.orgA, f.employees.icA, badge]);
      expect((await failure(tx, `insert into employee_custom_values (organization_id, employee_id, field_id, value) values ($1, $2, $3, 'abc')`, [f.orgA, f.employees.peerA, badge])).message).toBe('Badge number must be a number.');
      await as(tx, f.users.icA);
      await tx.query(`insert into employee_custom_values (organization_id, employee_id, field_id, value) values ($1, $2, $3, 'M')`, [f.orgA, f.employees.icA, shirt]);
      expect((await tx.query(`update employee_custom_values set value = '7' where employee_id = $1 and field_id = $2 returning 1`, [f.employees.icA, badge])).rows).toHaveLength(0);
      expect((await failure(tx, `insert into employee_custom_values (organization_id, employee_id, field_id, value) values ($1, $2, $3, 'XL')`, [f.orgA, f.employees.icA, shirt])).code).toBeDefined();
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from employee_custom_values where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
    });
  });
});
