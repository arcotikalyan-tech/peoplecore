import type { NextRequest } from 'next/server';

/**
 * The address the visitor used, for redirects from route handlers. Behind a reverse proxy (the Hostinger server's
 * Caddy) `request.nextUrl.origin` is the server's own listening address (http://0.0.0.0:3000), so use the
 * forwarded host and scheme the proxy sets (Caddy overwrites any the client sent), falling back to Host.
 */
export function publicOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host');
  if (!host) return request.nextUrl.origin;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol.replace(/:$/, '');
  return `${proto}://${host}`;
}

/** The same for pages, from the request headers: there is no request URL to fall back on, so https unless local. */
export function publicOriginFromHeaders(headers: Headers): string | null {
  const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host');
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || (local ? 'http' : 'https');
  return `${proto}://${host}`;
}
