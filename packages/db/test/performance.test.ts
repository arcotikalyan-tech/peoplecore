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

const view = (tx: Transaction, review: string) =>
  tx.query<{ self_rating: number | null; manager_rating: number | null; final_rating: number | null; manager_comments: string | null; can_manager_review: boolean; can_calibrate: boolean }>(
    'select self_rating, manager_rating, final_rating, manager_comments, can_manager_review, can_calibrate from review_view($1)', [review]).then((r) => r.rows[0]!);

describe('goals', () => {
  it('the employee, their line and HR maintain them; peers can’t see them', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const g = (await tx.query<{ id: string }>(`insert into goals (organization_id, employee_id, title, weight) values ($1, $2, 'Ship the billing revamp', 40) returning id`, [f.orgA, f.employees.icA])).rows[0]!.id;
      await tx.query('update goals set progress = 30 where id = $1', [g]);
      await as(tx, f.users.managerA); // icA is in managerA's line
      await tx.query('update goals set progress = 35 where id = $1', [g]);
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from goals where id = $1', [g])).rows).toHaveLength(0);
      expect((await failure(tx, `insert into goals (organization_id, employee_id, title) values ($1, $2, 'Not mine to set')`, [f.orgA, f.employees.icA])).code).toBe('42501');
    });
  });
});

