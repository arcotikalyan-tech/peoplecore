import { describe, expect, it } from 'vitest';
import { forgetWorkplace, rememberedPunches, rememberedWorkplace, rememberPunches, rememberWorkplace } from '../src/lib/offline-memory';

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => { m.set(k, v); },
    removeItem: async (k: string) => { m.delete(k); },
    raw: m,
  };
}

describe('what the phone remembers for a restart with no signal', () => {
  it('keeps each person’s workplace to themselves, until they sign out', async () => {
    const store = memoryStore();
    await rememberWorkplace(store, 'ana', { orgId: 'o1', employeeId: 'e1' });
    expect(await rememberedWorkplace(store, 'ana')).toEqual({ orgId: 'o1', employeeId: 'e1' });
    expect(await rememberedWorkplace(store, 'ben')).toBeNull();
    await forgetWorkplace(store, 'ana');
    expect(await rememberedWorkplace(store, 'ana')).toBeNull();
  });

  it('keeps today’s punches, and not yesterday’s', async () => {
    const store = memoryStore();
    const punches = [{ id: 'p1', punched_at: '2026-11-06T04:00:00Z', kind: 'in' }];
    await rememberPunches(store, 'e1', '2026-11-06', punches);
    expect(await rememberedPunches(store, 'e1', '2026-11-06')).toEqual(punches);
    expect(await rememberedPunches(store, 'e1', '2026-11-07')).toEqual([]);
    expect(await rememberedPunches(store, 'e2', '2026-11-06')).toEqual([]);
  });

  it('treats anything unreadable as nothing remembered', async () => {
    const store = memoryStore();
    store.raw.set('workplace.last.ana', '{not json');
    store.raw.set('today.punches.e1', '{"date":"2026-11-06","punches":"nope"}');
    expect(await rememberedWorkplace(store, 'ana')).toBeNull();
    expect(await rememberedPunches(store, 'e1', '2026-11-06')).toEqual([]);
    const broken = { ...store, getItem: async () => { throw new Error('storage'); } };
    expect(await rememberedWorkplace(broken, 'ana')).toBeNull();
  });
});
