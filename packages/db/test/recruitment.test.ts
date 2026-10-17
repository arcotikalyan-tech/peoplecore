import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

/** Runs a statement expected to fail inside a savepoint, so the surrounding transaction stays usable. */
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

const requisition = async (tx: Transaction, org: string, hiringManager: string | null, openings = 1) =>
  (await tx.query<{ id: string }>(
    `select create_requisition($1, 'Backend Engineer', $2::smallint, 'permanent', p_hiring_manager => $3) as id`,
    [org, openings, hiringManager])).rows[0]!.id;

const apply = async (tx: Transaction, req: string, email: string | null, phone: string | null = null, consent = true) =>
  (await tx.query<{ r: { application_id: string; candidate_id: string; existing_candidate: boolean } }>(
    `select add_application($1, 'Kavya', 'Demo', $2, $3, 'referral', null, $4) as r`, [req, email, phone, consent])).rows[0]!.r;

/** Creates committed recruitment data as the recruiter (outside asUser, which rolls back). */
async function seed(hiringManager: string | null) {
  const { f, t } = ctx;
  await t.db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: f.users.recruiterA, role: 'authenticated', aal: 'aal2' })]);
  await t.db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [f.users.recruiterA]);
  const req = (await t.db.query<{ id: string }>(`select create_requisition($1, 'Analyst', p_hiring_manager => $2) as id`, [f.orgA, hiringManager])).rows[0]!.id;
  const app = (await t.db.query<{ r: { application_id: string } }>(
    `select add_application($1, 'Seed', 'Candidate', $2, null, 'direct', null, true) as r`, [req, `seed.${req.slice(0, 8)}@example.test`])).rows[0]!.r;
  await t.db.query(`select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)`);
  return { req, app: app.application_id };
}

describe('requisitions', () => {
  it('recruiters and HR create them with sequential codes; managers and employees cannot', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const id = await requisition(tx, f.orgA, f.employees.leadA);
      const { rows } = await tx.query<{ code: string; status: string }>('select code, status from job_requisitions where id = $1', [id]);
      expect(rows[0]!.code).toMatch(/^REQ\d{5}$/);
      expect(rows[0]!.status).toBe('open');
    });
    for (const user of [f.users.managerA, f.users.icA, f.users.payrollA, f.users.ownerB]) {
      expect(await pgError(ctx.t.asUser(user, (tx) => requisition(tx, f.orgA, null)))).toBe('42501');
    }
  });

  it('managers see requisitions for themselves and their line, with the candidates; nobody else outside recruiting does', async () => {
    const { f } = ctx;
    const inLine = await seed(f.employees.leadA);   // leadA reports to managerA
    const outside = await seed(f.employees.peerA);  // peerA reports to nobody
    const sees = (user: string, id: string) => ctx.t.asUser(user, async (tx) => ({
      req: (await tx.query('select 1 from job_requisitions where id = $1', [id])).rows.length === 1,
      apps: (await tx.query('select 1 from applications where requisition_id = $1', [id])).rows.length,
      candidates: (await tx.query('select 1 from candidates c join applications a on a.candidate_id = c.id where a.requisition_id = $1', [id])).rows.length,
    }));
    expect(await sees(f.users.managerA, inLine.req)).toEqual({ req: true, apps: 1, candidates: 1 });
    expect(await sees(f.users.managerA, outside.req)).toEqual({ req: false, apps: 0, candidates: 0 });
    for (const user of [f.users.recruiterA, f.users.hrA, f.users.auditorA]) {
      expect(await sees(user, outside.req)).toEqual({ req: true, apps: 1, candidates: 1 });
    }
    for (const user of [f.users.leadA, f.users.icA, f.users.payrollA, f.users.ownerB]) {
      expect(await sees(user, inLine.req)).toEqual({ req: false, apps: 0, candidates: 0 });
    }
  });
});

