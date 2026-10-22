import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261022001000: passwords for every sign-in, members' sign-in status, and profile completeness. */
const ctx = useDatabase();

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

describe('account basics', () => {
  it('knows who still has to set a password, and shows member managers each member’s sign-in status', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      expect((await tx.query<{ n: boolean }>('select my_needs_password() as n')).rows[0]!.n).toBe(true);
      expect((await tx.query<{ b: { needs_password: boolean } }>(`select my_org_context('org-a') as b`)).rows[0]!.b.needs_password).toBe(true);
      // Invited: Supabase stores a random password nobody knows, so they still have to choose one.
      await tx.exec('reset role');
      await tx.query(`update auth.users set encrypted_password = '$2a$10$hash', invited_at = now() - interval '2 days' where id = $1`, [f.users.icA]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ n: boolean }>('select my_needs_password() as n')).rows[0]!.n).toBe(true);
      await tx.query('select mark_password_chosen()');
      expect((await tx.query<{ n: boolean }>('select my_needs_password() as n')).rows[0]!.n).toBe(false);
      expect((await tx.query('select * from member_sign_in_status($1)', [f.orgA])).rows).toHaveLength(0); // not a member manager

      await as(tx, f.users.ownerA);
      const rows = (await tx.query<{ user_id: string; email: string; has_password: boolean; invited_at: string | null; employee_name: string | null }>(
        'select user_id, email, has_password, invited_at, employee_name from member_sign_in_status($1)', [f.orgA])).rows;
      const ic = rows.find((r) => r.user_id === f.users.icA)!;
      expect(ic).toMatchObject({ email: 'ica@example.test', has_password: true, employee_name: 'Ishan Demo' });
      expect(ic.invited_at).not.toBeNull();
      expect(rows.find((r) => r.user_id === f.users.hrA)).toMatchObject({ has_password: false, employee_name: null });
      expect(rows.some((r) => r.user_id === f.users.ownerB)).toBe(false);
      await as(tx, f.users.ownerB);
      expect((await tx.query('select * from member_sign_in_status($1)', [f.orgA])).rows).toHaveLength(0);
    });
  });

  it('tells employees which parts of their profile are filled in, never the values', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const mine = async () => (await tx.query<{ c: Record<string, unknown> | null }>('select my_profile_completeness($1) as c', [f.orgA])).rows[0]!.c;
      expect(await mine()).toEqual({ employee_id: f.employees.icA, personal: false, blood_group: false, address: false, emergency: false, identity: false, bank: false });
      await tx.exec('reset role');
      await tx.query(`insert into employee_personal (organization_id, employee_id, date_of_birth, gender, personal_phone, blood_group, address_line1, city, postal_code)
        values ($1, $2, '1994-05-01', 'male', '+91 90000 00000', 'O+', '1 Example Road', 'Pune', '411001')
        on conflict (employee_id) do update set date_of_birth = excluded.date_of_birth, gender = excluded.gender, personal_phone = excluded.personal_phone,
          blood_group = excluded.blood_group, address_line1 = excluded.address_line1, city = excluded.city, postal_code = excluded.postal_code`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into emergency_contacts (organization_id, employee_id, name, relationship, phone) values ($1, $2, 'Asha Demo', 'Spouse', '+91 90000 00001')`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into restricted.employee_identity (organization_id, employee_id, pan) values ($1, $2, 'ABCDE1234F')`, [f.orgA, f.employees.icA]);
      await tx.query(`insert into restricted.employee_bank_accounts (organization_id, employee_id, account_holder_name, bank_name, account_number, ifsc)
        values ($1, $2, 'Ishan Demo', 'Example Bank', '123456789012', 'EXAM0001234')`, [f.orgA, f.employees.icA]);
      await as(tx, f.users.icA);
      expect(await mine()).toEqual({ employee_id: f.employees.icA, personal: true, blood_group: true, address: true, emergency: true, identity: true, bank: true });
      await as(tx, f.users.hrA); // no employee record of their own
      expect(await mine()).toBeNull();
    });
  });
});
