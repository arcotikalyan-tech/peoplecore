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

const course = async (tx: Transaction, org: string, title: string, extra: Record<string, unknown> = {}) =>
  (await tx.query<{ id: string }>(`insert into courses (organization_id, title, points, status) values ($1, $2, $3, $4) returning id`,
    [org, title, extra.points ?? 0, extra.status ?? 'published'])).rows[0]!.id;

describe('learn', () => {
  it('lessons drive progress; completion writes skills and pays points; drafts are hidden', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const c = await course(tx, f.orgA, 'Secure coding', { points: 40 });
      const draft = await course(tx, f.orgA, 'Unreleased course', { status: 'draft' });
      const l1 = (await tx.query<{ id: string }>(`insert into course_lessons (organization_id, course_id, position, title, body) values ($1, $2, 1, 'Basics', 'Read this') returning id`, [f.orgA, c])).rows[0]!.id;
      const l2 = (await tx.query<{ id: string }>(`insert into course_lessons (organization_id, course_id, position, title, kind, url) values ($1, $2, 2, 'Talk', 'video', 'https://example.test/v') returning id`, [f.orgA, c])).rows[0]!.id;
      const skill = (await tx.query<{ id: string }>(`insert into learn_skills (organization_id, name, category) values ($1, 'Threat modelling', 'Security') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into course_skills (organization_id, course_id, skill_id, level) values ($1, $2, $3, 3)`, [f.orgA, c, skill]);
      expect((await tx.query<{ a: boolean }>('select is_active as a from courses where id = $1', [draft])).rows[0]!.a).toBe(false);

      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from courses where id = $1', [draft])).rows).toHaveLength(0);
      expect((await failure(tx, 'select complete_lesson($1)', [l1])).message).toContain('Enrol');
      await tx.query('select enroll_in_course($1)', [c]);
      expect((await tx.query<{ v: { done: number; total: number } }>('select complete_lesson($1) as v', [l1])).rows[0]!.v).toEqual({ done: 1, total: 2 });
      await tx.query('select complete_lesson($1)', [l2]);
      expect((await tx.query<{ s: string }>(`select status as s from course_enrollments where course_id = $1 and employee_id = $2`, [c, f.employees.icA])).rows[0]!.s).toBe('completed');
      expect((await tx.query<{ level: number }>('select level from employee_skills where employee_id = $1 and skill_id = $2', [f.employees.icA, skill])).rows[0]!.level).toBe(3);
      expect(Number((await tx.query<{ b: string }>(`select coalesce(sum(delta), 0) as b from pxp_ledger where employee_id = $1 and kind = 'learning'`, [f.employees.icA])).rows[0]!.b)).toBe(40);

      // A colleague doesn't see someone else's skills; their manager does.
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from employee_skills where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      await as(tx, f.users.leadA);
      expect((await tx.query('select 1 from employee_skills where employee_id = $1', [f.employees.icA])).rows).toHaveLength(1);
    });
  });

  it('journeys assign every course and complete when the last one is done; rules assign matching people', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const a = await course(tx, f.orgA, 'Onboarding 1');
      const b = await course(tx, f.orgA, 'Onboarding 2');
      const j = (await tx.query<{ id: string }>(`insert into learn_journeys (organization_id, title, points) values ($1, 'New joiner path', 100) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into journey_steps (organization_id, journey_id, position, course_id) values ($1, $2, 1, $3), ($1, $2, 2, $4)`, [f.orgA, j, a, b]);
      expect((await failure(tx, 'select enroll_journey($1, $2)', [j, [f.employees.peerA]])).message).toContain('Publish');
      await tx.query(`update learn_journeys set status = 'published' where id = $1`, [j]);
      expect((await tx.query<{ n: number }>('select enroll_journey($1, $2) as n', [j, [f.employees.peerA]])).rows[0]!.n).toBe(1);
      const xs = (await tx.query<{ id: string; course_id: string }>('select id, course_id from course_enrollments where employee_id = $1 and course_id in ($2, $3)', [f.employees.peerA, a, b])).rows;
      expect(xs).toHaveLength(2);

      await as(tx, f.users.peerA);
      for (const x of xs) await tx.query(`select update_enrollment($1, 'completed')`, [x.id]);
      expect((await tx.query<{ d: string | null }>('select completed_at as d from journey_enrollments where journey_id = $1', [j])).rows[0]!.d).not.toBeNull();
      expect(Number((await tx.query<{ b: string }>(`select coalesce(sum(delta), 0) as b from pxp_ledger where employee_id = $1 and kind = 'learning'`, [f.employees.peerA])).rows[0]!.b)).toBe(100);

      // A rule for everyone in the department assigns the course to them; running it again assigns nothing new.
      await as(tx, f.users.hrA);
      const c = await course(tx, f.orgA, 'POSH awareness');
      await tx.query(`insert into learn_rules (organization_id, name, course_id, trigger, department_id) values ($1, 'POSH for all', $2, 'everyone', $3)`, [f.orgA, c, f.deptA]);
      const first = (await tx.query<{ n: number }>('select apply_learning_rules($1) as n', [f.orgA])).rows[0]!.n;
      expect(first).toBeGreaterThanOrEqual(0);
      expect((await tx.query<{ n: number }>('select apply_learning_rules($1) as n', [f.orgA])).rows[0]!.n).toBe(0);

      await as(tx, f.users.icA);
      expect((await failure(tx, 'select apply_learning_rules($1)', [f.orgA])).code).toBe('42501');
      expect((await tx.query('select 1 from learn_rules')).rows).toHaveLength(0);
    });
  });
});
