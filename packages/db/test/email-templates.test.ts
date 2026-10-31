import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('email templates (one layout and the account emails, for every organization)', () => {
  it('only platform admins read or change them, and every change is audited', async () => {
    const { f, t } = ctx;
    // An owner of an organization is not a platform admin: nothing to read, nothing to change.
    expect(await t.asUser(f.users.ownerA, async (tx) => (await tx.query('select * from platform_email_layout')).rows)).toEqual([]);
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select platform_set_email_layout('Acme HR', null, null, null, null, null, null)`)))).toBe('42501');
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select platform_set_email_template('invite', 'S', 'H', 'B', 'Go', null)`)))).toBe('42501');
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select platform_reset_email_template('invite')`)))).toBe('42501');
    expect(await pgError(t.asAnon((tx) => tx.query('select * from platform_email_templates')))).toBe('42501');

    await t.db.query('insert into platform_admins (user_id) values ($1)', [f.users.outsider]);
    try {
      const layout = await t.asUser(f.users.outsider, async (tx) => {
        await tx.query(`select platform_set_email_layout(' Acme HR ', '#0A66F0', 'https://cdn.example.test/logo.png', false, '', 'Help@Example.test', null)`);
        return (await tx.query('select brand_name, accent_color, logo_url, show_brand_name, footer_text, support_email, address, updated_by from platform_email_layout')).rows[0];
      });
      expect(layout).toEqual({
        brand_name: 'Acme HR', accent_color: '#0a66f0', logo_url: 'https://cdn.example.test/logo.png', show_brand_name: false,
        footer_text: '', support_email: 'help@example.test', address: null, updated_by: f.users.outsider,
      });

      // Back to the defaults: every column null.
      const reset = await t.asUser(f.users.outsider, async (tx) => {
        await tx.query('select platform_set_email_layout(null, null, null, null, null, null, null)');
        return (await tx.query('select brand_name, accent_color, logo_url, show_brand_name, footer_text from platform_email_layout')).rows[0];
      });
      expect(reset).toEqual({ brand_name: null, accent_color: null, logo_url: null, show_brand_name: null, footer_text: null });

      // Bad values are refused by the table.
      const set = (args: string) => t.asUser(f.users.outsider, (tx) => tx.query(`select platform_set_email_layout(${args})`));
      expect(await pgError(set(`null, 'blue', null, null, null, null, null`))).toBe('23514');
      expect(await pgError(set(`null, null, 'http://insecure.example.test/logo.png', null, null, null, null`))).toBe('23514');
      expect(await pgError(set(`null, null, 'https://x.example.test/"onerror="x', null, null, null, null`))).toBe('23514');
      expect(await pgError(set(`null, null, null, null, null, 'not-an-email', null`))).toBe('23514');

      // Each asUser call is its own rolled-back transaction, so every step that builds on another shares one.
      const templates = await t.asUser(f.users.outsider, async (tx) => {
        const keys = async () => (await tx.query('select key, subject, button_label, note from platform_email_templates order by key')).rows;
        await tx.query(`select platform_set_email_template('invite', 'Join {{organization}}', 'Welcome', 'Hello {{email}}', 'Accept', '')`);
        await tx.query(`select platform_set_email_template('invite', 'Join {{organization}} today', 'Welcome', 'Hello {{email}}', 'Accept', 'Works once.')`);
        // The code email has no button, whatever is sent.
        await tx.query(`select platform_set_email_template('reauthentication', 'Code', 'Confirm', 'Your code:', 'Ignored', null)`);
        const edited = await keys();
        await tx.query(`select platform_reset_email_template('invite')`);
        await tx.query(`select platform_reset_email_template('invite')`); // nothing left to reset: not logged again
        const afterReset = await keys();
        await tx.exec('reset role');
        const audit = (await tx.query(
          `select action, entity_type, changes->>'key' as key, actor_user_id from audit_events
            where organization_id is null and entity_type like 'platform_email%' order by id`)).rows;
        return { edited, afterReset, audit };
      });
      expect(templates.edited).toEqual([
        { key: 'invite', subject: 'Join {{organization}} today', button_label: 'Accept', note: 'Works once.' },
        { key: 'reauthentication', subject: 'Code', button_label: null, note: null },
      ]);
      expect(templates.afterReset).toEqual([{ key: 'reauthentication', subject: 'Code', button_label: null, note: null }]);
      expect(templates.audit).toEqual([
        { action: 'update', entity_type: 'platform_email_template', key: 'invite', actor_user_id: f.users.outsider },
        { action: 'update', entity_type: 'platform_email_template', key: 'invite', actor_user_id: f.users.outsider },
        { action: 'update', entity_type: 'platform_email_template', key: 'reauthentication', actor_user_id: f.users.outsider },
        { action: 'delete', entity_type: 'platform_email_template', key: 'invite', actor_user_id: f.users.outsider },
      ]);
      expect(await pgError(t.asUser(f.users.outsider, (tx) => tx.query(`select platform_set_email_template('payslip', 'S', 'H', 'B', null, null)`)))).toBe('22023');
      expect(await pgError(t.asUser(f.users.outsider, (tx) => tx.query(`select platform_set_email_template('invite', ' ', 'H', 'B', null, null)`)))).toBe('23514');

      const layoutAudit = await t.asUser(f.users.outsider, async (tx) => {
        await tx.query(`select platform_set_email_layout('Acme HR', null, null, null, null, null, null)`);
        await tx.exec('reset role');
        return (await tx.query(`select action, changes->>'brand_name' as brand from audit_events where entity_type = 'platform_email_layout'`)).rows;
      });
      expect(layoutAudit).toEqual([{ action: 'update', brand: 'Acme HR' }]);
    } finally {
      await t.db.query('delete from platform_admins where user_id = $1', [f.users.outsider]);
    }
  });

  it('the service role (send-email hook, worker) reads them; signed-in users get no write access', async () => {
    const { t } = ctx;
    const rows = (await t.db.query<{ table: string; select: boolean; insert: boolean; update: boolean }>(
      `select t as table, has_table_privilege('service_role', 'public.' || t, 'select') as select,
              has_table_privilege('authenticated', 'public.' || t, 'insert') as insert,
              has_table_privilege('authenticated', 'public.' || t, 'update') as update
         from unnest(array['platform_email_layout', 'platform_email_templates']) t`)).rows;
    expect(rows).toEqual([
      { table: 'platform_email_layout', select: true, insert: false, update: false },
      { table: 'platform_email_templates', select: true, insert: false, update: false },
    ]);
  });
});
