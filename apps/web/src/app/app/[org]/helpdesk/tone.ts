export const TICKET_TONE = {
  open: 'primary',
  in_progress: 'primary',
  waiting: 'warning',
  resolved: 'success',
  closed: 'neutral',
} as const;

export const STATUS_LABEL: Record<keyof typeof TICKET_TONE, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** An open ticket past its SLA (flagged by the worker, or overdue since its last run). */
export function isOverdue(t: { status: string; sla_due_at: string; breached_at: string | null }, now: string): boolean {
  return (t.status === 'open' || t.status === 'in_progress') && (t.breached_at !== null || t.sla_due_at < now);
}
