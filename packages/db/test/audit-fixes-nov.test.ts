import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Audit items fixed on 8 Nov 2026: EMP-05, LV-01, PMS-02, LRN-01 (PAY-10 is in payroll.test.ts and the engine's tests). */
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

const identity = (pan: string, uan: string) => `select set_employee_identity($1, p_pan => '${pan}', p_uan => '${uan}')`;

describe('the same person twice (EMP-05)', () => {
  it('refuses a PAN or UAN already held by someone who hasn’t left, and allows it for a rehire', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.query(identity('ABCPE1234F', '100123456789'), [f.employees.icA]);
      const code = (await tx.query<{ c: string }>('select employee_code as c from employees where id = $1', [f.employees.icA])).rows[0]!.c;
      const pan = await failure(tx, identity('ABCPE1234F', '100999999999'), [f.employees.peerA]);
      expect(pan).toMatchObject({ code: '22023', message: `This PAN is already recorded for employee ${code}, who hasn’t left. One person can’t have two employee records.` });
      expect((await failure(tx, identity('ZZZPE9999Z', '100123456789'), [f.employees.peerA])).message).toContain('This UAN is already recorded');
      // Saving the same numbers on the same record again is fine.
      await tx.query(identity('ABCPE1234F', '100123456789'), [f.employees.icA]);

      // Once the first record has left, the person can be hired again.
      await tx.exec('reset role');
      await tx.query(`update employees set status = 'exited', date_of_exit = '2026-01-31' where id = $1`, [f.employees.icA]);
      await as(tx, f.users.hrA);
      await tx.query(identity('ABCPE1234F', '100123456789'), [f.employees.peerA]);
    });
  });

  it('treats employee codes the same whatever the capitals', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const code = (await tx.query<{ c: string }>('select employee_code as c from employees where id = $1', [f.employees.icA])).rows[0]!.c;
      const other = code.toLowerCase() === code ? code.toUpperCase() : code.toLowerCase();
      const dup = await failure(tx, `update employees set employee_code = $2 where id = $1`, [f.employees.peerA, other]);
      expect(dup).toMatchObject({ code: '23505', message: `Employee code ${other} is already in use (codes don’t depend on capitals).` });
      // Changing only the capitals of your own code is fine.
      await tx.query(`update employees set employee_code = $2 where id = $1`, [f.employees.icA, other]);
    });
  });
});

describe('leave requests one at a time (LV-01)', () => {
  it('take a lock per employee before reading the balance', async () => {
    // Two connections can't race in this single-connection database, so this keeps the lock from being dropped; the race
    // itself was checked on the local Postgres with two sessions.
    const { rows } = await ctx.t.db.query<{ def: string }>(`select pg_get_functiondef('public.apply_leave(uuid, uuid, date, date, boolean, boolean, text)'::regprocedure) as def`);
    const def = rows[0]!.def;
    expect(def).toContain('pg_advisory_xact_lock');
    expect(def.indexOf('pg_advisory_xact_lock')).toBeLessThan(def.indexOf('from public.leave_ledger'));
  });
});

