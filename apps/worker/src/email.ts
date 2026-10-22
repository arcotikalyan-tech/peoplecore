import nodemailer, { type Transporter } from 'nodemailer';

/** One email the database queued (email_outbox, migration 20261022000200), as worker_claim_emails returns it. */
export interface OutgoingEmail {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  link: string | null;
  org_slug: string;
  org_name: string;
  /** The event it is about (absent from batches claimed before migration 20261022000800). */
  event?: string | null;
}

export interface Mailer {
  transport: Pick<Transporter, 'sendMail'>;
  from: string;
  appUrl: string | null;
}

/**
 * SMTP from SMTP_URL (smtp://user:password@host:587 or smtps://user:password@host:465), the sender from EMAIL_FROM and
 * links from APP_URL. Null when SMTP isn't configured: queued emails then wait (and expire after two days).
 */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  if (!env.SMTP_URL) return null;
  return {
    transport: nodemailer.createTransport(env.SMTP_URL),
    from: env.EMAIL_FROM || 'PeopleCore <no-reply@peoplecore.app>',
    appUrl: env.APP_URL ? env.APP_URL.replace(/\/+$/, '') : null,
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const FOOTER = 'You get this email because of your role. An administrator can change these emails in Settings › Notifications.';
const FOOTERS: Record<string, string> = {
  helpdesk_reply: 'You get this email because you’re on this helpdesk ticket. An administrator can change these emails in Settings › Notifications.',
};

/** The message for one queued email: plain text and a light HTML version, with a link into the app when known. */
export function compose(e: OutgoingEmail, m: Pick<Mailer, 'from' | 'appUrl'>) {
  const link = e.link && m.appUrl ? `${m.appUrl}/app/${encodeURIComponent(e.org_slug)}${e.link}` : null;
  const footer = (e.event && FOOTERS[e.event]) || FOOTER;
  const text = [e.body, link ? `Open in PeopleCore: ${link}` : null, `— ${e.org_name} on PeopleCore. ${footer}`].filter(Boolean).join('\n\n');
  const html = [
    `<p style="font:15px/1.5 system-ui,sans-serif;color:#111827">${escapeHtml(e.body).replace(/\r?\n/g, '<br>')}</p>`,
    link ? `<p><a href="${escapeHtml(link)}" style="font:14px system-ui,sans-serif;color:#4f46e5">Open in PeopleCore</a></p>` : '',
    `<p style="font:12px/1.5 system-ui,sans-serif;color:#6b7280">${escapeHtml(e.org_name)} on PeopleCore. ${escapeHtml(footer)}</p>`,
  ].join('');
  return { from: m.from, to: e.to_email, subject: e.subject, text, html };
}

/** Sends a batch; each email's outcome is reported back so it is marked sent, retried later or given up on. */
export async function sendBatch(
  emails: OutgoingEmail[], m: Mailer, report: (id: string, ok: boolean, error?: string) => Promise<void>,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const e of emails) {
    try {
      await m.transport.sendMail(compose(e, m));
      await report(e.id, true);
      sent++;
    } catch (err) {
      await report(e.id, false, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }
  return { sent, failed };
}
