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

/** A candidate with one application, created as `user`; returns ids. */
async function candidate(tx: Transaction, user: string, org: string, email: string) {
  await as(tx, user);
  const req = (await tx.query<{ id: string }>(`select create_requisition($1, 'Retention Analyst') as id`, [org])).rows[0]!.id;
  const r = (await tx.query<{ r: { application_id: string; candidate_id: string } }>(
    `select add_application($1, 'Ret', 'Candidate', $2, null, 'direct', null, true) as r`, [req, email])).rows[0]!.r;
  return { req, app: r.application_id, cand: r.candidate_id };
}

/** Moves the candidate's last activity `days` into the past and sets their application's stage (as the superuser). */
async function age(tx: Transaction, cand: string, days: number, stage: string, hiredAs?: string) {
  await tx.exec('reset role');
  await tx.query(`update candidates set consent_at = now() - make_interval(days => $2) where id = $1`, [cand, days]);
  await tx.query(`select set_config('app.stage_change', 'on', true)`);
  await tx.query(
    `update applications set stage = $2::application_stage, converted_employee_id = $3,
            created_at = now() - make_interval(days => $4), stage_changed_at = now() - make_interval(days => $4)
      where candidate_id = $1`, [cand, stage, hiredAs ?? null, days]);
  await tx.query(`select set_config('app.stage_change', 'off', true)`);
}

async function runWorker(tx: Transaction) {
  await tx.exec('set local role service_role');
  const r = (await tx.query<{ r: { erased: number } }>('select worker_candidate_retention() as r')).rows[0]!.r;
  await tx.exec('reset role');
  return r;
}

const exists = async (tx: Transaction, cand: string) => (await tx.query('select 1 from candidates where id = $1', [cand])).rows.length === 1;