describe('candidates and applications', () => {
  it('reuses a candidate with the same email (any case) or phone, and records consent for new ones', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const a = await requisition(tx, f.orgA, null);
      const b = await requisition(tx, f.orgA, null);
      const first = await apply(tx, a, 'kavya@example.test', '+91 98450 11111');
      expect(first.existing_candidate).toBe(false);
      expect((await apply(tx, b, 'KAVYA@example.test')).candidate_id).toBe(first.candidate_id);
      const c = await requisition(tx, f.orgA, null);
      const byPhone = await apply(tx, c, null, '+919845011111');
      expect(byPhone).toMatchObject({ candidate_id: first.candidate_id, existing_candidate: true });
      const { rows } = await tx.query<{ consent: boolean }>('select consent_at is not null as consent from candidates where id = $1', [first.candidate_id]);
      expect(rows[0]!.consent).toBe(true);
    });
  });

  it('refuses missing consent, conflicting identities, repeat applications and closed requisitions', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      await apply(tx, req, 'one@example.test');
      const other = await requisition(tx, f.orgA, null);
      await apply(tx, other, null, '+919845022222');
      const msg = async (sql: string, params: unknown[]) => (await failure(tx, sql, params)).message;
      const add = `select add_application($1, 'X', null, $2, $3, 'direct', null, $4)`;
      expect(await msg(add, [req, 'new@example.test', null, false])).toBe('Record the candidate’s consent to process their details.');
      expect(await msg(add, [req, 'one@example.test', '+919845022222', true])).toBe('This email and this phone number belong to two different candidates.');
      expect(await msg(add, [req, 'one@example.test', null, true])).toBe('This candidate has already applied for this requisition.');
      await tx.query(`update job_requisitions set status = 'closed' where id = $1`, [req]);
      expect(await msg(add, [req, 'late@example.test', null, true])).toBe('This requisition isn’t open for applications.');
    });
  });

  it('stages change only through move_application, never straight to hired', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { application_id: app } = await apply(tx, req, 'stage@example.test');
      expect((await failure(tx, `update applications set stage = 'offer' where id = $1`, [app])).message)
        .toBe('Change the stage with move_application or hire_application.');
      await tx.query(`select move_application($1, 'interview')`, [app]);
      expect((await failure(tx, `select move_application($1, 'hired')`, [app])).message).toBe('Use Hire to hire a candidate.');
      const { rows } = await tx.query<{ stage: string }>('select stage from applications where id = $1', [app]);
      expect(rows[0]!.stage).toBe('interview');

      // Notes can be edited directly; the application can't be re-pointed at another requisition or candidate.
      await tx.query(`update applications set outcome_note = 'Strong systems design' where id = $1`, [app]);
      const other = await requisition(tx, f.orgA, null);
      expect((await failure(tx, 'update applications set requisition_id = $1 where id = $2', [other, app])).message)
        .toBe('An application can’t be moved to another requisition or candidate.');
      const { candidate_id: someoneElse } = await apply(tx, other, 'other@example.test');
      expect((await failure(tx, 'update applications set candidate_id = $1 where id = $2', [someoneElse, app])).message)
        .toBe('An application can’t be moved to another requisition or candidate.');
    });
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) => tx.query(`select move_application($1, 'screening')`, [ctx.f.employees.icA])))).toBe('42501');
  });
});

