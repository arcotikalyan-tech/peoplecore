import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

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

// Reporting line in the fixture: Mira (managerA) ← Lalit (leadA) ← Ishan (icA). Pia (peerA) is outside it.
beforeAll(async () => {
  await ctx.t.db.exec(`
    insert into app.approval_flow_templates (subject_type, step_no, approver_rule, permission_key, label) values
      ('test_subject', 1, 'reporting_manager', 'leave.approve', 'Manager'),
      ('test_subject', 2, 'permission', 'payroll.approve', 'Payroll');
  `);
  await ctx.t.db.query(`select app.seed_org_flows($1, 'test_subject')`, [ctx.f.orgA]);
});

const request = (tx: Transaction, subject: string, summary = 'Test request') =>
  internal(tx, async () => (await tx.query<{ id: string }>(
    `select app.request_approval($1, 'test_subject', gen_random_uuid(), $2, $3, '/test') as id`, [ctx.f.orgA, subject, summary])).rows[0]!.id);
const inbox = async (tx: Transaction) =>
  (await tx.query<{ id: string; via: string; on_behalf_of_name: string | null; escalated: boolean }>(
    'select id, via, on_behalf_of_name, escalated from my_pending_approvals($1)', [ctx.f.orgA])).rows;
const notified = async (tx: Transaction, kind: string) => (await tx.query('select 1 from notifications where kind = $1', [kind])).rows.length;

describe('approval delegation', () => {
  it('a manager away hands their approvals to a colleague; the decision is recorded as on their behalf', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.leadA, async (tx) => {
      const today = (await tx.query<{ d: string }>(`select app.org_today($1)::text as d`, [f.orgA])).rows[0]!.d;
      const day = (n: number) => `(${`'${today}'::date + ${n}`})`;
      expect((await failure(tx, `select delegate_approvals($1, $2, ${day(0)}, ${day(5)})`, [f.orgA, f.users.leadA])).message).toBe('Choose someone else to approve.');
      expect((await failure(tx, `select delegate_approvals($1, $2, ${day(-1)}, ${day(5)})`, [f.orgA, f.users.peerA])).message).toBe('Start today or later.');
      expect((await failure(tx, `select delegate_approvals($1, $2, ${day(0)}, ${day(91)})`, [f.orgA, f.users.peerA])).message).toBe('Delegate for at most 90 days at a time.');
      expect((await failure(tx, `select delegate_approvals($1, $2, ${day(0)}, ${day(5)})`, [f.orgA, f.users.employeeB])).message).toBe('Choose a colleague who can sign in.');
      const delegation = (await tx.query<{ id: string }>(`select delegate_approvals($1, $2, ${day(0)}, ${day(5)}, 'On leave') as id`, [f.orgA, f.users.peerA])).rows[0]!.id;
      expect((await failure(tx, `select delegate_approvals($1, $2, ${day(3)}, ${day(8)})`, [f.orgA, f.users.managerA])).message)
        .toBe('There is already a delegation for some of these days. End it first.');

      await as(tx, f.users.icA);
      const id = await request(tx, f.employees.icA);

      await as(tx, f.users.peerA);
      expect(await notified(tx, 'approval.delegated')).toBe(1);
      expect(await notified(tx, 'approval.requested')).toBe(1);
      expect(await inbox(tx)).toEqual([{ id, via: 'delegation', on_behalf_of_name: 'Lalit Demo', escalated: false }]);
      expect((await tx.query('select 1 from approval_delegations')).rows).toHaveLength(1); // the delegate sees it

      await as(tx, f.users.managerA); // the skip level: not before escalation
      expect(await inbox(tx)).toEqual([]);
      expect((await failure(tx, `select decide_approval($1, 'approve')`, [id])).code).toBe('42501');
      expect((await tx.query('select 1 from approval_delegations')).rows).toHaveLength(0); // not theirs
      expect((await failure(tx, 'select end_delegation($1)', [delegation])).code).toBe('42501');

      await as(tx, f.users.peerA);
      expect((await tx.query<{ s: string }>(`select decide_approval($1, 'approve') as s`, [id])).rows[0]!.s).toBe('pending');
      expect((await tx.query<{ via: string; on_behalf_of: string }>('select via, on_behalf_of from approval_actions where request_id = $1', [id])).rows)
        .toEqual([{ via: 'delegation', on_behalf_of: f.users.leadA }]);

      await as(tx, f.users.leadA);
      expect(await notified(tx, 'approval.delegated_decision')).toBe(1);
      await tx.query('select end_delegation($1)', [delegation]);
      expect((await failure(tx, 'select end_delegation($1)', [delegation])).message).toBe('This delegation has already ended.');

      await as(tx, f.users.icA);
      const later = await request(tx, f.employees.icA, 'After the delegation ended');
      await as(tx, f.users.peerA);
      expect((await inbox(tx)).map((r) => r.id)).not.toContain(later);
      expect((await failure(tx, `select decide_approval($1, 'approve')`, [later])).code).toBe('42501');
    });
  });

  it('only starts on its first day; never lets the subject decide their own request; HR can delegate for someone', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const today = (await tx.query<{ d: string }>(`select app.org_today($1)::text as d`, [f.orgA])).rows[0]!.d;
      await tx.query(`select delegate_approvals($1, $2, $3::date + 1, $3::date + 3, null, $4)`, [f.orgA, f.users.peerA, today, f.users.leadA]); // tomorrow
      await tx.query(`select delegate_approvals($1, $2, $3::date, $3::date, null, $4)`, [f.orgA, f.users.icA, today, f.users.leadA]); // to the subject

      await as(tx, f.users.managerA); // no member.manage: only for themselves
      expect((await failure(tx, `select delegate_approvals($1, $2, $3::date, $3::date, null, $4)`, [f.orgA, f.users.peerA, today, f.users.leadA])).code).toBe('42501');

      await as(tx, f.users.icA);
      const id = await request(tx, f.employees.icA);
      expect(await inbox(tx)).toEqual([]); // delegate, but it is their own request
      expect((await failure(tx, `select decide_approval($1, 'approve')`, [id])).code).toBe('42501');
      await as(tx, f.users.peerA);
      expect(await inbox(tx)).toEqual([]); // starts tomorrow
    });
  });
});

