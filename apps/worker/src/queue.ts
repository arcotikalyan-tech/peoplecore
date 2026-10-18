/**
 * Queue mechanics, independent of Supabase so they can be tested with a fake client.
 * Jobs are claimed with a lease; each runs under a timeout shorter than the lease; failures are reported
 * so the database can retry with backoff (and eventually mark the job dead).
 */
export interface ClaimedJob {
  id: number;
  organization_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface QueueClient {
  claim(worker: string, limit: number, leaseSeconds: number): Promise<ClaimedJob[]>;
  complete(id: number, worker: string): Promise<void>;
  fail(id: number, worker: string, error: string): Promise<'retry' | 'dead' | null>;
  enqueue(org: string | null, kind: string, payload: Record<string, unknown>, key: string): Promise<void>;
}

export type Log = (event: string, fields?: Record<string, unknown>) => void;
export type Handler = (job: ClaimedJob, log: Log) => Promise<void>;
export type Handlers = Record<string, Handler>;

/** Exact kind first; then `event:*` for any domain event (events with no consumer are simply done). */
export function resolveHandler(handlers: Handlers, kind: string): Handler | undefined {
  return handlers[kind] ?? (kind.startsWith('event:') ? handlers['event:*'] : undefined);
}

export interface RunOptions {
  worker: string;
  limit: number;
  leaseSeconds: number;
  timeoutMs: number;
  log: Log;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Claims one batch and runs it. Returns counts for logging and tests. */
export async function runOnce(client: QueueClient, handlers: Handlers, opts: RunOptions) {
  const jobs = await client.claim(opts.worker, opts.limit, opts.leaseSeconds);
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    const handler = resolveHandler(handlers, job.kind);
    try {
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      await withTimeout(handler(job, opts.log), opts.timeoutMs);
      await client.complete(job.id, opts.worker);
      done++;
      opts.log('job.done', { id: job.id, kind: job.kind, attempts: job.attempts });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await client.fail(job.id, opts.worker, message);
      failed++;
      opts.log('job.failed', { id: job.id, kind: job.kind, attempts: job.attempts, outcome, error: message });
    }
  }
  return { claimed: jobs.length, done, failed };
}
