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
    }
  });
});
