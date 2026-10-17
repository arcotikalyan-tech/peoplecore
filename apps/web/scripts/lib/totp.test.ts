import { describe, expect, it } from 'vitest';
import { base32Decode, totp } from './totp';

// RFC 6238 Appendix B (SHA-1): ASCII secret "12345678901234567890".
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('decodes base32', () => {
    expect(base32Decode(SECRET).toString('ascii')).toBe('12345678901234567890');
  });

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches the RFC 6238 vector at T=%i', (seconds, expected) => {
    expect(totp(SECRET, seconds * 1000, { digits: 8 })).toBe(expected);
  });

  it('produces 6-digit codes by default', () => {
    expect(totp(SECRET, 59_000)).toBe('287082');
  });
});