describe('candidate consent expiry', () => {
  it('every organization starts with 365 days', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      expect((await tx.query('select candidate_retention_days as d from recruitment_settings')).rows).toEqual([{ d: 365 }]);
    });
  });

  it('erases expired candidates through erase_candidate’s path, keeps open and hired ones, and leaves other tenants alone', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const expired = await candidate(tx, f.users.recruiterA, f.orgA, 'expired@example.test');
      const recent = await candidate(tx, f.users.recruiterA, f.orgA, 'recent@example.test');
      const open = await candidate(tx, f.users.recruiterA, f.orgA, 'open@example.test');
      const hired = await candidate(tx, f.users.recruiterA, f.orgA, 'hired@example.test');
      const other = await candidate(tx, f.users.ownerB, f.orgB, 'other.tenant@example.test');
      await age(tx, expired.cand, 400, 'rejected');
      await age(tx, recent.cand, 300, 'withdrawn');
      await age(tx, open.cand, 400, 'interview');
      await age(tx, hired.cand, 400, 'hired', f.employees.peerA);
      await age(tx, other.cand, 300, 'rejected');
      // Org B keeps candidates for 200 days only, so its candidate is expired there; org A's 365 days still apply to A.
      await as(tx, f.users.ownerB);
      await tx.query('select save_candidate_retention($1, 200)', [f.orgB]);
      await tx.exec('reset role');

      expect(await runWorker(tx)).toEqual({ erased: 2 });
      expect(await exists(tx, expired.cand)).toBe(false);
      expect((await tx.query('select 1 from applications where id = $1', [expired.app])).rows).toHaveLength(0);
      expect(await exists(tx, other.cand)).toBe(false);
      expect(await exists(tx, recent.cand)).toBe(true);
      expect(await exists(tx, open.cand)).toBe(true);
      expect(await exists(tx, hired.cand)).toBe(true);
      expect(await runWorker(tx)).toEqual({ erased: 0 });

      const audit = (await tx.query<{ organization_id: string; actor_user_id: string | null; metadata: { reason: string; retention_days: number } }>(
        `select organization_id, actor_user_id, metadata from audit_events where action = 'erase' and entity_type = 'candidates' and entity_id = $1`,
        [expired.cand])).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ organization_id: f.orgA, actor_user_id: null, metadata: { reason: 'consent_expired', retention_days: 365 } });
      expect(JSON.stringify((await tx.query('select changes from audit_events where entity_id = $1', [expired.cand])).rows)).not.toMatch(/expired@example/);
    });
  });

  it('respects a shorter or longer setting, and a new application restarts the clock', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const a = await candidate(tx, f.users.hrA, f.orgA, 'shorter@example.test');
      const b = await candidate(tx, f.users.hrA, f.orgA, 'reapplied@example.test');
      await age(tx, a.cand, 100, 'rejected');
      await age(tx, b.cand, 100, 'rejected');
      await as(tx, f.users.hrA);
      // Reapplying adds an application today; once it is closed, the clock starts from then.
      const req2 = (await tx.query<{ id: string }>(`select create_requisition($1, 'Second Role') as id`, [f.orgA])).rows[0]!.id;
      const again = (await tx.query<{ r: { application_id: string } }>(
        `select add_application($1, 'Ret', 'Candidate', 'reapplied@example.test', null, 'direct', null, false) as r`, [req2])).rows[0]!.r;
      await tx.query(`select move_application($1, 'rejected')`, [again.application_id]);

      await tx.exec('reset role');
      expect(await runWorker(tx)).toEqual({ erased: 0 }); // 365 days
      await as(tx, f.users.hrA);
      await tx.query('select save_candidate_retention($1, 90)', [f.orgA]);
      const due = (await tx.query<{ candidate_id: string; name: string }>('select candidate_id, name from candidates_due_for_erasure($1)', [f.orgA])).rows;
      expect(due).toEqual([{ candidate_id: a.cand, name: 'Ret Candidate' }]);
      expect((await tx.query<{ d: number }>('select candidate_retention_days as d from recruitment_settings where organization_id = $1', [f.orgA])).rows[0]!.d).toBe(90);
      await tx.exec('reset role');
      expect(await runWorker(tx)).toEqual({ erased: 1 });
      expect(await exists(tx, a.cand)).toBe(false);
      expect(await exists(tx, b.cand)).toBe(true);
      // The change itself is audited.
      expect((await tx.query(`select 1 from audit_events where entity_type = 'recruitment_settings' and action = 'update'`)).rows.length).toBeGreaterThan(0);
    });
  });

  it('lists candidates due in the next 30 days, not later ones', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      const soon = await candidate(tx, f.users.recruiterA, f.orgA, 'soon@example.test');
      const later = await candidate(tx, f.users.recruiterA, f.orgA, 'later@example.test');
      await age(tx, soon.cand, 350, 'rejected');
      await age(tx, later.cand, 300, 'rejected');
      await as(tx, f.users.recruiterA);
      const due = (await tx.query<{ candidate_id: string; days: number }>(
        `select candidate_id, round(extract(epoch from erase_after - now()) / 86400)::int as days from candidates_due_for_erasure($1)`, [f.orgA])).rows;
      expect(due).toEqual([{ candidate_id: soon.cand, days: 15 }]);
    });
  });

  it('only recruitment.manage changes the setting or sees the list; nobody else, nor other tenants', async () => {
    const { f } = ctx;
    for (const user of [f.users.managerA, f.users.icA, f.users.payrollA, f.users.auditorA, f.users.ownerB]) {
      expect(await pgError(ctx.t.asUser(user, (tx) => tx.query('select save_candidate_retention($1, 60)', [f.orgA])))).toBe('42501');
      expect(await pgError(ctx.t.asUser(user, (tx) => tx.query('select * from candidates_due_for_erasure($1)', [f.orgA])))).toBe('42501');
      expect(await pgError(ctx.t.asUser(user, (tx) => tx.query('update recruitment_settings set candidate_retention_days = 60')))).toBe('42501');
    }
    for (const user of [f.users.icA, f.users.ownerB]) {
      await ctx.t.asUser(user, async (tx) => {
        expect((await tx.query('select 1 from recruitment_settings where organization_id = $1', [f.orgA])).rows).toHaveLength(0);
      });
    }
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      expect(await pgError(tx.query('select save_candidate_retention($1, 10)', [f.orgA]))).toBe('22023');
    });
    for (const fn of ['worker_candidate_retention()', 'app.erase_candidate_record(gen_random_uuid(), null)', 'app.candidate_erasure_schedule(null)']) {
      expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) => tx.query(`select ${fn}`)))).toBe('42501');
    }
  });
});
