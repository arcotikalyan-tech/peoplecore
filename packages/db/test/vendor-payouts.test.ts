import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

/** Vendor payouts, the Dearness Allowance switch and social links (20261021000400). */
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

describe('vendor payouts', () => {
  it('payroll enters an invoice with TDS; someone else approves; the bank file has it; it is marked paid with the UTR', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const vendor = (await tx.query<{ id: string }>(`insert into vendors (organization_id, name, kind, pan, account_holder, account_number, ifsc, tds_section, tds_rate)
        values ($1, 'Example Studio', 'professional', 'ABCDE1234F', 'Example Studio', '123456789012', 'HDFC0001234', '194J', 10) returning id`, [f.orgA])).rows[0]!.id;
      const pay = (await tx.query<{ id: string }>(`select record_vendor_payment($1, $2, 'INV-7', current_date, 50000, 'Design work') as id`, [f.orgA, vendor])).rows[0]!.id;
      expect((await tx.query<{ tds: string; net: string }>('select tds_amount::int::text as tds, net_amount::int::text as net from vendor_payments where id = $1', [pay])).rows[0])
        .toEqual({ tds: '5000', net: '45000' });
      expect((await failure(tx, `select record_vendor_payment($1, $2, 'inv-7', current_date, 100)`, [f.orgA, vendor])).code).toBe('23505'); // same invoice twice
      expect((await failure(tx, 'select decide_vendor_payments($1, $2, true)', [f.orgA, [pay]])).message).toBe('Someone else must approve payments you entered.');

      await as(tx, f.users.ownerA);
      expect((await tx.query<{ n: number }>('select decide_vendor_payments($1, $2, true) as n', [f.orgA, [pay]])).rows[0]!.n).toBe(1);
      const advice = (await tx.query<{ account_number: string; amount: string }>('select account_number, amount::int::text as amount from vendor_bank_advice($1)', [f.orgA])).rows;
      expect(advice).toEqual([{ account_number: '123456789012', amount: '45000' }]);
      expect((await failure(tx, `select update_vendor_payments($1, $2, 'paid', 'UTR9')`, [f.orgA, [pay]])).message).toBe('Enter the payment date.');
      await tx.query(`select update_vendor_payments($1, $2, 'paid', 'UTR9', current_date)`, [f.orgA, [pay]]);
      expect((await tx.query<{ status: string; reference: string }>('select status, reference from vendor_payments where id = $1', [pay])).rows[0]).toEqual({ status: 'paid', reference: 'UTR9' });
      expect((await tx.query('select 1 from vendor_bank_advice($1)', [f.orgA])).rows).toHaveLength(0);

      await tx.exec('reset role');
      const audit = (await tx.query<{ changes: Record<string, unknown> }>(`select changes from audit_events where entity_type = 'vendors' and entity_id = $1`, [vendor])).rows[0]!;
      expect(JSON.stringify(audit.changes)).not.toContain('123456789012'); // the account number stays out of the audit trail
    });
  });

  it('HR sees no vendors until an owner gives them the Vendor payout admin role', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into vendors (organization_id, name) values ($1, 'Quiet Supplies')`, [f.orgA]);
      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from vendors')).rows).toHaveLength(0);
      expect((await failure(tx, 'select vendor_bank_advice($1)', [f.orgA])).code).toBe('42501');
      await tx.exec('reset role');
      await tx.query(`insert into member_roles (organization_id, member_id, role_id)
        select $1, m.id, r.id from organization_members m, roles r where m.user_id = $2 and m.organization_id = $1 and r.organization_id = $1 and r.key = 'vendor_admin'`, [f.orgA, f.users.hrA]);
      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from vendors')).rows).toHaveLength(1);
    });
    expect(await pgError(ctx.t.asUser(f.users.icA, (tx) => tx.query(`select record_vendor_payment($1, gen_random_uuid(), 'X', current_date, 1)`, [f.orgA])))).toBe('42501');
  });
});

describe('Dearness Allowance', () => {
  it('switching DA on adds a PF-wage DA component; switching it off deactivates it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.payrollA, async (tx) => {
      const da = async () => (await tx.query<{ is_active: boolean; pf_wage: boolean }>(`select is_active, pf_wage from salary_components where organization_id = $1 and code = 'DA'`, [f.orgA])).rows[0];
      expect(await da()).toBeUndefined();
      await tx.query('update payroll_settings set da_enabled = true where organization_id = $1', [f.orgA]);
      expect(await da()).toEqual({ is_active: true, pf_wage: true });
      await tx.query('update payroll_settings set da_enabled = false where organization_id = $1', [f.orgA]);
      expect((await da())!.is_active).toBe(false);
    });
  });
});

describe('social links', () => {
  it('employees add their links; colleagues see them only when social info is switched on', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.peerA, async (tx) => {
      await tx.query(`insert into employee_personal (organization_id, employee_id, linkedin_url) values ($1, $2, 'https://www.linkedin.com/in/example')
                      on conflict (employee_id) do update set linkedin_url = excluded.linkedin_url`, [f.orgA, f.employees.peerA]);
      expect((await failure(tx, `update employee_personal set twitter_url = 'http://x.com/a' where employee_id = $1`, [f.employees.peerA])).code).toBe('23514');
      await as(tx, f.users.icA);
      const link = async () => (await tx.query<{ linkedin_url: string | null }>('select linkedin_url from people_directory($1) where id = $2', [f.orgA, f.employees.peerA])).rows[0]!.linkedin_url;
      expect(await link()).toBeNull();
      await as(tx, f.users.hrA);
      await tx.query('update directory_settings set show_social = true where organization_id = $1', [f.orgA]);
      await as(tx, f.users.icA);
      expect(await link()).toBe('https://www.linkedin.com/in/example');
    });
  });
});
