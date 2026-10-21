import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

const visibleEmployees = (userId: string, aal: 'aal1' | 'aal2') =>
  ctx.t.asUser(userId, async (tx) => (await tx.query('select 1 from employees')).rows.length, { aal });
const needsCode = (userId: string) =>
  ctx.t.asUser(userId, async (tx) => (await tx.query<{ r: boolean }>('select my_mfa_requirement() as r')).rows[0]!.r, { aal: 'aal1' });

describe('two-step sign-in as a setting', () => {
  it('an owner can stop requiring it for privileged roles, and only an owner in a two-step session can', async () => {
    const { f, t } = ctx;
    expect(await visibleEmployees(f.users.hrA, 'aal1')).toBe(0);
    expect(await needsCode(f.users.hrA)).toBe(true);

    // HR can't change it; the owner can't with a password alone (their powers need the code while it's on);
    // nobody can write the column directly.
    expect(await pgError(t.asUser(f.users.hrA, (tx) => tx.query('select set_org_require_mfa($1, false)', [f.orgA])))).toBe('42501');
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query('select set_org_require_mfa($1, false)', [f.orgA]), { aal: 'aal1' }))).toBe('42501');
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query('update org_controls set require_mfa = false where organization_id = $1', [f.orgA])))).toBe('42501');

    await t.db.query('update org_controls set require_mfa = false where organization_id = $1', [f.orgA]);
    try {
      expect(await visibleEmployees(f.users.hrA, 'aal1')).toBe(4);
      expect(await needsCode(f.users.hrA)).toBe(false);
      // Another organization's setting is untouched.
      expect(await visibleEmployees(f.users.ownerB, 'aal1')).toBe(0);
      // Turning it back on works from a password-only session now, and takes effect at once.
      await t.asUser(f.users.ownerA, (tx) => tx.query('select set_org_require_mfa($1, true)', [f.orgA]), { aal: 'aal1' });
      const after = await t.asUser(f.users.ownerA, async (tx) => {
        await tx.query('select set_org_require_mfa($1, true)', [f.orgA]);
        return (await tx.query<{ r: boolean }>('select require_mfa as r from org_controls where organization_id = $1', [f.orgA])).rows[0]!.r;
      }, { aal: 'aal1' });
      expect(after).toBe(true);
    } finally {
      await t.db.query('update org_controls set require_mfa = true where organization_id = $1', [f.orgA]);
    }
  });

  it('platform admins can make it optional for themselves, platform-wide', async () => {
    const { f, t } = ctx;
    await t.db.query('insert into platform_admins (user_id) values ($1)', [f.users.outsider]);
    try {
      expect(await needsCode(f.users.outsider)).toBe(true);
      expect(await pgError(t.asUser(f.users.outsider, (tx) => tx.query(`select create_organization('Nope', 'nope-org')`), { aal: 'aal1' }))).toBe('42501');
      expect(await pgError(t.asUser(f.users.hrA, (tx) => tx.query('select set_platform_require_mfa(false)')))).toBe('42501');

      await t.asUser(f.users.outsider, async (tx) => {
        await tx.query('select set_platform_require_mfa(false)');
      });
      await t.db.query('update platform_settings set require_mfa_for_admins = false');
      expect(await needsCode(f.users.outsider)).toBe(false);
      await t.asUser(f.users.outsider, (tx) => tx.query(`select create_organization('Fine', 'fine-org-2')`), { aal: 'aal1' });
    } finally {
      await t.db.query('update platform_settings set require_mfa_for_admins = true');
      await t.db.query('delete from platform_admins where user_id = $1', [f.users.outsider]);
      await t.db.query(`delete from organizations where slug = 'fine-org-2'`);
    }
  });
});
