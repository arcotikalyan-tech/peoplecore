import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_KEYS, ROLE_TEMPLATES } from '@peoplecore/shared';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('permission catalog ↔ database seed', () => {
  it('permissions match packages/shared exactly', async () => {
    const { rows } = await ctx.t.db.query<{ key: string; is_sensitive: boolean }>('select key, is_sensitive from permissions order by key');
    const expected = Object.entries(PERMISSIONS)
      .map(([key, d]) => ({ key, is_sensitive: 'sensitive' in d && d.sensitive === true }))
      .sort((a, b) => a.key.localeCompare(b.key));
    expect(rows).toEqual(expected);
  });

  it('role templates match packages/shared exactly', async () => {
    const { rows } = await ctx.t.db.query<{ role_key: string; permission_key: string; scope: string }>(
      'select role_key, permission_key, scope from app.role_template_permissions');
    for (const role of ROLE_KEYS) {
      const fromDb = Object.fromEntries(rows.filter((r) => r.role_key === role).map((r) => [r.permission_key, r.scope]));
      expect(fromDb, role).toEqual(ROLE_TEMPLATES[role].grants);
    }
  });

  it('every new organization receives all system roles', async () => {
    const { rows } = await ctx.t.db.query<{ key: string }>(
      'select key from roles where organization_id = $1 and is_system order by key', [ctx.f.orgA]);
    expect(rows.map((r) => r.key)).toEqual([...ROLE_KEYS].sort());
  });
});
