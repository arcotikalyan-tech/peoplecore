import { hostname } from 'node:os';
import { handlers } from './handlers.ts';
import { runOnce, type Log } from './queue.ts';
import { dueJobs } from './schedule.ts';
import { serviceClient, supabaseQueue } from './supabase.ts';

/**
 * PeopleCore worker: drains the job queue (ADR-007) and enqueues recurring jobs.
 *   corepack pnpm --filter @peoplecore/worker start
 * WORKER_ONCE=1 runs a single pass (schedule + one batch) and exits, for cron-style hosting and smoke tests.
 */
const worker = process.env.WORKER_ID || `${hostname()}-${process.pid}`;
const pollMs = Number(process.env.WORKER_POLL_MS ?? 5000);
const once = process.env.WORKER_ONCE === '1';
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
    const period = now.toISOString().slice(0, 13);
    if (period !== lastScheduled) {
      for (const job of dueJobs(now)) await queue.enqueue(null, job.kind, job.payload, job.key);
      lastScheduled = period;
    }
    const result = await runOnce(queue, registry, { worker, limit: 10, leaseSeconds: 300, timeoutMs: 240_000, log });
    if (once) break;
    if (result.claimed > 0) continue; // more may be waiting
  } catch (err) {
    log('worker.error', { error: err instanceof Error ? err.message : String(err) });
    if (once) process.exitCode = 1;
  }
  if (once) break;
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
log('worker.stopped');
