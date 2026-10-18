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

// Counts and sums come back as strings (bigint, numeric); compare them as numbers.
const num = (rows: unknown[]) =>
  (rows as Array<Record<string, unknown>>).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v])));

describe('analytics: aggregates that run as the caller', () => {
  it('headcount and scope follow what each person can see', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query('update employees set department_id = $1 where id = any($2)', [f.deptA, [f.employees.managerA, f.employees.leadA]]);
      const headcount = async (org = f.orgA, group = 'department') =>
        num((await tx.query<{ label: string; headcount: number }>('select label, headcount from analytics_headcount($1, $2, $3)', [org, '2026-10-18', group])).rows);
      const scope = async () => (await tx.query<{ s: { scope: string; employees_visible: number } }>('select analytics_scope($1) as s', [f.orgA])).rows[0]!.s;

      await as(tx, f.users.hrA);
      expect(await scope()).toMatchObject({ scope: 'organization', employees_visible: 4 });
      expect(await headcount()).toEqual([{ label: 'Engineering', headcount: 2 }, { label: 'Not set', headcount: 2 }]);
      expect(await headcount(f.orgA, 'employment_type')).toEqual([{ label: 'permanent', headcount: 4 }]);
      expect(await headcount(f.orgA, 'nonsense')).toEqual([{ label: 'Everyone', headcount: 4 }]);

      await as(tx, f.users.managerA); // their reporting line and themselves
      expect(await scope()).toMatchObject({ scope: 'reporting_line', employees_visible: 3 });
      expect(await headcount()).toEqual([{ label: 'Engineering', headcount: 2 }, { label: 'Not set', headcount: 1 }]);

      await as(tx, f.users.icA);
      expect(await scope()).toMatchObject({ scope: 'self', employees_visible: 1 });
      expect(await headcount()).toEqual([{ label: 'Not set', headcount: 1 }]);

      await as(tx, f.users.employeeB); // another organization sees nothing
      expect(await scope()).toMatchObject({ scope: 'self', employees_visible: 0 });
      expect(await headcount()).toEqual([]);
    });
  });

  it('joiners, leavers and month-end headcount, capped to three years', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into employees (organization_id, employee_code, first_name, last_name, status, employment_type, date_of_joining, date_of_exit)
        values ($1, 'A-090', 'Esha', 'Demo', 'exited', 'permanent', '2025-03-10', '2026-06-30'),
               ($1, 'A-091', 'Jai', 'Demo', 'active', 'contract', '2026-09-15', null)`, [f.orgA]);
      await as(tx, f.users.hrA);
      expect(num((await tx.query('select month::text, joiners, leavers, headcount_end from analytics_movements($1, $2, $3)', [f.orgA, '2026-06-01', '2026-09-30'])).rows))
        .toEqual([
          { month: '2026-06-01', joiners: 0, leavers: 1, headcount_end: 4 },
          { month: '2026-07-01', joiners: 0, leavers: 0, headcount_end: 4 },
          { month: '2026-08-01', joiners: 0, leavers: 0, headcount_end: 4 },
          { month: '2026-09-01', joiners: 1, leavers: 0, headcount_end: 5 },
        ]);
      expect(num((await tx.query('select sum(headcount) as n from analytics_headcount($1, $2)', [f.orgA, '2026-05-01'])).rows)).toEqual([{ n: 5 }]); // Esha, not Jai
      expect((await tx.query('select * from analytics_movements($1, $2, $3)', [f.orgA, '2020-01-01', '2026-01-01'])).rows).toEqual([]);
      expect((await tx.query('select * from analytics_movements($1, $2, $3)', [f.orgA, '2026-09-01', '2026-06-01'])).rows).toEqual([]);
      await as(tx, f.users.icA); // the leaver and the joiner aren't in an employee's view
      expect(num((await tx.query('select joiners, leavers from analytics_movements($1, $2, $3)', [f.orgA, '2026-06-01', '2026-06-30'])).rows))
        .toEqual([{ joiners: 0, leavers: 0 }]);
    });
  });

  it('leave and recruitment figures respect who can see the requests', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const type = (await tx.query<{ id: string }>(`insert into leave_types (organization_id, code, name) values ($1, 'XL', 'Example leave') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, days, status)
        values ($1, $2, $3, '2026-10-05', '2026-10-06', 2, 'approved'), ($1, $4, $3, '2026-10-07', '2026-10-07', 1, 'approved'),
               ($1, $2, $3, '2026-10-20', '2026-10-20', 1, 'pending')`, [f.orgA, f.employees.icA, type, f.employees.peerA]);
      await tx.query(`insert into job_requisitions (organization_id, code, title, openings) values ($1, 'R-1', 'Analyst', 2), ($1, 'R-2', 'Designer', 1)`, [f.orgA]);

      const leave = async () => num((await tx.query('select leave_type, requests, days, people from analytics_leave($1, $2, $3)', [f.orgA, '2026-10-01', '2026-10-31'])).rows);
      await as(tx, f.users.hrA);
      expect(await leave()).toEqual([{ leave_type: 'Example leave', requests: 2, days: 3, people: 2 }]);
      await as(tx, f.users.managerA); // Ishan is in Mira's line (through Lalit); Pia isn't
      expect(await leave()).toEqual([{ leave_type: 'Example leave', requests: 1, days: 2, people: 1 }]);
      await as(tx, f.users.peerA);
      expect(await leave()).toEqual([{ leave_type: 'Example leave', requests: 1, days: 1, people: 1 }]);

      await as(tx, f.users.recruiterA);
      expect((await tx.query<{ r: Record<string, unknown> }>('select analytics_recruitment($1) as r', [f.orgA])).rows[0]!.r)
        .toEqual({ open_requisitions: 2, openings: 3, applications_by_stage: {}, hired_last_90_days: 0 });
      await as(tx, f.users.icA);
      expect((await tx.query<{ r: Record<string, unknown> }>('select analytics_recruitment($1) as r', [f.orgA])).rows[0]!.r)
        .toMatchObject({ open_requisitions: 0, openings: 0 });
      await as(tx, f.users.icA); // payroll totals need payroll access
      expect((await tx.query('select * from analytics_payroll($1)', [f.orgA])).rows).toEqual([]);
    });
  });
});
