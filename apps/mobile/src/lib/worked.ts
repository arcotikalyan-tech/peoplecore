/**
 * Today's attendance from the punches: they alternate in, out, in, out, so an odd count means checked in. Worked time
 * adds each in–out pair and, while checked in, the time since the last check-in. No React Native imports: tested in Node.
 */
export interface Day {
  state: 'not_in' | 'in' | 'out';
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
}

export function today(punchTimes: string[], now: Date): Day {
  const times = [...punchTimes].sort();
  let worked = 0;
  for (let i = 0; i + 1 < times.length; i += 2) worked += Date.parse(times[i + 1]!) - Date.parse(times[i]!);
  const checkedIn = times.length % 2 === 1;
  if (checkedIn) worked += Math.max(0, now.getTime() - Date.parse(times[times.length - 1]!));
  return {
    state: times.length === 0 ? 'not_in' : checkedIn ? 'in' : 'out',
    firstIn: times[0] ?? null,
    lastOut: !checkedIn && times.length ? times[times.length - 1]! : null,
    workedMinutes: Math.floor(worked / 60_000),
  };
}

/** A shift's "09:30:00" as "09:30 am". */
export function shiftTime(hhmmss: string): string {
  const [h = 0, m = 0] = hhmmss.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}\u00a0${suffix}`;
}

export interface DayRow { work_date: string; status: string; late_minutes: number; punch_count?: number }

/** A month's totals up to today: days at work (a half day counts half), late arrivals, leave and absences. */
export function monthTotals(rows: DayRow[], today: string): { present: number; late: number; leave: number; absent: number } {
  const past = rows.filter((r) => r.work_date <= today);
  const atWork = (s: string) => s === 'present' || s === 'wfh' || s === 'on_duty';
  return {
    present: past.filter((r) => atWork(r.status)).length + past.filter((r) => r.status === 'half_day').length * 0.5,
    late: past.filter((r) => r.late_minutes > 0 && (atWork(r.status) || r.status === 'half_day')).length,
    leave: past.filter((r) => r.status === 'on_leave').length,
    absent: past.filter((r) => r.status === 'absent').length,
  };
}

/**
 * Days before today that likely need a correction: marked absent, or a check-in with no check-out (an odd number of
 * punches). Shown on Home with a link to fix them, as the day is still open to a regularization.
 */
export function daysToFix(rows: DayRow[], today: string): string[] {
  return rows.filter((r) => r.work_date < today && (r.status === 'absent' || (r.punch_count ?? 0) % 2 === 1)).map((r) => r.work_date);
}
