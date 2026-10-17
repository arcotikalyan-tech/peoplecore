import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

const visibleEmployees = (userId: string, aal: 'aal1' | 'aal2') =>
  ctx.t.asUser(userId, async (tx) => (await tx.query('select 1 from employees')).rows.length, { aal });

describe('two-factor sign-in for privileged roles', () => {
  it('HR powers apply only after the second factor', async () => {
    const { f } = ctx;
    expect(await visibleEmployees(f.users.hrA, 'aal2')).toBe(4);
    expect(await visibleEmployees(f.users.hrA, 'aal1')).toBe(0); // hr_admin is their only role
    const grants = await ctx.t.asUser(f.users.hrA, async (tx) => (await tx.query('select * from my_permissions($1)', [f.orgA])).rows, { aal: 'aal1' });
    expect(grants).toEqual([]);
  });

  it('an owner with a password alone cannot create employees or manage roles', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select create_employee($1, 'X', 'permanent', '2026-01-01')`, [f.orgA]), { aal: 'aal1' })),
    ).toBe('42501');
    const grantable = await t.asUser(f.users.ownerA, async (tx) => (await tx.query('select * from grantable_roles($1)', [f.orgA])).rows, { aal: 'aal1' });
    expect(grantable).toEqual([]);
  });

  it('everyday roles work without a second factor', async () => {
    const { f } = ctx;
    expect(await visibleEmployees(f.users.managerA, 'aal1')).toBe(3); // manager + their line
    expect(await visibleEmployees(f.users.icA, 'aal1')).toBe(1);
  });

  it('platform administration needs the second factor too', async () => {
    const { f, t } = ctx;
    await t.db.query('insert into platform_admins (user_id) values ($1)', [f.users.outsider]);
    try {
      expect(await pgError(t.asUser(f.users.outsider, (tx) => tx.query(`select create_organization('Nope', 'nope-org')`), { aal: 'aal1' }))).toBe('42501');
      const orgs = await t.asUser(f.users.outsider, async (tx) => (await tx.query('select 1 from organizations')).rows.length, { aal: 'aal1' });
      expect(orgs).toBe(0);
      await t.asUser(f.users.outsider, (tx) => tx.query(`select create_organization('Fine', 'fine-org')`), { aal: 'aal2' });
    } finally {
      await t.db.query('delete from platform_admins where user_id = $1', [f.users.outsider]);
    }
  });

  it('tells the app who must use two-factor, regardless of the current session', async () => {
    const { f, t } = ctx;
    const needs = (u: string) => t.asUser(u, async (tx) => (await tx.query<{ v: boolean }>('select my_mfa_requirement() as v')).rows[0]!.v, { aal: 'aal1' });
    expect(await needs(f.users.ownerA)).toBe(true);
    expect(await needs(f.users.hrA)).toBe(true);
    expect(await needs(f.users.payrollA)).toBe(true);
    expect(await needs(f.users.auditorA)).toBe(true);
    expect(await needs(f.users.managerA)).toBe(false);
    expect(await needs(f.users.icA)).toBe(false);
    expect(await needs(f.users.recruiterA)).toBe(false);
  });
});
