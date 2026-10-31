import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AccountEmailKey, EmailValues } from '@peoplecore/shared';

/**
 * Supabase Auth's send-email hook: instead of sending invitations, password resets and sign-in links itself, Auth
 * posts each one here (signed like a Standard Webhook) and PeopleCore sends it in the shared layout with the text
 * platform admins set. Pure parts only (signature, which emails, links), so they can be tested without a server.
 */

/** How old a signed request may be (Standard Webhooks recommends five minutes). */
const TOLERANCE_S = 5 * 60;

/**
 * Checks the webhook-id, webhook-timestamp and webhook-signature headers against the secret Supabase shows for the
 * hook ("v1,whsec_<base64>"). True only for a fresh request signed with that secret.
 */
export function verifyHookSignature(
  secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
  if (key.length < 16) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  // The header may carry several signatures ("v1,<base64> v1,<base64>") while a secret is being rotated.
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export interface HookPayload {
  user: { email?: string | null; new_email?: string | null; user_metadata?: Record<string, unknown> | null };
  email_data: {
    token?: string | null;
    token_hash?: string | null;
    token_new?: string | null;
    token_hash_new?: string | null;
    redirect_to?: string | null;
    email_action_type?: string | null;
  };
}

export interface HookEmail {
  to: string;
  key: AccountEmailKey;
  values: EmailValues;
  link: string | null;
  code: string | null;
}

/** Supabase's own link: it checks the token, then sends the browser to redirect_to (as its default templates do). */
function verifyLink(supabaseUrl: string, tokenHash: string, type: string, redirectTo: string | null | undefined): string {
  const u = new URL('/auth/v1/verify', supabaseUrl);
  u.searchParams.set('token', tokenHash);
  u.searchParams.set('type', type);
  if (redirectTo) u.searchParams.set('redirect_to', redirectTo);
  return u.toString();
}

/**
 * Invitations go straight to the app's /auth/callback with the token hash (Supabase's own link would put the session
 * in the URL fragment, which the server can't read). The address is the invitation's redirect, which Supabase has
 * already checked against its allowed URLs, or the app's own address.
 */
function inviteLink(tokenHash: string, redirectTo: string | null | undefined, appUrl: string | null): string | null {
  let origin: string | null = null;
  let next: string | null = null;
  try {
    const r = redirectTo ? new URL(redirectTo) : null;
    if (r && /^https?:$/.test(r.protocol)) {
      origin = r.origin;
      if (r.pathname === '/auth/callback') next = r.searchParams.get('next');
    }
  } catch {
    origin = null;
  }
  origin ??= appUrl ? new URL(appUrl).origin : null;
  if (!origin) return null;
  // The same shape as the earlier Supabase template: /auth/callback?token_hash=…&type=invite&next=…
  const link = new URL('/auth/callback', origin);
  link.searchParams.set('token_hash', tokenHash);
  link.searchParams.set('type', 'invite');
  link.searchParams.set('next', next || '/app');
  return link.toString();
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);

/**
 * The emails one hook call asks for. An email change sends two when Supabase wants both addresses to confirm: the
 * new address gets token_hash and the current one token_hash_new (Supabase's naming, kept for compatibility).
 * Throws for a request it can't serve, so Supabase reports the failure instead of pretending it was sent.
 */
export function hookEmails(p: HookPayload, ctx: { supabaseUrl: string; appUrl: string | null }): HookEmail[] {
  const d = p.email_data ?? {};
  const type = d.email_action_type ?? '';
  const email = p.user?.email?.trim() || null;
  const meta = p.user?.user_metadata ?? {};
  const need = (v: string | null | undefined, what: string) => {
    if (!v) throw new Error(`The ${type || 'email'} request has no ${what}.`);
    return v;
  };

  switch (type) {
    case 'invite': {
      const link = inviteLink(need(d.token_hash, 'token'), d.redirect_to, ctx.appUrl);
      return [{
        to: need(email, 'address'), key: 'invite', link: need(link, 'app address'), code: null,
        values: { email, organization: text(meta.invited_to), inviter: text(meta.invited_by) },
      }];
    }
    case 'recovery':
      return [{ to: need(email, 'address'), key: 'recovery', link: verifyLink(ctx.supabaseUrl, need(d.token_hash, 'token'), 'recovery', d.redirect_to), code: null, values: { email } }];
    case 'magiclink':
    case 'signup':
    case 'email':
      return [{ to: need(email, 'address'), key: 'magiclink', link: verifyLink(ctx.supabaseUrl, need(d.token_hash, 'token'), type, d.redirect_to), code: null, values: { email } }];
    case 'email_change': {
      const newEmail = need(p.user?.new_email?.trim(), 'new address');
      const values = { email, new_email: newEmail };
      const out: HookEmail[] = [{ to: newEmail, key: 'email_change', link: verifyLink(ctx.supabaseUrl, need(d.token_hash, 'token'), 'email_change', d.redirect_to), code: null, values }];
      if (d.token_hash_new && email) out.push({ to: email, key: 'email_change', link: verifyLink(ctx.supabaseUrl, d.token_hash_new, 'email_change', d.redirect_to), code: null, values });
      return out;
    }
    case 'reauthentication':
      return [{ to: need(email, 'address'), key: 'reauthentication', link: null, code: need(d.token, 'code'), values: { email, code: d.token } }];
    default:
      throw new Error(`Unknown email type “${type}”.`);
  }
}
