/** Notification emails by event and audience (migration 20261022000200): Settings › Notifications. */
export const EMAIL_EVENTS = [
  ['regularization', 'Attendance regularization', 'When someone asks to correct a day'],
  ['leave', 'Leave application', 'When someone applies for leave'],
  ['expense', 'Expense application', 'When someone submits an expense claim'],
  ['birthday', 'Birthdays', 'On the day, at 9 am'],
  ['anniversary', 'Work anniversaries', 'On the day, at 9 am'],
] as const;
export type EmailEvent = (typeof EMAIL_EVENTS)[number][0];

export const EMAIL_AUDIENCES = [
  ['owner', 'Owners'], ['hr_admin', 'HR administrators'], ['hr_executive', 'HR executives'],
  ['finance_admin', 'Finance administrators'], ['payroll_admin', 'Payroll administrators'], ['line_manager', 'Their manager'],
] as const;
export type EmailAudience = (typeof EMAIL_AUDIENCES)[number][0];

export const EMAIL_STATUS_LABELS: Record<string, string> = {
  queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', expired: 'Not sent (expired)',
};
