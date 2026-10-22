import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

/**
 * Migration 20261022000200 (Kredily second pass, batch 3): the HR executive, finance administrator, partner and
 * attendance device admin roles; email notifications per event and audience, the outbox and its delivery states;
 * company proofs; A1/A2 blood groups, transgender and previous experience on profiles; Event leave, nudges and the
 * leave-year preview.
 */
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

/** A member of org A with only the given role (fresh user). */
async function memberWith(tx: Transaction, role: string): Promise<string> {
  const { f, t } = ctx;
  await tx.exec('reset role');
  const user = (await tx.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`${role}.${Math.random().toString(36).slice(2, 7)}@example.test`])).rows[0]!.id;
  const member = (await tx.query<{ id: string }>(`insert into organization_members (organization_id, user_id, status) values ($1, $2, 'active') returning id`, [f.orgA, user])).rows[0]!.id;
  await tx.query(`insert into member_roles (organization_id, member_id, role_id) select $1, $2, id from roles where organization_id = $1 and key = $3`, [f.orgA, member, role]);
  void t;
  return user;
}

const perm = (tx: Transaction, permission: string) =>
  tx.query<{ ok: boolean }>('select app.has_permission($1, $2) as ok', [ctx.f.orgA, permission]).then((r) => r.rows[0]!.ok);

describe('standard roles', () => {
  it('every organization has the four new roles; payroll is the maker and finance the checker', async () => {
    const { f } = ctx;
    const roles = (await ctx.t.db.query<{ key: string; name: string; requires_mfa: boolean }>(
      `select key, name, requires_mfa from roles where organization_id = $1 and key in ('hr_executive', 'finance_admin', 'partner', 'attendance_device_admin', 'payroll_admin') order by key`, [f.orgB])).rows;
    expect(roles).toEqual([
      { key: 'attendance_device_admin', name: 'Attendance device admin', requires_mfa: true },
      { key: 'finance_admin', name: 'Finance administrator', requires_mfa: true },
      { key: 'hr_executive', name: 'HR executive', requires_mfa: true },
      { key: 'partner', name: 'Partner (read-only)', requires_mfa: true },
      { key: 'payroll_admin', name: 'Payroll administrator', requires_mfa: true },
    ]);
  });

  it('an HR executive keeps employee records without payroll; finance approves payroll and sees bank details', async () => {
    await ctx.t.asUser(ctx.f.users.hrA, async (tx) => {
      const hrx = await memberWith(tx, 'hr_executive');
      const fin = await memberWith(tx, 'finance_admin');
      await as(tx, hrx);
      expect([await perm(tx, 'employee.create'), await perm(tx, 'onboarding.manage'), await perm(tx, 'compensation.read'), await perm(tx, 'payroll.prepare'),
        await perm(tx, 'employee.bank.read')]).toEqual([true, true, false, false, false]);
      expect((await tx.query('select 1 from compensation_records limit 1')).rows).toHaveLength(0);
      await as(tx, fin);
      expect([await perm(tx, 'payroll.approve'), await perm(tx, 'payroll.prepare'), await perm(tx, 'employee.bank.read'), await perm(tx, 'vendor.manage'),
        await perm(tx, 'employee.update')]).toEqual([true, false, true, true, false]);
      expect((await tx.query<{ ok: boolean }>('select app.is_payroll_staff($1) as ok', [ctx.f.orgA])).rows[0]!.ok).toBe(true);
    });
  });

  it('a partner only reads; a device admin registers devices and imports punches but changes no rules', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const partner = await memberWith(tx, 'partner');
      const devices = await memberWith(tx, 'attendance_device_admin');
      await as(tx, partner);
      expect([await perm(tx, 'employee.identity.read'), await perm(tx, 'compensation.read'), await perm(tx, 'employee.update'), await perm(tx, 'employee.export')])
        .toEqual([true, true, false, false]);
      expect((await tx.query('update employees set work_phone = $2 where id = $1', [f.employees.icA, '+91 90000 00000'])).affectedRows).toBe(0);
      await as(tx, devices);
      const dev = (await tx.query<{ id: string }>(`insert into biometric_devices (organization_id, serial_number, name) values ($1, 'KREDEYE-1', 'Front door') returning id`, [f.orgA])).rows[0]!.id;
      const r = (await tx.query<{ r: { inserted: number } }>(`select import_device_punches($1, $2) as r`,
        [dev, JSON.stringify([{ line: 2, employee_code: 'A-003', punched_at: '2026-01-05 09:31', record_id: '1' }])])).rows[0]!.r;
      expect(r.inserted).toBe(1);
      expect((await tx.query(`update shifts set grace_minutes = 30 where organization_id = $1`, [f.orgA])).affectedRows).toBe(0);
      expect((await failure(tx, `select run_attendance_penalties($1, current_date)`, [f.orgA])).code).toBe('42501');
    });
  });
});

