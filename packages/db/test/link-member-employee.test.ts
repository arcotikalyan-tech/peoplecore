import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261022000900: linking members who are already in the organization to an employee record. */
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

describe('linking members to employee records', () => {
  it('links a new record to the member with that sign-in email; HR links and unlinks others; nobody else can', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const add = async (code: string, first: string, email: string) => (await tx.query<{ id: string; user_id: string | null }>(
        `insert into employees (organization_id, employee_code, first_name, last_name, work_email, status, employment_type, date_of_joining)
         values ($1, $2, $3, 'Demo', $4, 'active', 'permanent', '2024-01-01') returning id, user_id`, [f.orgA, code, first, email])).rows[0]!;
      const member = async (user: string) => (await tx.query<{ id: string }>('select id from organization_members where organization_id = $1 and user_id = $2', [f.orgA, user])).rows[0]!.id;

      // HR's own record, with HR's sign-in email (any case): linked as it is added.
      expect((await add('A-901', 'Hari', 'HRA@example.test')).user_id).toBe(f.users.hrA);
      // Someone outside the organization with that email: not linked.
      expect((await add('A-903', 'Bela', 'employeeb@example.test')).user_id).toBeNull();

      const rec = await add('A-904', 'Rhea', 'rhea@example.test'); // the recruiter signs in with another address
      expect(rec.user_id).toBeNull();
      const recruiter = await member(f.users.recruiterA);
      await tx.query('select link_member_employee($1, $2)', [recruiter, rec.id]);
      expect((await tx.query<{ user_id: string }>('select user_id from employees where id = $1', [rec.id])).rows[0]!.user_id).toBe(f.users.recruiterA);
      expect((await failure(tx, 'select link_member_employee($1, $2)', [recruiter, rec.id])).message).toBe('That employee record is already linked to another account.');
      const spare = await add('A-905', 'Spare', null as unknown as string);
      expect((await failure(tx, 'select link_member_employee($1, $2)', [recruiter, spare.id])).message).toBe('This member is already linked to an employee record.');
      await tx.query('select unlink_member_employee($1)', [recruiter]);
      expect((await tx.query<{ user_id: string | null }>('select user_id from employees where id = $1', [rec.id])).rows[0]!.user_id).toBeNull();
      expect((await failure(tx, 'select unlink_member_employee($1)', [recruiter])).message).toBe('This member isn’t linked to an employee record.');

      // Fixing a record's work email to a member's sign-in email links it too.
      await tx.query(`update employees set work_email = 'recruitera@example.test' where id = $1`, [spare.id]);
      expect((await tx.query<{ user_id: string }>('select user_id from employees where id = $1', [spare.id])).rows[0]!.user_id).toBe(f.users.recruiterA);

      const auditor = await member(f.users.auditorA);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select link_member_employee($1, $2)', [auditor, rec.id])).code).toBe('42501');
      await as(tx, f.users.ownerB);
      expect((await failure(tx, 'select unlink_member_employee($1)', [recruiter])).code).toBe('42501');
    });
  });

  it('an HR executive (employee.update without member.manage) can’t move a sign-in onto another record', async () => {
    const { f, t } = ctx;
    const hrExec = await t.createUser('hr.exec@example.test');
    const { rows } = await t.db.query<{ id: string }>(
      `insert into organization_members (organization_id, user_id, status) values ($1, $2, 'active') returning id`, [f.orgA, hrExec]);
    await t.db.query(`insert into member_roles (organization_id, member_id, role_id) select $1, $2, id from roles where organization_id = $1 and key = 'hr_executive'`,
      [f.orgA, rows[0]!.id]);
    const own = (await t.db.query<{ id: string }>(
      `insert into employees (organization_id, employee_code, first_name, last_name, user_id, status, employment_type, date_of_joining)
       values ($1, 'A-950', 'Esha', 'Demo', $2, 'active', 'permanent', '2024-01-01') returning id`, [f.orgA, hrExec])).rows[0]!.id;
    const refused = 'Only people who manage members can change whose sign-in an employee record uses.';

    await t.asUser(hrExec, async (tx) => {
      // Taking the manager's record, clearing their own link, or adding a record with someone's sign-in: refused.
      expect((await failure(tx, 'update employees set user_id = $1 where id = $2', [hrExec, f.employees.managerA])).message).toBe(refused);
      expect((await failure(tx, 'update employees set user_id = null where id = $1', [own])).message).toBe(refused);
      expect((await failure(tx,
        `insert into employees (organization_id, employee_code, first_name, last_name, user_id, status, employment_type, date_of_joining)
         values ($1, 'A-951', 'Copy', 'Demo', $2, 'active', 'permanent', '2024-01-01')`, [f.orgA, f.users.managerA])).message).toBe(refused);
      // Ordinary edits still work, and a new record still links itself to the member with that work email.
      await tx.query(`update employees set work_phone = '+91 90000 00000' where id = $1`, [f.employees.peerA]);
      const added = (await tx.query<{ user_id: string | null }>(
        `insert into employees (organization_id, employee_code, first_name, last_name, work_email, status, employment_type, date_of_joining)
         values ($1, 'A-952', 'Ravi', 'Demo', 'auditora@example.test', 'active', 'permanent', '2024-01-01') returning user_id`, [f.orgA])).rows[0]!;
      expect(added.user_id).toBe(f.users.auditorA);
    });
  });
});