describe('hire_application', () => {
  it('HR hires from an offer: one employee, placed from the requisition, pre-joining for a future date', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = (await tx.query<{ id: string }>(
        `select create_requisition($1, 'Designer', 2::smallint, 'contract', p_department_id => $2, p_hiring_manager => $3) as id`,
        [f.orgA, f.deptA, f.employees.managerA])).rows[0]!.id;
      const { application_id: app } = await apply(tx, req, 'hire@example.test');
      expect((await failure(tx, `select hire_application($1, current_date + 30)`, [app])).message).toBe('Move the candidate to Offer before hiring.');
      await tx.query(`select move_application($1, 'offer')`, [app]);
      const emp = (await tx.query<{ id: string }>(`select hire_application($1, current_date + 30, 'kavya.d@example.test') as id`, [app])).rows[0]!.id;

      const { rows } = await tx.query<{ first_name: string; status: string; employment_type: string; dept: string; mgr: string; email: string }>(
        `select first_name, status, employment_type, department_id as dept, manager_employee_id as mgr, work_email as email from employees where id = $1`, [emp]);
      expect(rows[0]).toEqual({ first_name: 'Kavya', status: 'pre_joining', employment_type: 'contract', dept: f.deptA, mgr: f.employees.managerA, email: 'kavya.d@example.test' });
      const a = await tx.query<{ stage: string; converted: string }>('select stage, converted_employee_id as converted from applications where id = $1', [app]);
      expect(a.rows[0]).toEqual({ stage: 'hired', converted: emp });

      expect((await failure(tx, `select hire_application($1, current_date + 30)`, [app])).message).toBe('This candidate has already been hired.');
      expect((await failure(tx, `select move_application($1, 'rejected')`, [app])).message).toBe('This candidate has already been hired.');
      // One of two openings filled: still open.
      const r = await tx.query<{ status: string }>('select status from job_requisitions where id = $1', [req]);
      expect(r.rows[0]!.status).toBe('open');
    });
  });

  it('closes the requisition once every opening is filled', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = await requisition(tx, f.orgA, null, 1);
      const { application_id: app } = await apply(tx, req, 'fill@example.test');
      await tx.query(`select move_application($1, 'offer')`, [app]);
      await tx.query(`select hire_application($1, current_date)`, [app]);
      const r = await tx.query<{ status: string }>('select status from job_requisitions where id = $1', [req]);
      expect(r.rows[0]!.status).toBe('closed');
    });
  });

  it('recruiters cannot hire (no employee.create)', async () => {
    const { f } = ctx;
    const code = await pgError(ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { application_id: app } = await apply(tx, req, 'rec@example.test');
      await tx.query(`select move_application($1, 'offer')`, [app]);
      await tx.query(`select hire_application($1, current_date)`, [app]);
    }));
    expect(code).toBe('42501');
  });
});

describe('erase_candidate', () => {
  it('deletes a candidate who was never hired, leaving no personal values in the audit trail', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { candidate_id: cand, application_id: app } = await apply(tx, req, 'erase.me@example.test', '+919845033333');
      await tx.query('select erase_candidate($1)', [cand]);
      expect((await tx.query('select 1 from candidates where id = $1', [cand])).rows).toHaveLength(0);
      expect((await tx.query('select 1 from applications where id = $1', [app])).rows).toHaveLength(0);
      await tx.exec('reset role');
      const { rows } = await tx.query<{ changes: unknown }>(`select changes from audit_events where entity_id = $1`, [cand]);
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toMatch(/erase\.me|Kavya|9845033333/);
    });
  });

  it('refuses hired candidates, and anyone without recruitment.manage', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { candidate_id: cand, application_id: app } = await apply(tx, req, 'kept@example.test');
      await tx.query(`select move_application($1, 'offer')`, [app]);
      await tx.query(`select hire_application($1, current_date)`, [app]);
      expect((await failure(tx, 'select erase_candidate($1)', [cand])).message).toBe('This candidate was hired; their records are kept as an employee’s.');
    });
    const { app } = await seed(null);
    const cand = (await ctx.t.db.query<{ c: string }>('select candidate_id as c from applications where id = $1', [app])).rows[0]!.c;
    for (const user of [f.users.managerA, f.users.auditorA, f.users.ownerB]) {
      expect(await pgError(ctx.t.asUser(user, (tx) => tx.query('select erase_candidate($1)', [cand])))).toBe('42501');
    }
  });
});
