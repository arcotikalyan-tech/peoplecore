/**
 * Recurring jobs. Each run gets an idempotency key for its period, so any number of workers (or restarts)
 * enqueue it exactly once per period.
 */
export interface ScheduledJob {
  kind: string;
  key: string;
  payload: Record<string, unknown>;
}

/**
 * Mostly hourly. The jobs are cheap and idempotent per employee and period inside the database, and hourly runs
 * serve every organization's time zone (each uses its own local date).
 */
export function dueJobs(now: Date): ScheduledJob[] {
  const hour = now.toISOString().slice(0, 13); // e.g. 2026-10-18T05
  return [
    { kind: 'core_hr.daily', key: `core_hr.daily:${hour}`, payload: { hour } },
    { kind: 'leave.accrual', key: `leave.accrual:${hour}`, payload: { hour } },
    // Daily: recomputes the last 7 days of attendance (absences appear the next morning, leave changes propagate).
    { kind: 'attendance.daily', key: `attendance.daily:${hour.slice(0, 10)}`, payload: { day: hour.slice(0, 10) } },
    // Overdue loans: each is reminded once, on the first run after its due date passes in the org's time zone.
    { kind: 'assets.returns', key: `assets.returns:${hour}`, payload: { hour } },
    // Approvals waiting longer than their step allows (hours, 72 by default) escalate once per step.
    { kind: 'approvals.escalate', key: `approvals.escalate:${hour}`, payload: { hour } },
    // Overdue training reminders and recertification (each once; hourly so every time zone's day is covered).
    { kind: 'learning.daily', key: `learning.daily:${hour}`, payload: { hour } },
    // Every 15 minutes: the shortest helpdesk SLA is 4 hours, so a breach is flagged within a quarter of it.
    { kind: 'helpdesk.sla', key: `helpdesk.sla:${hour}:${String(Math.floor(now.getUTCMinutes() / 15) * 15).padStart(2, '0')}`, payload: { hour } },
  ];
}
