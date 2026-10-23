import { afterEach, describe, expect, it, vi } from 'vitest';
import { appVersion } from './version';

describe('the version shown in Account settings', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('names the commit the server built and when it went live, in the organization’s time zone', () => {
    vi.stubEnv('APP_VERSION', '522e5a3f6d46');
    vi.stubEnv('APP_DEPLOYED_AT', '2026-10-23T09:15:00Z');
    expect(appVersion('Asia/Kolkata')).toMatch(/^PeopleCore version 522e5a3 · updated 23 Oct 2026, 2:45\s?pm$/i);
  });

  it('falls back to Vercel’s commit, and says when it is a development build', () => {
    vi.stubEnv('APP_VERSION', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234');
    expect(appVersion('UTC')).toBe('PeopleCore version abcdef1');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    expect(appVersion('UTC')).toBe('PeopleCore · development build');
  });
});
