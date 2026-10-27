import { describe, expect, it } from 'vitest';
import { chunkedStore, type SecureStore } from '../src/lib/chunked-store';
import { classify, classifyHttp, PunchQueue, type KeyValueStore, type QueuedPunch, type SendResult } from '../src/lib/punch-queue';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); } };
};
const T0 = Date.parse('2026-10-18T03:30:00Z');
const punch = (clientId: string) => ({ clientId, orgId: 'org', latitude: 12.97, longitude: 77.59, accuracyM: 15 });

describe('offline punch queue', () => {
  it('keeps punches on the device until they are sent, in order, and sends each once', async () => {
    let now = T0;
    const q = new PunchQueue(memory(), () => now);
    await q.add(punch('a'));
    now += 9 * 3600_000;
    await q.add(punch('b'));
    expect((await q.pending()).map((p) => [p.clientId, p.punchedAt])).toEqual([['a', '2026-10-18T03:30:00.000Z'], ['b', '2026-10-18T12:30:00.000Z']]);

    const sent: string[] = [];
    expect(await q.sync(async (p) => { sent.push(p.clientId); return { ok: true }; })).toEqual({ sent: 2, refused: 0, waiting: 0 });
    expect(sent).toEqual(['a', 'b']);
    expect(await q.sync(async () => { throw new Error('nothing to send'); })).toEqual({ sent: 0, refused: 0, waiting: 0 });
  });

  it('on a shared phone, only the person who made a punch sees and sends it', async () => {
    const q = new PunchQueue(memory(), () => T0);
    await q.add({ ...punch('mine'), userId: 'ana' });
    await q.add({ ...punch('theirs'), userId: 'ben' });
    await q.add(punch('before-update')); // saved before punches were kept per person
    expect((await q.all('ben')).map((p) => p.clientId)).toEqual(['theirs', 'before-update']);
    const sent: string[] = [];
    expect(await q.sync(async (p) => { sent.push(p.clientId); return { ok: true }; }, 'ben')).toEqual({ sent: 2, refused: 0, waiting: 0 });
    expect(sent).toEqual(['theirs', 'before-update']);
    expect((await q.all()).map((p) => p.clientId)).toEqual(['mine']); // Ana's waits for Ana
  });

  it('a punch added while a sync is sending isn’t lost', async () => {
    const q = new PunchQueue(memory(), () => T0);
    await q.add(punch('a'));
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    const syncing = q.sync(async () => { await slow; return { ok: true }; });
    await q.add(punch('b')); // tapped Check out while 'a' was still on its way
    release();
    expect(await syncing).toEqual({ sent: 1, refused: 0, waiting: 1 });
    expect((await q.all()).map((p) => p.clientId)).toEqual(['b']);
  });

  it('stops at a network failure and retries later; keeps permanent refusals with their reason', async () => {
    const q = new PunchQueue(memory(), () => T0);
    for (const id of ['a', 'b', 'c']) await q.add(punch(id));
    const answers: Record<string, SendResult> = {
      a: { ok: false, permanent: true, message: 'You are outside every office geofence.' },
      b: { ok: false, permanent: false, message: 'No connection.' },
    };
    const calls: string[] = [];
    const send = async (p: QueuedPunch) => { calls.push(p.clientId); return answers[p.clientId] ?? { ok: true }; };
    expect(await q.sync(send)).toEqual({ sent: 0, refused: 1, waiting: 2, reason: 'No connection.' });
    expect(calls).toEqual(['a', 'b']); // c waits behind b
    expect((await q.all()).find((p) => p.clientId === 'a')?.refused).toBe('You are outside every office geofence.');

    delete answers.b; // back online
    calls.length = 0;
    expect(await q.sync(send)).toEqual({ sent: 2, refused: 0, waiting: 0 });
    expect(calls).toEqual(['b', 'c']); // the refused one isn't sent again
    await q.dismiss('a');
    expect(await q.all()).toEqual([]);
  });

  it('marks punches older than 72 hours as refused without sending them', async () => {
    let now = T0;
    const q = new PunchQueue(memory(), () => now);
    await q.add(punch('old'));
    now += 73 * 3600_000;
    let called = false;
    expect(await q.sync(async () => { called = true; return { ok: true }; })).toEqual({ sent: 0, refused: 1, waiting: 0 });
    expect(called).toBe(false);
    expect((await q.all())[0]?.refused).toMatch(/72 hours/);
  });

  it('survives a corrupted store', async () => {
    const store = memory();
    store.data.set('peoplecore.punches.v1', '{not json');
    expect(await new PunchQueue(store).all()).toEqual([]);
  });

  it('treats user-facing and permission errors as final, anything else as retryable', () => {
    expect(classify(null)).toEqual({ ok: true });
    expect(classify({ code: '22023', message: 'You are outside every office geofence.' })).toEqual({ ok: false, permanent: true, message: 'You are outside every office geofence.' });
    expect(classify({ code: '42501' })).toEqual({ ok: false, permanent: true, message: 'Not allowed.' });
    expect(classify({ message: 'TypeError: Network request failed' })).toEqual({ ok: false, permanent: false, message: 'No connection.' });
  });
});

describe('chunked secure store', () => {
  const fake = (): SecureStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItemAsync: async (k) => data.get(k) ?? null,
      setItemAsync: async (k, v) => { if (v.length > 2048) throw new Error('too big'); if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error('bad key'); data.set(k, v); },
      deleteItemAsync: async (k) => { data.delete(k); },
    };
  };

  it('stores values larger than one keychain item, and shrinks cleanly', async () => {
    const secure = fake();
    const store = chunkedStore(secure);
    const big = 'x'.repeat(5000);
    await store.setItem('sb-abc-auth-token', big);
    expect(await store.getItem('sb-abc-auth-token')).toBe(big);
    expect(secure.data.size).toBe(4); // 3 chunks + count
    await store.setItem('sb-abc-auth-token', 'small');
    expect(await store.getItem('sb-abc-auth-token')).toBe('small');
    expect([...secure.data.keys()].sort()).toEqual(['sb-abc-auth-token.0', 'sb-abc-auth-token.n']);
    await store.removeItem('sb-abc-auth-token');
    expect(secure.data.size).toBe(0);
    expect(await store.getItem('sb-abc-auth-token')).toBeNull();
  });

  it('makes keys safe for the keychain', async () => {
    const store = chunkedStore(fake());
    await store.setItem('sb:auth/token', 'v');
    expect(await store.getItem('sb:auth/token')).toBe('v');
  });
});

describe('photo punches through the app server', () => {
  it('keeps a refusal for good, and retries anything else', () => {
    expect(classifyHttp(200, { ok: true })).toEqual({ ok: true });
    expect(classifyHttp(400, { ok: false, message: 'Take a photo (JPEG or PNG).', permanent: true })).toEqual({ ok: false, permanent: true, message: 'Take a photo (JPEG or PNG).' });
    expect(classifyHttp(403, { ok: false, message: 'Your account isn’t linked to an active employee record.' })).toMatchObject({ permanent: true });
    expect(classifyHttp(503, { ok: false, message: 'The selfie couldn’t be stored. It will be sent again.', permanent: false })).toMatchObject({ permanent: false });
    expect(classifyHttp(401, null)).toMatchObject({ permanent: false });
    expect(classifyHttp(0, null)).toEqual({ ok: false, permanent: false, message: 'No connection.' });
  });
});
