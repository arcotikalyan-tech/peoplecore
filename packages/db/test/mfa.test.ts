import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

/**
 * Two-step sign-in is off unless an organization switches it on (migration 20261022001100); then everyone there needs
 * the code, whatever their role. Org A has it on in the fixture; org B keeps the default.
 */
const ctx = useDatabase();

const visibleEmployees = (userId: string, aal: 'aal1' | 'aal2') =>
  ctx.t.asUser(userId, async (tx) => (await tx.query('select 1 from employees')).rows.length, { aal });
const grants = (userId: string, org: string, aal: 'aal1' | 'aal2') =>
  ctx.t.asUser(userId, async (tx) => (await tx.query('select * from my_permissions($1)', [org])).rows, { aal });
const needs = (userId: string) =>
  ctx.t.asUser(userId, async (tx) => (await tx.query<{ v: boolean }>('select my_mfa_requirement() as v')).rows[0]!.v, { aal: 'aal1' });

describe('two-step sign-in, switched on per organization', () => {
  it('is not needed where the organization hasn’t switched it on', async () => {
    const { f } = ctx;
    expect(await visibleEmployees(f.users.ownerB, 'aal1')).toBe(1);
    expect((await grants(f.users.ownerB, f.orgB, 'aal1')).length).toBeGreaterThan(0);
    expect(await needs(f.users.ownerB)).toBe(false);
    expect(await needs(f.users.employeeB)).toBe(false);
  });

  it('once switched on, everyone there needs it, whatever their role', async () => {
    const { f, t } = ctx;
    expect(await visibleEmployees(f.users.hrA, 'aal2')).toBe(4);
    expect(await visibleEmployees(f.users.hrA, 'aal1')).toBe(0);
    for (const u of [f.users.ownerA, f.users.hrA, f.users.managerA, f.users.icA, f.users.recruiterA]) {
      expect(await grants(u, f.orgA, 'aal1')).toEqual([]);
      expect(await needs(u)).toBe(true);
    }
    expect((await grants(f.users.managerA, f.orgA, 'aal2')).length).toBeGreaterThan(0);
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select create_employee($1, 'X', 'permanent', '2026-01-01')`, [f.orgA]), { aal: 'aal1' }))).toBe('42501');
  });

  it('owners switch it on once they use it themselves, and off only with the code while it’s on', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.employeeB, (tx) => tx.query('select set_org_require_mfa($1, true)', [f.orgB]), { aal: 'aal1' }))).toBe('42501');
    expect(await pgError(t.asUser(f.users.ownerB, (tx) => tx.query('update org_controls set require_mfa = true where organization_id = $1', [f.orgB])))).toBe('42501');
    expect(await pgError(t.asUser(f.users.ownerB, (tx) => tx.query('select set_org_require_mfa($1, true)', [f.orgB]), { aal: 'aal1' }))).toBe('22023');
    await t.asUser(f.users.ownerB, (tx) => tx.query('select set_org_require_mfa($1, true)', [f.orgB]), { aal: 'aal2' });
    await t.db.query('update org_controls set require_mfa = true where organization_id = $1', [f.orgB]);
    try {
      expect(await needs(f.users.employeeB)).toBe(true);
      expect(await visibleEmployees(f.users.ownerB, 'aal1')).toBe(0);
      expect(await pgError(t.asUser(f.users.ownerB, (tx) => tx.query('select set_org_require_mfa($1, false)', [f.orgB]), { aal: 'aal1' }))).toBe('42501');
      await t.asUser(f.users.ownerB, (tx) => tx.query('select set_org_require_mfa($1, false)', [f.orgB]), { aal: 'aal2' });
    } finally {
      await t.db.query('update org_controls set require_mfa = false where organization_id = $1', [f.orgB]);
    }
  });

  it('platform administration needs the code only when the platform switch is on', async () => {
    const { f, t } = ctx;
    await t.db.query('insert into platform_admins (user_id) values ($1)', [f.users.outsider]);
    try {
      expect(await needs(f.users.outsider)).toBe(false);
      await t.asUser(f.users.outsider, (tx) => tx.query(`select create_organization('Fine', 'fine-org')`), { aal: 'aal1' });
      expect(await pgError(t.asUser(f.users.hrA, (tx) => tx.query('select set_platform_require_mfa(true)')))).toBe('42501');
      expect(await pgError(t.asUser(f.users.outsider, (tx) => tx.query('select set_platform_require_mfa(true)'), { aal: 'aal1' }))).toBe('22023');
      await t.asUser(f.users.outsider, (tx) => tx.query('select set_platform_require_mfa(true)'), { aal: 'aal2' });
      await t.db.query('update platform_settings set require_mfa_for_admins = true');
      expect(await needs(f.users.outsider)).toBe(true);
      expect(await pgError(t.asUser(f.users.outsider, (tx) => tx.query(`select create_organization('Nope', 'nope-org')`), { aal: 'aal1' }))).toBe('42501');
      await t.asUser(f.users.outsider, (tx) => tx.query(`select create_organization('Fine again', 'fine-org-2')`), { aal: 'aal2' });
    } finally {
      await t.db.query('update platform_settings set require_mfa_for_admins = false');
      await t.db.query('delete from platform_admins where user_id = $1', [f.users.outsider]);
      await t.db.query(`delete from organizations where slug in ('fine-org', 'fine-org-2')`);
    }
  });
});
