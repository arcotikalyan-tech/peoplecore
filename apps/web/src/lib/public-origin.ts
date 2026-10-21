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
