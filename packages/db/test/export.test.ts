import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

const log = (org: string, rows = 3) => `select log_employee_export('${org}', '{"status":"active"}', ${rows}) as id`;

describe('log_employee_export', () => {
  it('records who exported what, for roles with employee.export', async () => {
    const { f } = ctx;
    for (const user of [f.users.hrA, f.users.ownerA, f.users.payrollA, f.users.auditorA]) {
      await ctx.t.asUser(user, async (tx) => {
        const { rows } = await tx.query<{ id: number }>(log(f.orgA));
        await tx.exec('reset role'); // read the audit log as the database owner
        const ev = await tx.query<{ actor: string; action: string; entity_type: string; metadata: unknown }>(
          'select actor_user_id as actor, action, entity_type, metadata from audit_events where id = $1', [rows[0]!.id]);
        expect(ev.rows[0]).toEqual({
          actor: user, action: 'export', entity_type: 'employees',
          metadata: { format: 'csv', row_count: 3, filters: { status: 'active' } },
        });
      });
    }
  });

  it('refuses managers, employees, recruiters, other organizations and password-only HR', async () => {
    const { f } = ctx;
    for (const user of [f.users.managerA, f.users.icA, f.users.recruiterA, f.users.ownerB]) {
      expect(await pgError(ctx.t.asUser(user, (tx) => tx.query(log(f.orgA))))).toBe('42501');
    }
    expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) => tx.query(log(f.orgA)), { aal: 'aal1' }))).toBe('42501');
  });

  it('rejects a negative row count', async () => {
    expect(await pgError(ctx.t.asUser(ctx.f.users.hrA, (tx) => tx.query(log(ctx.f.orgA, -1))))).toBe('22023');
  });
});
