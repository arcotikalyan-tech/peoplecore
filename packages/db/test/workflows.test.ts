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

const save = (tx: Transaction, org: string, def: string | null, name: string, trigger: string, conditions: unknown[], steps: unknown[], active = true) =>
  tx.query<{ id: string }>('select save_workflow($1, $2, $3, $4, $5, $6, $7) as id',
    [org, def, name, trigger, JSON.stringify(conditions), JSON.stringify(steps), active]).then((r) => r.rows[0]!.id);

/** Emits a domain event as the system and runs the worker for it; returns how many workflows started. */
async function fire(tx: Transaction, org: string, type: string, subject: string, key: string) {
  await tx.exec('reset role');
  await tx.query(`select app.emit_event($1, $2, $3, '{}', $4)`, [org, type, subject, key]);
  const event = (await tx.query<{ id: number }>('select id from app.domain_events where idempotency_key = $1', [key])).rows[0]!.id;
  await tx.exec('set local role service_role');
  const r = (await tx.query<{ r: { started: number } }>('select worker_start_workflows($1) as r', [event])).rows[0]!.r;
  await tx.exec('reset role');
  return { started: r.started, event };
}

const runs = (tx: Transaction) => tx.query<{ status: string; current_step: number; error: string | null }>(
  'select status, current_step, error from workflow_runs order by started_at').then((r) => r.rows);
const steps = (tx: Transaction) => tx.query<{ step_no: number; kind: string; status: string }>(
  'select step_no, kind, status from workflow_run_steps order by step_no').then((r) => r.rows);

