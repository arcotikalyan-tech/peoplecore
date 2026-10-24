import { describe, expect, it } from 'vitest';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('attendance anomaly detector', () => {
  it('flags impossible travel, a rough location and punches far outside the rule, once each', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update organizations set timezone = 'Asia/Kolkata' where id = $1`, [f.orgA]);
      await tx.query(`update shifts set start_time = '09:30', end_time = '18:30' where organization_id = $1 and is_default`, [f.orgA]);
      // Today in India: 09:40 in Bengaluru, then 10:10 in Mumbai (about 840 km in 30 minutes).
      const day = (await tx.query<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date - 1, 'YYYY-MM-DD') as d`)).rows[0]!.d;
      const punch = async (key: string, employee: string, time: string, lat: number | null, lon: number | null, accuracy = 20) =>
        (await tx.query<{ id: string }>(
          `insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key, latitude, longitude, accuracy_m)
           values ($1, $2, ($3 || ' ' || $4)::timestamp at time zone 'Asia/Kolkata', 'mobile', $5, $6, $7, $8) returning id`,
          [f.orgA, employee, day, time, key, lat, lon, accuracy])).rows[0]!.id;
      await punch('a1', f.employees.icA, '09:40', 12.9716, 77.5946);
      const mumbai = await punch('a2', f.employees.icA, '10:10', 19.076, 72.8777);
      const rough = await punch('b1', f.employees.peerA, '09:35', 12.97, 77.59, 4500);
      const night = await punch('b2', f.employees.peerA, '02:15', 12.97, 77.59);
      await punch('c1', f.employees.leadA, '09:31', 12.9716, 77.5946);
      await punch('c2', f.employees.leadA, '18:40', 12.9721, 77.5950); // a normal day: nothing to flag

      await tx.exec('set local role service_role');
      expect((await tx.query<{ r: Record<string, number> }>('select worker_attendance_anomalies() as r')).rows[0]!.r)
        .toEqual({ impossible_travel: 1, poor_location: 1, odd_hours: 1 });
      expect((await tx.query<{ r: Record<string, number> }>('select worker_attendance_anomalies() as r')).rows[0]!.r)
        .toEqual({ impossible_travel: 0, poor_location: 0, odd_hours: 0 }); // once each
      await tx.exec('reset role');
      const flags = (await tx.query<{ subject_id: string; rule: string; explanation: string }>(
        `select subject_id, rule, explanation from anomaly_flags where organization_id = $1 and rule in ('impossible_travel', 'poor_location', 'odd_hours') order by rule`, [f.orgA])).rows;
      expect(flags.map((x) => [x.rule, x.subject_id])).toEqual([['impossible_travel', mumbai], ['odd_hours', night], ['poor_location', rough]]);
      expect(flags[0]!.explanation).toMatch(/^8\d\d km from the previous punch in 30 minutes \(about 1\d\d\d km\/h\)/);
      expect(flags[1]!.explanation).toBe('Punched at 02:15, far outside the 09:30–18:30 attendance rule for the day.');
      expect(flags[2]!.explanation).toMatch(/^The phone gave its location only to within 4\.5 km/);

      await tx.exec('set local role authenticated');
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: f.users.icA, role: 'authenticated', aal: 'aal2' })]);
      await expect(tx.query('select worker_attendance_anomalies()')).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('attendance managers flag a punch’s photo with a note, once; others can’t', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const path = `${f.orgA}/${f.employees.icA}/0b9a3c52-1d4e-4f6a-9b8c-7d6e5f4a3b2c`;
      const punch = (await tx.query<{ id: string }>(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key, selfie_path)
        values ($1, $2, now(), 'mobile', 'photo-1', $3) returning id`, [f.orgA, f.employees.icA, path])).rows[0]!.id;
      const bare = (await tx.query<{ id: string }>(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key)
        values ($1, $2, now(), 'mobile', 'photo-2') returning id`, [f.orgA, f.employees.icA])).rows[0]!.id;
      const as = async (user: string) => {
        await tx.exec('reset role');
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
        await tx.exec('set local role authenticated');
      };
      const fails = async (sql: string, params: unknown[]) => {
        await tx.exec('savepoint s');
        try { await tx.query(sql, params); } catch (e) { await tx.exec('rollback to savepoint s'); return (e as { code?: string; message: string }); }
        throw new Error('expected to fail');
      };
      await as(f.users.icA);
      expect((await fails('select flag_punch_photo($1, $2)', [punch, 'Looks like a screen'])).code).toBe('42501');
      await as(f.users.hrA);
      expect((await fails('select flag_punch_photo($1, $2)', [bare, 'Looks like a screen'])).message).toBe('This punch has no photo.');
      expect((await fails('select flag_punch_photo($1, $2)', [punch, 'x'])).message).toBe('Say in a few words what looks wrong.');
      await tx.query('select flag_punch_photo($1, $2)', [punch, 'Looks like a photo of a screen.']);
      await tx.query('select flag_punch_photo($1, $2)', [punch, 'Again.']);
      await tx.exec('reset role');
      expect((await tx.query('select rule, explanation from anomaly_flags where subject_id = $1', [punch])).rows)
        .toEqual([{ rule: 'photo_check', explanation: 'Check-in photo: Looks like a photo of a screen.' }]);
    });
  });
});

