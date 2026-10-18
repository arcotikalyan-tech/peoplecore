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

/** Switch the transaction's identity, as PostgREST does per request. */
async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

/** Prepares an offer as `preparer`, has the owner approve it, then sends it and records acceptance. */
async function acceptOffer(tx: Transaction, app: string, preparer: string, joinInDays = 30) {
  await as(tx, preparer);
  const offer = (await tx.query<{ id: string }>(
    `select save_offer_version($1, 1200000, current_date + $2::int, current_date + 10) as id`, [app, joinInDays])).rows[0]!.id;
  await tx.query('select submit_offer($1)', [offer]);
  const approval = (await tx.query<{ a: string }>('select approval_request_id as a from offers where id = $1', [offer])).rows[0]!.a;
  await as(tx, ctx.f.users.ownerA);
  await tx.query(`select decide_approval($1, 'approve')`, [approval]);
  await as(tx, preparer);
  await tx.query(`select set_offer_status($1, 'sent')`, [offer]);
  await tx.query(`select set_offer_status($1, 'accepted')`, [offer]);
  return offer;
}

describe('offers', () => {
  it('need approval by someone else; revisions are new versions; hiring needs acceptance', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { application_id: app } = await apply(tx, req, 'offer@example.test');
      const offer = (await tx.query<{ id: string }>(`select save_offer_version($1, 1000000, current_date + 20, current_date + 7) as id`, [app])).rows[0]!.id;
      expect((await tx.query<{ stage: string }>('select stage from applications where id = $1', [app])).rows[0]!.stage).toBe('offer');
      expect((await failure(tx, `select hire_application($1, null)`, [app])).message).toBe('Record the candidate’s acceptance of an offer before hiring.');
      expect((await failure(tx, `select set_offer_status($1, 'sent')`, [offer])).message).toBe('Only an approved offer can be sent.');

      await tx.query('select submit_offer($1)', [offer]);
      const approval = (await tx.query<{ a: string }>('select approval_request_id as a from offers where id = $1', [offer])).rows[0]!.a;
      expect((await failure(tx, `select decide_approval($1, 'approve')`, [approval])).code).toBe('42501'); // the preparer
      expect((await failure(tx, `select save_offer_version($1, 1100000, current_date + 20, current_date + 7)`, [app])).message)
        .toBe('An offer that is pending approval can’t be changed. Withdraw it from approval first.');

      await as(tx, f.users.ownerA);
      await tx.query(`select decide_approval($1, 'approve')`, [approval]);
      await as(tx, f.users.hrA);
      expect((await tx.query<{ status: string }>('select status from offers where id = $1', [offer])).rows[0]!.status).toBe('approved');

      // Revising an approved offer makes a new version that needs approval again.
      await tx.query(`select save_offer_version($1, 1150000, current_date + 20, current_date + 7)`, [app]);
      const o = (await tx.query<{ status: string; current_version: number }>('select status, current_version from offers where id = $1', [offer])).rows[0]!;
      expect(o).toEqual({ status: 'draft', current_version: 2 });
      expect((await tx.query('select 1 from offer_versions where offer_id = $1', [offer])).rows).toHaveLength(2);

      await tx.exec('reset role');
      const audit = await tx.query<{ changes: { annual_ctc: string } }>(`select changes from audit_events where entity_type = 'offer_versions' and action = 'insert' limit 1`);
      expect(audit.rows[0]!.changes.annual_ctc).toBe('[redacted]');
    });
  });

  it('an expired offer can’t be accepted', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { application_id: app } = await apply(tx, req, 'late@example.test');
      const offer = (await tx.query<{ id: string }>(`select save_offer_version($1, 900000, current_date + 20, current_date + 7) as id`, [app])).rows[0]!.id;
      await tx.query('select submit_offer($1)', [offer]);
      const approval = (await tx.query<{ a: string }>('select approval_request_id as a from offers where id = $1', [offer])).rows[0]!.a;
      await as(tx, f.users.ownerA);
      await tx.query(`select decide_approval($1, 'approve')`, [approval]);
      await as(tx, f.users.hrA);
      await tx.query(`select set_offer_status($1, 'sent')`, [offer]);
      await tx.exec('reset role');
      await tx.query(`alter table offer_versions drop constraint offer_versions_check`);
      await tx.query(`update offer_versions set expires_on = current_date - 3 where offer_id = $1`, [offer]);
      await as(tx, f.users.hrA);
      expect((await failure(tx, `select set_offer_status($1, 'accepted')`, [offer])).message).toMatch(/^This offer expired on /);
    });
  });
});

