import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hookEmails, verifyHookSignature, type HookPayload } from './auth-email-hook';

const key = Buffer.from('peoplecore-test-hook-secret-0123456789');
const secret = `v1,whsec_${key.toString('base64')}`;
const sign = (id: string, ts: number, body: string, k = key) => `v1,${createHmac('sha256', k).update(`${id}.${ts}.${body}`).digest('base64')}`;

describe('verifyHookSignature', () => {
  const body = '{"user":{}}';
  const now = 1_790_000_000_000;
  const ts = Math.floor(now / 1000);

  it('accepts a fresh request signed with the secret, also among several signatures', () => {
    expect(verifyHookSignature(secret, { id: 'msg_1', timestamp: String(ts), signature: sign('msg_1', ts, body) }, body, now)).toBe(true);
    const rotated = `v1,${Buffer.from('x'.repeat(32)).toString('base64')} ${sign('msg_1', ts, body)}`;
    expect(verifyHookSignature(secret, { id: 'msg_1', timestamp: String(ts), signature: rotated }, body, now)).toBe(true);
  });

  it('refuses another body, another secret, an old request and missing headers', () => {
    const h = { id: 'msg_1', timestamp: String(ts), signature: sign('msg_1', ts, body) };
    expect(verifyHookSignature(secret, h, '{"user":{"email":"x"}}', now)).toBe(false);
    expect(verifyHookSignature(secret, { ...h, signature: sign('msg_1', ts, body, Buffer.from('another-secret-0123456789abcdef')) }, body, now)).toBe(false);
    expect(verifyHookSignature(secret, { ...h, signature: sign('msg_1', ts - 400, body), timestamp: String(ts - 400) }, body, now)).toBe(false);
    expect(verifyHookSignature(secret, { ...h, signature: null }, body, now)).toBe(false);
    expect(verifyHookSignature('', h, body, now)).toBe(false);
  });
});

describe('hookEmails', () => {
  const ctx = { supabaseUrl: 'https://abc.supabase.example.test', appUrl: 'https://hr.example.test' };
  const payload = (type: string, extra: Partial<HookPayload['email_data']> = {}, user: Partial<HookPayload['user']> = {}): HookPayload => ({
    user: { email: 'asha@example.test', user_metadata: {}, ...user },
    email_data: { email_action_type: type, token: '123456', token_hash: 'pkce_abc', redirect_to: 'https://hr.example.test/auth/callback?next=%2Fset-password', ...extra },
  });

  it('invitations go to the app with the token hash, with the organization and who invited', () => {
    const [e] = hookEmails(payload('invite', { token_hash: 'hash1', redirect_to: 'https://hr.example.test/auth/callback?next=/app' },
      { user_metadata: { invited_to: 'Acme Ltd', invited_by: 'Ravi Kumar' } }), ctx);
    expect(e).toEqual({
      to: 'asha@example.test', key: 'invite', code: null,
      link: 'https://hr.example.test/auth/callback?next=%2Fapp&token_hash=hash1&type=invite',
      values: { email: 'asha@example.test', organization: 'Acme Ltd', inviter: 'Ravi Kumar' },
    });
    // Supabase fell back to its Site URL: the app's callback on that address.
    expect(hookEmails(payload('invite', { token_hash: 'h', redirect_to: 'https://hr.example.test' }), ctx)[0]!.link)
      .toBe('https://hr.example.test/auth/callback?next=%2Fapp&token_hash=h&type=invite');
    expect(hookEmails(payload('invite', { token_hash: 'h', redirect_to: null }), ctx)[0]!.link)
      .toBe('https://hr.example.test/auth/callback?next=%2Fapp&token_hash=h&type=invite');
    expect(hookEmails(payload('invite', { token_hash: 'h', redirect_to: 'javascript:alert(1)' }), ctx)[0]!.link).toMatch(/^https:\/\/hr\.example\.test\//);
  });

  it('password resets and sign-in links use Supabase’s verify link, as its own templates did', () => {
    const [reset] = hookEmails(payload('recovery'), ctx);
    expect(reset!.key).toBe('recovery');
    const u = new URL(reset!.link!);
    expect([u.origin, u.pathname, u.searchParams.get('token'), u.searchParams.get('type'), u.searchParams.get('redirect_to')])
      .toEqual(['https://abc.supabase.example.test', '/auth/v1/verify', 'pkce_abc', 'recovery', 'https://hr.example.test/auth/callback?next=%2Fset-password']);
    expect(hookEmails(payload('magiclink'), ctx)[0]).toMatchObject({ key: 'magiclink', values: { email: 'asha@example.test' } });
  });

  it('an email change goes to the new address and, when both must confirm, to the current one with its own token', () => {
    const out = hookEmails(payload('email_change', { token_hash: 'for-new', token_hash_new: 'for-current' }, { new_email: 'asha.rao@example.test' }), ctx);
    expect(out.map((e) => [e.to, new URL(e.link!).searchParams.get('token')])).toEqual([
      ['asha.rao@example.test', 'for-new'], ['asha@example.test', 'for-current'],
    ]);
    expect(out[0]!.values).toEqual({ email: 'asha@example.test', new_email: 'asha.rao@example.test' });
    expect(hookEmails(payload('email_change', { token_hash_new: null }, { new_email: 'n@example.test' }), ctx)).toHaveLength(1);
  });

  it('the confirmation code has no link; unknown or incomplete requests are refused', () => {
    expect(hookEmails(payload('reauthentication'), ctx)[0]).toMatchObject({ key: 'reauthentication', link: null, code: '123456' });
    expect(() => hookEmails(payload('something_new'), ctx)).toThrow('Unknown email type');
    expect(() => hookEmails(payload('recovery', { token_hash: null }), ctx)).toThrow('no token');
    expect(() => hookEmails(payload('recovery', {}, { email: null }), ctx)).toThrow('no address');
  });
});
