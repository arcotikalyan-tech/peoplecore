import { NextResponse, type NextRequest } from 'next/server';
import { accountEmail } from '@peoplecore/shared';
import { publicEnv } from '@/lib/env';
import { createAdminClient } from '@/server/admin';
import { hookEmails, verifyHookSignature, type HookPayload } from '@/server/auth-email-hook';
import { loadEmailTemplates } from '@/server/email-templates';
import { appUrl, EmailNotConfigured, sendEmail } from '@/server/mailer';

/**
 * Supabase Auth's send-email hook (Authentication › Hooks › Send Email, HTTPS): every invitation, password reset,
 * sign-in link, email change and confirmation code comes here instead of going out with Supabase's own templates, and
 * is sent in the layout and words platform admins set (Platform › Email templates). Requests must carry Supabase's
 * signature with SEND_EMAIL_HOOK_SECRET. See docs/runbooks/email.md.
 */

export const dynamic = 'force-dynamic';

/** Supabase waits five seconds for the hook; sending that takes longer finishes after the reply. */
const WAIT_MS = 4_000;
const MAX_BODY = 64 * 1024;

const fail = (status: number, message: string) => NextResponse.json({ error: { http_code: status, message } }, { status });

// Nothing to see here without a signed POST (and a GET lets tests compile the route before Supabase calls it).
export function GET() {
  return fail(405, 'Use POST.');
}

export async function POST(request: NextRequest) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) return fail(500, 'The send-email hook isn’t set up on the app server (SEND_EMAIL_HOOK_SECRET).');
  const body = await request.text();
  if (body.length > MAX_BODY) return fail(413, 'Too large.');
  const signed = verifyHookSignature(secret, {
    id: request.headers.get('webhook-id'),
    timestamp: request.headers.get('webhook-timestamp'),
    signature: request.headers.get('webhook-signature'),
  }, body);
  if (!signed) return fail(401, 'The signature doesn’t match.');

  let emails;
  try {
    emails = hookEmails(JSON.parse(body) as HookPayload, { supabaseUrl: publicEnv().url, appUrl: appUrl() });
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : 'Unreadable request.');
  }

  // AUTHORIZATION: only Supabase Auth holds the secret the signature was checked against. The service role only reads
  // the platform's email layout and templates (no tenant data).
  const templates = await loadEmailTemplates(createAdminClient());
  try {
    await Promise.all(emails.map((e) => {
      const message = accountEmail(e.key, templates.text(e.key), { ...e.values, brand: templates.layout.brandName }, { link: e.link, code: e.code });
      return sendEmail(e.to, templates.layout, message, { waitMs: WAIT_MS });
    }));
  } catch (err) {
    if (err instanceof EmailNotConfigured) return fail(500, err.message);
    console.error('email.auth_failed', err instanceof Error ? err.message : String(err));
    return fail(502, 'The mail server refused the email. Try again in a minute.');
  }
  return NextResponse.json({});
}
