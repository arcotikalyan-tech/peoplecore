/**
 * A work day's punches: check in and out, with lunch and breaks between. A punch without a kind (a biometric device,
 * an import, a correction, an older phone app) is a check-in or check-out by its place: they alternate. The website
 * and the phone app read the day with these; the database keeps the same rules (record_punch, app.punch_state and
 * app.compute_attendance_day in migration 20261102120000).
 */

export const PUNCH_KINDS = ['in', 'out', 'lunch_start', 'lunch_end', 'break_start', 'break_end'] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];
export type PauseKind = 'lunch' | 'break';

/** What a button that makes the punch says. */
export const PUNCH_ACTIONS: Record<PunchKind, string> = {
  in: 'Check in', out: 'Check out', lunch_start: 'Start lunch', lunch_end: 'End lunch', break_start: 'Start break', break_end: 'End break',
};

/** What a punch was, in a day's list. */
export const PUNCH_LABELS: Record<PunchKind, string> = {
  in: 'Check-in', out: 'Check-out', lunch_start: 'Lunch started', lunch_end: 'Lunch ended', break_start: 'Break started', break_end: 'Break ended',
};

export interface PunchLike {
  punched_at: string;
  kind?: PunchKind | null;
}

const isCheck = (k: PunchKind | null | undefined) => k == null || k === 'in' || k === 'out';
const time = (p: PunchLike) => Date.parse(p.punched_at);
const sorted = (punches: readonly PunchLike[]) => [...punches].sort((a, b) => time(a) - time(b));

export interface PunchState {
  /** Checked in and not out yet: an odd number of check-ins and check-outs. */
  checkedIn: boolean;
  /** On lunch or a break that hasn't ended. */
  paused: PauseKind | null;
}

export function punchState(punches: readonly PunchLike[]): PunchState {
  let checks = 0;
  let paused: PauseKind | null = null;
  for (const p of sorted(punches)) {
    if (isCheck(p.kind)) { checks += 1; paused = null; }
    else paused = p.kind === 'lunch_start' ? 'lunch' : p.kind === 'break_start' ? 'break' : null;
  }
  const checkedIn = checks % 2 === 1;
  return { checkedIn, paused: checkedIn ? paused : null };
}

/** The punches someone can make next: check in; or start lunch, start a break, check out; or end the one that's on. */
export function nextPunches(s: PunchState): PunchKind[] {
  if (!s.checkedIn) return ['in'];
  if (s.paused === 'lunch') return ['lunch_end'];
  if (s.paused === 'break') return ['break_end'];
  return ['lunch_start', 'break_start', 'out'];
}

/** How a punch reads in a day's list: its kind, or for one without, check-in or check-out by its place. */
export function punchLabels(punches: readonly PunchLike[]): string[] {
  let checks = 0;
  return punches.map((p) => {
    if (p.kind && !isCheck(p.kind)) return PUNCH_LABELS[p.kind];
    checks += 1;
    return p.kind ? PUNCH_LABELS[p.kind] : checks % 2 === 1 ? PUNCH_LABELS.in : PUNCH_LABELS.out;
  });
}

export interface PunchLocation {
  latitude?: number | string | null;
  longitude?: number | string | null;
  accuracy_m?: number | null;
}

export interface PunchPlace {
  /** The exact coordinates, as stored (six decimals: about 10 cm). */
  coords: string;
  /** How sure the device was: "within 18 m". A laptop's guess can be far rougher than a phone's GPS. */
  accuracy: string | null;
  /** The pin in Google Maps; opens the Maps app on a phone. */
  mapsUrl: string;
}

/** Where a punch was made, or null when none was recorded. */
export function punchPlace(p: PunchLocation): PunchPlace | null {
  if (p.latitude == null || p.longitude == null) return null;
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  return {
    coords,
    accuracy: p.accuracy_m == null ? null : `within ${p.accuracy_m} m`,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lng.toFixed(6)}`,
  };
}

export interface DayProgress {
  /** Time at work: each check-in to its check-out, and while checked in, up to now. */
  atWorkMinutes: number;
  /** Lunch and breaks so far (one that's on runs up to now). */
  breakMinutes: number;
  /** Worked: time at work less the larger of the rule's break and the breaks taken (the rule's only past half a day). */
  workedMinutes: number;
  /** Time at work still needed for a full day: the full day's work plus the larger of the rule's break and the breaks. */
  toFullDayMinutes: number;
}

/**
 * A day so far, as the database will count it once it's over (app.compute_attendance_day): a full day of 8 hours with
 * an hour's break is 9 hours at work, however the hour is split, and breaks beyond the hour make the day longer.
 */
export function dayProgress(punches: readonly PunchLike[], now: Date,
  rule: { fullDayMinutes: number; halfDayMinutes: number; breakMinutes: number }): DayProgress {
  const list = sorted(punches);
  let atWork = 0;
  let breaks = 0;
  let inAt: number | null = null;
  let pauseAt: number | null = null;
  for (const p of list) {
    const t = time(p);
    if (isCheck(p.kind)) {
      if (pauseAt !== null) { breaks += t - pauseAt; pauseAt = null; } // checking out ends a lunch or break
      if (inAt === null) inAt = t;
      else { atWork += t - inAt; inAt = null; }
    } else if (p.kind === 'lunch_start' || p.kind === 'break_start') {
      if (inAt !== null && pauseAt === null) pauseAt = t;
    } else if (pauseAt !== null) {
      breaks += t - pauseAt;
      pauseAt = null;
    }
  }
  const nowMs = now.getTime();
  if (inAt !== null) atWork += Math.max(0, nowMs - inAt);
  if (pauseAt !== null) breaks += Math.max(0, nowMs - pauseAt);
  const atWorkMinutes = Math.floor(atWork / 60_000);
  const breakMinutes = Math.floor(breaks / 60_000);
  const allowance = atWorkMinutes > rule.halfDayMinutes ? rule.breakMinutes : 0;
  return {
    atWorkMinutes,
    breakMinutes,
    workedMinutes: Math.max(0, atWorkMinutes - Math.max(allowance, breakMinutes)),
    toFullDayMinutes: Math.max(0, rule.fullDayMinutes + Math.max(rule.breakMinutes, breakMinutes) - atWorkMinutes),
  };
}
