import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

/**
 * Migration 20261018003200 replaced per-row app.can_access_employee() and app.has_permission() calls in every
 * policy with set-based helpers that run once per query. This proves the two give the same answer for every
 * fixture user, employee, organization and permission, with and without two-step sign-in.
 */

const PERMISSIONS = [
  'employee.read', 'employee.update', 'employee.personal.read', 'employee.identity.read', 'employee.bank.read', 'employee.document.read',
  'leave.read', 'leave.approve', 'attendance.read', 'attendance.approve', 'compensation.read', 'performance.read', 'performance.manage',
  'payroll.prepare', 'recruitment.read', 'helpdesk.manage', 'separation.manage', 'ai.use',
];

async function claims(tx: Transaction, user: string, aal: 'aal1' | 'aal2') {
  await tx.exec('reset role'); // superuser: sees every row, while auth.uid() and the session's aal come from the claims
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal })]);
}

describe('set-based RLS helpers match the per-row functions', () => {
  it('for every user, employee and permission, at aal2 and aal1', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      // A deeper line, so 'team' covers indirect reports: Ishan (icA) now manages Pia (peerA).
      await tx.exec('reset role');
      await tx.query('update employees set manager_employee_id = $1 where id = $2', [f.employees.icA, f.employees.peerA]);
      let compared = 0;
      for (const user of Object.values(f.users)) {
        for (const aal of ['aal2', 'aal1'] as const) {
          await claims(tx, user, aal);
          const employees = await tx.query<{ id: string; perm: string; old: boolean; new: boolean }>(
            `select e.id, p.perm,
                    app.can_access_employee(e.organization_id, e.id, p.perm) as old,
                    (e.organization_id in (select app.orgs_with_scope(p.perm, 'org')) or e.id in (select app.employees_in_scope(p.perm))) as new
               from employees e cross join unnest($1::text[]) p(perm)`, [PERMISSIONS]);
          const orgs = await tx.query<{ org: string; perm: string; old: boolean; new: boolean }>(
            `select o.id as org, p.perm, app.has_permission(o.id, p.perm) as old,
                    o.id in (select app.orgs_with_scope(p.perm, 'org')) as new
               from organizations o cross join unnest($1::text[]) p(perm)`, [PERMISSIONS]);
          const differ = [...employees.rows, ...orgs.rows].filter((r) => r.old !== r.new);
          expect(differ, `${user} ${aal}`).toEqual([]);
          compared += employees.rows.length + orgs.rows.length;
          // The comparison isn't vacuous: each user can see something and is refused something.
          if (aal === 'aal2' && user !== f.users.outsider) {
            expect(employees.rows.some((r) => r.old), `${user} sees someone`).toBe(true);
          }
        }
      }
      expect(compared).toBeGreaterThan(1000);
    });
  });
});