describe('email notifications', () => {
  it('leave, regularization and expense applications email the chosen audiences, never the applicant', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into notification_email_rules (organization_id, event, audience) values
        ($1, 'leave', 'hr_admin'), ($1, 'leave', 'line_manager'), ($1, 'regularization', 'line_manager'), ($1, 'expense', 'owner')`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, `insert into notification_email_rules (organization_id, event, audience) values ($1, 'birthday', 'owner')`, [f.orgA])).code).toBe('42501');
      expect((await tx.query('select 1 from email_outbox')).rows).toHaveLength(0);

      await tx.exec('reset role');
      const cl = (await tx.query<{ id: string }>(`select id from leave_types where organization_id = $1 and code = 'CL'`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days) values ($1, $2, $3, current_date - 30, 'adjust', 5)`, [f.orgA, f.employees.icA, cl]);
      const monday = (await tx.query<{ d: string }>(`select to_char(d, 'YYYY-MM-DD') as d from generate_series(app.org_today($1) + 7, app.org_today($1) + 13, interval '1 day') d where extract(isodow from d) = 1`, [f.orgA])).rows[0]!.d;
      await as(tx, f.users.icA);
      await tx.query(`select apply_leave($1, $2, $3::date, $3::date + 1, false, false, 'Family function')`, [f.employees.icA, cl, monday]);
      await tx.query(`select request_regularization($1, app.org_today($2) - 2, '09:30', '18:30', 'Forgot to punch')`, [f.employees.icA, f.orgA]);
      await tx.exec('reset role');
      const claim = (await tx.query<{ id: string }>(`insert into expense_claims (organization_id, employee_id, title, status, total) values ($1, $2, 'Client visit', 'draft', 1250) returning id`, [f.orgA, f.employees.icA])).rows[0]!.id;
      await tx.query(`update expense_claims set status = 'pending', submitted_at = now() where id = $1`, [claim]);
      await tx.query(`update expense_claims set status = 'pending' where id = $1`, [claim]);  // no change: no second email

      const mail = (await tx.query<{ to_email: string; event: string; subject: string }>(`select to_email, event, subject from email_outbox where organization_id = $1 order by event, to_email`, [f.orgA])).rows;
      expect(mail.map((m) => [m.event, m.to_email])).toEqual([
        ['expense', 'ownera@example.test'], ['leave', 'hra@example.test'], ['leave', 'leada@example.test'], ['regularization', 'leada@example.test'],
      ]);
      expect(mail.find((m) => m.event === 'leave')!.subject).toBe('Leave application: Ishan Demo, 2 days of Casual leave');
      expect(mail.find((m) => m.event === 'expense')!.subject).toBe('Expense claim: Ishan Demo, ₹1250.00');
      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from email_outbox')).rows).toHaveLength(4);
    });
  });

  it('birthdays and work anniversaries go out once a day from 9 am', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into notification_email_rules (organization_id, event, audience) values ($1, 'birthday', 'hr_admin'), ($1, 'anniversary', 'owner')`, [f.orgA]);
      await tx.exec('reset role');
      await tx.query(`insert into employee_personal (organization_id, employee_id, date_of_birth)
                      values ($1, $2, make_date(1992, extract(month from app.org_today($1))::int, extract(day from app.org_today($1))::int))
                      on conflict (employee_id) do update set date_of_birth = excluded.date_of_birth`, [f.orgA, f.employees.peerA]);
      // Only Lalit has a work anniversary today (the others joined 400 days ago, never a whole number of years).
      await tx.query(`update employees set date_of_joining = app.org_today($1) - 400 where organization_id = $1`, [f.orgA]);
      await tx.query(`update employees set date_of_joining = (app.org_today($1) - interval '2 years')::date where id = $2`, [f.orgA, f.employees.leadA]);
      const at = (time: string) => `((app.org_today('${f.orgA}') + '${time}'::time)::timestamp at time zone 'Asia/Kolkata')`;
      expect((await tx.query<{ r: Record<string, number> }>(`select worker_celebration_emails(${at('08:30')}) as r`)).rows[0]!.r).toEqual({ birthday_emails: 0, anniversary_emails: 0 });
      expect((await tx.query<{ r: Record<string, number> }>(`select worker_celebration_emails(${at('09:30')}) as r`)).rows[0]!.r).toEqual({ birthday_emails: 1, anniversary_emails: 1 });
      expect((await tx.query<{ r: Record<string, number> }>(`select worker_celebration_emails(${at('11:00')}) as r`)).rows[0]!.r).toEqual({ birthday_emails: 0, anniversary_emails: 0 });
      const subjects = (await tx.query<{ subject: string }>(`select subject from email_outbox where organization_id = $1 and event in ('birthday', 'anniversary') order by event`, [f.orgA])).rows.map((r) => r.subject);
      expect(subjects).toEqual(['🎉 Lalit Demo completes 2 years at Demo Org A today', '🎂 Today is Pia Demo’s birthday']);
    });
  });

  it('the worker claims emails, records what happened, retries failures and lets old mail expire', async () => {
    const { f, t } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) => tx.query('select * from worker_claim_emails(1)')))).toBe('42501');
    await t.db.exec('begin');
    try {
      const add = (age: string) => t.db.query<{ id: string }>(`insert into email_outbox (organization_id, to_email, event, subject, body, created_at)
        values ($1, 'hra@example.test', 'leave', 'Test', 'Body', now() - $2::interval) returning id`, [f.orgA, age]).then((r) => r.rows[0]!.id);
      const fresh = await add('1 minute');
      const flaky = await add('2 minutes');
      const stale = await add('3 days');
      const claimed = (await t.db.query<{ id: string; org_slug: string }>('select * from worker_claim_emails(10)')).rows;
      expect(claimed.map((c) => c.id).sort()).toEqual([fresh, flaky].sort());
      expect(claimed[0]!.org_slug).toBe('demo-a');
      expect((await t.db.query('select * from worker_claim_emails(10)')).rows).toHaveLength(0);  // nothing left to take
      await t.db.query('select worker_email_result($1, true)', [fresh]);
      await t.db.query(`select worker_email_result($1, false, 'Connection refused')`, [flaky]);
      const status = async (id: string) => (await t.db.query<{ status: string; last_error: string | null }>('select status, last_error from email_outbox where id = $1', [id])).rows[0];
      expect(await status(fresh)).toEqual({ status: 'sent', last_error: null });
      expect(await status(flaky)).toEqual({ status: 'queued', last_error: 'Connection refused' });
      expect((await status(stale))!.status).toBe('expired');
      await t.db.query(`update email_outbox set attempts = 5, status = 'sending' where id = $1`, [flaky]);
      await t.db.query(`select worker_email_result($1, false, 'Mailbox full')`, [flaky]);
      expect((await status(flaky))!.status).toBe('failed');
    } finally {
      await t.db.exec('rollback');
    }
  });
});

describe('company proofs and profiles', () => {
  it('admins keep PAN, CIN and GST proofs under their own organization; auditors read them; others see nothing', async () => {
    const { f } = ctx;
    const path = (org: string) => `${org}/00000000-0000-4000-8000-${Math.floor(Math.random() * 1e12).toString().padStart(12, '0')}`;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into company_documents (organization_id, kind, file_name, storage_path, content_type, size_bytes) values ($1, 'pan', 'pan.pdf', $2, 'application/pdf', 1200)`, [f.orgA, path(f.orgA)]);
      expect((await failure(tx, `insert into company_documents (organization_id, kind, file_name, storage_path, content_type, size_bytes) values ($1, 'gst', 'gst.pdf', $2, 'application/pdf', 900)`, [f.orgA, path(f.orgB)])).code).toBe('23514');
      await as(tx, f.users.auditorA);
      expect((await tx.query('select kind from company_documents')).rows).toEqual([{ kind: 'pan' }]);
      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from company_documents')).rows).toHaveLength(0);
      expect((await failure(tx, `insert into company_documents (organization_id, kind, file_name, storage_path, content_type, size_bytes) values ($1, 'cin', 'cin.pdf', $2, 'application/pdf', 900)`, [f.orgA, path(f.orgA)])).code).toBe('42501');
    });
  });

  it('profiles take the A1/A2 blood groups, transgender and previous experience', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      await t.db.query(`insert into employee_personal (organization_id, employee_id, blood_group, gender) values ($1, $2, 'A1B+', 'transgender')
                        on conflict (employee_id) do update set blood_group = 'A1B+', gender = 'transgender'`, [f.orgA, f.employees.icA]);
      expect((await failure(t.db as unknown as Transaction, `update employee_personal set blood_group = 'C+' where employee_id = $1`, [f.employees.icA])).code).toBe('23514');
      await t.db.query('update employees set prior_experience_months = 38 where id = $1', [f.employees.icA]);
      expect((await failure(t.db as unknown as Transaction, 'update employees set prior_experience_months = -1 where id = $1', [f.employees.icA])).code).toBe('23514');
    } finally {
      await t.db.exec('rollback');
    }
  });
});

