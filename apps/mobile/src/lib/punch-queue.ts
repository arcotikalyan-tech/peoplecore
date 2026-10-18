/**
 * Offline-first check-in. A punch is stored on the device first, with a client id made once, and sent to
 * `record_punch` when there is a connection. The database records each client id once, so retries and a
 * second device sync can't double-count. It accepts offline punches up to 72 hours old. A punch the server
 * refuses for good (outside every geofence, too old) is kept with the reason for the person to see; a network
 * failure is retried on the next sync. No React Native imports: tested in Node.
 */

export interface QueuedPunch {
  clientId: string;
  orgId: string;
  punchedAt: string; // ISO, device clock
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
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
  constructor(private store: KeyValueStore, private now: () => number = Date.now) {}

  async all(): Promise<QueuedPunch[]> {
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
    await this.save([...(await this.all()), punch]);
    return punch;
  }

  /** Waiting to be sent (not refused). */
  async pending(): Promise<QueuedPunch[]> {
    return (await this.all()).filter((p) => !p.refused);
  }

  /**
   * Sends waiting punches in order. Stops at the first network failure (the rest wait for the next sync), drops
   * accepted ones, and keeps permanently refused ones with their reason. Punches past 72 hours can't be accepted
   * any more; they are marked refused without a call.
   */
  async sync(send: (p: QueuedPunch) => Promise<SendResult>): Promise<{ sent: number; refused: number; waiting: number }> {
    const list = await this.all();
    let sent = 0;
    let refused = 0;
    let stopped = false;
    const keep: QueuedPunch[] = [];
    for (const p of list) {
      if (p.refused || stopped) {
        keep.push(p);
        continue;
      }
      if (this.now() - Date.parse(p.punchedAt) > MAX_AGE_MS) {
        keep.push({ ...p, refused: 'More than 72 hours old; ask your manager to regularize the day.' });
        refused++;
        continue;
      }
      const r = await send(p);
      if (r.ok) sent++;
      else if (r.permanent) {
        keep.push({ ...p, refused: r.message });
        refused++;
      } else {
        keep.push(p);
        stopped = true;
      }
    }
    await this.save(keep);
    return { sent, refused, waiting: keep.filter((p) => !p.refused).length };
  }

  /** The person has seen a refusal; forget it. */
  async dismiss(clientId: string) {
    await this.save((await this.all()).filter((p) => p.clientId !== clientId));
  }
}

/** Postgres/PostgREST errors with a message for people (22023) or a refusal (42501) won't change on retry. */
export function classify(error: { code?: string; message?: string } | null): SendResult {
  if (!error) return { ok: true };
  const permanent = error.code === '22023' || error.code === '42501' || error.code === '23514';
  return { ok: false, permanent, message: error.code === '22023' ? (error.message ?? 'Refused.') : permanent ? 'Not allowed.' : 'No connection.' };
}
