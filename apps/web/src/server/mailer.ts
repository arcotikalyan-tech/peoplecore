import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { emailSender, renderEmail, type EmailLayout, type EmailMessage } from '@peoplecore/shared';

/**
 * Email from the web app (account emails through the Supabase send-email hook, and platform admins' test emails), over
 * the same SMTP mailbox as the worker: SMTP_URL, EMAIL_FROM and APP_URL in the server's .env (docs/runbooks/email.md).
 */

let cached: Transporter | null = null;

export class EmailNotConfigured extends Error {
  constructor() {
    super('Email isn’t set up on the app server (SMTP_URL).');
  }
}

function transport(): Transporter {
  const url = process.env.SMTP_URL;
  if (!url) throw new EmailNotConfigured();
  // Nodemailer would wait minutes for a stuck mail server by default.
  cached ??= nodemailer.createTransport({ url, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  return cached;
}

/** The app's public address (no trailing slash), for links and the logo; null when not set. */
export function appUrl(): string | null {
  return process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, '') : null;
}

export const isEmailConfigured = () => Boolean(process.env.SMTP_URL);

/**
 * Renders the message in the layout and sends it. With `waitMs`, stops waiting after that long and lets the send
 * finish in the background ('sending'): Supabase gives its hook five seconds and retries one that takes longer,
 * which would send the email twice.
 */
export async function sendEmail(to: string, layout: EmailLayout, message: EmailMessage, opts: { waitMs?: number } = {}): Promise<'sent' | 'sending'> {
  const r = renderEmail(layout, message, { appUrl: appUrl() });
  const sending = transport().sendMail({
    from: emailSender(process.env.EMAIL_FROM || 'PeopleCore <no-reply@peoplecore.app>', layout.brandName),
    to, subject: r.subject, text: r.text, html: r.html,
  });
  if (!opts.waitMs) {
    await sending;
    return 'sent';
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<'sending'>((resolve) => { timer = setTimeout(() => resolve('sending'), opts.waitMs); });
  const outcome = await Promise.race([sending.then(() => 'sent' as const), slow]).finally(() => clearTimeout(timer));
  if (outcome === 'sending') {
    sending.catch((err: unknown) => console.error('email.failed_after_reply', err instanceof Error ? err.message : String(err)));
  }
  return outcome;
}