describe('goals locked once the self review is in (PMS-02)', () => {
  it('the employee and the manager can’t change them; HR can; goals outside the cycle stay open', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const cycle = (await tx.query<{ id: string }>(`insert into review_cycles (organization_id, name, period_start, period_end) values ($1, 'Locking', '2026-04-01', '2027-03-31') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('select activate_review_cycle($1)', [cycle]);
      const review = (await tx.query<{ id: string }>('select id from reviews where cycle_id = $1 and employee_id = $2', [cycle, f.employees.icA])).rows[0]!.id;

      await as(tx, f.users.icA);
      const goal = (await tx.query<{ id: string }>(`insert into goals (organization_id, employee_id, cycle_id, title, weight) values ($1, $2, $3, 'Ship the thing', 100) returning id`, [f.orgA, f.employees.icA, cycle])).rows[0]!.id;
      const loose = (await tx.query<{ id: string }>(`insert into goals (organization_id, employee_id, title) values ($1, $2, 'Learn something') returning id`, [f.orgA, f.employees.icA])).rows[0]!.id;
      await tx.query('update goals set progress = 40 where id = $1', [goal]); // before the self review: open
      await tx.query(`select submit_self_review($1, 4::smallint, 'A good year with steady delivery.')`, [review]);

      const locked = 'These goals are locked: the self review for this cycle has been submitted. Ask HR if a goal must change.';
      expect(await failure(tx, 'update goals set progress = 90 where id = $1', [goal])).toMatchObject({ code: '22023', message: locked });
      expect((await failure(tx, 'delete from goals where id = $1', [goal])).message).toBe(locked);
      expect((await failure(tx, `insert into goals (organization_id, employee_id, cycle_id, title) values ($1, $2, $3, 'Late addition')`, [f.orgA, f.employees.icA, cycle])).message).toBe(locked);
      expect((await failure(tx, 'update goals set cycle_id = null where id = $1', [goal])).message).toBe(locked); // can't move it out either
      await tx.query('update goals set progress = 70 where id = $1', [loose]);

      await as(tx, f.users.managerA); // can maintain icA's goals (the line manager in these fixtures can't see them)
      expect((await failure(tx, 'update goals set weight = 80 where id = $1', [goal])).message).toBe(locked);

      await as(tx, f.users.hrA);
      await tx.query('update goals set progress = 55 where id = $1', [goal]);
      await tx.exec('reset role');
      expect((await tx.query<{ weight: number; progress: number }>('select weight, progress from goals where id = $1', [goal])).rows[0]).toEqual({ weight: 100, progress: 55 });
    });
  });
});

describe('course completion needs the lessons (LRN-01)', () => {
  it('a learner can’t mark a course with lessons complete early; finishing the lessons completes it; HR can record it', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const course = async (title: string) => (await tx.query<{ id: string }>(`insert into courses (organization_id, title, self_enroll, status) values ($1, $2, true, 'published') returning id`, [f.orgA, title])).rows[0]!.id;
      const withLessons = await course('Safety basics');
      const lesson = async (c: string, n: number) => (await tx.query<{ id: string }>(`insert into course_lessons (organization_id, course_id, position, title, body) values ($1, $2, $3, $4, 'Read this') returning id`, [f.orgA, c, n, `Part ${n}`])).rows[0]!.id;
      const l1 = await lesson(withLessons, 1);
      const l2 = await lesson(withLessons, 2);
      const noLessons = await course('Outside workshop');
      const forPeer = await course('Fire drill');
      await lesson(forPeer, 1);

      await as(tx, f.users.icA);
      const mine = (await tx.query<{ id: string }>('select enroll_in_course($1) as id', [withLessons])).rows[0]!.id;
      expect(await failure(tx, `select update_enrollment($1, 'completed')`, [mine])).toMatchObject({ code: '22023', message: 'Finish the lessons first: 0 of 2 done.' });
      await tx.query('select complete_lesson($1)', [l1]);
      expect((await failure(tx, `select update_enrollment($1, 'completed')`, [mine])).message).toBe('Finish the lessons first: 1 of 2 done.');
      await tx.query('select complete_lesson($1)', [l2]); // the last lesson finishes the course
      const plain = (await tx.query<{ id: string }>('select enroll_in_course($1) as id', [noLessons])).rows[0]!.id;
      await tx.query(`select update_enrollment($1, 'completed', 'Attended on site')`, [plain]); // nothing to check against

      await as(tx, f.users.peerA);
      const peers = (await tx.query<{ id: string }>('select enroll_in_course($1) as id', [forPeer])).rows[0]!.id;
      await as(tx, f.users.hrA);
      await tx.query(`select update_enrollment($1, 'completed', 'Did the drill in person')`, [peers]); // HR records it

      await tx.exec('reset role');
      const status = async (id: string) => (await tx.query<{ status: string }>('select status from course_enrollments where id = $1', [id])).rows[0]!.status;
      expect([await status(mine), await status(plain), await status(peers)]).toEqual(['completed', 'completed', 'completed']);
    });
  });
});

describe('suspended members (SEC-08)', () => {
  it('can’t log mileage, answer a held claim or ask for data deletion', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.peerA, async (tx) => {
      await tx.exec('reset role');
      const claim = (await tx.query<{ id: string }>(`insert into expense_claims (organization_id, employee_id, title, status, held_at, hold_note)
        values ($1, $2, 'Held trip', 'pending', now(), 'Which client?') returning id`, [f.orgA, f.employees.peerA])).rows[0]!.id;
      await tx.query(`update organization_members set status = 'suspended' where organization_id = $1 and user_id = $2`, [f.orgA, f.users.peerA]);
      await as(tx, f.users.peerA);
      expect((await failure(tx, `select log_mileage($1, current_date - 1, 12, 'Office', 'Client')`, [f.orgA])).code).toBe('42501');
      expect((await failure(tx, `select reply_expense_claim($1, 'The Example Ltd visit')`, [claim])).code).toBe('42501');
      expect((await failure(tx, `select request_data_deletion($1, '{contact}')`, [f.orgA])).code).toBe('42501');
    });
  });
});

describe('reporting lines (EMP-03)', () => {
  it('refuse a loop, however long', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const managerOf = async (id: string) => (await tx.query<{ m: string | null }>('select manager_employee_id as m from employees where id = $1', [id])).rows[0]!.m;
      // icA reports to leadA; making leadA report to icA would close the circle.
      expect(await managerOf(f.employees.icA)).toBe(f.employees.leadA);
      const loop = await failure(tx, 'update employees set manager_employee_id = $2 where id = $1', [f.employees.leadA, f.employees.icA]);
      expect(loop.code).toBe('22023');
      expect(loop.message).toMatch(/^That would make a reporting loop: .+ already reports, directly or through others, to this person\.$/);
      // Further up the line too: whoever leadA reports to can't report to icA.
      const top = await managerOf(f.employees.leadA);
      if (top) expect((await failure(tx, 'update employees set manager_employee_id = $2 where id = $1', [top, f.employees.icA])).code).toBe('22023');
      // An ordinary change still works.
      await tx.query('update employees set manager_employee_id = $2 where id = $1', [f.employees.peerA, f.employees.leadA]);
    });
  });

  it('a loan from someone with no manager who can act goes to payroll instead of waiting for nobody', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query('update employees set manager_employee_id = null where id = $1', [f.employees.icA]);
      const request = (await tx.query<{ id: string }>(`select app.request_approval($1, 'loan', gen_random_uuid(), $2, 'Loan for a test', '/loans') as id`, [f.orgA, f.employees.icA])).rows[0]!.id;
      const approvers = (await tx.query<{ u: string }>('select app.current_approvers($1) as u', [request])).rows.map((r) => r.u);
      expect(approvers).toContain(f.users.payrollA);
    });
  });
});

describe('file paths stay in the organization (SEC-10)', () => {
  it('refuses a letter header, signature, ID-card logo or filing proof pointing at another organization', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const other = `${f.orgB}/00000000-0000-4000-8000-000000000001`;
      const mine = `${f.orgA}/00000000-0000-4000-8000-000000000002`;
      await tx.query(`insert into letter_settings (organization_id, header_path) values ($1, $2) on conflict (organization_id) do update set header_path = excluded.header_path`, [f.orgA, mine]);
      expect((await failure(tx, 'update letter_settings set header_path = $2 where organization_id = $1', [f.orgA, other])).code).toBe('23514');
      expect((await failure(tx, 'update letter_settings set footer_path = $2 where organization_id = $1', [f.orgA, other])).code).toBe('23514');
      const sig = await failure(tx, `insert into letter_signatories (organization_id, name, designation, signature_path) values ($1, 'A. Signer', 'Director', $2)`, [f.orgA, other]);
      expect(sig.code).toBe('23514');
      await tx.query(`insert into letter_signatories (organization_id, name, designation, signature_path) values ($1, 'A. Signer', 'Director', $2)`, [f.orgA, mine]);
    });
  });
});
