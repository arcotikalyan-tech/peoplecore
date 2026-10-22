import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { publicOrigin, publicOriginFromHeaders } from './public-origin';

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

describe('publicOriginFromHeaders', () => {
  it('uses the forwarded host and scheme, assuming https except locally', () => {
    expect(publicOriginFromHeaders(new Headers({ host: '172.18.0.1:3200', 'x-forwarded-host': 'hrms.tazq.io', 'x-forwarded-proto': 'https' }))).toBe('https://hrms.tazq.io');
    expect(publicOriginFromHeaders(new Headers({ host: 'hr.example.test' }))).toBe('https://hr.example.test');
    expect(publicOriginFromHeaders(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(publicOriginFromHeaders(new Headers())).toBeNull();
  });
});
