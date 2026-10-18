import { describe, expect, it } from 'vitest';
import { resolveHandler, runOnce, type ClaimedJob, type Handlers, type QueueClient } from '../src/queue.ts';
import { dueJobs } from '../src/schedule.ts';

function fakeQueue(jobs: ClaimedJob[]) {
  const calls: string[] = [];
  const client: QueueClient = {
    claim: async () => jobs.splice(0),
    complete: async (id) => { calls.push(`complete:${id}`); },
    fail: async (id, _w, error) => { calls.push(`fail:${id}:${error}`); return 'retry'; },
    enqueue: async () => {},
  };
  return { client, calls };
}

const job = (id: number, kind: string): ClaimedJob => ({ id, organization_id: null, kind, payload: {}, attempts: 1 });
const opts = { worker: 'w', limit: 10, leaseSeconds: 60, timeoutMs: 50, log: () => {} };

describe('runOnce', () => {
  it('completes jobs whose handler succeeds and reports failures, timeouts and unknown kinds', async () => {
    const handlers: Handlers = {
      ok: async () => {},
      boom: async () => { throw new Error('nope'); },
      slow: () => new Promise((resolve) => setTimeout(resolve, 500)),
      'event:*': async () => {},
    };
    const { client, calls } = fakeQueue([job(1, 'ok'), job(2, 'boom'), job(3, 'slow'), job(4, 'mystery'), job(5, 'event:employee.joined')]);
    expect(await runOnce(client, handlers, opts)).toEqual({ claimed: 5, done: 2, failed: 3 });
    expect(calls).toEqual([
      'complete:1',
      'fail:2:nope',
      'fail:3:timed out after 50 ms',
      'fail:4:No handler for job kind "mystery"',
      'complete:5',
    ]);
  });

  it('prefers an exact handler over the event fallback', () => {
    const exact = async () => {};
    const fallback = async () => {};
    expect(resolveHandler({ 'event:a.b': exact, 'event:*': fallback }, 'event:a.b')).toBe(exact);
    expect(resolveHandler({ 'event:*': fallback }, 'event:c.d')).toBe(fallback);
    expect(resolveHandler({ 'event:*': fallback }, 'core_hr.daily')).toBeUndefined();
  });
});

describe('dueJobs', () => {
  it('uses one idempotency key per hour', () => {
    const a = dueJobs(new Date('2026-10-18T05:01:00Z'));
    const b = dueJobs(new Date('2026-10-18T05:59:59Z'));
    const c = dueJobs(new Date('2026-10-18T06:00:00Z'));
    const hourly = (jobs: ReturnType<typeof dueJobs>) => jobs.filter((j) => j.kind !== 'helpdesk.sla').map((j) => j.key);
    expect(hourly(a)).toEqual(['core_hr.daily:2026-10-18T05', 'leave.accrual:2026-10-18T05', 'attendance.daily:2026-10-18', 'assets.returns:2026-10-18T05',
      'approvals.escalate:2026-10-18T05', 'learning.daily:2026-10-18T05',
      'workflows.resume:2026-10-18T05', 'separations.daily:2026-10-18T05',
      'retention.daily:2026-10-18', 'ai.retention:2026-10-18']);
    expect(hourly(b)).toEqual(hourly(a));
    expect(hourly(c)).toEqual(['core_hr.daily:2026-10-18T06', 'leave.accrual:2026-10-18T06', 'attendance.daily:2026-10-18', 'assets.returns:2026-10-18T06',
      'approvals.escalate:2026-10-18T06', 'learning.daily:2026-10-18T06',
      'workflows.resume:2026-10-18T06', 'separations.daily:2026-10-18T06',
      'retention.daily:2026-10-18', 'ai.retention:2026-10-18']); // same day key
  });

  it('checks helpdesk SLAs every quarter hour', () => {
    const sla = (iso: string) => dueJobs(new Date(iso)).find((j) => j.kind === 'helpdesk.sla')!.key;
    expect(sla('2026-10-18T05:01:00Z')).toBe('helpdesk.sla:2026-10-18T05:00');
    expect(sla('2026-10-18T05:14:59Z')).toBe('helpdesk.sla:2026-10-18T05:00');
    expect(sla('2026-10-18T05:15:00Z')).toBe('helpdesk.sla:2026-10-18T05:15');
    expect(sla('2026-10-18T05:59:00Z')).toBe('helpdesk.sla:2026-10-18T05:45');
  });
});
