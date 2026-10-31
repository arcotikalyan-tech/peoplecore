/**
 * Every email PeopleCore sends shares one layout, set by platform administrators for all organizations (Platform ›
 * Email templates): the brand, a logo, an accent colour and a footer. The account emails (invitation, password reset,
 * sign-in link, email change, confirmation code) also have editable text with {{variables}}; notification emails
 * (leave, payslips, helpdesk…) keep the message the app writes and are wrapped in the same layout.
 *
 * Runs the same in the web app (the Supabase send-email hook and the console preview) and in the worker.
 */

export interface EmailLayout {
  brandName: string;
  /** #rrggbb: the button and links. */
  accentColor: string;
  /** An https address for the logo; null uses the PeopleCore mark from the app. */
  logoUrl: string | null;
  /** The brand name next to the logo. */
  showBrandName: boolean;
  /** Under every email, e.g. what the product is. */
  footerText: string;
  supportEmail: string | null;
  /** The sender's postal address, one line. */
  address: string | null;
}

export const DEFAULT_EMAIL_LAYOUT: EmailLayout = {
  brandName: 'PeopleCore',
  accentColor: '#5652e8',
  logoUrl: null,
  showBrandName: true,
  footerText: 'PeopleCore is the HR workspace your organization uses for leave, attendance, payslips and more.',
  supportEmail: null,
  address: null,
};

/** The layout as stored (platform_email_layout; null columns use the defaults). */
export interface EmailLayoutRow {
  brand_name: string | null;
  accent_color: string | null;
  logo_url: string | null;
  show_brand_name: boolean | null;
  footer_text: string | null;
  support_email: string | null;
  address: string | null;
}

