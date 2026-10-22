import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Location for geofenced check-ins on our own pages only; the selfie uses the file picker, which this doesn't govern.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' }, // the camera: check-in selfies
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const config: NextConfig = {
  // The server image (Dockerfile) runs Next's self-contained output; Vercel and `next start` use the default.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const, outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)) } : {}),
  transpilePackages: ['@peoplecore/shared', '@peoplecore/payroll', '@peoplecore/ai'],
  poweredByHeader: false,
  // Document uploads are capped at 5 MB (checked again on the server); leave room for the other form fields.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  // Dev-only badge. Its default bottom-left spot covers the sidebar's Sign out link; top-left only overlaps the logo.
  devIndicators: { position: 'top-left' },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
