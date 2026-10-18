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

describe('onboarding', () => {
  it('every organization has a default template with joiner, manager and owner tasks', async () => {
    const { rows } = await ctx.t.db.query<{ assignee: string; n: number }>(
      `select t.assignee, count(*)::int as n from onboarding_template_tasks t join onboarding_templates p on p.id = t.template_id
        where p.organization_id = $1 and p.is_default group by 1 order by 1`, [ctx.f.orgA]);
    expect(rows).toEqual([{ assignee: 'joiner', n: 3 }, { assignee: 'manager', n: 3 }, { assignee: 'owner', n: 1 }]);
  });

  it('HR starts a plan: tasks land with the joiner and their manager, due around the joining date; it completes itself', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const plan = (await tx.query<{ id: string }>('select start_onboarding($1) as id', [f.employees.icA])).rows[0]!.id;
      const tasks = await tx.query<{ id: string; assignee: string; offset: number }>(
        `select t.id, t.assignee_employee_id as assignee, (t.due_on - e.date_of_joining) as offset
           from tasks t join employees e on e.id = $2 where t.subject_id = $1 order by t.due_on, t.title`, [plan, f.employees.icA]);
      expect(tasks.rows).toHaveLength(7);
      expect(tasks.rows.filter((t) => t.assignee === f.employees.icA)).toHaveLength(3);
      expect(tasks.rows.filter((t) => t.assignee === f.employees.leadA)).toHaveLength(4); // manager also gets the owner task
      expect(tasks.rows[0]!.offset).toBe(-3);
      expect((await failure(tx, 'select start_onboarding($1)', [f.employees.icA])).message).toBe('This person already has onboarding in progress.');

      // The joiner and the manager close their tasks; the last one completes the plan.
      for (const t of tasks.rows) {
        await as(tx, t.assignee === f.employees.icA ? f.users.icA : f.users.leadA);
        await tx.query(`select set_task_status($1, 'done')`, [t.id]);
      }
      await as(tx, f.users.hrA);
      expect((await tx.query<{ status: string }>('select status from onboarding_plans where id = $1', [plan])).rows[0]!.status).toBe('completed');
    });
  });

  it('cancelling a plan cancels its open tasks; only HR can start or cancel', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) => tx.query('select start_onboarding($1)', [f.employees.icA])))).toBe('42501');
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const plan = (await tx.query<{ id: string }>('select start_onboarding($1) as id', [f.employees.peerA])).rows[0]!.id;
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select cancel_onboarding($1)', [plan])).code).toBe('42501');
      expect((await tx.query('select 1 from onboarding_plans where id = $1', [plan])).rows).toHaveLength(0); // not their plan
      await as(tx, f.users.hrA);
      await tx.query('select cancel_onboarding($1)', [plan]);
      expect((await tx.query(`select 1 from tasks where subject_id = $1 and status = 'open'`, [plan])).rows).toHaveLength(0);
    });
  });

  it('the worker starts the default plan for a hire exactly once', async () => {
    const { db } = ctx.t;
    await db.exec('begin');
    try {
      expect((await db.query<{ r: string }>('select worker_start_onboarding($1) as r', [ctx.f.employees.leadA])).rows[0]!.r).toBe('started');
      expect((await db.query<{ r: string }>('select worker_start_onboarding($1) as r', [ctx.f.employees.leadA])).rows[0]!.r).toBe('exists');
      expect((await db.query<{ r: string }>('select worker_start_onboarding(gen_random_uuid()) as r')).rows[0]!.r).toBe('missing'); // e.g. deleted since
    } finally {
      await db.exec('rollback');
    }
    expect(await pgError(ctx.t.asUser(ctx.f.users.hrA, (tx) => tx.query('select worker_start_onboarding($1)', [ctx.f.employees.leadA])))).toBe('42501');
  });
});

describe('policies', () => {
  it('HR publishes; members read and acknowledge once; HR sees who has not', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const policy = (await tx.query<{ id: string }>(
        `insert into policy_documents (organization_id, title, body) values ($1, 'Code of conduct', 'Be kind, be honest, be safe.') returning id`, [f.orgA])).rows[0]!.id;
      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from policy_documents where id = $1', [policy])).rows).toHaveLength(1);
      await tx.query('select acknowledge_policy($1)', [policy]);
      await tx.query('select acknowledge_policy($1)', [policy]); // idempotent
      expect((await failure(tx, `insert into policy_documents (organization_id, title, body) values ($1, 'Mine', 'Not allowed here.')`, [f.orgA])).code).toBe('42501');
      expect((await failure(tx, 'select * from policy_acknowledgement_status($1)', [policy])).code).toBe('42501');

      await as(tx, f.users.hrA);
      const status = await tx.query<{ employee_id: string; acknowledged_at: string | null }>('select employee_id, acknowledged_at from policy_acknowledgement_status($1)', [policy]);
      expect(status.rows.filter((r) => r.acknowledged_at).map((r) => r.employee_id)).toEqual([f.employees.icA]);
      expect(status.rows.length).toBeGreaterThan(1);
    });
    expect(await pgError(ctx.t.asUser(f.users.outsider, (tx) => tx.query(`select acknowledge_policy(gen_random_uuid())`)))).toBe('42501');
  });
});
