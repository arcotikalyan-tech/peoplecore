import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

/** Switch the transaction's identity, as PostgREST does per request (role authenticated, aal2). */
async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

/** Runs internal (app schema) functions as the database owner, keeping the caller's JWT identity. */
async function internal<T>(tx: Transaction, fn: () => Promise<T>): Promise<T> {
  await tx.exec('reset role');
  const out = await fn();
  await tx.exec('set local role authenticated');
  return out;
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

beforeAll(async () => {
  // A two-step test flow (manager, then payroll) with a handler that records outcomes.
  await ctx.t.db.exec(`
    create table app.test_outcomes (subject uuid, outcome text);
    create function app.test_handler(p_subject uuid, p_outcome text) returns void
      language sql security definer set search_path = '' as $$ insert into app.test_outcomes values (p_subject, p_outcome) $$;
    insert into app.approval_handlers values ('test_subject', 'app.test_handler(uuid,text)');
    insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label) values
      ('test_subject', 1, 'reporting_manager', 'leave.approve', 'Manager'),
      ('test_subject', 2, 'permission', 'payroll.approve', 'Payroll');
  `);
  await ctx.t.db.query(`select app.seed_org_flows($1, 'test_subject')`, [ctx.f.orgA]);
});

describe('jobs', () => {
  it('enqueues once per key, claims, completes, retries with backoff, and dies after max attempts', async () => {
    const { db } = ctx.t;
    const id = (await db.query<{ id: number }>(`select app.enqueue_job(null, 'demo.task', '{"n":1}', 'k1') as id`)).rows[0]!.id;
    expect((await db.query<{ id: number }>(`select app.enqueue_job(null, 'demo.task', '{"n":2}', 'k1') as id`)).rows[0]!.id).toBe(id);

    const claimed = await db.query<{ id: number; attempts: number; payload: unknown }>(`select * from worker_claim_jobs('w1', 10, 60)`);
    expect(claimed.rows).toEqual([{ id, organization_id: null, kind: 'demo.task', payload: { n: 1 }, attempts: 1 }]);
    expect((await db.query(`select * from worker_claim_jobs('w2', 10, 60)`)).rows).toEqual([]); // leased
    expect((await db.query<{ r: boolean | null }>(`select worker_complete_job($1, 'w2') as r`, [id])).rows[0]!.r).toBeNull();

    expect((await db.query<{ r: string }>(`select worker_fail_job($1, 'w1', 'boom') as r`, [id])).rows[0]!.r).toBe('retry');
    const after = await db.query<{ status: string; delay: number }>(
      `select status, extract(epoch from run_at - now())::int as delay from app.jobs where id = $1`, [id]);
    expect(after.rows[0]).toMatchObject({ status: 'queued' });
    expect(after.rows[0]!.delay).toBeGreaterThanOrEqual(25);

    await db.query(`update app.jobs set run_at = now(), max_attempts = 2 where id = $1`, [id]);
    await db.query(`select * from worker_claim_jobs('w1', 10, 60)`);
    expect((await db.query<{ r: string }>(`select worker_fail_job($1, 'w1', 'boom again') as r`, [id])).rows[0]!.r).toBe('dead');

    const id2 = (await db.query<{ id: number }>(`select app.enqueue_job(null, 'demo.task', '{}', 'k2') as id`)).rows[0]!.id;
    await db.query(`select * from worker_claim_jobs('w1', 10, 60)`);
    await db.query(`update app.jobs set locked_until = now() - interval '1 second' where id = $1`, [id2]); // worker crashed
    expect((await db.query<{ id: number; attempts: number }>(`select id, attempts from worker_claim_jobs('w3', 10, 60)`)).rows)
      .toEqual([{ id: id2, attempts: 2 }]);
    expect((await db.query<{ r: boolean }>(`select worker_complete_job($1, 'w3') as r`, [id2])).rows[0]!.r).toBe(true);
  });

  it('the worker API is closed to signed-in users', async () => {
    expect(await pgError(ctx.t.asUser(ctx.f.users.ownerA, (tx) => tx.query(`select * from worker_claim_jobs('x', 1, 60)`)))).toBe('42501');
    expect(await pgError(ctx.t.asUser(ctx.f.users.ownerA, (tx) => tx.query(`select worker_enqueue_job(null, 'x', '{}', 'x')`)))).toBe('42501');
  });
});

describe('domain events', () => {
  it('are recorded once and enqueue their job in the same transaction', async () => {
    const { db } = ctx.t;
    const { orgA } = ctx.f;
    await db.query(`select app.emit_event($1, 'employee.joined', $1, '{"x":1}', 'ev-1')`, [orgA]);
    await db.query(`select app.emit_event($1, 'employee.joined', $1, '{"x":2}', 'ev-1')`, [orgA]);
    expect((await db.query(`select 1 from app.domain_events where idempotency_key = 'ev-1'`)).rows).toHaveLength(1);
    const jobs = await db.query<{ kind: string; payload: { x: number; subject_id: string } }>(
      `select kind, payload from app.jobs where idempotency_key = 'event:ev-1'`);
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]).toMatchObject({ kind: 'event:employee.joined', payload: { x: 1, subject_id: orgA } });
  });
});

