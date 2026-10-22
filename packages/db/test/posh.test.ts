import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/**
 * Migration 20261022000600: the POSH Internal Committee, committee members handling POSH cases, the statutory steps
 * of a case and the annual report figures.
 */
const ctx = useDatabase();

async function as(tx: Transaction, user: string, aal: 'aal1' | 'aal2' = 'aal2') {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal })]);
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

/** The SQL and parameters to add a committee member (an employee, or the external member when `employee` is null). */
const member = (org: string, role: string, employee: string | null, woman: boolean, from = 'current_date - 30', until = 'current_date + 700'): [string, unknown[]] =>
  [`insert into posh_committee_members (organization_id, role, employee_id, external_name, external_org, woman, term_from, term_until)
    values ($1, $2, $3, $4, $5, $6, ${from}, ${until})`, [org, role, employee, employee ? null : 'Asha Example', employee ? null : 'Example Foundation', woman]];

describe('POSH Internal Committee', () => {
  it('HR keeps the register within the law; everyone sees who is on it, nothing more', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(...member(f.orgA, 'presiding_officer', f.employees.leadA, true));
      await tx.query(...member(f.orgA, 'member', f.employees.peerA, true));
      await tx.query(...member(f.orgA, 'external_member', null, false));
      expect((await failure(tx, ...member(f.orgA, 'presiding_officer', f.employees.managerA, false))).code).toBe('23514'); // a woman presides
      expect((await failure(tx, ...member(f.orgA, 'member', f.employees.managerA, false, 'current_date', "current_date + interval '4 years'"))).code).toBe('23514');
      expect((await failure(tx, `insert into posh_committee_members (organization_id, role, woman, term_from, term_until)
        values ($1, 'external_member', true, current_date, current_date + 300)`, [f.orgA])).code).toBe('23514'); // the external member is named

      await as(tx, f.users.icA);
      const seen = (await tx.query<{ role: string; name: string; external_org: string | null; is_me: boolean }>('select * from posh_committee($1)', [f.orgA])).rows;
      expect(seen.map((r) => [r.role, r.name])).toEqual([['presiding_officer', 'Lalit Demo'], ['member', 'Pia Demo'], ['external_member', 'Asha Example']]);
      expect(seen.every((r) => !r.is_me)).toBe(true);
      expect((await tx.query('select 1 from posh_committee_members')).rows).toHaveLength(0); // the register itself is HR's
      expect((await failure(tx, ...member(f.orgA, 'member', f.employees.icA, false))).code).toBe('42501');
    });
    await ctx.t.asUser(f.users.ownerB, async (tx) => {
      expect((await tx.query('select * from posh_committee($1)', [f.orgA])).rows).toHaveLength(0);
    });
  });

  it('current committee members handle POSH cases (in a two-step session), except cases that name them', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(...member(f.orgA, 'presiding_officer', f.employees.peerA, true));
      await tx.query(...member(f.orgA, 'member', f.employees.leadA, false, 'current_date - 900', 'current_date - 1')); // term over

      await as(tx, f.users.icA);
      const posh = (await tx.query<{ id: string }>(`select raise_grievance($1, 'posh', 'Unwelcome remarks', 'Repeated remarks about my appearance in the team channel.', current_date - 10) as id`, [f.orgA])).rows[0]!.id;
      const other = (await tx.query<{ id: string }>(`select raise_grievance($1, 'pay', 'Missing arrears', 'My arrears from the last revision were never paid out to me.') as id`, [f.orgA])).rows[0]!.id;
      const naming = (await tx.query<{ id: string }>(`select raise_grievance($1, 'posh', 'Comments at the offsite', 'Comments made at the offsite that I found deeply uncomfortable.', current_date - 5, $2) as id`,
        [f.orgA, [f.employees.peerA]])).rows[0]!.id;

      await tx.exec('reset role');
      const told = (await tx.query<{ user_id: string }>(`select distinct user_id from notifications where kind = 'grievance.new' and link = '/grievances/' || $1`, [posh])).rows.map((r) => r.user_id);
      expect(told).toContain(f.users.peerA);
      expect(told).not.toContain(f.users.leadA); // former member
      expect((await tx.query(`select 1 from notifications where kind = 'grievance.new' and link = '/grievances/' || $1 and user_id = $2`, [naming, f.users.peerA])).rows).toHaveLength(0);

      await as(tx, f.users.peerA);
      expect((await tx.query<{ id: string }>('select id from grievances order by created_at')).rows.map((r) => r.id)).toEqual([posh]);
      expect((await tx.query<{ my_role: string; description: string }>('select my_role, description from grievance_case($1)', [posh])).rows[0]).toMatchObject({ my_role: 'investigator' });
      await tx.query(`select add_grievance_note($1, 'Copy of the complaint sent to the respondent.', true)`, [posh]);
      await tx.query(`select update_grievance($1, 'investigating')`, [posh]);
      expect((await tx.query('select * from grievance_case($1)', [other])).rows).toHaveLength(0);
      expect((await tx.query('select * from grievance_case($1)', [naming])).rows).toHaveLength(0);

      await as(tx, f.users.peerA, 'aal1');
      expect((await tx.query('select id from grievances')).rows).toHaveLength(0); // the organization requires two-step
      await as(tx, f.users.leadA);
      expect((await tx.query('select id from grievances')).rows).toHaveLength(0);
    });
  });

  it('the people handling a POSH case record its steps in order; HR gets the annual figures', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      // Steps are dated in the organization's own calendar (Asia/Kolkata); so is current_date here, whatever the hour.
      await tx.exec(`set local timezone = 'Asia/Kolkata'`);
      await tx.query(...member(f.orgA, 'presiding_officer', f.employees.peerA, true));
      await as(tx, f.users.icA);
      const posh = (await tx.query<{ id: string }>(`select raise_grievance($1, 'posh', 'Unwelcome remarks', 'Repeated remarks about my appearance in the team channel.', current_date - 10) as id`, [f.orgA])).rows[0]!.id;
      const pay = (await tx.query<{ id: string }>(`select raise_grievance($1, 'pay', 'Missing arrears', 'My arrears from the last revision were never paid out to me.') as id`, [f.orgA])).rows[0]!.id;
      expect((await failure(tx, `select record_posh_step($1, 'notice_sent', current_date)`, [posh])).code).toBe('42501'); // not the reporter

      await as(tx, f.users.peerA);
      await tx.query(`select record_posh_step($1, 'notice_sent', current_date)`, [posh]);
      expect((await failure(tx, `select record_posh_step($1, 'notice_sent', current_date + 1)`, [posh])).message).toBe('Use a date between the complaint and today.');
      expect((await failure(tx, `select record_posh_step($1, 'action_taken', current_date)`, [posh])).message).toBe('Choose the action taken.');
      await tx.query(`select record_posh_step($1, 'inquiry_completed', current_date)`, [posh]);
      await tx.query(`select record_posh_step($1, 'report_sent', current_date)`, [posh]);
      await tx.query(`select record_posh_step($1, 'action_taken', current_date, 'warning')`, [posh]);
      expect((await tx.query<{ notice_sent_on: string | null; action_kind: string }>('select notice_sent_on, action_kind from posh_case_steps where grievance_id = $1', [posh])).rows[0]!.action_kind).toBe('warning');
      await tx.query(`select record_posh_step($1, 'report_sent', null)`, [posh]); // clearing a step
      expect((await failure(tx, `select record_posh_step($1, 'step_nine', current_date)`, [posh])).message).toBe('Choose a step.');

      await as(tx, f.users.hrA);
      expect((await failure(tx, `select record_posh_step($1, 'notice_sent', current_date)`, [pay])).message).toBe('Statutory steps are kept for POSH cases.');
      await tx.query(`select update_grievance($1, 'resolved', 'The committee found the complaint proved; the respondent was warned.')`, [posh]);
      await tx.query(`insert into posh_sessions (organization_id, held_on, audience, title, attendees) values ($1, current_date, 'employees', 'POSH awareness', 40),
        ($1, current_date, 'committee', 'Committee orientation', 3)`, [f.orgA]);
      const year = Number((await tx.query<{ y: string }>(`select extract(year from current_date)::text as y`)).rows[0]!.y);
      const report = (await tx.query<{ r: Record<string, unknown> }>('select posh_annual_report($1, $2) as r', [f.orgA, year])).rows[0]!.r;
      expect(report).toMatchObject({ year, received: 1, disposed: 1, pending_over_90_days: 0, workshops: 1, committee_sessions: 1, actions: { warning: 1 } });

      await as(tx, f.users.peerA);
      expect((await failure(tx, 'select posh_annual_report($1, $2)', [f.orgA, year])).code).toBe('42501');
      expect((await tx.query('select 1 from posh_sessions')).rows).toHaveLength(0);
    });
  });
});
