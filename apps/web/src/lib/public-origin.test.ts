import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { publicOrigin } from './public-origin';

const req = (headers: Record<string, string>) => new NextRequest('http://0.0.0.0:3000/auth/callback', { headers });

describe('publicOrigin', () => {
  it('uses the host and scheme forwarded by the proxy, not the listening address', () => {
    expect(publicOrigin(req({ host: 'hrms.tazq.io', 'x-forwarded-host': 'hrms.tazq.io', 'x-forwarded-proto': 'https' }))).toBe('https://hrms.tazq.io');
  });
  it('falls back to the Host header, then to the request URL', () => {
    expect(publicOrigin(req({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(publicOrigin(new NextRequest('http://localhost:3000/x'))).toBe('http://localhost:3000');
  });
});
