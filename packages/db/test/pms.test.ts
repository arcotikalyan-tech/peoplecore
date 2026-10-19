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

describe('pms settings, KRAs, skills', () => {
  it('goal weightage gates the self review; skills are rated by the employee then the manager; manager ratings stay hidden until shared', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const cycle = (await tx.query<{ id: string }>(
        `insert into review_cycles (organization_id, name, period_start, period_end) values ($1, 'FY27', '2026-04-01', '2027-03-31') returning id`, [f.orgA])).rows[0]!.id;
      const comm = (await tx.query<{ id: string }>(`insert into pms_skills (organization_id, name, category) values ($1, 'Communication', 'Core') returning id`, [f.orgA])).rows[0]!.id;
      const code = (await tx.query<{ id: string }>(`insert into pms_skills (organization_id, name, category) values ($1, 'Code quality', 'Technical') returning id`, [f.orgA])).rows[0]!.id;
      expect((await failure(tx, `insert into pms_skills (organization_id, name) values ($1, 'communication')`, [f.orgA])).code).toBe('23505');
      await tx.query(`insert into pms_kras (organization_id, title, weight) values ($1, 'Ship the roadmap', 60)`, [f.orgA]);
      await tx.query(`insert into goals (organization_id, employee_id, cycle_id, title, weight) values ($1, $2, $3, 'Ship the roadmap', 60), ($1, $2, $3, 'Mentor two engineers', 30)`,
        [f.orgA, f.employees.icA, cycle]);
      await tx.query('select activate_review_cycle($1)', [cycle]);
      const review = (await tx.query<{ id: string }>('select id from reviews where cycle_id = $1 and employee_id = $2', [cycle, f.employees.icA])).rows[0]!.id;

      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from pms_kras')).rows).toHaveLength(1); // the library is visible to everyone
      expect((await failure(tx, `insert into pms_skills (organization_id, name) values ($1, 'Mine')`, [f.orgA])).code).toBe('42501');
      expect((await failure(tx, `select rate_review_skills($1, 'self', $2)`, [review, JSON.stringify({ [comm]: 7 })])).message).toBe('Rate each skill from 1 to 5.');
      expect((await tx.query<{ n: number }>(`select rate_review_skills($1, 'self', $2) as n`, [review, JSON.stringify({ [comm]: 4, [code]: 3 })])).rows[0]!.n).toBe(2);
      expect((await failure(tx, `select rate_review_skills($1, 'manager', $2)`, [review, JSON.stringify({ [comm]: 4 })])).code).toBe('42501');
      expect((await failure(tx, `select submit_self_review($1, 4::smallint, 'A good year with steady delivery.')`, [review])).message)
        .toBe('Your goal weights for this cycle add up to 90%; make them 100% before submitting.');

      await as(tx, f.users.hrA);
      await tx.query(`update goals set weight = 40 where employee_id = $1 and title = 'Mentor two engineers'`, [f.employees.icA]);
      await as(tx, f.users.icA);
      await tx.query(`select submit_self_review($1, 4::smallint, 'A good year with steady delivery.')`, [review]);
      expect((await failure(tx, `select rate_review_skills($1, 'self', $2)`, [review, JSON.stringify({ [comm]: 5 })])).message).toBe('These ratings can’t be changed now.');

      await as(tx, f.users.leadA); // Ishan's manager
      await tx.query(`select rate_review_skills($1, 'manager', $2)`, [review, JSON.stringify({ [comm]: 3, [code]: 4 })]);
      expect((await tx.query<{ name: string; self_rating: number; manager_rating: number }>('select name, self_rating, manager_rating from review_skills($1)', [review])).rows)
        .toEqual([{ name: 'Communication', self_rating: 4, manager_rating: 3 }, { name: 'Code quality', self_rating: 3, manager_rating: 4 }]);

      await as(tx, f.users.icA);
      expect((await tx.query<{ manager_rating: number | null }>('select manager_rating from review_skills($1)', [review])).rows.every((r) => r.manager_rating === null)).toBe(true);
      expect((await tx.query('select 1 from review_skill_ratings')).rows).toHaveLength(0);

      await as(tx, f.users.peerA);
      expect((await failure(tx, 'select * from review_skills($1)', [review])).code).toBe('42501');

      await as(tx, f.users.hrA);
      await tx.query(`update pms_settings set goal_weightage = false, rating_labels = '{Poor,Fair,Good,Great,Outstanding}' where organization_id = $1`, [f.orgA]);
      expect((await tx.query('select 1 from review_skill_ratings')).rows).toHaveLength(2);
    });
  });
});