describe('notifications', () => {
  it('people see and mark only their own, and can change nothing else', async () => {
    const { f } = ctx;
    await ctx.t.db.query(`select app.notify($1, $2, 'test.hello', 'Hello')`, [f.orgA, f.users.icA]);
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(`select id from notifications where kind = 'test.hello'`);
      expect(rows).toHaveLength(1);
      await tx.query('update notifications set read_at = now() where id = $1', [rows[0]!.id]);
      expect((await failure(tx, `update notifications set title = 'x' where id = $1`, [rows[0]!.id])).code).toBe('42501');
    });
    await ctx.t.asUser(f.users.peerA, async (tx) => {
      expect((await tx.query(`select 1 from notifications where kind = 'test.hello'`)).rows).toHaveLength(0);
    });
  });
});

describe('tasks', () => {
  it('HR assigns; the assignee and their line see and complete it; others cannot', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(
        `insert into tasks (organization_id, assignee_employee_id, title, due_on) values ($1, $2, 'Submit PAN copy', current_date + 3) returning id`,
        [f.orgA, f.employees.icA])).rows[0]!.id;

      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from tasks where id = $1', [id])).rows).toHaveLength(1);
      await tx.query(`select set_task_status($1, 'done')`, [id]);
      expect((await failure(tx, `insert into tasks (organization_id, assignee_employee_id, title) values ($1, $2, 'x')`, [f.orgA, f.employees.peerA])).code).toBe('42501');

      await as(tx, f.users.managerA); // icA reports to leadA, who reports to managerA
      expect((await tx.query<{ status: string }>('select status from tasks where id = $1', [id])).rows).toEqual([{ status: 'done' }]);

      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from tasks where id = $1', [id])).rows).toHaveLength(0);
      expect((await failure(tx, `select set_task_status($1, 'open')`, [id])).code).toBe('42501');
    });
  });
});

