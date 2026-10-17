import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

const PAN = 'ABCPE1234F';

describe('personal details and emergency contacts', () => {
  const upsertPersonal = `insert into employee_personal (organization_id, employee_id, date_of_birth, personal_phone, city)
                          values ($1, $2, '1994-03-14', '+919800000001', 'Pune')
                          on conflict (employee_id) do update set date_of_birth = excluded.date_of_birth, city = excluded.city`;

  it('HR and the employee themselves can read and edit; colleagues, managers and auditors cannot read', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.query(upsertPersonal, [f.orgA, f.employees.icA]);
      await tx.query(`insert into emergency_contacts (organization_id, employee_id, name, relationship, phone) values ($1, $2, 'R. Demo', 'Parent', '+919800000002')`, [f.orgA, f.employees.icA]);
      await tx.exec('reset role');
      for (const [user, expected] of [[f.users.icA, 1], [f.users.peerA, 0], [f.users.managerA, 0], [f.users.auditorA, 0], [f.users.hrA, 1]] as const) {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
        await tx.exec('set local role authenticated');
        const personal = (await tx.query('select 1 from employee_personal where employee_id = $1', [f.employees.icA])).rows.length;
        const contacts = (await tx.query('select 1 from emergency_contacts where employee_id = $1', [f.employees.icA])).rows.length;
        expect([personal, contacts], user).toEqual([expected, expected]);
        await tx.exec('reset role');
      }
    });
  });

  it('employees can edit their own personal details but nobody else’s', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.icA, async (tx) => {
      await tx.query(upsertPersonal, [f.orgA, f.employees.icA]);
    });
    expect(await pgError(t.asUser(f.users.icA, (tx) => tx.query(upsertPersonal, [f.orgA, f.employees.peerA])))).toBe('42501');
  });

  it('audits changes to redacted fields without exposing their values (regression: edits touching only redacted fields used to be skipped)', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.query(upsertPersonal, [f.orgA, f.employees.icA]);
      await tx.query(`update employee_personal set date_of_birth = '1995-01-01' where employee_id = $1`, [f.employees.icA]);
      const { rows } = await tx.query<{ action: string; changes: Record<string, unknown>; metadata: Record<string, string> }>(
        `select action, changes, metadata from audit_events where entity_type = 'employee_personal' order by id desc limit 1`);
      expect(rows[0]).toMatchObject({ action: 'update', metadata: { employee_id: f.employees.icA } });
      expect(rows[0]!.changes).toEqual({ date_of_birth: { from: '[redacted]', to: '[redacted]' } });
    });
  });
});

