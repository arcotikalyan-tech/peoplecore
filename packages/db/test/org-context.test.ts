import { describe, expect, it } from 'vitest';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

interface Bundle {
  org: { id: string; slug: string } | null;
  grants: { permission_key: string; scope: string }[];
  platform_admin: boolean;
  needs_mfa: boolean;
  disabled_modules: string[];
}

const bundle = (userId: string, slug: string, aal: 'aal1' | 'aal2' = 'aal2') =>
  ctx.t.asUser(userId, async (tx) => (await tx.query<{ b: Bundle }>('select my_org_context($1) as b', [slug])).rows[0]!.b, { aal });

describe('my_org_context (the page shell in one round trip)', () => {
  it('matches the separate lookups for a member', async () => {
    const { f, t } = ctx;
    await t.db.query(`insert into org_modules (organization_id, module, enabled) values ($1, 'loans', false), ($1, 'assets', true)`, [f.orgA]);
    const b = await bundle(f.users.hrA, 'demo-a');
    expect(b.org?.id).toBe(f.orgA);
    const direct = await t.asUser(f.users.hrA, async (tx) => (await tx.query('select permission_key, scope from my_permissions($1)', [f.orgA])).rows);
    expect(b.grants.length).toBe(direct.length);
    expect(b.grants).toEqual(expect.arrayContaining(direct));
    expect(b.platform_admin).toBe(false);
    expect(b.needs_mfa).toBe(true);
    expect(b.disabled_modules).toEqual(['loans']);
  });

  it("withholds another tenant's organization and modules, and privileged grants at aal1", async () => {
    const { f } = ctx;
    const other = await bundle(f.users.hrA, 'demo-b');
    expect(other.org).toBeNull();
    expect(other.grants).toEqual([]);
    expect(other.disabled_modules).toEqual([]);
    const aal1 = await bundle(f.users.hrA, 'demo-a', 'aal1');
    expect(aal1.org?.id).toBe(f.orgA);
    expect(aal1.grants).toEqual([]);
    expect(aal1.needs_mfa).toBe(true);
    const ic = await bundle(f.users.icA, 'demo-a', 'aal1');
    expect(ic.grants.length).toBeGreaterThan(0);
    expect(ic.needs_mfa).toBe(false);
  });
});
