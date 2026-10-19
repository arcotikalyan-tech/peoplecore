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

describe('organization settings', () => {
  it('muted notification categories are not delivered; modules and controls are kept by org managers', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into notification_settings (organization_id, category, enabled) values ($1, 'loan', false)`, [f.orgA]);
      await tx.query(`insert into org_modules (organization_id, module, enabled) values ($1, 'loans', false)`, [f.orgA]);
      await tx.exec('reset role');
      await tx.query(`select app.notify($1, $2, 'loan.disbursed', 'Muted')`, [f.orgA, f.users.icA]);
      await tx.query(`select app.notify($1, $2, 'leave.approved', 'Delivered')`, [f.orgA, f.users.icA]);
      expect((await tx.query<{ title: string }>(`select title from notifications where user_id = $1 and title in ('Muted', 'Delivered')`, [f.users.icA])).rows)
        .toEqual([{ title: 'Delivered' }]);

      await as(tx, f.users.icA);
      expect((await tx.query<{ enabled: boolean }>('select enabled from org_modules')).rows).toEqual([{ enabled: false }]);
      expect((await failure(tx, `insert into org_modules (organization_id, module) values ($1, 'assets')`, [f.orgA])).code).toBe('42501');
      expect((await tx.query('update org_controls set block_self_edit = true')).affectedRows).toBe(0);
    });
  });

  it('when self-edits are blocked, HR can’t change their own record or pay; owners are exempt', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const hrEmp = (await tx.query<{ id: string }>(`insert into employees (organization_id, employee_code, first_name, work_email, user_id, status, employment_type, date_of_joining)
        values ($1, 'A-HR', 'Hema', 'hema@example.test', $2, 'active', 'permanent', '2024-01-01') returning id`, [f.orgA, f.users.hrA])).rows[0]!.id;
      await as(tx, f.users.hrA);
      await tx.query(`update employees set job_title = 'HR lead' where id = $1`, [hrEmp]); // allowed while the control is off
      await tx.query('update org_controls set block_self_edit = true where organization_id = $1', [f.orgA]);
      expect((await failure(tx, `update employees set job_title = 'Chief people officer' where id = $1`, [hrEmp])).message)
        .toBe('Your organization doesn’t allow editing your own HR record. Ask a colleague in HR.');
      await tx.query(`update employees set job_title = 'Engineer' where id = $1`, [f.employees.icA]); // others' records are fine
    });
  });

  it('owners open and close support access; only platform admins read the summary', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      expect((await failure(tx, `select grant_support_access($1, 500, 'Payroll question')`, [f.orgA])).message).toBe('Open support access for 1 hour to 7 days.');
      await tx.query(`select grant_support_access($1, 4, 'Help with the payroll setup')`, [f.orgA]);
      expect((await tx.query('select 1 from support_access_windows where revoked_at is null')).rows).toHaveLength(1);
      expect((await failure(tx, 'select support_overview($1)', [f.orgA])).code).toBe('42501'); // not a platform admin
      expect((await tx.query<{ n: number }>('select revoke_support_access($1) as n', [f.orgA])).rows[0]!.n).toBe(1);

      await as(tx, f.users.hrA);
      expect((await failure(tx, `select grant_support_access($1, 2, 'Just looking')`, [f.orgA])).code).toBe('42501');
      expect((await tx.query('select 1 from support_access_windows')).rows).toHaveLength(0);
    });
  });
});
