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

async function catalog(tx: Transaction, org: string) {
  const add = async (title: string, extra = '') =>
    (await tx.query<{ id: string }>(`insert into courses (organization_id, title ${extra ? ', ' + extra.split('=')[0] : ''})
      values ($1, $2 ${extra ? ', ' + extra.split('=')[1] : ''}) returning id`, [org, title])).rows[0]!.id;
  return {
    secure: await add('Secure coding basics'),
    posh: (await tx.query<{ id: string }>(`insert into courses (organization_id, title, valid_for_months, self_enroll) values ($1, 'POSH awareness', 12, false) returning id`, [org])).rows[0]!.id,
    old: await add('Old induction', 'is_active=false'),
  };
}

const enrollments = async (tx: Transaction) =>
  (await tx.query<{ employee_id: string; status: string }>('select employee_id, status from course_enrollments order by created_at, employee_id')).rows;
const notified = async (tx: Transaction, kind: string) => (await tx.query('select 1 from notifications where kind = $1', [kind])).rows.length;

describe('learning', () => {
  it('employees enrol in open courses and complete them; their line and HR see it, colleagues don’t', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const c = await catalog(tx, f.orgA);
      expect((await failure(tx, `insert into courses (organization_id, title, url) values ($1, 'Bad link', 'http://example.test')`, [f.orgA])).code).toBe('23514');

      await as(tx, f.users.icA);
      expect((await tx.query<{ title: string }>('select title from courses order by title')).rows.map((r) => r.title)).toEqual(['POSH awareness', 'Secure coding basics']);
      expect((await failure(tx, `insert into courses (organization_id, title) values ($1, 'My course')`, [f.orgA])).code).toBe('42501');
      const mine = (await tx.query<{ id: string }>('select enroll_in_course($1) as id', [c.secure])).rows[0]!.id;
      expect((await failure(tx, 'select enroll_in_course($1)', [c.secure])).message).toBe('You’re already enrolled.');
      expect((await failure(tx, 'select enroll_in_course($1)', [c.posh])).message).toBe('This course isn’t open for enrolment. Ask HR or your manager.');
      expect((await failure(tx, 'select enroll_in_course($1)', [c.old])).message).toBe('This course isn’t open for enrolment. Ask HR or your manager.'); // inactive
      await tx.query(`select update_enrollment($1, 'completed', 'Finished all modules')`, [mine]);
      expect((await tx.query<{ status: string; valid_until: string | null; recorded_by: string | null }>(
        'select status, valid_until, recorded_by from course_enrollments where id = $1', [mine])).rows[0]).toEqual({ status: 'completed', valid_until: null, recorded_by: null });
      expect((await failure(tx, `select update_enrollment($1, 'in_progress')`, [mine])).message).toBe('This enrolment is closed.');

      for (const [user, sees] of [[f.users.leadA, 1], [f.users.managerA, 1], [f.users.hrA, 1], [f.users.peerA, 0], [f.users.employeeB, 0]] as const) {
        await as(tx, user);
        expect((await enrollments(tx)).length, user).toBe(sees);
      }
    });
  });

  it('managers assign training to their line, HR to anyone; mandatory training can’t be dropped; completions expire', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const c = await catalog(tx, f.orgA);
      const today = (await tx.query<{ d: string }>(`select app.org_today($1)::text as d`, [f.orgA])).rows[0]!.d;

      await as(tx, f.users.leadA);
      expect((await tx.query<{ n: number }>(`select assign_course($1, $2, $3::date + 14) as n`, [c.posh, [f.employees.icA], today])).rows[0]!.n).toBe(1);
      expect((await failure(tx, 'select assign_course($1, $2)', [c.posh, [f.employees.peerA]])).code).toBe('42501'); // not their line
      expect((await failure(tx, `select assign_course($1, $2, $3::date - 1)`, [c.posh, [f.employees.icA], today])).message).toBe('The due date can’t be in the past.');
      expect((await failure(tx, 'select assign_course($1, $2)', [c.posh, []])).message).toBe('Choose at least one person.');

      await as(tx, f.users.hrA);
      expect((await tx.query<{ n: number }>('select assign_course($1, $2) as n', [c.posh, [f.employees.icA, f.employees.peerA]])).rows[0]!.n).toBe(1); // Ishan already has it
      expect((await failure(tx, 'select assign_course($1, $2)', [c.posh, [f.employees.employeeB]])).code).toBe('42501');

      await as(tx, f.users.icA);
      expect(await notified(tx, 'learning.assigned')).toBe(1);
      const id = (await tx.query<{ id: string }>(`select id from course_enrollments where course_id = $1`, [c.posh])).rows[0]!.id;
      expect((await failure(tx, `select update_enrollment($1, 'cancelled')`, [id])).message).toBe('Mandatory training can’t be dropped. Talk to HR.');
      await tx.query(`select update_enrollment($1, 'in_progress')`, [id]);

      await as(tx, f.users.leadA); // records the classroom session for him
      await tx.query(`select update_enrollment($1, 'completed', 'Attended the 14 Oct session')`, [id]);
      const done = (await tx.query<{ recorded_by: string; valid_until: string; expected: string }>(
        `select recorded_by, valid_until::text, ($2::date + interval '12 months')::date::text as expected from course_enrollments where id = $1`, [id, today])).rows[0]!;
      expect(done.recorded_by).toBe(f.users.leadA);
      expect(done.valid_until).toBe(done.expected);

      await as(tx, f.users.icA);
      expect(await notified(tx, 'learning.completed')).toBe(1);
      expect((await tx.query('select * from learning_summary($1)', [f.orgA])).rows).toHaveLength(0); // HR only

      await as(tx, f.users.hrA);
      const summary = (await tx.query<{ enrolled: number; completed: number }>('select enrolled, completed from learning_summary($1) where course_id = $2', [f.orgA, c.posh])).rows[0]!;
      expect({ enrolled: Number(summary.enrolled), completed: Number(summary.completed) }).toEqual({ enrolled: 1, completed: 1 });
    });
  });

  it('the worker reminds overdue learners once and re-assigns completions before they lapse', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const c = await catalog(tx, f.orgA);
      await tx.query('select assign_course($1, $2)', [c.posh, [f.employees.peerA, f.employees.icA]]);
      const run = async () => {
        await tx.exec('reset role');
        await tx.exec('set local role service_role');
        const r = (await tx.query<{ r: { reminded: number; recertifications: number } }>('select worker_learning() as r')).rows[0]!.r;
        await tx.exec('reset role');
        return r;
      };
      expect((await failure(tx, 'select worker_learning()')).code).toBe('42501');

      await tx.exec('reset role');
      await tx.query(`update course_enrollments set due_on = app.org_today($1) - 1 where employee_id = $2`, [f.orgA, f.employees.peerA]);
      const ishan = (await tx.query<{ id: string }>('select id from course_enrollments where employee_id = $1', [f.employees.icA])).rows[0]!.id;
      expect(await run()).toMatchObject({ reminded: 1, recertifications: 0 });
      expect(await run()).toMatchObject({ reminded: 0, recertifications: 0 });
      const told = (await tx.query<{ user_id: string }>(`select user_id from notifications where kind = 'learning.overdue'`)).rows.map((r) => r.user_id);
      expect(told.sort()).toEqual([f.users.peerA, f.users.hrA].sort());

      await as(tx, f.users.hrA);
      await tx.query(`select update_enrollment($1, 'completed')`, [ishan]);
      await tx.exec('reset role');
      await tx.query(`update course_enrollments set valid_until = app.org_today($1) + 10 where id = $2`, [f.orgA, ishan]);
      expect(await run()).toMatchObject({ reminded: 0, recertifications: 1 });
      expect(await run()).toMatchObject({ reminded: 0, recertifications: 0 });
      const renewal = (await tx.query<{ source: string; status: string; mandatory: boolean; due: boolean }>(
        `select source, status, mandatory, due_on = app.org_today($1) + 10 as due from course_enrollments where employee_id = $2 and id <> $3`,
        [f.orgA, f.employees.icA, ishan])).rows;
      expect(renewal).toEqual([{ source: 'recertification', status: 'assigned', mandatory: true, due: true }]);
    });
  });

  it('only HR edits the catalog', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) =>
      tx.query(`insert into courses (organization_id, title) values ($1, 'Leadership 101')`, [f.orgA])))).toBe('42501');
  });
});
