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
async function failure(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec('savepoint f');
  try { await tx.query(sql, params); } catch (e) { await tx.exec('rollback to savepoint f'); return e as { code?: string; message: string }; }
  throw new Error(`expected to fail: ${sql}`);
}

describe('reports', () => {
  it('templates are private unless shared; schedules are only ever the owner’s', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into report_templates (organization_id, name, config) values ($1, 'Mine', '{"columns":["name"]}'), ($1, 'For all', '{"columns":["code"]}')`, [f.orgA]);
      await tx.query(`update report_templates set shared = true where name = 'For all'`);
      await tx.query(`insert into report_schedules (organization_id, report_key, frequency, next_run_on) values ($1, 'employee_master', 'monthly', '2026-11-01')`, [f.orgA]);
      expect((await failure(tx, `insert into report_templates (organization_id, name, config, created_by) values ($1, 'Forged', '{}', $2)`, [f.orgA, f.users.icA])).code).toBe('42501');

      await as(tx, f.users.icA);
      expect((await tx.query<{ name: string }>('select name from report_templates')).rows.map((r) => r.name)).toEqual(['For all']);
      expect((await tx.query(`update report_templates set name = 'Taken' returning 1`)).rows).toHaveLength(0);
      expect((await tx.query('select 1 from report_schedules')).rows).toHaveLength(0);
      await as(tx, f.users.employeeB);
      expect((await tx.query('select 1 from report_templates')).rows).toHaveLength(0);
    });
  });

  it('every export is recorded against the person who ran it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`select log_report_export($1, 'employee_master', '{"asof":"2026-10-19"}', 12)`, [f.orgA]);
      expect((await failure(tx, `select log_report_export($1, 'Bad Key!', '{}', 1)`, [f.orgA])).code).toBe('42501');
      await as(tx, f.users.employeeB);
      expect((await failure(tx, `select log_report_export($1, 'employee_master', '{}', 1)`, [f.orgA])).code).toBe('42501');
      await tx.exec('reset role');
      const rows = (await tx.query<{ actor_user_id: string; metadata: { report: string; row_count: number } }>(
        `select actor_user_id, metadata from audit_events where action = 'export' and entity_type = 'report'`)).rows;
      expect(rows).toEqual([{ actor_user_id: f.users.hrA, metadata: { report: 'employee_master', params: { asof: '2026-10-19' }, row_count: 12 } }]);
    });
  });

  it('the worker reminds owners of due schedules once, moves them on, and drops schedules of people who left', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into report_schedules (organization_id, report_key, params, frequency, next_run_on)
        values ($1, 'consolidated_net_pay', '{"title":"Net pay"}', 'monthly', '2026-01-01')`, [f.orgA]);
      await as(tx, f.users.icA);
      await tx.query(`insert into report_schedules (organization_id, report_key, frequency, next_run_on) values ($1, 'leave_register', 'weekly', '2026-01-01')`, [f.orgA]);
      await tx.exec('reset role');
      await tx.query(`update organization_members set status = 'suspended' where organization_id = $1 and user_id = $2`, [f.orgA, f.users.icA]);
      expect((await tx.query<{ r: { reminded: number } }>('select worker_report_schedules() as r')).rows[0]!.r.reminded).toBe(1);
      expect((await tx.query<{ r: { reminded: number } }>('select worker_report_schedules() as r')).rows[0]!.r.reminded).toBe(0);
      const next = (await tx.query<{ next_run_on: string; after: boolean; day: number }>(
        `select next_run_on::text, next_run_on > app.org_today(organization_id) as after, extract(day from next_run_on)::int as day from report_schedules`)).rows;
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ after: true, day: 1 });
      expect((await tx.query<{ title: string; link: string }>(`select title, link from notifications where kind = 'report.scheduled'`)).rows[0]!.title).toBe('Scheduled report ready: Net pay');
      await as(tx, f.users.hrA);
      expect((await failure(tx, 'select worker_report_schedules()')).code).toBe('42501');
    });
  });
});
