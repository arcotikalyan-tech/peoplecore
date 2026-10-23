import { createSign } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import type { Log } from './queue.ts';

/** One push the database queued (migration 20261023000100), as worker_claim_pushes returns it. */
export interface OutgoingPush {
  id: string;
  /** The person's phones, most recently seen first. */
  tokens: string[];
  title: string;
  body: string | null;
  link: string | null;
  kind: string;
  org_slug: string;
  org_name: string;
}

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushSender {
  /** Sends one message to one phone: 'gone' when the phone no longer has the app (its token is then forgotten). */
  send(token: string, message: PushMessage): Promise<'sent' | 'gone'>;
}

/** The Google service account Firebase gives you (Project settings › Service accounts › Generate new private key). */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * Firebase Cloud Messaging from FCM_SERVICE_ACCOUNT (the service account's JSON, as is or base64-encoded). Null when
 * it isn't configured: pushes then wait in the queue and expire after a day.
 */
export function fcmFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): PushSender | null {
  const raw = env.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  const account = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as Partial<ServiceAccount>;
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT needs project_id, client_email and private_key (the Firebase service account JSON).');
  }
  return fcmSender(account as ServiceAccount, fetchImpl);
}

/** FCM's HTTP v1 API, signed in as the service account (an access token, renewed a minute before it expires). */
export function fcmSender(account: ServiceAccount, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): PushSender {
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
  let cached: { token: string; expires: number } | null = null;
  const accessToken = async () => {
    if (cached && cached.expires > now() + 60_000) return cached.token;
    const iat = Math.floor(now() / 1000);
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
      iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat, exp: iat + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
    const res = await fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    });
    if (!res.ok) throw new Error(`FCM sign-in failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: json.access_token, expires: now() + json.expires_in * 1000 };
    return cached.token;
  };
  return {
    async send(token, m) {
      const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { token, notification: { title: m.title, body: m.body }, data: m.data, android: { priority: 'high', notification: { channel_id: 'default' } } },
        }),
      });
      if (res.ok) return 'sent';
      const text = await res.text();
      // The app was uninstalled or the token replaced (404 UNREGISTERED), or the token was never valid.
      if (res.status === 404 || /UNREGISTERED/.test(text) || (res.status === 400 && /registration token/i.test(text))) return 'gone';
      throw new Error(`FCM ${res.status}: ${text.slice(0, 200)}`);
    },
  };
}

/**
 * What the phone shows: the workplace's name over the notification's title (never its longer text, which can hold
 * comments, so little shows on a lock screen). Tapping it opens the screen its link points to.
 */
export function pushMessage(p: OutgoingPush): PushMessage {
  return { title: p.org_name, body: p.title, data: { link: p.link ?? '', kind: p.kind, org: p.org_slug } };
}

/**
 * Sends a batch, each push to all of its person's phones. A push is done once any phone got it (or there was no phone
 * left to try); otherwise it is tried again later. Phones that are gone are reported so they're forgotten.
 */
export async function sendPushes(
  pushes: OutgoingPush[], sender: PushSender, report: (id: string, ok: boolean, error: string | undefined, dead: string[]) => Promise<void>,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const p of pushes) {
    const dead: string[] = [];
    let delivered = false;
    let error: string | undefined;
    for (const token of p.tokens) {
      try {
        if ((await sender.send(token, pushMessage(p))) === 'sent') delivered = true;
        else dead.push(token);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    const ok = delivered || !error;
    await report(p.id, ok, ok ? undefined : error, dead);
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/** One pass over the push queue (the worker runs it on every poll, so pushes go out within seconds). */
export async function drainPushes(db: SupabaseClient<Database>, sender: PushSender, log: Log): Promise<void> {
  const { data, error } = await db.rpc('worker_claim_pushes', { p_limit: 50 });
  if (error) throw new Error(error.message);
  const pushes = (data ?? []) as OutgoingPush[];
  if (pushes.length === 0) return;
  const r = await sendPushes(pushes, sender, async (id, ok, message, dead) => {
    const { error: e } = await db.rpc('worker_push_result', { p_id: id, p_ok: ok, p_error: message, p_dead_tokens: dead });
    if (e) throw new Error(e.message);
  });
  log('notifications.push', r);
}
