import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fcmFromEnv, fcmSender, pushMessage, sendPushes, type OutgoingPush, type PushSender } from '../src/push.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  project_id: 'peoplecore-test', client_email: 'push@peoplecore-test.iam.gserviceaccount.example.test',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

const push: OutgoingPush = {
  id: '00000000-0000-4000-8000-000000000001', tokens: ['phone-1', 'phone-2'], title: 'Your leave was approved: Casual leave (4 Nov 2026, 1 day)',
  body: 'Enjoy the break', link: '/leave', kind: 'approval.approved', org_slug: 'demo-a', org_name: 'Demo Org A',
};

/** A stand-in for Google: the token endpoint and FCM's send endpoint, answering as told. */
function fakeGoogle(answer: (token: string) => { status: number; body: string } = () => ({ status: 200, body: '{}' })) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
    const { message } = JSON.parse(String(init.body)) as { message: { token: string } };
    const a = answer(message.token);
    return new Response(a.body, { status: a.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('push notifications', () => {
  it('are off until the Firebase service account is configured; a broken one says what is missing', () => {
    expect(fcmFromEnv({})).toBeNull();
    expect(fcmFromEnv({ FCM_SERVICE_ACCOUNT: JSON.stringify(account) })).not.toBeNull();
    expect(fcmFromEnv({ FCM_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(account)).toString('base64') })).not.toBeNull();
    expect(() => fcmFromEnv({ FCM_SERVICE_ACCOUNT: '{"project_id":"x"}' })).toThrow(/client_email and private_key/);
  });

  it('show the workplace over the notification’s title, never its longer text, with the link for the tap', () => {
    expect(pushMessage(push)).toEqual({
      title: 'Demo Org A', body: 'Your leave was approved: Casual leave (4 Nov 2026, 1 day)',
      data: { link: '/leave', kind: 'approval.approved', org: 'demo-a' },
    });
    expect(pushMessage({ ...push, link: null }).data.link).toBe('');
  });

  it('sign in to Google as the service account once, then send through FCM', async () => {
    const google = fakeGoogle();
    let clock = Date.UTC(2026, 9, 23, 8);
    const sender = fcmSender(account, google.fetchImpl, () => clock);
    expect(await sender.send('phone-1', pushMessage(push))).toBe('sent');
    expect(await sender.send('phone-2', pushMessage(push))).toBe('sent');
    expect(google.calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://fcm.googleapis.com/v1/projects/peoplecore-test/messages:send',
      'https://fcm.googleapis.com/v1/projects/peoplecore-test/messages:send',
    ]);
    // The sign-in is a JWT signed with the service account's key, for the messaging scope.
    const assertion = new URLSearchParams(String(google.calls[0]!.init.body)).get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token',
    });
    const sent = google.calls[1]!;
    expect((sent.init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
    expect(JSON.parse(String(sent.init.body))).toEqual({
      message: {
        token: 'phone-1', notification: { title: 'Demo Org A', body: push.title },
        data: { link: '/leave', kind: 'approval.approved', org: 'demo-a' }, android: { priority: 'high', notification: { channel_id: 'default' } },
      },
    });
    // An hour later the access token has expired: it signs in again.
    clock += 3_600_000;
    await sender.send('phone-1', pushMessage(push));
    expect(google.calls.filter((c) => c.url.includes('oauth2')).length).toBe(2);
  });

  it('forget phones that no longer have the app, and retry what failed for other reasons', async () => {
    const google = fakeGoogle((token) =>
      token === 'gone' ? { status: 404, body: '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}' }
      : token === 'bad' ? { status: 400, body: '{"error":{"message":"The registration token is not a valid FCM registration token"}}' }
      : token === 'down' ? { status: 503, body: 'Service Unavailable' }
      : { status: 200, body: '{}' });
    const sender = fcmSender(account, google.fetchImpl);
    expect(await sender.send('gone', pushMessage(push))).toBe('gone');
    expect(await sender.send('bad', pushMessage(push))).toBe('gone');
    await expect(sender.send('down', pushMessage(push))).rejects.toThrow('FCM 503: Service Unavailable');

    const reports: unknown[] = [];
    const report = async (id: string, ok: boolean, error: string | undefined, dead: string[]) => { reports.push({ id, ok, error, dead }); };
    const r = await sendPushes([
      { ...push, id: 'a', tokens: ['phone-1', 'gone'] }, // delivered to one phone; the other is forgotten
      { ...push, id: 'b', tokens: ['down', 'bad'] },     // nothing delivered: tried again later
      { ...push, id: 'c', tokens: [] },                  // no phone left: done
    ], sender, report);
    expect(r).toEqual({ sent: 2, failed: 1 });
    expect(reports).toEqual([
      { id: 'a', ok: true, error: undefined, dead: ['gone'] },
      { id: 'b', ok: false, error: 'FCM 503: Service Unavailable', dead: ['bad'] },
      { id: 'c', ok: true, error: undefined, dead: [] },
    ]);
  });

  it('report a push done when every phone is gone', async () => {
    const sender: PushSender = { send: async () => 'gone' };
    const reports: Array<{ ok: boolean; dead: string[] }> = [];
    await sendPushes([push], sender, async (_id, ok, _e, dead) => { reports.push({ ok, dead }); });
    expect(reports).toEqual([{ ok: true, dead: ['phone-1', 'phone-2'] }]);
  });
});
