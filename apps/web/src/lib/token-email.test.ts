import { describe, expect, it } from 'vitest';
import { emailInToken } from './token-email';

const token = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

describe('emailInToken', () => {
  it('reads the email from a sign-in token', () => {
    expect(emailInToken(token({ sub: '1', email: 'priya.sharma@example.test' }))).toBe('priya.sharma@example.test');
    expect(emailInToken(token({ email: 'जया@example.test' }))).toBe('जया@example.test');
  });

  it('is null for anything else', () => {
    expect(emailInToken('not-a-token')).toBeNull();
    expect(emailInToken('a.%%%.c')).toBeNull();
    expect(emailInToken(token({ sub: '1' }))).toBeNull();
    expect(emailInToken(token({ email: 5 }))).toBeNull();
  });
});