describe('review cycle', () => {
  it('with self-appraisal switched off, the manager reviews straight away', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const cycle = (await tx.query<{ id: string }>(
        `insert into review_cycles (organization_id, name, period_start, period_end) values ($1, 'H1 no self', '2025-04-01', '2025-09-30') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('select activate_review_cycle($1)', [cycle]);
      const review = (await tx.query<{ id: string }>('select id from reviews where cycle_id = $1 and employee_id = $2', [cycle, f.employees.icA])).rows[0]!.id;
      await as(tx, f.users.leadA);
      // Self-appraisal on (the default): the manager waits for the self review.
      expect((await view(tx, review)).can_manager_review).toBe(false);
      expect((await failure(tx, `select submit_manager_review($1, 3::smallint, 'Steady half; good ownership.')`, [review])).message)
        .toBe('The manager review opens after the self review, while the cycle is active.');
      await tx.exec('reset role');
      await tx.query(`insert into pms_settings (organization_id, self_appraisal) values ($1, false)
                      on conflict (organization_id) do update set self_appraisal = false`, [f.orgA]);
      await as(tx, f.users.leadA);
      expect((await view(tx, review)).can_manager_review).toBe(true);
      await tx.query(`select submit_manager_review($1, 3::smallint, 'Steady half; good ownership.')`, [review]);
    });
  });

  it('self review → manager review → calibration → shared; the employee sees the manager’s part only when shared', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const cycle = (await tx.query<{ id: string }>(
        `insert into review_cycles (organization_id, name, period_start, period_end) values ($1, 'FY26 annual', '2025-04-01', '2026-03-31') returning id`, [f.orgA])).rows[0]!.id;
      const opened = (await tx.query<{ n: number }>('select activate_review_cycle($1) as n', [cycle])).rows[0]!.n;
      expect(opened).toBeGreaterThan(0);
      const review = (await tx.query<{ id: string }>('select id from reviews where cycle_id = $1 and employee_id = $2', [cycle, f.employees.icA])).rows[0]!.id;

      await as(tx, f.users.icA);
      expect((await tx.query<{ review_id: string }>('select review_id from my_reviews($1)', [f.orgA])).rows.map((r) => r.review_id)).toContain(review);
      expect((await tx.query('select 1 from reviews where id = $1', [review])).rows).toHaveLength(0); // raw row hidden from the subject
      expect((await failure(tx, `select submit_self_review($1, 4::smallint, 'Too short')`, [review])).message).toBe('Add a few sentences about your year.');
      await tx.query(`select submit_self_review($1, 4::smallint, 'Delivered the billing revamp and mentored two engineers.')`, [review]);

      await as(tx, f.users.peerA);
      expect((await failure(tx, `select submit_manager_review($1, 3::smallint, 'I am not the manager here.')`, [review])).code).toBe('42501');
      await as(tx, f.users.leadA); // icA's direct manager
      expect((await view(tx, review)).can_manager_review).toBe(true);
      await tx.query(`select submit_manager_review($1, 3::smallint, 'Solid year; the revamp slipped a quarter.')`, [review]);

      await as(tx, f.users.icA);
      expect(await view(tx, review)).toMatchObject({ self_rating: 4, manager_rating: null, manager_comments: null, final_rating: null }); // not shared yet

      await as(tx, f.users.hrA);
      expect((await view(tx, review)).can_calibrate).toBe(true);
      expect((await failure(tx, `select calibrate_review($1, 4::smallint, '')`, [review])).message).toBe('Say why the final rating differs from the manager’s.');
      await tx.query(`select calibrate_review($1, 4::smallint, 'Calibrated against peers: impact above the bar.')`, [review]);
      await tx.query('select share_review_cycle($1)', [cycle]);

      await as(tx, f.users.icA);
      expect(await view(tx, review)).toMatchObject({ self_rating: 4, manager_rating: 3, final_rating: 4, manager_comments: 'Solid year; the revamp slipped a quarter.' });
      expect((await failure(tx, `select submit_self_review($1, 5::smallint, 'Changing my mind after the fact.')`, [review])).message).toBe('Your self review can’t be changed now.');
      expect((await tx.query(`select 1 from notifications where kind = 'performance.shared'`)).rows).toHaveLength(1);

      await tx.exec('reset role');
      const audit = await tx.query<{ changes: Record<string, unknown> }>(`select changes from audit_events where entity_type = 'reviews' and action = 'update' and entity_id = $1 order by id desc limit 1`, [review]);
      expect(JSON.stringify(audit.rows[0]!.changes)).not.toMatch(/revamp|Calibrated/);
    });
  });

  it('360 feedback: requested by the subject or manager, answered once, read anonymously after sharing', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const cycle = (await tx.query<{ id: string }>(
        `insert into review_cycles (organization_id, name, period_start, period_end) values ($1, 'H1', '2026-04-01', '2026-09-30') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('select activate_review_cycle($1)', [cycle]);
      const review = (await tx.query<{ id: string }>('select id from reviews where cycle_id = $1 and employee_id = $2', [cycle, f.employees.icA])).rows[0]!.id;

      await as(tx, f.users.icA);
      const req = (await tx.query<{ id: string }>(`select request_feedback($1, $2, 'How did I do on the billing launch?') as id`, [review, f.employees.peerA])).rows[0]!.id;
      expect((await failure(tx, `select request_feedback($1, $2, 'Asking myself?')`, [review, f.employees.icA])).message).toBe('Ask someone other than the person being reviewed.');

      await as(tx, f.users.peerA);
      await tx.query(`select give_feedback($1, 'Clear communication and a calm launch.')`, [req]);
      expect((await failure(tx, `select give_feedback($1, 'Second thoughts on it all.')`, [req])).message).toBe('You have already answered this request.');

      await as(tx, f.users.icA);
      expect((await tx.query('select * from my_feedback($1)', [review])).rows).toHaveLength(0); // not shared yet
      await as(tx, f.users.leadA);
      expect((await tx.query<{ response: string }>('select response from feedback_requests where review_id = $1', [review])).rows[0]!.response).toBe('Clear communication and a calm launch.');
      await as(tx, f.users.hrA);
      await tx.query('select share_review_cycle($1)', [cycle]);
      await as(tx, f.users.icA);
      expect((await tx.query('select * from my_feedback($1)', [review])).rows).toEqual([
        { question: 'How did I do on the billing launch?', response: 'Clear communication and a calm launch.' },
      ]);
    });
  });

  it('only HR runs cycles', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) =>
      tx.query(`insert into review_cycles (organization_id, name, period_start, period_end) values ($1, 'x', current_date, current_date)`, [f.orgA])))).toBe('42501');
  });
});