describe('hire_application', () => {
  it('HR hires from an accepted offer: one employee, joining date and placement from the offer and requisition', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = (await tx.query<{ id: string }>(
        `select create_requisition($1, 'Designer', 2::smallint, 'contract', p_department_id => $2, p_hiring_manager => $3) as id`,
        [f.orgA, f.deptA, f.employees.managerA])).rows[0]!.id;
      const { application_id: app } = await apply(tx, req, 'hire@example.test');
      await acceptOffer(tx, app, f.users.hrA, 30);
      const emp = (await tx.query<{ id: string }>(`select hire_application($1, null, 'kavya.d@example.test') as id`, [app])).rows[0]!.id;

      const { rows } = await tx.query<{ first_name: string; status: string; employment_type: string; dept: string; mgr: string; email: string; joins: string }>(
        `select first_name, status, employment_type, department_id as dept, manager_employee_id as mgr, work_email as email,
                (date_of_joining - current_date)::text as joins from employees where id = $1`, [emp]);
      expect(rows[0]).toEqual({ first_name: 'Kavya', status: 'pre_joining', employment_type: 'contract', dept: f.deptA, mgr: f.employees.managerA, email: 'kavya.d@example.test', joins: '30' });
      const a = await tx.query<{ stage: string; converted: string }>('select stage, converted_employee_id as converted from applications where id = $1', [app]);
      expect(a.rows[0]).toEqual({ stage: 'hired', converted: emp });

      expect((await failure(tx, `select hire_application($1, null)`, [app])).message).toBe('This candidate has already been hired.');
      expect((await failure(tx, `select move_application($1, 'rejected')`, [app])).message).toBe('This candidate has already been hired.');
      const r = await tx.query<{ status: string }>('select status from job_requisitions where id = $1', [req]);
      expect(r.rows[0]!.status).toBe('open'); // one of two openings filled
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from app.domain_events where event_type = 'employee.hired' and subject_id = $1`, [emp])).rows).toHaveLength(1);
    });
  });

  it('closes the requisition once every opening is filled', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = await requisition(tx, f.orgA, null, 1);
      const { application_id: app } = await apply(tx, req, 'fill@example.test');
      await acceptOffer(tx, app, f.users.hrA, 2);
      await tx.query(`select hire_application($1, null)`, [app]);
      const r = await tx.query<{ status: string }>('select status from job_requisitions where id = $1', [req]);
      expect(r.rows[0]!.status).toBe('closed');
    });
  });

  it('recruiters cannot hire (no employee.create)', async () => {
    const { f } = ctx;
    const code = await pgError(ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { application_id: app } = await apply(tx, req, 'rec@example.test');
      await acceptOffer(tx, app, f.users.recruiterA);
      await tx.query(`select hire_application($1, null)`, [app]);
    }));
    expect(code).toBe('42501');
  });
});

describe('interviews and scorecards', () => {
  it('panelists get a task, see only what they need, and see others’ scorecards only after submitting their own', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { application_id: app, candidate_id: cand } = await apply(tx, req, 'panel@example.test', '+919845044444');
      const interview = (await tx.query<{ id: string }>(
        `select schedule_interview($1, 'Technical', now() - interval '2 hours', 60::smallint, 'video', 'https://meet.example.test/x', $2) as id`,
        [app, [f.employees.leadA, f.employees.peerA]])).rows[0]!.id;

      await as(tx, f.users.peerA);
      const mine = await tx.query<{ candidate_name: string; scorecard_submitted: boolean }>('select candidate_name, scorecard_submitted from my_interviews($1)', [f.orgA]);
      expect(mine.rows).toEqual([{ candidate_name: 'Kavya Demo', scorecard_submitted: false }]);
      expect((await tx.query('select 1 from candidates where id = $1', [cand])).rows).toHaveLength(0); // no contact details
      expect((await tx.query(`select 1 from tasks where subject_id = $1 and status = 'open'`, [interview])).rows).toHaveLength(1);
      const ratings = JSON.stringify([{ criterion: 'Problem solving', rating: 4 }, { criterion: 'Communication', rating: 3 }]);
      await tx.query(`select submit_scorecard($1, 'yes', 'Solid fundamentals', $2)`, [interview, ratings]);
      expect((await failure(tx, `select submit_scorecard($1, 'no', 'Changed my mind', $2)`, [interview, ratings])).message)
        .toBe('You have already submitted a scorecard for this interview.');

      await as(tx, f.users.leadA);
      expect((await tx.query('select 1 from scorecards where interview_id = $1', [interview])).rows).toHaveLength(0); // hasn't submitted yet
      await tx.query(`select submit_scorecard($1, 'strong_yes', 'Excellent', $2)`, [interview, ratings]);
      expect((await tx.query('select 1 from scorecards where interview_id = $1', [interview])).rows).toHaveLength(2);
      expect((await tx.query<{ status: string }>('select status from interviews where id = $1', [interview])).rows[0]!.status).toBe('completed');

      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from scorecard_ratings r join scorecards s on s.id = r.scorecard_id where s.interview_id = $1', [interview])).rows).toHaveLength(4);
      await as(tx, f.users.icA);
      expect((await failure(tx, `select submit_scorecard($1, 'yes', 'Not on the panel', $2)`, [interview, ratings])).code).toBe('42501');
    });
  });

  it('scorecards wait until the interview has happened', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = await requisition(tx, f.orgA, null);
      const { application_id: app } = await apply(tx, req, 'future@example.test');
      const interview = (await tx.query<{ id: string }>(
        `select schedule_interview($1, 'HR round', now() + interval '1 day', 30::smallint, 'phone', null, $2) as id`, [app, [f.employees.peerA]])).rows[0]!.id;
      await as(tx, f.users.peerA);
      expect((await failure(tx, `select submit_scorecard($1, 'yes', 'Too early', '[{"criterion":"Fit","rating":3}]')`, [interview])).message)
        .toBe('Submit the scorecard after the interview.');
    });
  });
});

describe('careers page (anonymous)', () => {
  it('lists only published open requisitions and accepts applications with consent, revealing nothing', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      const published = (await t.db.query<{ id: string }>(
        `insert into job_requisitions (organization_id, code, title, is_published) values ($1, 'REQ-PUB', 'Public role', true) returning id`, [f.orgA])).rows[0]!.id;
      await t.db.query(`insert into job_requisitions (organization_id, code, title) values ($1, 'REQ-HID', 'Internal role')`, [f.orgA]);
      await t.db.query(`insert into candidates (organization_id, first_name, email, phone, consent_at) values ($1, 'Existing', 'existing@example.test', '+919845055555', now())`, [f.orgA]);
      await t.db.exec(`set local role anon`);
      await t.db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.sub', '', true)`);

      const jobs = await t.db.query<{ title: string }>(`select title from public_job_postings('demo-a')`);
      expect(jobs.rows.map((r) => r.title)).toEqual(['Public role']);
      const applyAs = (email: string, phone: string | null, consent = true) =>
        t.db.query<{ r: string }>(`select submit_public_application('demo-a', $1, 'Asha', 'Applicant', $2, $3, $4) as r`, [published, email, phone, consent]);
      expect((await applyAs('asha.applicant@example.test', null)).rows[0]!.r).toBe('received');
      expect((await applyAs('asha.applicant@example.test', null)).rows[0]!.r).toBe('received'); // again: same answer
      expect((await applyAs('stranger@example.test', '+919845055555')).rows[0]!.r).toBe('received'); // someone else's phone
      await t.db.exec('savepoint s1');
      await expect(applyAs('x@example.test', null, false)).rejects.toThrow('Please agree to the processing of your details to apply.');
      await t.db.exec('rollback to savepoint s1');
      await expect(t.db.query('select 1 from candidates')).rejects.toThrow(/permission denied/);
      await t.db.exec('rollback to savepoint s1');

      await t.db.exec('reset role');
      const { rows } = await t.db.query<{ email: string; phone: string | null; source: string; apps: number }>(
        `select c.email, c.phone, c.source, (select count(*)::int from applications a where a.candidate_id = c.id) as apps
           from candidates c where c.organization_id = $1 and c.email in ('asha.applicant@example.test', 'stranger@example.test') order by c.email`, [f.orgA]);
      expect(rows).toEqual([
        { email: 'asha.applicant@example.test', phone: null, source: 'careers_site', apps: 1 },
        { email: 'stranger@example.test', phone: null, source: 'careers_site', apps: 1 },
      ]);
    } finally {
      await t.db.exec('rollback');
    }
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
      await acceptOffer(tx, app, f.users.hrA, 2);
      await tx.query(`select hire_application($1, null)`, [app]);
      expect((await failure(tx, 'select erase_candidate($1)', [cand])).message).toBe('This candidate was hired; their records are kept as an employee’s.');
    });
    const { app } = await seed(null);
    const cand = (await ctx.t.db.query<{ c: string }>('select candidate_id as c from applications where id = $1', [app])).rows[0]!.c;
    for (const user of [f.users.managerA, f.users.auditorA, f.users.ownerB]) {
      expect(await pgError(ctx.t.asUser(user, (tx) => tx.query('select erase_candidate($1)', [cand])))).toBe('42501');
    }
  });
});
