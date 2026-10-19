import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

describe('people directory', () => {
  it('members see colleagues with only the fields the organization allows; org.manage changes that', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update employees set work_email = 'pia@example.test', work_phone = '+91 98450 00000' where id = $1`, [f.employees.peerA]);
      await as(tx, f.users.icA);
      const rows = (await tx.query<{ id: string; work_email: string | null; work_phone: string | null; tenure_years: string }>(
        'select id, work_email, work_phone, tenure_years from people_directory($1)', [f.orgA])).rows;
      const pia = rows.find((r) => r.id === f.employees.peerA)!;
      expect(pia.work_email).toBeNull();          // hidden by default
      expect(pia.work_phone).toBeNull();
      expect(Number(pia.tenure_years)).toBeGreaterThanOrEqual(0);
      expect((await tx.query('update directory_settings set show_email = true returning 1')).rows).toHaveLength(0); // not theirs to change
      await as(tx, f.users.hrA);
      await tx.query('update directory_settings set show_email = true where organization_id = $1', [f.orgA]);
      await as(tx, f.users.icA);
      const after = (await tx.query<{ work_email: string | null }>('select work_email from people_directory($1) where id = $2', [f.orgA, f.employees.peerA])).rows[0]!;
      expect(after.work_email).toBe('pia@example.test');
    });
    await ctx.t.asUser(f.users.employeeB, async (tx) => {
      expect((await tx.query('select 1 from people_directory($1)', [f.orgA])).rows).toHaveLength(0); // another organization
    });
  });

  it('HR confirms probation; employees can’t', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.icA, (tx) => tx.query('select confirm_probation($1, $2)', [f.orgA, [f.employees.icA]])))).toBe('42501');
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const n = (await tx.query<{ n: number }>('select confirm_probation($1, $2) as n', [f.orgA, [f.employees.icA, f.employees.peerA]])).rows[0]!.n;
      expect(n).toBe(2);
      expect((await tx.query<{ n: number }>('select confirm_probation($1, $2) as n', [f.orgA, [f.employees.icA]])).rows[0]!.n).toBe(0); // once
      const c = (await tx.query<{ confirmed_on: string | null }>('select confirmed_on::text from employees where id = $1', [f.employees.icA])).rows[0]!;
      expect(c.confirmed_on).not.toBeNull();
    });
  });
});

describe('profile gaps', () => {
  it('HR sees which identity details are on file as yes/no; bank presence only with bank access; employees get nothing', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const rows = (await tx.query<{ employee_id: string; has_pan: boolean; has_bank: boolean | null }>('select * from people_profile_gaps($1)', [f.orgA])).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.has_bank === null)).toBe(true); // HR has no bank access
      expect(Object.keys(rows[0]!).sort()).toEqual(['employee_id', 'has_aadhaar', 'has_bank', 'has_pan', 'has_uan']);
    });
    expect(await pgError(ctx.t.asUser(f.users.icA, (tx) => tx.query('select * from people_profile_gaps($1)', [f.orgA])))).toBe('42501');
  });
});
