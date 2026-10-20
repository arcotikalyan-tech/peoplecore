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

async function failure(tx: Transaction, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await tx.exec('savepoint expect_failure');
  try {
    await tx.query(sql, params);
  } catch (err) {
    await tx.exec('rollback to savepoint expect_failure');
    return { code: (err as { code?: string }).code, message: (err as Error).message };
  }
  throw new Error(`expected to fail: ${sql}`);
}

describe('attendance rules enforced', () => {
  it('rotations pick the shift for the day; an explicit roster assignment wins', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const mk = async (name: string, start: string) => (await tx.query<{ id: string }>(
        `insert into shifts (organization_id, code, name, start_time, end_time) values ($1, upper($2), $2, $3, $4) returning id`, [f.orgA, name, start, '18:00'])).rows[0]!.id;
      const day = await mk('Day', '09:00');
      const night = await mk('Late', '14:00');
      const rot = (await tx.query<{ id: string }>(`insert into shift_rotations (organization_id, name, pattern, period_days, start_date) values ($1, 'Weekly swap', $2, 7, '2026-01-05') returning id`, [f.orgA, [day, night]])).rows[0]!.id;
      await tx.query(`insert into rotation_assignments (organization_id, employee_id, rotation_id, effective_from) values ($1, $2, $3, '2026-01-01')`, [f.orgA, f.employees.peerA, rot]);
      await tx.exec('reset role');
      const shift = async (d: string) => (await tx.query<{ name: string }>('select (app.shift_for($1, $2)).name as name', [f.employees.peerA, d])).rows[0]!.name;
      expect(await shift('2026-01-06')).toBe('Day');
      expect(await shift('2026-01-13')).toBe('Late');
      expect(await shift('2026-01-20')).toBe('Day');
      await tx.query(`insert into roster_assignments (organization_id, employee_id, shift_id, effective_from, effective_to) values ($1, $2, $3, '2026-01-13', '2026-01-13')`, [f.orgA, f.employees.peerA, day]);
      expect(await shift('2026-01-13')).toBe('Day');
      // A foreign shift can't be in a pattern.
      await as(tx, f.users.hrA);
      expect((await failure(tx, `insert into shift_rotations (organization_id, name, pattern, start_date) values ($1, 'Bad', $2, current_date)`, [f.orgA, [day, '00000000-0000-4000-8000-000000000000']])).code).toBe('23503');
    });
  });

  it('office network, geofence and selfie decide at check-in', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update shifts set verify_ip = true, verify_geofence = true, verify_selfie = true where organization_id = $1 and is_default`, [f.orgA]);
      await tx.query(`insert into attendance_settings (organization_id, allowed_ips) values ($1, '{203.0.113.10}') on conflict (organization_id) do update set allowed_ips = excluded.allowed_ips`, [f.orgA]);
      const loc = (await tx.query<{ id: string }>(`insert into locations (organization_id, code, name, latitude, longitude) values ($1, 'HQ', 'HQ', 12.97, 77.59) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query('update employees set location_id = $1 where id = $2', [loc, f.employees.icA]);
      await tx.query(`insert into geofences (organization_id, location_id, name, latitude, longitude, radius_m) values ($1, $2, 'HQ', 12.97, 77.59, 200)`, [f.orgA, loc]);
      const selfie = `${f.orgA}/${f.employees.icA}/00000000-0000-4000-8000-0000000000aa`;

      await as(tx, f.users.icA);
      const punch = (args: string) => `select record_punch('punch-${Math.random().toString(36).slice(2, 12)}', null, 'web', ${args}, p_org => $1)`;
      expect((await failure(tx, punch(`12.97, 77.59, 10, p_ip => '198.51.100.1', p_selfie_path => '${selfie}'`), [f.orgA])).message).toContain('office network');
      expect((await failure(tx, punch(`13.50, 77.59, 10, p_ip => '203.0.113.10', p_selfie_path => '${selfie}'`), [f.orgA])).message).toContain('outside the workplace');
      expect((await failure(tx, punch(`12.97, 77.59, 10, p_ip => '203.0.113.10'`), [f.orgA])).message).toContain('selfie');
      expect((await failure(tx, punch(`12.97, 77.59, 10, p_ip => '203.0.113.10', p_selfie_path => '${f.orgA}/${f.employees.peerA}/00000000-0000-4000-8000-0000000000aa'`), [f.orgA])).message).toContain('Invalid selfie');
      const ok = (await tx.query<{ id: string }>(`select record_punch('punch-okay-123', null, 'web', 12.97, 77.59, 10, p_ip => '203.0.113.10', p_selfie_path => $2, p_org => $1) as id`, [f.orgA, selfie])).rows[0]!.id;
      expect((await tx.query<{ s: string }>('select punch_selfie($1) as s', [ok])).rows[0]!.s).toBe(selfie);
      // Mobile has no selfie yet: the punch counts and is flagged for review.
      const mobile = (await tx.query<{ id: string }>(`select record_punch('punch-mobile-12', null, 'mobile', 12.97, 77.59, 10, p_org => $1) as id`, [f.orgA])).rows[0]!.id;
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from anomaly_flags where subject_id = $1 and rule = 'no_selfie'`, [mobile])).rows).toHaveLength(1);
      await as(tx, f.users.peerA);
      expect((await failure(tx, 'select punch_selfie($1)', [ok])).message).toContain('Not found');
    });
  });

  it('reminders go out once a day: missing check-out and late arrivals', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into attendance_settings (organization_id, late_punch_alert) values ($1, true) on conflict (organization_id) do update set late_punch_alert = true`, [f.orgA]);
      await tx.query(`insert into attendance_days (organization_id, employee_id, work_date, status, punch_count, late_minutes) values
        ($1, $2, app.org_today($1) - 1, 'present', 1, 0), ($1, $3, app.org_today($1), 'present', 1, 25)`, [f.orgA, f.employees.icA, f.employees.icA]);
      const first = (await tx.query<{ v: { missing_checkout: number; digests: number; late_alerts: number } }>('select worker_attendance_reminders() as v')).rows[0]!.v;
      const second = (await tx.query<{ v: Record<string, number> }>('select worker_attendance_reminders() as v')).rows[0]!.v;
      expect(second).toEqual({ missing_checkout: 0, digests: 0, late_alerts: 0 });
      // Whether anything went out depends on the local hour (10 am / 11 am); never twice on the same day.
      expect(first.missing_checkout).toBeLessThanOrEqual(1);
      expect(first.late_alerts).toBeLessThanOrEqual(1);
    });
  });
});
