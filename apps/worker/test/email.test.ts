import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { compose, mailerFromEnv, sendBatch, type OutgoingEmail } from '../src/email.ts';

const email: OutgoingEmail = {
  id: '00000000-0000-4000-8000-000000000001', to_email: 'hra@example.test', subject: 'Leave application: Ishan Demo, 2 days',
  body: 'Ishan Demo applied for Casual leave <2 days>.', link: '/leave', org_slug: 'demo-a', org_name: 'Demo Org A',
};

describe('emails', () => {
  it('is off until SMTP is configured; links need the app address', () => {
    expect(mailerFromEnv({})).toBeNull();
    const m = mailerFromEnv({ SMTP_URL: 'smtp://127.0.0.1:2525', EMAIL_FROM: 'PeopleCore <hr@example.test>', APP_URL: 'https://hr.example.test/' })!;
    expect([m.from, m.appUrl]).toEqual(['PeopleCore <hr@example.test>', 'https://hr.example.test']);
    const msg = compose(email, m);
    expect(msg).toMatchObject({ from: 'PeopleCore <hr@example.test>', to: 'hra@example.test', subject: email.subject });
    expect(msg.text).toContain('Open in PeopleCore: https://hr.example.test/app/demo-a/leave');
    expect(msg.html).toContain('Casual leave &lt;2 days&gt;.');
    expect(compose(email, { from: m.from, appUrl: null }).text).not.toContain('Open in PeopleCore');
  });

  it('says why it was sent, and keeps line breaks in the HTML', () => {
    const reply = compose({ ...email, event: 'helpdesk_reply', body: 'Pia Demo replied on ticket #4 “VPN”:\n\nPlease update to 5.2.' }, { from: 'a@example.test', appUrl: null });
    expect(reply.text).toContain('because you’re on this helpdesk ticket');
    expect(reply.html).toContain('“VPN”:<br><br>Please update to 5.2.');
    expect(compose(email, { from: 'a@example.test', appUrl: null }).text).toContain('because of your role');
  });

  it('reports each email as sent or failed', async () => {
    const outcomes: Array<[string, boolean, string | undefined]> = [];
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const flaky = { sendMail: async (msg: Parameters<typeof transport.sendMail>[0]) => {
      if (msg.to === 'bad@example.test') throw new Error('Mailbox unavailable');
      return transport.sendMail(msg);
    } };
    const r = await sendBatch([email, { ...email, id: 'x', to_email: 'bad@example.test' }], { transport: flaky, from: 'a@example.test', appUrl: null },
      async (id, ok, error) => { outcomes.push([id, ok, error]); });
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(outcomes).toEqual([[email.id, true, undefined], ['x', false, 'Mailbox unavailable']]);
  });
});
