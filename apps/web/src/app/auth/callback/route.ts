import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/safe-redirect';
import { createClient } from '@/server/supabase';

/** Completes email-link sign-in and invitations (PKCE `code`, or `token_hash` from custom email templates). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNextPath(url.searchParams.get('next'));
  const supabase = await createClient();

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  // Neither a PKCE code nor a token hash: the session (or Supabase's error) is in the URL fragment, which only the
  // browser can read. Browsers keep the fragment across this redirect.
  if (!code && !tokenHash) {
    if (url.searchParams.get('error')) return NextResponse.redirect(new URL('/login?error=link', url.origin));
    return NextResponse.redirect(new URL(`/auth/confirm?next=${encodeURIComponent(next)}`, url.origin));
  }

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error('missing type') };

  return NextResponse.redirect(new URL(error ? '/login?error=link' : next, url.origin));
}
