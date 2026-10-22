import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261022001300: people are emailed when their request is decided, and when their payslip is ready (on by default). */
const ctx = useDatabase();

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

describe('emails to the person', () => {
  it('say a payslip is ready, with a link and never the figures', async () => {
    const { f, t } = ctx;
    await t.db.query(`select app.notify($1, $2, 'payroll.payslip', 'Your payslip for Oct 2026 is ready', null, '/payslips')`, [f.orgA, f.users.icA]);
    await t.db.query(`select app.notify($1, $2, 'leave.nudge', 'You have 4 days of leave to use')`, [f.orgA, f.users.icA]);
    const rows = (await t.db.query<{ user_id: string; subject: string; body: string; link: string }>(
      `select user_id, subject, body, link from email_outbox where event = 'payslip'`)).rows;
    expect(rows).toEqual([{ user_id: f.users.icA, subject: 'Your payslip for Oct 2026 is ready', body: 'Your payslip for Oct 2026 is ready. Open PeopleCore to see it or download the PDF.', link: '/payslips' }]);
    await t.db.query(`delete from email_outbox where event = 'payslip'`);
    await t.db.query(`delete from notifications where kind in ('payroll.payslip', 'leave.nudge') and user_id = $1`, [f.users.icA]);
  });

  it('tell the person their leave was approved or rejected, with the comment; nothing once switched off', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const types = Object.fromEntries((await tx.query<{ code: string; id: string }>('select code, id from leave_types where organization_id = $1', [f.orgA])).rows.map((r) => [r.code, r.id]));
      const monday = (await tx.query<{ d: string }>(
        `select to_char(t + ((8 - extract(isodow from t)::int) % 7), 'YYYY-MM-DD') as d from (select app.org_today($1) + 14 as t) x`, [f.orgA])).rows[0]!.d;
      const day = (offset: number) => {
        const d = new Date(`${monday}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + offset);
        return d.toISOString().slice(0, 10);
      };
      const emails = async () => (await tx.query<{ user_id: string; subject: string; body: string; link: string }>(
        `select user_id, subject, body, link from email_outbox where event = 'decision' order by created_at, subject`)).rows;
      expect((await tx.query(`select 1 from notification_email_rules where organization_id = $1 and event = 'decision' and audience = 'self' and enabled`, [f.orgA])).rows).toHaveLength(1);

      await as(tx, f.users.hrA);
      await tx.query(`select adjust_leave_balance($1, $2, 5, 'Opening balance', 'opening')`, [f.employees.icA, types.CL]);
      await as(tx, f.users.icA);
      const apply = async (start: string, end: string) => (await tx.query<{ id: string }>('select apply_leave($1, $2, $3, $4) as id', [f.employees.icA, types.CL, start, end])).rows[0]!.id;
      const approvalOf = async (id: string) => (await tx.query<{ a: string }>('select approval_request_id as a from leave_requests where id = $1', [id])).rows[0]!.a;
      const first = await apply(day(0), day(0));
      const second = await apply(day(1), day(2));
      const a1 = await approvalOf(first);
      const a2 = await approvalOf(second);

      await as(tx, f.users.leadA); // icA's manager
      await tx.query('select decide_approval($1, $2)', [a1, 'approve']);
      await tx.query('select decide_approval($1, $2, $3)', [a2, 'reject', 'Release week; please pick other days']);
      await tx.exec('reset role');
      const sent = await emails();
      expect(sent).toHaveLength(2);
      expect(sent.every((e) => e.user_id === f.users.icA && e.link === '/leave')).toBe(true);
      expect(sent.find((e) => e.subject.startsWith('Your leave was approved'))!.subject).toMatch(/^Your leave was approved: Casual leave \(\d{1,2} \w{3} \d{4}, 1 day\)$/);
      const rejected = sent.find((e) => e.subject.startsWith('Your leave was rejected'))!;
      expect(rejected.subject).toMatch(/2 days\)$/);
      expect(rejected.body).toMatch(/was rejected\.\n\nComment: Release week; please pick other days$/);

      await tx.query(`update notification_email_rules set enabled = false where organization_id = $1 and event = 'decision'`, [f.orgA]);
      await as(tx, f.users.icA);
      const third = await apply(day(3), day(3));
      const a3 = await approvalOf(third);
      await as(tx, f.users.leadA);
      await tx.query('select decide_approval($1, $2)', [a3, 'approve']);
      await tx.exec('reset role');
      expect(await emails()).toHaveLength(2);
    });
  });

  it('is on for new organizations too, and the person audience is for decisions and payslips only', async () => {
    const { t } = ctx;
    const org = (await t.db.query<{ id: string }>(`insert into organizations (name, slug) values ('Decide Co', 'decide-co') returning id`)).rows[0]!.id;
    try {
      expect((await t.db.query(`select event from notification_email_rules where organization_id = $1 and audience = 'self' and enabled order by event`, [org])).rows).toEqual([{ event: 'decision' }, { event: 'payslip' }]);
      await expect(t.db.query(`insert into notification_email_rules (organization_id, event, audience) values ($1, 'leave', 'self')`, [org])).rejects.toMatchObject({ code: '23514' });
    } finally {
      await t.db.query('delete from organizations where id = $1', [org]);
    }
  });
});
