import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('audit trail', () => {
  it('records the actor and only the changed fields on update', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`update employees set work_phone = '+919800000000' where id = $1`, [f.employees.icA]);
      const { rows } = await tx.query<{ actor_user_id: string; action: string; changes: Record<string, unknown> }>(
        `select actor_user_id, action, changes from audit_events
          where entity_type = 'employees' and entity_id = $1 order by id desc limit 1`, [f.employees.icA]);
      expect(rows[0]).toMatchObject({ actor_user_id: f.users.hrA, action: 'update' });
      expect(Object.keys(rows[0]!.changes)).toEqual(['work_phone']);
      expect(rows[0]!.changes.work_phone).toEqual({ from: null, to: '+919800000000' });
    });
  });

  it('no-op updates are not logged', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const count = async () =>
        Number((await tx.query<{ n: string }>(`select count(*) n from audit_events where entity_id = $1`, [f.employees.peerA])).rows[0]!.n);
      const before = await count();
      await tx.query(`update employees set first_name = first_name where id = $1`, [f.employees.peerA]);
      expect(await count()).toBe(before);
    });
  });

  it('is append-only, even for the database superuser', async () => {
    expect(await pgError(ctx.t.db.query('update audit_events set action = $1', ['tampered']))).toBe('42501');
    expect(await pgError(ctx.t.db.query('delete from audit_events'))).toBe('42501');
    expect(await pgError(ctx.t.db.query('truncate audit_events'))).toBe('42501');
  });

  it('clients cannot forge audit events', async () => {
    expect(
      await pgError(ctx.t.asUser(ctx.f.users.ownerA, (tx) =>
        tx.query(`insert into audit_events (organization_id, action, entity_type) values ($1, 'x', 'y')`, [ctx.f.orgA]))),
    ).toBe('42501');
  });

  it('is visible to auditors and owners, not employees or other tenants', async () => {
    const { f } = ctx;
    const count = (u: string) =>
      ctx.t.asUser(u, async (tx) => (await tx.query('select 1 from audit_events')).rows.length);
    expect(await count(f.users.auditorA)).toBeGreaterThan(0);
    expect(await count(f.users.icA)).toBe(0);
    const crossTenant = await ctx.t.asUser(f.users.ownerB, async (tx) =>
      (await tx.query('select 1 from audit_events where organization_id = $1', [f.orgA])).rows.length);
    expect(crossTenant).toBe(0);
  });
});