export function layoutFromRow(row: EmailLayoutRow | null | undefined): EmailLayout {
  const d = DEFAULT_EMAIL_LAYOUT;
  if (!row) return d;
  return {
    brandName: row.brand_name || d.brandName,
    accentColor: row.accent_color && HEX.test(row.accent_color) ? row.accent_color : d.accentColor,
    logoUrl: row.logo_url || null,
    showBrandName: row.show_brand_name ?? d.showBrandName,
    footerText: row.footer_text ?? d.footerText,
    supportEmail: row.support_email || null,
    address: row.address || null,
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** What's wrong with a layout an administrator typed, by field, or an empty object. */
export function layoutProblems(l: EmailLayout): Partial<Record<keyof EmailLayout, string>> {
  const p: Partial<Record<keyof EmailLayout, string>> = {};
  if (!l.brandName.trim() || l.brandName.length > 60) p.brandName = 'Use 1 to 60 characters.';
  if (!HEX.test(l.accentColor)) p.accentColor = 'Use a colour like #5652e8.';
  if (l.logoUrl && (!/^https:\/\/[^\s"'<>]+$/.test(l.logoUrl) || l.logoUrl.length > 500)) p.logoUrl = 'Use an https:// address of an image (PNG or JPEG).';
  if (l.footerText.length > 500) p.footerText = 'Use at most 500 characters.';
  if (l.supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.supportEmail)) p.supportEmail = 'Enter an email address.';
  if (l.address && l.address.length > 200) p.address = 'Use at most 200 characters.';
  return p;
}

// ─── Account emails ─────────────────────────────────────────────────────────

export const EMAIL_VARIABLES = {
  organization: 'The organization’s name',
  inviter: 'Who sent the invitation',
  email: 'The person’s email address',
  new_email: 'The new email address',
  code: 'The one-time code',
  brand: 'The brand name from the layout',
} as const;
export type EmailVariable = keyof typeof EMAIL_VARIABLES;

/** Shown when a value isn't known (an invitation sent before organizations were passed along, for example). */
const FALLBACKS: Record<EmailVariable, string> = {
  organization: 'your organization',
  inviter: 'Your HR team',
  email: 'your account',
  new_email: 'your new address',
  code: '',
  brand: DEFAULT_EMAIL_LAYOUT.brandName,
};

export interface AccountEmailText {
  subject: string;
  heading: string;
  /** Paragraphs separated by a blank line; **bold** is allowed. */
  body: string;
  /** The button's label; null for emails without a link. */
  button: string | null;
  /** Small print under the button. */
  note: string | null;
}

interface AccountEmailDefinition {
  label: string;
  when: string;
  variables: readonly EmailVariable[];
  /** Has a link (button); false for the code email. */
  link: boolean;
  defaults: AccountEmailText;
}

export const ACCOUNT_EMAILS = {
  invite: {
    label: 'Invitation',
    when: 'HR, an owner or a platform administrator gives someone a sign-in.',
    variables: ['organization', 'inviter', 'email', 'brand'],
    link: true,
    defaults: {
      subject: 'You’re invited to join {{organization}} on {{brand}}',
      heading: 'Join {{organization}} on {{brand}}',
      body: '{{inviter}} has invited you to {{brand}}, where {{organization}} manages leave, attendance, payslips and more.\n\nAccept the invitation to choose your password. After that, sign in any time with **{{email}}** and your password.',
      button: 'Accept invitation',
      note: 'This link works once. If it has expired, ask your HR team to send a new invitation. If you weren’t expecting this email, you can ignore it.',
    },
  },
  recovery: {
    label: 'Password reset',
    when: 'Someone uses “Forgot password?”, or an administrator sends a password setup link.',
    variables: ['email', 'brand'],
    link: true,
    defaults: {
      subject: 'Choose a new {{brand}} password',
      heading: 'Choose a new password',
      body: 'We got a request to set a new password for **{{email}}**. Use the button to choose one.',
      button: 'Choose a new password',
      note: 'This link works once and expires soon. If you didn’t ask for it, you can ignore this email: your password stays as it is.',
    },
  },
  magiclink: {
    label: 'Sign-in link',
    when: 'Someone chooses “Sign in with an email link” on the sign-in page.',
    variables: ['email', 'brand'],
    link: true,
    defaults: {
      subject: 'Your {{brand}} sign-in link',
      heading: 'Sign in to {{brand}}',
      body: 'Use the button to sign in as **{{email}}**. Open it on the same device and browser where you asked for it.',
      button: 'Sign in',
      note: 'This link works once and expires soon. If you didn’t ask for it, you can ignore this email.',
    },
  },
  email_change: {
    label: 'Email address change',
    when: 'Someone changes the email address they sign in with (sent to the old and the new address).',
    variables: ['email', 'new_email', 'brand'],
    link: true,
    defaults: {
      subject: 'Confirm your new {{brand}} email address',
      heading: 'Confirm your email address change',
      body: 'Your {{brand}} sign-in is changing from **{{email}}** to **{{new_email}}**. Use the button to confirm the change.',
      button: 'Confirm the change',
      note: 'If you didn’t ask for this, don’t confirm it, and tell your HR team.',
    },
  },
  reauthentication: {
    label: 'Confirmation code',
    when: 'Someone is asked to confirm it’s them before a sensitive change.',
    variables: ['code', 'email', 'brand'],
    link: false,
    defaults: {
      subject: 'Your {{brand}} confirmation code',
      heading: 'Confirm it’s you',
      body: 'Enter this code to confirm the change to **{{email}}**:',
      button: null,
      note: 'The code expires soon. Never share it: nobody from {{brand}} or your HR team will ask for it.',
    },
  },
} as const satisfies Record<string, AccountEmailDefinition>;

export type AccountEmailKey = keyof typeof ACCOUNT_EMAILS;
export const ACCOUNT_EMAIL_KEYS = Object.keys(ACCOUNT_EMAILS) as AccountEmailKey[];

export const isAccountEmailKey = (key: string): key is AccountEmailKey => Object.hasOwn(ACCOUNT_EMAILS, key);

export const TEMPLATE_LIMITS = { subject: 150, heading: 150, body: 4000, button: 40, note: 1000 } as const;

/** An edited template as stored (platform_email_templates; null columns use the defaults). */
export interface AccountEmailRow {
  key: string;
  subject: string | null;
  heading: string | null;
  body: string | null;
  button_label: string | null;
  note: string | null;
}

export function accountEmailText(key: AccountEmailKey, row: AccountEmailRow | null | undefined): AccountEmailText {
  const d: AccountEmailText = ACCOUNT_EMAILS[key].defaults;
  return {
    subject: row?.subject || d.subject,
    heading: row?.heading || d.heading,
    body: row?.body || d.body,
    button: ACCOUNT_EMAILS[key].link ? row?.button_label || d.button : null,
    note: row ? row.note : d.note,
  };
}

const VARIABLE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** What's wrong with edited text, by field: empty or too long fields, and {{variables}} this email doesn't have. */
export function templateProblems(key: AccountEmailKey, t: AccountEmailText): Partial<Record<keyof AccountEmailText, string>> {
  const allowed: readonly string[] = ACCOUNT_EMAILS[key].variables;
  const p: Partial<Record<keyof AccountEmailText, string>> = {};
  for (const field of ['subject', 'heading', 'body', 'button', 'note'] as const) {
    const value = t[field];
    if (value == null) continue;
    if (field !== 'note' && !value.trim()) p[field] = 'This can’t be empty.';
    else if (value.length > TEMPLATE_LIMITS[field]) p[field] = `Use at most ${TEMPLATE_LIMITS[field]} characters.`;
    else {
      const unknown = [...value.matchAll(VARIABLE)].map((m) => m[1]!).filter((v) => !allowed.includes(v));
      if (unknown.length) p[field] = `This email has no {{${unknown[0]}}}. Use ${allowed.map((v) => `{{${v}}}`).join(', ')}.`;
    }
  }
  return p;
}

export type EmailValues = Partial<Record<EmailVariable, string | null>>;

/** Puts the values into {{variables}}; unknown ones are left as written, missing ones use a fallback. */
export function fillVariables(text: string, values: EmailValues): string {
  return text.replace(VARIABLE, (whole, name: string) => {
    if (!Object.hasOwn(FALLBACKS, name)) return whole;
    const v = values[name as EmailVariable]?.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    return v || FALLBACKS[name as EmailVariable];
  });
}

/** An account email ready to render: the text with its values, plus the link or code. */
export function accountEmail(
  key: AccountEmailKey, text: AccountEmailText, values: EmailValues, extra: { link?: string | null; code?: string | null },
): EmailMessage {
  const fill = (s: string) => fillVariables(s, values);
  return {
    subject: fill(text.subject),
    heading: fill(text.heading),
    body: fill(text.body),
    button: ACCOUNT_EMAILS[key].link && extra.link && text.button ? { label: fill(text.button), url: extra.link } : null,
    code: extra.code ?? null,
    note: text.note ? fill(text.note) : null,
  };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

export interface EmailMessage {
  subject: string;
  heading: string;
  /** Plain text: paragraphs separated by a blank line, single line breaks kept, **bold**. */
  body: string;
  button?: { label: string; url: string } | null;
  /** A one-time code, shown large. */
  code?: string | null;
  note?: string | null;
  /** The organization it's from, above the heading. */
  organization?: string | null;
  /** Why the person gets this email. */
  reason?: string | null;
}

export interface RenderOptions {
  /** The app's address (no trailing slash), for the default logo. */
  appUrl?: string | null;
}

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black button text, whichever contrasts more with the colour. */
export function textOn(hex: string): '#ffffff' | '#111827' {
  const l = luminance(hex);
  return 1.05 / (l + 0.05) >= (l + 0.05) / (luminance('#111827') + 0.05) ? '#ffffff' : '#111827';
}

const stripBold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1');

/** One paragraph's HTML: escaped, **bold** made strong, single line breaks kept. */
function paragraphHtml(p: string): string {
  return escapeHtml(p).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#111827">$1</strong>').replace(/\r?\n/g, '<br>');
}

const paragraphs = (s: string) => s.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);

/** The email's HTML (tables and inline styles, which every mail app reads) and its plain-text twin. */
export function renderEmail(layout: EmailLayout, m: EmailMessage, opts: RenderOptions = {}): { subject: string; html: string; text: string } {
  const accent = HEX.test(layout.accentColor) ? layout.accentColor : DEFAULT_EMAIL_LAYOUT.accentColor;
  const logo = layout.logoUrl || (opts.appUrl ? `${opts.appUrl}/brand/peoplecore-mark.png` : null);
  const subject = m.subject.replace(/\s+/g, ' ').trim();
  const body = paragraphs(m.body);
  const preheader = stripBold(body[0] ?? m.heading).slice(0, 140);
  const contact = [layout.supportEmail ? `Questions? ${layout.supportEmail}` : null, layout.address].filter(Boolean) as string[];

  const brandCell = layout.showBrandName || !logo
    ? `<td style="vertical-align:middle;font:700 18px/1.2 ${FONT};color:#111827;letter-spacing:-0.2px">${escapeHtml(layout.brandName)}</td>` : '';
  const logoCell = logo
    ? `<td style="vertical-align:middle;padding-right:${brandCell ? 10 : 0}px"><img src="${escapeHtml(logo)}" alt="${brandCell ? '' : escapeHtml(layout.brandName)}" height="32" style="display:block;height:32px;width:auto;max-width:200px;border:0;outline:none"></td>` : '';

  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:0;background:#f3f4f6;-webkit-text-size-adjust:100%">',
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(preheader)}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6"><tr><td align="center" style="padding:32px 12px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">',
    `<tr><td style="padding:0 4px 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logoCell}${brandCell}</tr></table></td></tr>`,
    `<tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-top:4px solid ${accent};border-radius:12px;padding:32px 28px">`,
    m.organization ? `<p style="margin:0 0 8px;font:600 12px/1.4 ${FONT};color:#6b7280;text-transform:uppercase;letter-spacing:0.6px">${escapeHtml(m.organization)}</p>` : '',
    `<h1 style="margin:0 0 16px;font:700 22px/1.3 ${FONT};color:#111827">${escapeHtml(m.heading)}</h1>`,
    ...body.map((p) => `<p style="margin:0 0 16px;font:15px/1.6 ${FONT};color:#374151">${paragraphHtml(p)}</p>`),
    m.code
      ? `<p style="margin:8px 0 20px"><span style="display:inline-block;padding:12px 20px;border-radius:8px;background:#f3f4f6;border:1px solid #e5e7eb;font:700 26px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:6px;color:#111827">${escapeHtml(m.code)}</span></p>`
      : '',
    m.button
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr><td style="border-radius:8px;background:${accent}">`
        + `<a href="${escapeHtml(m.button.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font:600 15px/1.2 ${FONT};color:${textOn(accent)};text-decoration:none;border-radius:8px">${escapeHtml(m.button.label)}</a>`
        + '</td></tr></table>'
        + `<p style="margin:0 0 16px;font:13px/1.5 ${FONT};color:#6b7280">If the button doesn’t work, copy this link into your browser:<br>`
        + `<a href="${escapeHtml(m.button.url)}" target="_blank" style="color:${accent};word-break:break-all">${escapeHtml(m.button.url)}</a></p>`
      : '',
    m.note ? `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #f0f0f3;font:13px/1.5 ${FONT};color:#6b7280">${paragraphHtml(m.note)}</p>` : '',
    '</td></tr>',
    `<tr><td style="padding:20px 12px 0;text-align:center;font:12px/1.6 ${FONT};color:#6b7280">`,
    [m.reason, layout.footerText, contact.join(' · ')].filter(Boolean).map((s) => `<p style="margin:0 0 6px">${escapeHtml(s!)}</p>`).join(''),
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');

  const text = [
    m.organization ? `${m.organization}\n\n${m.heading}` : m.heading,
    ...body.map(stripBold),
    m.code ? m.code : null,
    m.button ? `${m.button.label}: ${m.button.url}` : null,
    m.note ? stripBold(m.note) : null,
    ['—', m.reason, layout.footerText, contact.join(' · ')].filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}

/** The sender: the address from EMAIL_FROM ("Name <address>" or just the address), named after the layout's brand. */
export function emailSender(envFrom: string, brandName: string): { name: string; address: string } {
  const address = (/<([^<>\s]+@[^<>\s]+)>/.exec(envFrom)?.[1] ?? envFrom).trim();
  return { name: brandName.replace(/["<>\r\n]/g, '').trim() || DEFAULT_EMAIL_LAYOUT.brandName, address };
}
