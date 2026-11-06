import { dayProgress, nextPunches, punchState, type PauseKind, type PunchKind, type PunchLike } from '@peoplecore/shared/punches';

/**
 * Today's attendance from the punches (check in and out, with lunch and breaks between; a punch without a kind is a
 * check-in or check-out by its place). A full day is the rule's day of work plus its break at work: 8 hours with an
 * hour's break is 9 hours, and lunch and breaks beyond the hour add to it. No React Native imports: tested in Node.
 */
export interface Day {
  state: 'not_in' | 'in' | 'out';
  /** On lunch or a break that hasn't ended. */
  paused: PauseKind | null;
  firstIn: string | null;
  lastOut: string | null;
  /** Time at work so far: each check-in to its check-out, and up to now while checked in. */
  atWorkMinutes: number;
  /** Lunch and breaks so far. */
  breakMinutes: number;
  /** Time at work a full day takes: the day's work plus the rule's break, or the breaks taken if longer. */
  fullDayMinutes: number;
  /** What can be punched next. */
  next: PunchKind[];
}

/** The rule's day: minutes of work for a full and a half day, and the break that comes off a day longer than half. */
export interface DayRule { fullDayMinutes: number; halfDayMinutes: number; breakMinutes: number }
export const DEFAULT_DAY: DayRule = { fullDayMinutes: 480, halfDayMinutes: 240, breakMinutes: 60 };

const isCheck = (p: PunchLike) => p.kind == null || p.kind === 'in' || p.kind === 'out';

export function today(punches: readonly PunchLike[], now: Date, rule: DayRule = DEFAULT_DAY): Day {
  const checks = punches.filter(isCheck).sort((a, b) => Date.parse(a.punched_at) - Date.parse(b.punched_at));
  const state = punchState(punches);
  const progress = dayProgress(punches, now, rule);
  return {
    state: checks.length === 0 ? 'not_in' : state.checkedIn ? 'in' : 'out',
    paused: state.paused,
    firstIn: checks[0]?.punched_at ?? null,
    lastOut: !state.checkedIn && checks.length ? checks[checks.length - 1]!.punched_at : null,
    atWorkMinutes: progress.atWorkMinutes,
    breakMinutes: progress.breakMinutes,
    fullDayMinutes: progress.atWorkMinutes + progress.toFullDayMinutes,
    next: nextPunches(state),
  };
}

/**
 * One punch button: only the one pressed spins. The others wait without a spinner while it's working, and all of them
 * wait until today's punches have been read.
 */
export function punchButton(kind: PunchKind, punching: PunchKind | null, ready: boolean): { busy: boolean; disabled: boolean } {
  return { busy: punching === kind, disabled: !ready || punching !== null };
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
