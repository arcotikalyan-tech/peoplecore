import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../src/lib/punch-queue';
import { selfieRequired } from '../src/lib/selfie-rule';

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); } };
};

describe('whether a check-in needs a selfie', () => {
  it('follows the rule as it is now, so switching the selfie on takes effect at the next check-in', async () => {
    const store = memory();
    expect(await selfieRequired(store, 'emp', async () => false)).toBe(false);
    expect(await selfieRequired(store, 'emp', async () => true)).toBe(true);
    expect(await selfieRequired(store, 'emp', async () => false)).toBe(false);
  });

  it('uses the last answer when the server can’t be asked (offline, an error or too slow)', async () => {
    const store = memory();
    expect(await selfieRequired(store, 'emp', async () => null)).toBe(false); // never asked yet
    await selfieRequired(store, 'emp', async () => true);
    expect(await selfieRequired(store, 'emp', async () => null)).toBe(true);
    expect(await selfieRequired(store, 'emp', async () => { throw new Error('offline'); })).toBe(true);
    expect(await selfieRequired(store, 'emp', () => new Promise(() => {}), 20)).toBe(true);
    expect(await selfieRequired(store, 'other', async () => null)).toBe(false); // kept per person
  });
});
