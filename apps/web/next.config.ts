import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const config: NextConfig = {
  transpilePackages: ['@peoplecore/shared'],
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
