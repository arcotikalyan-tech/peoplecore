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

  it('who can grant each role matches packages/shared, in templates and in existing organizations', async () => {
    const expected = Object.fromEntries(ROLE_KEYS.map((r) => [r, ROLE_TEMPLATES[r].assignableWith]));
    const templates = await ctx.t.db.query<{ role_key: string; assignment_permission: string }>(
      'select role_key, assignment_permission from app.role_templates');
    expect(Object.fromEntries(templates.rows.map((r) => [r.role_key, r.assignment_permission]))).toEqual(expected);
    const orgRoles = await ctx.t.db.query<{ key: string; assignment_permission: string }>(
      'select key, assignment_permission from roles where organization_id = $1 and is_system', [ctx.f.orgA]);
    expect(Object.fromEntries(orgRoles.rows.map((r) => [r.key, r.assignment_permission]))).toEqual(expected);
  });

  it('which roles require two-factor sign-in matches packages/shared, in templates and organizations', async () => {
    const expected = Object.fromEntries(ROLE_KEYS.map((r) => [r, ROLE_TEMPLATES[r].requiresMfa]));
    const templates = await ctx.t.db.query<{ role_key: string; requires_mfa: boolean }>('select role_key, requires_mfa from app.role_templates');
    expect(Object.fromEntries(templates.rows.map((r) => [r.role_key, r.requires_mfa]))).toEqual(expected);
    const orgRoles = await ctx.t.db.query<{ key: string; requires_mfa: boolean }>(
      'select key, requires_mfa from roles where organization_id = $1 and is_system', [ctx.f.orgA]);
    expect(Object.fromEntries(orgRoles.rows.map((r) => [r.key, r.requires_mfa]))).toEqual(expected);
  });

  it('every new organization receives all system roles', async () => {
    const { rows } = await ctx.t.db.query<{ key: string }>(
      'select key from roles where organization_id = $1 and is_system order by key', [ctx.f.orgA]);
    expect(rows.map((r) => r.key)).toEqual([...ROLE_KEYS].sort());
  });
});
