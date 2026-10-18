/**
 * Recurring jobs. Each run gets an idempotency key for its period, so any number of workers (or restarts)
 * enqueue it exactly once per period.
 */
export interface ScheduledJob {
  kind: string;
  key: string;
  payload: Record<string, unknown>;
}

/** Hourly: the daily Core HR upkeep is cheap and idempotent, and hourly runs serve every time zone. */
export function dueJobs(now: Date): ScheduledJob[] {
  const hour = now.toISOString().slice(0, 13); // e.g. 2026-10-18T05
  return [{ kind: 'core_hr.daily', key: `core_hr.daily:${hour}`, payload: { hour } }];
}
