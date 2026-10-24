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
  const quarter = String(Math.floor(now.getUTCMinutes() / 15) * 15).padStart(2, '0');
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
    // Workflows waiting N days resume within the hour after their time.
    { kind: 'workflows.resume', key: `workflows.resume:${hour}`, payload: { hour } },
    // Exits: the day after each last working day, in the organization's time zone.
    { kind: 'separations.daily', key: `separations.daily:${hour}`, payload: { hour } },
    // Daily is enough for retention (periods are months long).
    { kind: 'retention.daily', key: `retention.daily:${hour.slice(0, 10)}`, payload: { day: hour.slice(0, 10) } },
    // Candidates out of every pipeline past their organization's retention period (consent expiry, T15).
    { kind: 'recruitment.retention', key: `recruitment.retention:${hour.slice(0, 10)}`, payload: { day: hour.slice(0, 10) } },
    // Companies whose owner asked to close them: archived on the closing day (hourly, so each time zone's day is met).
    { kind: 'org.closures', key: `org.closures:${hour}`, payload: { hour } },
    // The audit log's daily archive: hourly, so a missed day is caught up within the hour (cheap when nothing is due).
    { kind: 'audit.archive', key: `audit.archive:${hour}`, payload: { hour } },
    // AI prompts and outputs are kept 30 days; runs that never finished are closed.
    { kind: 'ai.retention', key: `ai.retention:${hour.slice(0, 10)}`, payload: { day: hour.slice(0, 10) } },
    // Scheduled reports: a reminder when one is due in its organization's time zone (each schedule once per period).
    { kind: 'reports.schedules', key: `reports.schedules:${hour}`, payload: { hour } },
    // Attendance reminders: missing check-out (10 am), approvals digest (9 am), late alerts (11 am), local time.
    { kind: 'attendance.reminders', key: `attendance.reminders:${hour}`, payload: { hour } },
    // Learning assignment rules (new joiners, yearly refreshers): once a day.
    { kind: 'learning.rules', key: `learning.rules:${hour.slice(0, 10)}`, payload: { day: hour.slice(0, 10) } },
    // Timesheet reminders: missing hours at 6 pm on working days, the weekly reminder on Friday at 4 pm (local time).
    { kind: 'timesheet.reminders', key: `timesheet.reminders:${hour}`, payload: { hour } },
    // Automatic deduction: penalties and absent days, the morning after each attendance cycle ends (local time).
    { kind: 'attendance.deductions', key: `attendance.deductions:${hour}`, payload: { hour } },
    // Every 15 minutes: the shortest helpdesk SLA is 4 hours, so a breach is flagged within a quarter of it.
    { kind: 'helpdesk.sla', key: `helpdesk.sla:${hour}:${quarter}`, payload: { hour } },
    // Every 15 minutes: automatic clock-in at shift starts and clock-out at shift ends.
    { kind: 'attendance.auto_clock', key: `attendance.auto_clock:${hour}:${quarter}`, payload: { hour } },
    // Every 15 minutes: notification emails waiting in the outbox.
    { kind: 'notifications.email', key: `notifications.email:${hour}:${quarter}`, payload: { hour } },
    // Birthday and work-anniversary emails, once a day per organization from 9 am local time.
    { kind: 'notifications.celebrations', key: `notifications.celebrations:${hour}`, payload: { hour } },
  ];
}
