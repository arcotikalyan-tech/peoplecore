import { describe, expect, it } from 'vitest';
import { within } from '../src/lib/timeout';

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