describe('approval escalation', () => {
  const age = (tx: Transaction, id: string, hours: number) =>
    internal(tx, () => tx.query(`update approval_requests set step_started_at = now() - make_interval(hours => $2) where id = $1`, [id, hours]));
  const run = (tx: Transaction) => internal(tx, async () => {
    await tx.exec('set local role service_role');
    const r = (await tx.query<{ r: { escalated: number } }>('select worker_approval_escalations() as r')).rows[0]!.r;
    await tx.exec('reset role');
    return r.escalated;
  });

  it('after the step’s hours, adds the manager’s manager; resets when the request moves on', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const id = await request(tx, f.employees.icA, 'Waiting too long');
      expect((await failure(tx, 'select worker_approval_escalations()')).code).toBe('42501');
      await age(tx, id, 71);
      expect(await run(tx)).toBe(0);
      await age(tx, id, 73);
      expect(await run(tx)).toBe(1);
      expect(await run(tx)).toBe(0); // once per step

      await as(tx, f.users.leadA);
      expect(await notified(tx, 'approval.escalated')).toBe(1); // reminded
      await as(tx, f.users.managerA);
      expect(await notified(tx, 'approval.escalated')).toBe(1);
      expect(await inbox(tx)).toEqual([{ id, via: 'escalation', on_behalf_of_name: null, escalated: true }]);
      expect((await tx.query<{ s: string }>(`select decide_approval($1, 'approve') as s`, [id])).rows[0]!.s).toBe('pending');
      expect((await tx.query<{ via: string }>('select via from approval_actions where request_id = $1', [id])).rows).toEqual([{ via: 'escalation' }]);

      await as(tx, f.users.leadA); // step 2 is payroll's; the escalation and its clock reset
      expect(await inbox(tx)).toEqual([]);
      const state = await internal(tx, async () => (await tx.query<{ escalated_at: string | null; fresh: boolean }>(
        `select escalated_at, step_started_at > now() - interval '1 minute' as fresh from approval_requests where id = $1`, [id])).rows[0]!);
      expect(state).toEqual({ escalated_at: null, fresh: true });
      await age(tx, id, 80);
      expect(await run(tx)).toBe(1);
      await as(tx, f.users.payrollA); // permission steps: the same approvers, reminded
      expect(await notified(tx, 'approval.escalated')).toBe(1);
      expect((await inbox(tx))[0]).toMatchObject({ id, via: 'direct', escalated: true });
    });
  });

  it('without a manager’s manager, escalates to the step’s permission holders; steps can change their hours', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.leadA, async (tx) => {
      const id = await request(tx, f.employees.leadA, 'Lalit’s request'); // manager Mira has no manager
      await as(tx, f.users.hrA);
      expect(await inbox(tx)).toEqual([]);
      await age(tx, id, 100);
      expect(await run(tx)).toBe(1);
      expect((await inbox(tx)).map((r) => r.id)).toEqual([id]);
      expect(await notified(tx, 'approval.escalated')).toBe(1);

      await tx.query(`update approval_flow_steps set escalate_after_hours = 24 where organization_id = $1 and label = 'Manager'`, [f.orgA]); // org.manage
      expect((await failure(tx, `update approval_flow_steps set escalate_after_hours = 0 where organization_id = $1`, [f.orgA])).code).toBe('23514');
      await as(tx, f.users.managerA);
      expect((await tx.query(`update approval_flow_steps set escalate_after_hours = 1 where organization_id = $1`, [f.orgA])).affectedRows).toBe(0);
    });
  });
});
