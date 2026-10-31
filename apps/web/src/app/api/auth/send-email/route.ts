import { NextResponse, type NextRequest } from 'next/server';
import { accountEmail } from '@peoplecore/shared';
import { publicEnv } from '@/lib/env';
import { createAdminClient } from '@/server/admin';
import { hookEmails, verifyHookSignature, type HookPayload } from '@/server/auth-email-hook';
import { cachedEmailTemplates } from '@/server/email-templates';
import { appUrl, EmailNotConfigured, hookSecret, sendEmail } from '@/server/mailer';

/**
 * Supabase Auth's send-email hook (Authentication › Hooks › Send Email, HTTPS): every invitation, password reset,
 * sign-in link, email change and confirmation code comes here instead of going out with Supabase's own templates, and
 * is sent in the layout and words platform admins set (Platform › Email templates). Requests must carry Supabase's
 * signature with SEND_EMAIL_HOOK_SECRET. See docs/runbooks/email.md.
 */

export const dynamic = 'force-dynamic';

/**
 * Supabase waits five seconds from signing the request. If it gives up, it discards the link's token, so an email sent
 * after that would carry a dead link: past this budget the hook replies (and sending finishes in the background), and
 * with too little of it left it sends nothing and lets Supabase report the failure.
 */
const BUDGET_MS = 4_000;
const MIN_LEFT_MS = 700;
const MAX_BODY = 64 * 1024;

const fail = (status: number, message: string) => NextResponse.json({ error: { http_code: status, message } }, { status });

// Nothing to see here without a signed POST (and a GET lets tests compile the route before Supabase calls it).
export function GET() {
  return fail(405, 'Use POST.');
}

export async function POST(request: NextRequest) {
  const received = Date.now();
  // Time already spent before the handler ran (network, a busy server), from the signature's timestamp in whole seconds;
  // counted as at most three seconds so a server clock that runs a little ahead can't eat the whole budget.
  const before = Math.min(Math.max(received - Number(request.headers.get('webhook-timestamp')) * 1000, 0), 3_000) || 0;
  const signedAt = received - before;
  const secret = hookSecret();
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
  const templates = await cachedEmailTemplates(createAdminClient());
  const waitMs = BUDGET_MS - (Date.now() - signedAt);
  if (waitMs < MIN_LEFT_MS) {
    console.error('email.auth_too_slow', { ms: Date.now() - signedAt });
    return fail(504, 'The app took too long to answer. Try again.');
  }
  try {
    await Promise.all(emails.map((e) => {
      const message = accountEmail(e.key, templates.text(e.key), { ...e.values, brand: templates.layout.brandName }, { link: e.link, code: e.code });
      return sendEmail(e.to, templates.layout, message, { waitMs });
    }));
  } catch (err) {
    if (err instanceof EmailNotConfigured) return fail(500, err.message);
    console.error('email.auth_failed', err instanceof Error ? err.message : String(err));
    return fail(502, 'The mail server refused the email. Try again in a minute.');
  }
  return NextResponse.json({});
}
