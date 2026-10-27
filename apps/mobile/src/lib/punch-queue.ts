/**
 * Offline-first check-in. A punch is stored on the device first, with a client id made once, and sent to
 * `record_punch` when there is a connection. The database records each client id once, so retries and a
 * second device sync can't double-count. It accepts offline punches up to 72 hours old. A punch the server
 * refuses for good (outside every geofence, too old) is kept with the reason for the person to see; a network
 * failure is retried on the next sync. Each punch belongs to the person who made it: on a shared phone only they see
 * and send it (the server records a punch as whoever sends it). No React Native imports: tested in Node.
 */

export interface QueuedPunch {
  clientId: string;
  /** Who made it. Only they see and send it; punches saved before this was kept count as anyone's. */
  userId?: string;
  orgId: string;
  punchedAt: string; // ISO, device clock
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  /** A selfie taken with the punch (a file on this device), when the attendance rule asks for one. */
  photoUri?: string;
  /** Set when the server refused it for good. */
  refused?: string;
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** What sending one punch did: stored, refused for good (with the message), or not reached. */
export type SendResult = { ok: true } | { ok: false; permanent: boolean; message: string };

const KEY = 'peoplecore.punches.v1';
const MAX_AGE_MS = 72 * 3600_000;

export class PunchQueue {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private store: KeyValueStore, private now: () => number = Date.now) {}

  /** Read-change-write steps run one at a time, so two of them can't overwrite each other. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Every punch on the device, or one person's (with those from before punches were kept per person). */
  async all(userId?: string): Promise<QueuedPunch[]> {
    const list = await this.read();
    return userId ? list.filter((p) => !p.userId || p.userId === userId) : list;
  }

  private async read(): Promise<QueuedPunch[]> {
    try {
      const raw = await this.store.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as QueuedPunch[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async save(list: QueuedPunch[]) {
    await this.store.setItem(KEY, JSON.stringify(list));
  }

  /** Records a punch on the device. */
  async add(p: Omit<QueuedPunch, 'punchedAt' | 'refused'> & { punchedAt?: string }): Promise<QueuedPunch> {
    const punch: QueuedPunch = { ...p, punchedAt: p.punchedAt ?? new Date(this.now()).toISOString() };
    await this.exclusive(async () => this.save([...(await this.read()), punch]));
    return punch;
  }

  /** Waiting to be sent (not refused). */
  async pending(userId?: string): Promise<QueuedPunch[]> {
    return (await this.all(userId)).filter((p) => !p.refused);
  }

  /**
   * Sends waiting punches in order. Stops at the first network failure (the rest wait for the next sync), drops
   * accepted ones, and keeps permanently refused ones with their reason. Punches past 72 hours can't be accepted
   * any more; they are marked refused without a call. `reason` is why the last try didn't get through, for the screen.
   * Only `userId`'s punches are sent. What happened is applied to the list as it is when sending ends, so a punch added
   * meanwhile (or another sync's work) is kept.
   */
  async sync(send: (p: QueuedPunch) => Promise<SendResult>, userId?: string): Promise<{ sent: number; refused: number; waiting: number; reason?: string }> {
    const outcome = new Map<string, { sent: true } | { refused: string }>();
    let reason: string | undefined;
    for (const p of await this.pending(userId)) {
      if (this.now() - Date.parse(p.punchedAt) > MAX_AGE_MS) {
        outcome.set(p.clientId, { refused: 'More than 72 hours old; ask your manager to regularize the day.' });
        continue;
      }
      const r = await send(p);
      if (r.ok) outcome.set(p.clientId, { sent: true });
      else if (r.permanent) outcome.set(p.clientId, { refused: r.message });
      else {
        reason = r.message;
        break;
      }
    }
    const waiting = await this.exclusive(async () => {
      const next = (await this.read()).flatMap((p) => {
        const o = outcome.get(p.clientId);
        if (!o) return [p];
        return 'sent' in o ? [] : [{ ...p, refused: o.refused }];
      });
      await this.save(next);
      return next.filter((p) => !p.refused && (!userId || !p.userId || p.userId === userId)).length;
    });
    const results = [...outcome.values()];
    return { sent: results.filter((o) => 'sent' in o).length, refused: results.length - results.filter((o) => 'sent' in o).length, waiting,
             ...(reason ? { reason } : {}) };
  }

  /** The person has seen a refusal; forget it. */
  async dismiss(clientId: string) {
    await this.exclusive(async () => this.save((await this.read()).filter((p) => p.clientId !== clientId)));
  }
}

/** What the app server's photo endpoint (/api/mobile/punch) answered: its status and JSON body. */
export function classifyHttp(status: number, body: { ok?: boolean; message?: string; permanent?: boolean } | null): SendResult {
  if (status === 200 && body?.ok) return { ok: true };
  // A refusal that won't change on retry (the rule, a bad photo, no employee record); anything else is tried again.
  if (status === 400 || status === 403 || body?.permanent) return { ok: false, permanent: true, message: body?.message ?? 'Refused.' };
  return { ok: false, permanent: false, message: body?.message ?? 'No connection.' };
}

/** Postgres/PostgREST errors with a message for people (22023) or a refusal (42501) won't change on retry. */
export function classify(error: { code?: string; message?: string } | null): SendResult {
  if (!error) return { ok: true };
  const permanent = error.code === '22023' || error.code === '42501' || error.code === '23514';
  return { ok: false, permanent, message: error.code === '22023' ? (error.message ?? 'Refused.') : permanent ? 'Not allowed.' : 'No connection.' };
}
