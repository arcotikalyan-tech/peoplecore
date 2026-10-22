import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('access requests from the website sign-up form', () => {
  it('anyone can ask, a repeat for the same email is ignored, and the visitor can read nothing', async () => {
    const { t } = ctx;
    const count = await t.asAnon(async (tx) => {
      const ask = (email: string) => tx.query(`select request_access('Acme Pvt Ltd', 'Asha Rao', $1, null, '26-100', 'We have 60 people')`, [email]);
      await ask('asha@acme.example.test');
      await ask('ASHA@acme.example.test');
      await tx.exec('reset role');
      return (await tx.query<{ n: number }>('select count(*)::int as n from access_requests')).rows[0]!.n;
    });
    expect(count).toBe(1);
    expect(await pgError(t.asAnon((tx) => tx.query(`select request_access('Acme', 'Asha', 'not-an-email')`)))).toBe('22023');
    expect(await pgError(t.asAnon((tx) => tx.query('select * from access_requests')))).toBe('42501');
  });

  it('only platform admins read requests, and they may change only the review fields', async () => {
    const { f, t } = ctx;
    await t.db.query(`insert into access_requests (company, contact_name, work_email) values ('Acme', 'Asha Rao', 'asha@acme.example.test')`);
    await t.db.query('insert into platform_admins (user_id) values ($1)', [f.users.outsider]);
    try {
      expect(await t.asUser(f.users.hrA, async (tx) => (await tx.query('select * from access_requests')).rows)).toEqual([]);
      const rows = await t.asUser(f.users.outsider, async (tx) => (await tx.query<{ work_email: string }>('select work_email from access_requests')).rows);
      expect(rows).toEqual([{ work_email: 'asha@acme.example.test' }]);
      const status = await t.asUser(f.users.outsider, async (tx) => {
        await tx.query(`update access_requests set status = 'contacted', reviewed_by = auth.uid(), reviewed_at = now()`);
        return (await tx.query<{ status: string }>('select status from access_requests')).rows[0]!.status;
      });
      expect(status).toBe('contacted');
      expect(await pgError(t.asUser(f.users.outsider, (tx) => tx.query(`update access_requests set company = 'X'`)))).toBe('42501');
    } finally {
      await t.db.query('delete from platform_admins where user_id = $1', [f.users.outsider]);
      await t.db.query('delete from access_requests');
      await t.db.query(`delete from email_outbox where event like 'signup%'`);
    }
  });

  it('emails the person who asked (once) and every platform admin; tenants never see these emails', async () => {
    const { f, t } = ctx;
    await t.db.query('insert into platform_admins (user_id) values ($1)', [f.users.outsider]);
    try {
      const rows = await t.asAnon(async (tx) => {
        const ask = (email: string) => tx.query(`select request_access('Acme Pvt Ltd', 'Asha Rao', $1, '+91 90000 00000', '26-100', 'We have 60 people')`, [email]);
        await ask('asha@acme.example.test');
        await ask('asha@acme.example.test'); // again: nothing more is sent
        await tx.exec('reset role');
        return (await tx.query<{ organization_id: string | null; user_id: string | null; to_email: string; event: string; subject: string; body: string; link: string | null }>(
          `select organization_id, user_id, to_email, event, subject, body, link from email_outbox where event like 'signup%' and created_at = now() order by event`)).rows;
      });
      const alert = rows.find((r) => r.event === 'signup_alert' && r.user_id === f.users.outsider)!;
      const received = rows.filter((r) => r.event === 'signup_received');
      expect(rows.filter((r) => r.event === 'signup_alert').length).toBe(Number((await t.db.query<{ n: string }>('select count(*) as n from platform_admins')).rows[0]!.n));
      expect(alert).toMatchObject({ organization_id: null, subject: 'New sign-up: Acme Pvt Ltd (26-100 people)', link: '/platform' });
      expect(alert.body).toContain('Email: asha@acme.example.test');
      expect(alert.body).toContain('Message: We have 60 people');
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ to_email: 'asha@acme.example.test', user_id: null, organization_id: null, subject: 'We’ve got your PeopleCore request', link: null });
      expect(received[0]!.body).toMatch(/^Hi Asha,\n\nThanks for asking for a PeopleCore workspace for Acme Pvt Ltd\./);
    } finally {
      await t.db.query('delete from platform_admins where user_id = $1', [f.users.outsider]);
    }
  });

  it('only sign-up emails may have no organization, and the worker sends them without a workspace', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      await expect(t.db.query(`insert into email_outbox (to_email, event, subject, body) values ('x@example.test', 'leave', 'S', 'B')`)).rejects.toMatchObject({ code: '23514' });
      await t.db.exec('rollback');
      await t.db.exec('begin');
      const id = (await t.db.query<{ id: string }>(`insert into email_outbox (to_email, event, subject, body, link) values ('ops@example.test', 'signup_alert', 'New sign-up', 'Body', '/platform') returning id`)).rows[0]!.id;
      const claimed = (await t.db.query<{ id: string; org_slug: string | null; org_name: string | null }>('select * from worker_claim_emails(10)')).rows;
      expect(claimed.find((c) => c.id === id)).toMatchObject({ org_slug: null, org_name: null });
      expect(await t.asUser(f.users.ownerA, async (tx) => (await tx.query('select 1 from email_outbox where organization_id is null')).rows)).toEqual([]);
    } finally {
      await t.db.exec('rollback');
    }
  });
});

