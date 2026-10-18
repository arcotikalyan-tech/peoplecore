import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from '@peoplecore/shared';
import { cn } from '@/components/ui/cn';

/** Short codes used in logs and the month grid, as payroll and statutory registers write them. */
export const STATUS_CODE: Record<AttendanceStatus, string> = {
  present: 'P', half_day: 'HL', absent: 'A', on_leave: 'L', weekly_off: 'WO', holiday: 'H', not_marked: '–', wfh: 'WFH', on_duty: 'OD',
};

const TONE: Record<AttendanceStatus, string> = {
  present: 'bg-success-soft text-success ring-success/25', half_day: 'bg-warning-soft text-warning ring-warning/25',
  absent: 'bg-danger-soft text-danger ring-danger/25', on_leave: 'bg-info-soft text-info ring-info/25',
  weekly_off: 'bg-subtle text-muted ring-line', holiday: 'bg-accent-soft text-accent ring-accent/25',
  not_marked: 'bg-subtle text-muted ring-line', wfh: 'bg-ai-soft text-ai ring-ai/25', on_duty: 'bg-info-soft text-info ring-info/25',
};

export function StatusChip({ status, code = false, className }: { status: string | null; code?: boolean; className?: string }) {
  const s = (status ?? 'not_marked') as AttendanceStatus;
  return (
    <span title={ATTENDANCE_STATUS_LABELS[s]} className={cn('inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONE[s], className)}>
      {code ? STATUS_CODE[s] : ATTENDANCE_STATUS_LABELS[s]}
    </span>
  );
}

export const LEGEND = 'P present · HL half day · A absent · L leave · WO weekly off · H holiday · WFH work from home · OD on duty · – not marked';

export const hours = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');
export const clock = (tz: string) => (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