describe('leave', () => {
  it('new organizations get Event leave; HR nudges people with unused leave once a week and previews the year end', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      await tx.exec('reset role');
      const org = (await tx.query<{ id: string }>(`insert into organizations (name, slug, is_demo) values ('Fresh Co', 'fresh-co', true) returning id`)).rows[0]!.id;
      expect((await tx.query<{ code: string; category: string }>(`select code, category from leave_types where organization_id = $1 order by code`, [org])).rows)
        .toEqual([{ code: 'CL', category: 'casual' }, { code: 'EL', category: 'earned' }, { code: 'EVL', category: 'event' }, { code: 'LOP', category: 'lop' }, { code: 'SL', category: 'sick' }]);

      const el = (await tx.query<{ id: string }>(`select id from leave_types where organization_id = $1 and code = 'EL'`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into leave_ledger (organization_id, employee_id, leave_type_id, entry_date, kind, days) values ($1, $2, $3, app.org_today($1), 'adjust', 40), ($1, $4, $3, app.org_today($1), 'adjust', 2)`,
        [f.orgA, f.employees.peerA, el, f.employees.icA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select nudge_leave($1)', [f.orgA])).code).toBe('42501');
      await as(tx, f.users.hrA);
      expect((await tx.query<{ n: number }>('select nudge_leave($1) as n', [f.orgA])).rows[0]!.n).toBe(1);
      expect((await failure(tx, 'select nudge_leave($1)', [f.orgA])).message).toMatch(/^People were nudged on .+\. Nudge again after a week\.$/);
      const preview = (await tx.query<{ name: string; people: number; balance: string; carry: string; lapse: string }>(
        `select name, people, balance, carry, lapse from leave_year_end_preview($1) where name = 'Earned leave'`, [f.orgA])).rows[0]!;
      expect([preview.people, Number(preview.balance), Number(preview.carry), Number(preview.lapse)]).toEqual([2, 42, 32, 10]);
      await tx.exec('reset role');
      expect((await tx.query<{ title: string }>(`select title from notifications where user_id = $1 and kind = 'leave.nudge'`, [f.users.peerA])).rows)
        .toEqual([{ title: 'You have 40 days of leave to use' }]);
    });
  });
});
