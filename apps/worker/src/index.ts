import { hostname } from 'node:os';
import { handlers } from './handlers.ts';
import { runOnce, type Log } from './queue.ts';
import { dueJobs } from './schedule.ts';
import { serviceClient, supabaseQueue } from './supabase.ts';

/**
 * PeopleCore worker: drains the job queue (ADR-007) and enqueues recurring jobs.
 *   corepack pnpm --filter @peoplecore/worker start
 * WORKER_ONCE=1 runs a single pass and exits, for cron-style hosting: it enqueues what is due, then drains the
 * queue until it is empty or WORKER_MAX_MS (default 10 minutes) has passed.
 */
const worker = process.env.WORKER_ID || `${hostname()}-${process.pid}`;
const pollMs = Number(process.env.WORKER_POLL_MS ?? 5000);
const once = process.env.WORKER_ONCE === '1';
const deadline = once ? Date.now() + Number(process.env.WORKER_MAX_MS ?? 600_000) : Infinity;
const log: Log = (event, fields = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), worker, event, ...fields }));

const db = serviceClient();
const queue = supabaseQueue(db);
const registry = handlers(db);
let stopping = false;
let lastScheduled = '';

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log('worker.stopping', { signal });
    stopping = true;
  });
}

log('worker.started', { pollMs });
while (!stopping) {
  try {
    const now = new Date();
    // Once per quarter hour; hourly and daily jobs are deduplicated by their idempotency keys.
    const period = `${now.toISOString().slice(0, 13)}:${Math.floor(now.getUTCMinutes() / 15)}`;
    if (period !== lastScheduled) {
      for (const job of dueJobs(now)) await queue.enqueue(null, job.kind, job.payload, job.key);
      lastScheduled = period;
    }
    const result = await runOnce(queue, registry, { worker, limit: 10, leaseSeconds: 300, timeoutMs: 240_000, log });
    if (result.claimed > 0 && Date.now() < deadline) continue; // more may be waiting
    if (once) break;
  } catch (err) {
    log('worker.error', { error: err instanceof Error ? err.message : String(err) });
    if (once) process.exitCode = 1;
  }
  if (once) break;
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
log('worker.stopped');