describe('identity numbers', () => {
  const setIdentity = (pan = PAN) => `select set_employee_identity($1, p_pan => '${pan}', p_aadhaar_last4 => '9012', p_uan => '100123456789')`;

  it('cannot be read from the table, even by HR: the schema is not reachable', async () => {
    expect(await pgError(ctx.t.asUser(ctx.f.users.hrA, (tx) => tx.query('select * from restricted.employee_identity')))).toBe('42501');
  });

  it('HR sets them; summaries are masked; revealing is audited', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.query(setIdentity(), [f.employees.icA]);
      const summary = await tx.query<{ pan: string; aadhaar_last4: string; uan: string; can_edit: boolean }>(
        'select * from employee_identity_summary($1)', [f.employees.icA]);
      expect(summary.rows[0]).toMatchObject({ pan: '••••••234F', aadhaar_last4: '9012', uan: '••••••••6789', can_edit: true });

      const revealed = await tx.query<{ pan: string }>('select * from reveal_employee_identity($1)', [f.employees.icA]);
      expect(revealed.rows[0]!.pan).toBe(PAN);
      const audit = await tx.query<{ actor_user_id: string; entity_id: string }>(
        `select actor_user_id, entity_id from audit_events where action = 'reveal' and entity_type = 'employee_identity' order by id desc limit 1`);
      expect(audit.rows[0]).toEqual({ actor_user_id: f.users.hrA, entity_id: f.employees.icA });
      const stored = await tx.query<{ changes: Record<string, string> }>(
        `select changes from audit_events where entity_type = 'employee_identity' and action = 'insert' order by id desc limit 1`);
      expect(stored.rows[0]!.changes.pan).toBe('[redacted]');
    });
  });

  it('employees can see their own; colleagues and managers cannot; payroll can read but not edit', async () => {
    const { f, t } = ctx;
    await t.db.query(
      `insert into restricted.employee_identity (organization_id, employee_id, pan) values ($1, $2, $3)`, [f.orgA, f.employees.icA, PAN]);
    try {
      expect(await t.asUser(f.users.icA, async (tx) => (await tx.query<{ pan: string }>('select * from reveal_employee_identity($1)', [f.employees.icA])).rows[0]!.pan)).toBe(PAN);
      for (const user of [f.users.peerA, f.users.managerA, f.users.auditorA]) {
        expect(await pgError(t.asUser(user, (tx) => tx.query('select * from employee_identity_summary($1)', [f.employees.icA]))), user).toBe('42501');
      }
      expect(await t.asUser(f.users.payrollA, async (tx) => (await tx.query('select * from reveal_employee_identity($1)', [f.employees.icA])).rows.length)).toBe(1);
      expect(await pgError(t.asUser(f.users.payrollA, (tx) => tx.query(setIdentity(), [f.employees.icA])))).toBe('42501');
    } finally {
      await t.db.query('delete from restricted.employee_identity where employee_id = $1', [f.employees.icA]);
    }
  });

  it('rejects malformed numbers at the database too', async () => {
    expect(await pgError(ctx.t.asUser(ctx.f.users.hrA, (tx) => tx.query(setIdentity('NOTAPAN'), [ctx.f.employees.icA])))).toBe('23514');
  });

  it('HR without two-step verification cannot see them', async () => {
    expect(
      await pgError(ctx.t.asUser(ctx.f.users.hrA, (tx) => tx.query('select * from employee_identity_summary($1)', [ctx.f.employees.icA]), { aal: 'aal1' })),
    ).toBe('42501');
  });

  it('does not reveal whether an unknown employee exists', async () => {
    expect(
      await pgError(ctx.t.asUser(ctx.f.users.hrA, (tx) => tx.query('select * from employee_identity_summary($1)', ['00000000-0000-4000-8000-000000000000']))),
    ).toBe('42501');
  });
});

describe('bank accounts', () => {
  const setBank = (account: string) =>
    `select set_employee_bank_account($1, 'Ishan Demo', 'Demo Bank', '${account}', 'DEMB0001234', 'savings')`;

  it('payroll changes them; the previous account is archived, not deleted', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.payrollA, async (tx) => {
      await tx.query(setBank('001234567890'), [f.employees.icA]);
      await tx.query(setBank('009999888877'), [f.employees.icA]);
      const { rows } = await tx.query<{ account_number: string; previous_accounts: string; can_edit: boolean }>(
        'select * from employee_bank_summary($1)', [f.employees.icA]);
      expect(rows[0]).toMatchObject({ account_number: '••••••••8877', can_edit: true });
      expect(Number(rows[0]!.previous_accounts)).toBe(1);
    });
  });

  it('HR can neither see nor change bank accounts; the employee can see their own', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.hrA, (tx) => tx.query('select * from employee_bank_summary($1)', [f.employees.icA])))).toBe('42501');
    expect(await pgError(t.asUser(f.users.hrA, (tx) => tx.query(setBank('001234567890'), [f.employees.icA])))).toBe('42501');
    await t.db.query(
      `insert into restricted.employee_bank_accounts (organization_id, employee_id, account_holder_name, bank_name, account_number, ifsc)
       values ($1, $2, 'Ishan Demo', 'Demo Bank', '001234567890', 'DEMB0001234')`, [f.orgA, f.employees.icA]);
    try {
      const own = await t.asUser(f.users.icA, async (tx) => (await tx.query<{ account_number: string }>('select * from reveal_employee_bank_account($1)', [f.employees.icA])).rows);
      expect(own[0]!.account_number).toBe('001234567890');
      expect(await pgError(t.asUser(f.users.peerA, (tx) => tx.query('select * from reveal_employee_bank_account($1)', [f.employees.icA])))).toBe('42501');
    } finally {
      await t.db.query('delete from restricted.employee_bank_accounts where employee_id = $1', [f.employees.icA]);
    }
  });
});
