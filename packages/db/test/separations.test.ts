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

const today = async (tx: Transaction, org: string) => (await tx.query<{ d: string }>('select app.org_today($1)::text as d', [org])).rows[0]!.d;
const approve = async (tx: Transaction, org: string) => {
  const pending = (await tx.query<{ id: string }>(`select id from my_pending_approvals($1) where subject_type = 'separation'`, [org])).rows;
  expect(pending, 'pending separation approval').toHaveLength(1);
  return (await tx.query<{ s: string }>(`select decide_approval($1, 'approve') as s`, [pending[0]!.id])).rows[0]!.s;
};
const items = async (tx: Transaction, sep: string) =>
  (await tx.query<{ kind: string; status: string }>('select kind, status from clearance_items where separation_id = $1 order by created_at', [sep])).rows;
const runWorker = async (tx: Transaction) => {
  await tx.exec('reset role');
  await tx.exec('set local role service_role');
  const r = (await tx.query<{ r: { completed: number; failed: number } }>('select worker_separations() as r')).rows[0]!.r;
  await tx.exec('reset role');
  return r;
};

describe('separations', () => {
  it('resignation → manager and HR approve → clearance (assets and access clear themselves) → exit, sign-in suspended', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const d = await today(tx, f.orgA);
      // Ishan holds a laptop and a GitHub account.
      const laptop = (await tx.query<{ id: string }>(`insert into assets (organization_id, name, category, tag) values ($1, 'Laptop', 'Laptop', '') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('select issue_asset($1, $2)', [laptop, f.employees.icA]);
      const gh = (await tx.query<{ id: string }>(`insert into access_systems (organization_id, name) values ($1, 'GitHub') returning id`, [f.orgA])).rows[0]!.id;
      const grant = (await tx.query<{ id: string }>(`select grant_access($1, $2, 'ishan') as id`, [gh, f.employees.icA])).rows[0]!.id;

      await as(tx, f.users.icA);
      expect((await failure(tx, `select submit_resignation($1, $2::date - 1)`, [f.orgA, d])).message).toBe('The last working day can’t be in the past.');
      const sep = (await tx.query<{ id: string }>(`select submit_resignation($1, $2::date + 10, 'growth', 'Joining a startup') as id`, [f.orgA, d])).rows[0]!.id;
      expect((await failure(tx, `select submit_resignation($1, $2::date + 40)`, [f.orgA, d])).message).toBe('A separation is already open for this employee.');
      const s = (await tx.query<{ notice_days: number; shortfall_days: number; status: string }>('select notice_days, shortfall_days, status from separations where id = $1', [sep])).rows[0]!;
      expect(s).toEqual({ notice_days: 30, shortfall_days: 20, status: 'submitted' });
      expect((await tx.query<{ reason: string }>('select reason from separation_details($1)', [sep])).rows).toEqual([{ reason: 'Joining a startup' }]);

      await as(tx, f.users.leadA); // the manager: sees it, not why
      expect((await failure(tx, 'select reason from separations')).code).toBe('42501');
      expect((await tx.query('select * from separation_details($1)', [sep])).rows).toHaveLength(0);
      expect(await approve(tx, f.orgA)).toBe('pending');

      await as(tx, f.users.hrA);
      await tx.query(`select set_separation_terms($1, $2::date + 20, 'waived')`, [sep, d]);
      expect(await approve(tx, f.orgA)).toBe('approved');
      expect((await tx.query<{ status: string; shortfall_days: number; shortfall_treatment: string }>(
        'select status, shortfall_days, shortfall_treatment from separations where id = $1', [sep])).rows[0]).toEqual({ status: 'approved', shortfall_days: 10, shortfall_treatment: 'waived' });
      const emp = (await tx.query<{ status: string; exit: boolean }>(`select status, date_of_exit = $2::date + 20 as exit from employees where id = $1`, [f.employees.icA, d])).rows[0]!;
      expect(emp).toEqual({ status: 'on_notice', exit: true });
      expect((await items(tx, sep)).map((i) => i.kind)).toEqual(['asset', 'access', 'handover', 'finance', 'exit_interview']);
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from app.domain_events where event_type = 'separation.approved' and subject_id = $1`, [sep])).rows).toHaveLength(1);
      await as(tx, f.users.hrA);

      const item = async (kind: string) => (await tx.query<{ id: string }>('select id from clearance_items where separation_id = $1 and kind = $2', [sep, kind])).rows[0]!.id;
      expect((await failure(tx, `select clear_item($1, 'cleared')`, [await item('asset')])).message).toBe('Record the return on the asset; this clears itself.');
      expect((await failure(tx, `select clear_item($1, 'waived')`, [await item('finance')])).message).toBe('Say why it’s waived.');
      await tx.query(`select return_asset($1)`, [laptop]);
      await tx.query(`select revoke_access($1, 'Leaving')`, [grant]);

      await as(tx, f.users.leadA);
      expect((await failure(tx, `select clear_item($1, 'cleared')`, [await item('finance')])).code).toBe('42501');
      await tx.query(`select clear_item($1, 'cleared')`, [await item('handover')]);
      await as(tx, f.users.payrollA);
      await tx.query(`select clear_item($1, 'cleared', 'No advances')`, [await item('finance')]);
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from separations')).rows).toHaveLength(0);
      await as(tx, f.users.icA);
      expect((await failure(tx, `select clear_item($1, 'cleared')`, [await item('handover')])).code).toBe('42501');
      await tx.query(`select save_exit_interview($1, '{"would_recommend": 4, "comments": "Good team"}', true)`, [sep]);
      expect((await items(tx, sep)).every((i) => i.status === 'cleared')).toBe(true);

      expect(await runWorker(tx)).toEqual({ completed: 0, failed: 0 }); // not yet
      await tx.query(`update separations set last_working_day = $2::date - 1, submitted_on = $2::date - 5, notice_end = $2::date + 25 where id = $1`, [sep, d]);
      expect(await runWorker(tx)).toEqual({ completed: 1, failed: 0 });
      expect((await tx.query<{ status: string }>('select status from employees where id = $1', [f.employees.icA])).rows[0]!.status).toBe('exited');
      expect((await tx.query<{ status: string }>('select status from organization_members where organization_id = $1 and user_id = $2', [f.orgA, f.users.icA])).rows[0]!.status).toBe('suspended');
      expect((await tx.query(`select 1 from app.domain_events where event_type = 'employee.exited' and subject_id = $1`, [f.employees.icA])).rows).toHaveLength(1);
      await as(tx, f.users.icA); // access to the organization is gone
      expect((await tx.query('select 1 from separations')).rows).toHaveLength(0);
    });
  });

  it('HR starts an exit and cancels it; employees withdraw before approval; others can’t start one', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const d = await today(tx, f.orgA);
      const sep = (await tx.query<{ id: string }>(`select initiate_separation($1, 'termination', $2::date + 5, 'performance', 'Did not meet the improvement plan') as id`,
        [f.employees.icA, d])).rows[0]!.id;
      await as(tx, f.users.leadA);
      expect(await approve(tx, f.orgA)).toBe('pending');
      await as(tx, f.users.ownerA); // a second HR-side person: the initiator can’t approve their own
      expect(await approve(tx, f.orgA)).toBe('approved');
      await as(tx, f.users.hrA);
      await tx.query('select withdraw_separation($1)', [sep]);
      expect((await tx.query<{ status: string }>('select status from separations where id = $1', [sep])).rows[0]!.status).toBe('cancelled');
      expect((await tx.query<{ status: string; date_of_exit: string | null }>('select status, date_of_exit from employees where id = $1', [f.employees.icA])).rows[0])
        .toEqual({ status: 'active', date_of_exit: null });
      expect((await items(tx, sep)).every((i) => i.status === 'waived')).toBe(true);

      await as(tx, f.users.icA);
      const mine = (await tx.query<{ id: string }>(`select submit_resignation($1, $2::date + 30) as id`, [f.orgA, d])).rows[0]!.id;
      await tx.query('select withdraw_separation($1)', [mine]);
      expect((await tx.query<{ status: string }>('select status from separations where id = $1', [mine])).rows[0]!.status).toBe('withdrawn');

      await as(tx, f.users.managerA);
      expect((await failure(tx, `select initiate_separation($1, 'termination', $2::date + 5)`, [f.employees.icA, d])).code).toBe('42501');
      await as(tx, f.users.employeeB);
      expect((await failure(tx, `select initiate_separation($1, 'termination', $2::date + 5)`, [f.employees.icA, d])).code).toBe('42501');
    });
  });

  it('the last owner keeps access when they exit; deleting an organization still works', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const d = await today(tx, f.orgA);
      await tx.exec('reset role');
      const owner = (await tx.query<{ id: string }>(
        `insert into employees (organization_id, employee_code, first_name, last_name, work_email, user_id, status, employment_type, date_of_joining)
         values ($1, 'A-901', 'Omar', 'Demo', 'omar@example.test', $2, 'active', 'permanent', '2024-01-01') returning id`, [f.orgA, f.users.ownerA])).rows[0]!.id;
      await tx.query(`insert into separations (organization_id, employee_id, type, initiated_by, submitted_on, requested_last_day, notice_days, notice_end, last_working_day, status)
                      values ($1, $2, 'resignation', $3, $4::date - 40, $4::date - 1, 30, $4::date - 10, $4::date - 1, 'approved')`, [f.orgA, owner, f.users.ownerA, d]);
      expect(await runWorker(tx)).toEqual({ completed: 1, failed: 0 });
      expect((await tx.query<{ status: string }>('select status from organization_members where organization_id = $1 and user_id = $2', [f.orgA, f.users.ownerA])).rows[0]!.status).toBe('active');
      expect((await tx.query(`select 1 from notifications where kind = 'separation.exit_failed' and user_id = $1`, [f.users.hrA])).rows).toHaveLength(1);

      await tx.query('delete from organizations where id = $1', [f.orgA]);
      expect((await tx.query('select 1 from separations')).rows).toHaveLength(0);
    });
  });
});