describe('workflows', () => {
  it('only HR builds them, with clear messages for anything wrong; every save is a new version', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      expect((await failure(tx, `select save_workflow($1, null, 'Hi', 'employee.joined', '[]', '[]', true)`, [f.orgA])).message).toBe('Name the workflow.');
      expect((await failure(tx, `select save_workflow($1, null, 'Welcome', 'employee.joined', '[]', '[]', true)`, [f.orgA])).message).toBe('Add between 1 and 20 steps.');
      expect((await failure(tx, `select save_workflow($1, null, 'Welcome', 'nothing.happened', '[]', '[{"type":"wait","days":1}]', true)`, [f.orgA])).message)
        .toBe('Choose what starts the workflow.');
      expect((await failure(tx, `select save_workflow($1, null, 'Welcome', 'employee.joined', '[]', '[{"type":"notify","to":"manager"}]', true)`, [f.orgA])).message)
        .toBe('Step 1: give it a title (up to 150 characters).');
      expect((await failure(tx, `select save_workflow($1, null, 'Payroll', 'payroll.locked', '[]', '[{"type":"notify","to":"employee","title":"x"}]', true)`, [f.orgA])).message)
        .toBe('Step 1: this trigger isn’t about an employee.');
      expect((await failure(tx, `select save_workflow($1, null, 'Welcome', 'employee.joined', '[{"field":"department_id","value":"00000000-0000-0000-0000-000000000000"}]', '[{"type":"wait","days":1}]', true)`, [f.orgA])).message)
        .toBe('A condition names a department that doesn’t exist.');
      expect((await failure(tx, `select save_workflow($1, null, 'Welcome', 'employee.joined', '[]', '[{"type":"wait","days":"soon"}]', true)`, [f.orgA])).message)
        .toBe('A step has a number that isn’t a whole number.');

      const id = await save(tx, f.orgA, null, 'Welcome', 'employee.joined', [], [{ type: 'wait', days: 1 }]);
      await save(tx, f.orgA, id, 'Welcome joiners', 'employee.joined', [], [{ type: 'wait', days: 2 }]);
      expect((await tx.query<{ version: number }>('select version from workflow_versions where definition_id = $1 order by version', [id])).rows.map((r) => r.version)).toEqual([1, 2]);
      expect((await failure(tx, `select save_workflow($1, $2, 'Welcome joiners', 'employee.hired', '[]', '[{"type":"wait","days":1}]', true)`, [f.orgA, id])).message)
        .toBe('The trigger can’t change. Create a new workflow instead.');
      expect((await failure(tx, `update workflow_versions set steps = '[]' where definition_id = $1`, [id])).code).toBe('42501'); // no privilege

      await as(tx, f.users.managerA);
      expect((await failure(tx, `select save_workflow($1, null, 'Mine', 'employee.joined', '[]', '[{"type":"wait","days":1}]', true)`, [f.orgA])).code).toBe('42501');
      expect((await tx.query('select 1 from workflow_definitions')).rows).toHaveLength(0);
      await as(tx, f.users.ownerB);
      expect((await tx.query('select 1 from workflow_definitions')).rows).toHaveLength(0);
    });
  });

  it('a joiner in the matching department gets a welcome, a desk task for their manager, a course and an approval; then it finishes', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query('update employees set department_id = $1 where id = $2', [f.deptA, f.employees.icA]);
      await as(tx, f.users.hrA);
      const course = (await tx.query<{ id: string }>(`insert into courses (organization_id, title) values ($1, 'Security basics') returning id`, [f.orgA])).rows[0]!.id;
      await save(tx, f.orgA, null, 'Engineering onboarding', 'employee.joined', [{ field: 'department_id', value: f.deptA }], [
        { type: 'notify', to: 'employee', title: 'Welcome, {{employee}}!' },
        { type: 'task', assignee: 'manager', title: 'Set up a desk for {{employee}}', due_in_days: 2 },
        { type: 'course', course_id: course, due_in_days: 14 },
        { type: 'approval', summary: 'Confirm {{employee}}’s probation plan' },
        { type: 'notify', to: 'permission', permission: 'workflow.manage', title: 'Onboarding done for {{employee}}' },
      ]);

      expect((await fire(tx, f.orgA, 'employee.joined', f.employees.peerA, 'joined:pia')).started).toBe(0); // no department
      const { started, event } = await fire(tx, f.orgA, 'employee.joined', f.employees.icA, 'joined:ishan');
      expect(started).toBe(1);
      await tx.exec('set local role service_role');
      expect((await tx.query<{ r: { started: number } }>('select worker_start_workflows($1) as r', [event])).rows[0]!.r.started).toBe(0); // once
      await tx.exec('reset role');
      expect(await runs(tx)).toEqual([{ status: 'waiting', current_step: 3, error: null }]);
      expect(await steps(tx)).toEqual([
        { step_no: 0, kind: 'notify', status: 'done' }, { step_no: 1, kind: 'task', status: 'done' },
        { step_no: 2, kind: 'course', status: 'done' }, { step_no: 3, kind: 'approval', status: 'waiting' },
      ]);
      expect((await tx.query<{ title: string }>(`select title from notifications where kind = 'workflow.notice' and user_id = $1`, [f.users.icA])).rows)
        .toEqual([{ title: 'Welcome, Ishan Demo!' }]);
      expect((await tx.query<{ title: string; assignee_employee_id: string }>(`select title, assignee_employee_id from tasks where subject_type = 'workflow_run'`)).rows)
        .toEqual([{ title: 'Set up a desk for Ishan Demo', assignee_employee_id: f.employees.leadA }]);
      expect((await tx.query('select 1 from course_enrollments where employee_id = $1 and course_id = $2', [f.employees.icA, course])).rows).toHaveLength(1);

      await as(tx, f.users.leadA); // the manager approves it from the inbox
      const pending = (await tx.query<{ id: string; summary: string }>('select id, summary from my_pending_approvals($1)', [f.orgA])).rows;
      expect(pending.map((p) => p.summary)).toEqual(['Confirm Ishan Demo’s probation plan']);
      await tx.query(`select decide_approval($1, 'approve')`, [pending[0]!.id]);

      await tx.exec('reset role');
      expect(await runs(tx)).toEqual([{ status: 'completed', current_step: 5, error: null }]);
      const told = (await tx.query<{ user_id: string }>(`select user_id from notifications where kind = 'workflow.notice' and title like 'Onboarding done%'`)).rows.map((r) => r.user_id);
      expect(told.sort()).toEqual([f.users.ownerA, f.users.hrA].sort());

      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from workflow_runs')).rows).toHaveLength(0); // HR only
    });
  });

  it('waits and resumes; a rejected approval stops the run; a failing step stops it with the error; HR can stop a run', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const course = (await tx.query<{ id: string }>(`insert into courses (organization_id, title) values ($1, 'Retiring soon') returning id`, [f.orgA])).rows[0]!.id;
      const later = await save(tx, f.orgA, null, 'Check in after a week', 'employee.hired', [], [
        { type: 'wait', days: 7 }, { type: 'notify', to: 'employee', title: 'How is your first week, {{employee}}?' },
      ]);
      const gated = await save(tx, f.orgA, null, 'Laptop approval', 'employee.hired', [], [
        { type: 'approval', summary: 'Approve a laptop for {{employee}}' }, { type: 'task', assignee: 'employee', title: 'Collect your laptop' },
      ]);
      const broken = await save(tx, f.orgA, null, 'Course for hires', 'employee.hired', [], [{ type: 'course', course_id: course }]);
      await tx.query('update courses set is_active = false where id = $1', [course]);

      expect((await fire(tx, f.orgA, 'employee.hired', f.employees.icA, 'hired:ishan')).started).toBe(3);
      const byDef = async (d: string) => (await tx.query<{ id: string; status: string; error: string | null }>(
        'select id, status, error from workflow_runs where definition_id = $1', [d])).rows[0]!;
      expect((await byDef(later)).status).toBe('waiting');
      expect(await byDef(broken)).toMatchObject({ status: 'failed', error: 'The course is no longer offered.' });

      const resume = async () => {
        await tx.exec('set local role service_role');
        const r = (await tx.query<{ r: { resumed: number } }>('select worker_resume_workflows() as r')).rows[0]!.r.resumed;
        await tx.exec('reset role');
        return r;
      };
      await tx.exec('reset role');
      expect(await resume()).toBe(0);
      await tx.query(`update workflow_runs set resume_at = now() - interval '1 minute' where definition_id = $1`, [later]);
      expect(await resume()).toBe(1);
      expect((await byDef(later)).status).toBe('completed');

      await as(tx, f.users.leadA);
      const req = (await tx.query<{ id: string }>('select id from my_pending_approvals($1)', [f.orgA])).rows[0]!.id;
      await tx.query(`select decide_approval($1, 'reject', 'Use the spare one')`, [req]);
      await tx.exec('reset role');
      expect((await byDef(gated)).status).toBe('stopped');
      expect((await tx.query(`select 1 from tasks where title = 'Collect your laptop'`)).rows).toHaveLength(0);

      await as(tx, f.users.hrA); // a run waiting on approval, stopped by HR: its request is withdrawn
      await tx.query('update courses set is_active = true where id = $1', [course]);
      expect((await fire(tx, f.orgA, 'employee.hired', f.employees.peerA, 'hired:pia')).started).toBe(3);
      await as(tx, f.users.hrA);
      const waiting = (await tx.query<{ id: string }>(`select id from workflow_runs where definition_id = $1 and subject_employee_id = $2`, [gated, f.employees.peerA])).rows[0]!.id;
      await tx.query('select stop_workflow_run($1)', [waiting]);
      expect((await failure(tx, 'select stop_workflow_run($1)', [waiting])).message).toBe('This run has already finished.');
      expect((await tx.query<{ status: string }>(`select r.status from approval_requests r join workflow_run_steps s on s.approval_request_id = r.id where s.run_id = $1`, [waiting])).rows)
        .toEqual([{ status: 'cancelled' }]);
    });
  });
});
