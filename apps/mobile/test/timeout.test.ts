import { afterEach, describe, expect, it, vi } from 'vitest';
import { timedFetch, within } from '../src/lib/timeout';

describe('a call that may never answer', () => {
  it('gives the answer when it comes in time', async () => {
    expect(await within(Promise.resolve(7), 50, null)).toBe(7);
  });

  it('gives the fallback when it takes too long (a GPS fix indoors)', async () => {
    expect(await within(new Promise(() => {}), 20, 'late')).toBe('late');
  });

  it('gives the fallback when it fails', async () => {
    expect(await within(Promise.reject(new Error('no fix')), 50, 'failed')).toBe('failed');
  });
});

describe('a database request on a stalled connection', () => {
  const aborted = (signal?: AbortSignal | null) => new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
  // What a stalled network looks like: nothing ever arrives (or the answer stops halfway) until the request is aborted.
  const stubFetch = (answer: (init?: RequestInit) => Promise<unknown>) =>
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => answer(init));
  afterEach(() => { vi.unstubAllGlobals(); });

  it('answers as usual when the server answers', async () => {
    stubFetch(async () => new Response('ok'));
    expect(await (await timedFetch(1000)('https://example.test')).text()).toBe('ok');
  });

  it('gives up when the server never answers', async () => {
    stubFetch((init) => aborted(init?.signal));
    await expect(timedFetch(20)('https://example.test')).rejects.toThrow('aborted');
  });

  it('gives up when the answer stops halfway', async () => {
    stubFetch(async (init) => ({ text: () => aborted(init?.signal) }));
    const res = await timedFetch(20)('https://example.test');
    await expect(res.text()).rejects.toThrow('aborted');
  });

  it('still stops when the caller stops it, before or during the request', async () => {
    stubFetch((init) => (init?.signal?.aborted ? Promise.reject(new Error('aborted')) : aborted(init?.signal)));
    const during = new AbortController();
    const pending = timedFetch(10_000)('https://example.test', { signal: during.signal });
    during.abort();
    await expect(pending).rejects.toThrow('aborted');
    const before = new AbortController();
    before.abort();
    await expect(timedFetch(10_000)('https://example.test', { signal: before.signal })).rejects.toThrow('aborted');
  });
});
