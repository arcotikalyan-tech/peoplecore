import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_EMAIL_KEYS, ACCOUNT_EMAILS, accountEmail, accountEmailText, DEFAULT_EMAIL_LAYOUT, fillVariables, layoutFromRow,
  layoutProblems, renderEmail, templateProblems, textOn,
} from '../src/email.ts';

describe('account email templates', () => {
  it('every default uses only its own variables and fits the limits', () => {
    for (const key of ACCOUNT_EMAIL_KEYS) {
      expect(templateProblems(key, ACCOUNT_EMAILS[key].defaults), key).toEqual({});
      expect(ACCOUNT_EMAILS[key].defaults.button === null, key).toBe(!ACCOUNT_EMAILS[key].link);
    }
  });

  it('refuses variables an email does not have, and empty text', () => {
    const text = { ...ACCOUNT_EMAILS.recovery.defaults, subject: 'Reset for {{organization}}', heading: ' ' };
    const p = templateProblems('recovery', text);
    expect(p.subject).toContain('no {{organization}}');
    expect(p.subject).toContain('{{email}}, {{brand}}');
    expect(p.heading).toBe('This can’t be empty.');
    expect(templateProblems('recovery', { ...text, subject: 'x'.repeat(151), heading: 'H' }).subject).toBe('Use at most 150 characters.');
  });

  it('fills values, uses fallbacks for missing ones and leaves unknown names alone', () => {
    expect(fillVariables('Join {{ organization }} as {{email}} ({{nope}})', { organization: 'Acme\nLtd', email: null }))
      .toBe('Join Acme Ltd as your account ({{nope}})');
  });

  it('an edited row replaces the defaults; a cleared note means no note; the code email never has a button', () => {
    const row = { key: 'invite', subject: 'S', heading: 'H', body: 'B', button_label: 'Go', note: null };
    expect(accountEmailText('invite', row)).toEqual({ subject: 'S', heading: 'H', body: 'B', button: 'Go', note: null });
    expect(accountEmailText('invite', null)).toEqual(ACCOUNT_EMAILS.invite.defaults);
    expect(accountEmailText('reauthentication', { ...row, key: 'reauthentication' }).button).toBeNull();
  });
});

describe('layout', () => {
  it('null columns use the defaults; an empty footer stays empty', () => {
    expect(layoutFromRow(null)).toEqual(DEFAULT_EMAIL_LAYOUT);
    const l = layoutFromRow({ brand_name: 'Acme HR', accent_color: '#zzzzzz', logo_url: null, show_brand_name: null, footer_text: '', support_email: 'help@example.test', address: null });
    expect(l).toEqual({ ...DEFAULT_EMAIL_LAYOUT, brandName: 'Acme HR', footerText: '', supportEmail: 'help@example.test' });
  });

  it('checks what an administrator typed', () => {
    expect(layoutProblems(DEFAULT_EMAIL_LAYOUT)).toEqual({});
    expect(Object.keys(layoutProblems({ ...DEFAULT_EMAIL_LAYOUT, brandName: ' ', accentColor: 'blue', logoUrl: 'http://x.example.test/a.png', supportEmail: 'nope' })))
      .toEqual(['brandName', 'accentColor', 'logoUrl', 'supportEmail']);
    expect(layoutProblems({ ...DEFAULT_EMAIL_LAYOUT, logoUrl: 'https://x.example.test/a.png" onerror="x' }).logoUrl).toBeDefined();
  });

  it('picks readable button text', () => {
    expect(textOn('#5652e8')).toBe('#ffffff');
    expect(textOn('#ffd400')).toBe('#111827');
  });
});

describe('renderEmail', () => {
  const invite = accountEmail('invite', ACCOUNT_EMAILS.invite.defaults, { organization: 'Acme <Ltd>', inviter: 'Asha Rao', email: 'new@example.test', brand: 'PeopleCore' },
    { link: 'https://hr.example.test/auth/callback?token_hash=abc&type=invite&next=/app' });

  it('renders the invitation with the organization, a button and the link spelled out', () => {
    const r = renderEmail(DEFAULT_EMAIL_LAYOUT, invite, { appUrl: 'https://hr.example.test' });
    expect(r.subject).toBe('You’re invited to join Acme <Ltd> on PeopleCore');
    expect(r.html).toContain('Join Acme &lt;Ltd&gt; on PeopleCore</h1>');
    expect(r.html).toContain('Asha Rao has invited you');
    expect(r.html).toContain('<strong style="color:#111827">new@example.test</strong>');
    expect(r.html).toContain('href="https://hr.example.test/auth/callback?token_hash=abc&amp;type=invite&amp;next=/app"');
    expect(r.html).toContain('>Accept invitation</a>');
    expect(r.html).toContain('src="https://hr.example.test/brand/peoplecore-mark.png"');
    expect(r.html).not.toContain('<Ltd>');
    expect(r.text).toContain('Accept invitation: https://hr.example.test/auth/callback?token_hash=abc&type=invite&next=/app');
    expect(r.text).toContain('sign in any time with new@example.test and your password');
    expect(r.text).not.toContain('**');
  });

  it('uses the layout: a custom logo alone, the accent colour, the footer and contact line', () => {
    const layout = { ...DEFAULT_EMAIL_LAYOUT, brandName: 'Acme HR', accentColor: '#0a66f0', logoUrl: 'https://cdn.example.test/logo.png', showBrandName: false, footerText: 'Acme HR, for Acme staff.', supportEmail: 'help@example.test', address: '1 Main Rd, Pune' };
    const r = renderEmail(layout, { ...invite, reason: 'You get this email because of your role.' });
    expect(r.html).toContain('src="https://cdn.example.test/logo.png" alt="Acme HR"');
    expect(r.html).not.toContain('peoplecore-mark.png');
    expect(r.html).toContain('border-top:4px solid #0a66f0');
    expect(r.html).toContain('background:#0a66f0');
    expect(r.text).toContain('—\nYou get this email because of your role.\nAcme HR, for Acme staff.\nQuestions? help@example.test · 1 Main Rd, Pune');
  });

  it('without a logo or app address, shows the brand name; keeps paragraphs and line breaks of notifications', () => {
    const r = renderEmail(DEFAULT_EMAIL_LAYOUT, {
      subject: 'Leave approved\n', heading: 'Leave approved', body: 'Your leave was approved.\nEnjoy.\n\nComment: <ok>', organization: 'Demo Org A',
    });
    expect(r.subject).toBe('Leave approved');
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('>PeopleCore</td>');
    expect(r.html).toContain('Your leave was approved.<br>Enjoy.</p>');
    expect(r.html).toContain('Comment: &lt;ok&gt;</p>');
    expect(r.html).toContain('>Demo Org A</p>');
    expect(r.text.startsWith('Demo Org A\n\nLeave approved\n\nYour leave was approved.\nEnjoy.\n\nComment: <ok>')).toBe(true);
  });

  it('shows a code large and has no button for the code email', () => {
    const m = accountEmail('reauthentication', ACCOUNT_EMAILS.reauthentication.defaults, { email: 'a@example.test' }, { code: '123456', link: 'https://x.example.test' });
    expect(m.button).toBeNull();
    const r = renderEmail(DEFAULT_EMAIL_LAYOUT, m);
    expect(r.html).toContain('letter-spacing:6px;color:#111827">123456</span>');
    expect(r.text).toContain('\n\n123456\n\n');
  });
});
