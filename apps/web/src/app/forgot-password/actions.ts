'use server';

import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { publicEnv } from '@/lib/env';
import { publicOriginFromHeaders } from '@/lib/public-origin';

/**
 * Emails a link to choose a new password. The same answer whether or not the address has an account. The implicit
 * flow puts the session in the link itself, so it works on any device (a PKCE link only works in the browser that
 * asked for it); /auth/confirm finishes the sign-in and sends the person to /set-password.
 */
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ email: z.email() }).safeParse({ email: String(formData.get('email') ?? '').trim() });
  if (!parsed.success) return { ok: false, message: 'Enter a valid email address.', fieldErrors: { email: 'Enter a valid email address' }, values: { email: String(formData.get('email') ?? '') } };
  const h = await headers();
  const origin = h.get('origin') ?? publicOriginFromHeaders(h) ?? '';
  const { url, publishableKey } = publicEnv();
  const auth = createClient(url, publishableKey, { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false } }).auth;
  await auth.resetPasswordForEmail(parsed.data.email.toLowerCase(), { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/set-password?reason=reset')}` });
  return { ok: true, message: 'If that email has a PeopleCore account, a link to choose a new password is on its way. It works once and expires in an hour.' };
}
