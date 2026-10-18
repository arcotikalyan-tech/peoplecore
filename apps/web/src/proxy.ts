import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isProduction, isSupabaseConfigured, publicEnv } from '@/lib/env';

const PROTECTED = ['/app', '/platform', '/mfa'];

/**
 * Content Security Policy with a fresh nonce per request (threat model T14). Next.js reads the nonce from the
 * request's policy and puts it on its own scripts; 'strict-dynamic' lets those load the rest. Nothing else may
 * run script. Styles allow inline (React style attributes); the Supabase origin is allowed for API calls and
 * signed-URL images. Development adds 'unsafe-eval' for fast refresh.
 */
function contentSecurityPolicy(nonce: string): string {
  const supabase = isSupabaseConfigured() ? new URL(publicEnv().url).origin : '';
  const dev = !isProduction();
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabase}`.trim(),
    `font-src 'self' data:`,
    `connect-src 'self' ${supabase} ${supabase.replace(/^http/, 'ws')}`.trim(),
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`, // HTTPS itself is enforced by Strict-Transport-Security (next.config.ts)
  ].join('; ');
}

/**
 * Sets the security policy, refreshes the Supabase session cookie and redirects signed-out users away from
 * protected areas. The redirect is an optimistic check only; authorization is enforced by RLS and server-side checks.
 */
export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  // A new response that forwards the request, with whatever cookies the session refresh set on it.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('content-security-policy', csp);
    return NextResponse.next({ request: { headers } });
  };
  const secured = (response: NextResponse) => {
    response.headers.set('content-security-policy', csp);
    return response;
  };

  let response = forward();
  if (!isSupabaseConfigured()) return secured(response);

  const { url, publishableKey } = publicEnv();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  if (!data?.claims && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = `?next=${encodeURIComponent(path)}`;
    return secured(NextResponse.redirect(login));
  }
  return secured(response);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
