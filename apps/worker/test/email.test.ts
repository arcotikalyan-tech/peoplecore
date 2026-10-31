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
    expect(msg).toMatchObject({ from: { name: 'PeopleCore', address: 'hr@example.test' }, to: 'hra@example.test', subject: email.subject });
    expect(msg.text).toContain('Open in PeopleCore: https://hr.example.test/app/demo-a/leave');
    expect(msg.html).toContain('Casual leave &lt;2 days&gt;.');
    expect(msg.html).toContain('href="https://hr.example.test/app/demo-a/leave"');
    expect(msg.html).toContain('>Demo Org A</p>');
    expect(compose(email, { from: m.from, appUrl: null }).text).not.toContain('Open in PeopleCore');
  });

  it('says why it was sent, and keeps paragraphs in the HTML', () => {
    const reply = compose({ ...email, event: 'helpdesk_reply', body: 'Pia Demo replied on ticket #4 “VPN”:\n\nPlease update to 5.2.' }, { from: 'a@example.test', appUrl: null });
    expect(reply.text).toContain('because you’re on this helpdesk ticket');
    expect(reply.html).toMatch(/“VPN”:<\/p><p [^>]+>Please update to 5\.2\.<\/p>/);
    expect(compose(email, { from: 'a@example.test', appUrl: null }).text).toContain('because of your role');
    expect(compose({ ...email, event: 'decision' }, { from: 'a@example.test', appUrl: null }).text).toContain('because you made this request');
    expect(compose({ ...email, event: 'payslip' }, { from: 'a@example.test', appUrl: null }).text).toContain('because your payslip was published');
  });

  it('sends sign-up emails without a workspace, linking into the console', () => {
    const alert = compose({ ...email, org_slug: null, org_name: null, event: 'signup_alert', link: '/platform', body: 'Asha Rao asked for a workspace.' },
      { from: 'a@example.test', appUrl: 'https://hrms.example.test' });
    expect(alert.text).toContain('Open in PeopleCore: https://hrms.example.test/platform');
    expect(alert.text).toContain('—\nYou get this email because you’re a PeopleCore platform administrator.');
    expect(alert.html).not.toContain('null');
  });

  it('uses the layout platform admins set: brand, button, sender name and footer', () => {
    const layout = { brandName: 'Acme HR', accentColor: '#0a66f0', logoUrl: null, showBrandName: true, footerText: 'Acme HR for Acme staff.', supportEmail: null, address: null };
    const msg = compose(email, { from: 'PeopleCore <no-reply@example.test>', appUrl: 'https://hr.example.test', layout });
    expect(msg.from).toEqual({ name: 'Acme HR', address: 'no-reply@example.test' });
    expect(msg.text).toContain('Open in Acme HR: https://hr.example.test/app/demo-a/leave');
    expect(msg.text).toContain('Acme HR for Acme staff.');
    expect(msg.html).toContain('background:#0a66f0');
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