describe('approvals', () => {
  const request = (tx: Transaction, subjectEmployee: string, summary = 'Test request') =>
    internal(tx, async () => (await tx.query<{ id: string }>(
      `select app.request_approval($1, 'test_subject', gen_random_uuid(), $2, $3, '/test') as id`,
      [ctx.f.orgA, subjectEmployee, summary])).rows[0]!.id);
  const outcomes = (tx: Transaction) => internal(tx, async () => (await tx.query<{ outcome: string }>('select outcome from app.test_outcomes')).rows.map((r) => r.outcome));
  const decide = (tx: Transaction, id: string, decision: string, comment: string | null = null) =>
    tx.query<{ s: string }>('select decide_approval($1, $2, $3) as s', [id, decision, comment]).then((r) => r.rows[0]!.s);

  it('goes manager → payroll; nobody decides their own request or two steps; the handler sees the outcome', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const id = await request(tx, f.employees.icA);
      expect((await failure(tx, 'select decide_approval($1, $2)', [id, 'approve'])).code).toBe('42501'); // own request

      await as(tx, f.users.payrollA);
      expect((await failure(tx, 'select decide_approval($1, $2)', [id, 'approve'])).code).toBe('42501'); // not step 1's approver

      await as(tx, f.users.leadA); // icA's manager
      expect((await tx.query<{ id: string }>('select id from my_pending_approvals($1)', [f.orgA])).rows.map((r) => r.id)).toEqual([id]);
      expect(await decide(tx, id, 'approve')).toBe('pending');
      expect((await failure(tx, 'select decide_approval($1, $2)', [id, 'approve'])).code).toBe('42501'); // second step

      await as(tx, f.users.payrollA);
      expect(await decide(tx, id, 'approve')).toBe('approved');
      expect(await outcomes(tx)).toEqual(['approved']);

      await as(tx, f.users.icA);
      const { rows } = await tx.query<{ kind: string }>(`select kind from notifications where kind like 'approval.%'`);
      expect(rows.map((r) => r.kind)).toEqual(['approval.approved']);
      expect((await tx.query<{ decision: string }>('select decision from approval_actions where request_id = $1 order by acted_at', [id])).rows
        .map((r) => r.decision)).toEqual(['approve', 'approve']);
      await internal(tx, async () => {
        expect((await tx.query(`select 1 from app.domain_events where event_type = 'approval.approved' and subject_id = $1`, [id])).rows).toHaveLength(1);
      });
    });
  });

  it('rejections need a reason; requesters can withdraw; one pending request per subject', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const id = await request(tx, f.employees.icA);
      await as(tx, f.users.leadA);
      expect((await failure(tx, 'select decide_approval($1, $2)', [id, 'reject'])).message).toBe('Give a reason when rejecting.');
      expect(await decide(tx, id, 'reject', 'Overlaps the release')).toBe('rejected');

      await as(tx, f.users.icA);
      const second = await request(tx, f.employees.icA);
      await as(tx, f.users.peerA);
      expect((await failure(tx, 'select cancel_approval($1)', [second])).code).toBe('42501');
      expect((await tx.query('select 1 from approval_requests where id = $1', [second])).rows).toHaveLength(0); // not visible
      await as(tx, f.users.icA);
      await tx.query('select cancel_approval($1)', [second]);
      expect(await outcomes(tx)).toEqual(['rejected', 'cancelled']);

      const subject = (await internal(tx, async () => (await tx.query<{ s: string }>(
        `select subject_id as s from approval_requests where id = $1`, [second])).rows[0]!.s));
      await internal(tx, async () => {
        await tx.query(`select app.request_approval($1, 'test_subject', $2, $3, 'Again')`, [f.orgA, subject, f.employees.icA]);
        await tx.exec('savepoint dup');
        expect(await pgError(tx.query(`select app.request_approval($1, 'test_subject', $2, $3, 'Twice')`, [f.orgA, subject, f.employees.icA]))).toBe('23505');
        await tx.exec('rollback to savepoint dup');
      });
    });
  });

  it('falls back to org-wide approvers when the subject has no manager, or the manager raised the request', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.peerA, async (tx) => {
      const noManager = await request(tx, f.employees.peerA);
      const approvers = await internal(tx, async () => (await tx.query<{ u: string }>('select app.current_approvers($1) as u', [noManager])).rows.map((r) => r.u).sort());
      expect(approvers).toEqual([f.users.hrA, f.users.ownerA].sort()); // leave.approve, org scope

      await as(tx, f.users.leadA); // leadA raises one for their own report
      const byManager = await request(tx, f.employees.icA);
      expect((await failure(tx, 'select decide_approval($1, $2)', [byManager, 'approve'])).code).toBe('42501');
      await as(tx, f.users.hrA);
      expect(await decide(tx, byManager, 'approve')).toBe('pending');
    });
  });

  it('refuses subject types without a flow', async () => {
    await ctx.t.asUser(ctx.f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      expect((await failure(tx, `select app.request_approval($1, 'unknown_thing', gen_random_uuid(), null, 'x')`, [ctx.f.orgA])).message)
        .toBe('No approval flow is set up for unknown_thing.');
    });
  });
});
