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

describe('hiring OS', () => {
  it('recruiters keep plans, pools, templates and spend; employees and other tenants see none of it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      // Templates are seeded for every organization.
      expect((await tx.query('select 1 from recruiting_email_templates where organization_id = $1', [f.orgA])).rows.length).toBeGreaterThanOrEqual(5);

      const plan = (await tx.query<{ id: string }>(`insert into hiring_plans (organization_id, name, period_kind, period_start)
        values ($1, 'FY27 Q1', 'quarter', '2026-04-01') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into hiring_plan_lines (organization_id, plan_id, department_id, headcount) values ($1, $2, $3, 4)`, [f.orgA, plan, f.deptA]);
      const pool = (await tx.query<{ id: string }>(`insert into talent_pools (organization_id, name) values ($1, 'Silver medallists') returning id`, [f.orgA])).rows[0]!.id;
      const req = (await tx.query<{ id: string }>(`select create_requisition($1, 'Analyst') as id`, [f.orgA])).rows[0]!.id;
      const cand = (await tx.query<{ r: { candidate_id: string } }>(`select add_application($1, 'Ira', 'Demo', 'ira@example.test', null, 'referral', null, true) as r`, [req])).rows[0]!.r.candidate_id;
      await tx.query(`insert into talent_pool_members (organization_id, pool_id, candidate_id) values ($1, $2, $3)`, [f.orgA, pool, cand]);
      await tx.query(`insert into recruiting_spend (organization_id, source, month, amount) values ($1, 'referral', '2026-10-01', 25000)`, [f.orgA]);
      expect((await failure(tx, `insert into hiring_plans (organization_id, name, period_kind, period_start) values ($1, 'Bad', 'month', '2026-04-15')`, [f.orgA])).code).toBe('23514');

      // The activity log shows recruitment events without candidates' contact details.
      const activity = (await tx.query<{ entity_type: string; subject: string; changes: Record<string, unknown> | null }>('select * from recruiting_activity($1)', [f.orgA])).rows;
      expect(activity.some((a) => a.entity_type === 'applications' && a.subject.includes('Ira'))).toBe(true);
      expect(activity.every((a) => !a.changes || !('email' in a.changes))).toBe(true);

      const team = (await tx.query<{ access: string }>('select * from recruiting_team($1)', [f.orgA])).rows;
      expect(team.length).toBeGreaterThanOrEqual(2); // owner, HR, recruiter
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select * from recruiting_team($1)', [f.orgA])).code).toBe('42501');
      expect((await tx.query('select 1 from hiring_plans')).rows).toHaveLength(0);
      expect((await tx.query('select 1 from talent_pools')).rows).toHaveLength(0);
      expect((await failure(tx, 'select * from recruiting_activity($1)', [f.orgA])).code).toBe('42501');
      expect((await failure(tx, `insert into talent_pools (organization_id, name) values ($1, 'Mine')`, [f.orgA])).code).toBe('42501');
      await as(tx, f.users.ownerB);
      expect((await tx.query('select 1 from recruiting_spend')).rows).toHaveLength(0);
    });
  });

  it('notifies the hiring manager of a new applicant, unless switched off', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const req = (await tx.query<{ id: string }>(`select create_requisition($1, 'Designer', p_hiring_manager => $2) as id`, [f.orgA, f.employees.managerA])).rows[0]!.id;
      await tx.query(`select add_application($1, 'Noor', 'Demo', 'noor@example.test', null, 'careers_site', null, true)`, [req]);
      await tx.exec('reset role');
      const n = (await tx.query<{ title: string }>(`select title from notifications where user_id = $1 and kind = 'recruitment.applicant'`, [f.users.managerA])).rows;
      expect(n.map((x) => x.title)).toEqual(['New applicant for Designer']);

      await as(tx, f.users.hrA);
      await tx.query(`select save_recruiting_automations($1, 5::smallint, false)`, [f.orgA]);
      await tx.query(`select add_application($1, 'Omar', 'Demo', 'omar@example.test', null, 'careers_site', null, true)`, [req]);
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from notifications where user_id = $1 and kind = 'recruitment.applicant'`, [f.users.managerA])).rows).toHaveLength(1);
      expect((await tx.query<{ d: number }>('select stall_days as d from recruitment_settings where organization_id = $1', [f.orgA])).rows[0]!.d).toBe(5);

      await as(tx, f.users.icA);
      expect((await failure(tx, `select save_recruiting_automations($1, 5::smallint, true)`, [f.orgA])).code).toBe('42501');
    });
  });
});
