import { z } from 'zod';
import { isoDate, optionalUuid, requiredText, uuid } from './common.ts';

/** Mirrors the attendance enums and checks (migrations 20261018001300, 20261019000100). */
export const ATTENDANCE_STATUSES = ['present', 'half_day', 'absent', 'on_leave', 'weekly_off', 'holiday', 'not_marked', 'wfh', 'on_duty'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', half_day: 'Half day', absent: 'Absent', on_leave: 'On leave',
  weekly_off: 'Weekly off', holiday: 'Holiday', not_marked: 'Not marked yet', wfh: 'Work from home', on_duty: 'On duty',
};

const time = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const optionalTime = z.preprocess((v) => (v === '' || v == null ? undefined : v), time.optional());

export const punchSchema = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().int().min(0).max(100000).optional(),
});

export const regularizationSchema = z
  .object({ workDate: isoDate, checkIn: optionalTime, checkOut: optionalTime, reason: requiredText(500, 'Reason') })
  .refine((v) => v.checkIn || v.checkOut, { path: ['checkIn'], message: 'Give a check-in time, a check-out time, or both' })
  .refine((v) => !v.checkIn || !v.checkOut || v.checkOut > v.checkIn, { path: ['checkOut'], message: 'Check-out must be after check-in' });

export const shiftSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/, 'Up to 12 letters, digits, _ or -'),
    name: requiredText(60, 'Name'),
    startTime: time,
    endTime: time,
    breakMinutes: z.coerce.number().int().min(0).max(240),
    graceMinutes: z.coerce.number().int().min(0).max(240),
    fullDayMinutes: z.coerce.number().int().min(60).max(1440),
    halfDayMinutes: z.coerce.number().int().min(30).max(1440),
  })
  .refine((v) => v.halfDayMinutes <= v.fullDayMinutes, { path: ['halfDayMinutes'], message: 'Can’t exceed a full day' });

export const rosterSchema = z.object({
  employeeId: uuid,
  shiftId: uuid,
  effectiveFrom: isoDate,
  effectiveTo: z.preprocess((v) => (v === '' ? undefined : v), isoDate.optional()),
});

export const geofenceSchema = z.object({
  locationId: uuid,
  name: requiredText(80, 'Name'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().int().min(20).max(5000),
});

export const ZONE_SHAPES = ['circle', 'rectangle', 'polygon'] as const;
export type ZoneShape = (typeof ZONE_SHAPES)[number];
export const ZONE_SHAPE_LABELS: Record<ZoneShape, string> = { circle: 'Circle', rectangle: 'Rectangle', polygon: 'Polygon' };
export type LatLng = [number, number];

/**
 * Corners typed one per line as "latitude, longitude" (or pasted from a map: "12.9716, 77.5946"). Returns the points
 * or an error for the first line that isn't a coordinate pair.
 */
export function parseZonePoints(text: string): { points: LatLng[]; error?: string } {
  const points: LatLng[] = [];
  const lines = text.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const m = /^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(line);
    const lat = m ? Number(m[1]) : NaN;
    const lng = m ? Number(m[2]) : NaN;
    if (!m || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { points, error: `Line ${i + 1} isn’t a latitude and a longitude.` };
    points.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
  }
  return { points };
}

const lat = z.coerce.number({ error: 'Latitude' }).min(-90, 'Between -90 and 90').max(90, 'Between -90 and 90');
const lng = z.coerce.number({ error: 'Longitude' }).min(-180, 'Between -180 and 180').max(180, 'Between -180 and 180');

/** A zone (migration 20261021000600): a circle (centre and radius), a rectangle (two corners) or a polygon (3–50 corners). */
export const zoneSchema = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('circle'), locationId: uuid, name: requiredText(80, 'Name'), latitude: lat, longitude: lng,
    radiusM: z.coerce.number().int().min(20, 'At least 20 m').max(5000, 'At most 5,000 m') }),
  z.object({ shape: z.literal('rectangle'), locationId: uuid, name: requiredText(80, 'Name'),
    lat1: lat, lng1: lng, lat2: lat, lng2: lng })
    .refine((v) => v.lat1 !== v.lat2 && v.lng1 !== v.lng2, { path: ['lat2'], message: 'Give two opposite corners' }),
  z.object({ shape: z.literal('polygon'), locationId: uuid, name: requiredText(80, 'Name'), points: z.string().max(4000) })
    .superRefine((v, c) => {
      const r = parseZonePoints(v.points);
      if (r.error) c.addIssue({ code: 'custom', path: ['points'], message: r.error });
      else if (r.points.length < 3 || r.points.length > 50) c.addIssue({ code: 'custom', path: ['points'], message: 'Give 3 to 50 corners, one per line' });
    }),
]);

/** The zone's corners as stored ([lat, lng] pairs), or null for a circle. */
export function zonePoints(v: z.infer<typeof zoneSchema>): LatLng[] | null {
  if (v.shape === 'circle') return null;
  if (v.shape === 'rectangle') return [[v.lat1, v.lng1], [v.lat2, v.lng2]];
  return parseZonePoints(v.points).points;
}

/** Area (m²) and perimeter (m) of a zone, on a flat projection (good for zones up to a few kilometres). */
export function zoneMeasures(shape: ZoneShape, points: LatLng[] | null, radiusM: number | null): { area: number; perimeter: number } {
  if (shape === 'circle') {
    const r = radiusM ?? 0;
    return { area: Math.PI * r * r, perimeter: 2 * Math.PI * r };
  }
  const pts = shape === 'rectangle' && points?.length === 2
    ? [points[0]!, [points[0]![0], points[1]![1]] as LatLng, points[1]!, [points[1]![0], points[0]![1]] as LatLng]
    : (points ?? []);
  if (pts.length < 3) return { area: 0, perimeter: 0 };
  const k = (Math.PI / 180) * 6371000;
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const xy = pts.map(([la, lo]) => [lo * k * Math.cos((lat0 * Math.PI) / 180), la * k] as const);
  let area = 0;
  let perimeter = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i]!;
    const [x2, y2] = xy[(i + 1) % xy.length]!;
    area += x1 * y2 - x2 * y1;
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  return { area: Math.abs(area) / 2, perimeter };
}

export const deviceSchema = z.object({
  serialNumber: z.string().trim().regex(/^[A-Za-z0-9_-]{3,60}$/, '3–60 letters, digits, _ or -'),
  name: requiredText(80, 'Name'),
  locationId: optionalUuid,
});

/** Biometric export rows: employee_code, punched_at (local time or with offset), record_id. */
export function parseDeviceCsvRows(rows: string[][]): { rows: Array<{ line: number; employee_code: string; punched_at: string; record_id: string }>; error?: string } {
  const [header, ...body] = rows;
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const at = (name: string) => cols.indexOf(name);
  if (at('employee_code') < 0 || at('punched_at') < 0 || at('record_id') < 0) {
    return { rows: [], error: 'The file needs the columns employee_code, punched_at and record_id.' };
  }
  return {
    rows: body.map((r, i) => ({
      line: i + 2,
      employee_code: (r[at('employee_code')] ?? '').trim(),
      punched_at: (r[at('punched_at')] ?? '').trim(),
      record_id: (r[at('record_id')] ?? '').trim(),
    })),
  };
}

// ─── Attendance operations (migration 20261019000100) ───────────────────────

const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(min).max(max).optional());
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const PENALTY_METHODS = ['full_day', 'half_day', 'hourly'] as const;
export const SHORT_HOURS_METHODS = [...PENALTY_METHODS, 'half_day_by_duration'] as const;
export type PenaltyMethod = (typeof SHORT_HOURS_METHODS)[number];
export const PENALTY_METHOD_LABELS: Record<PenaltyMethod, string> = {
  full_day: 'A full day', half_day: 'Half a day', hourly: 'Hourly (pro rata)', half_day_by_duration: 'Half day by duration',
};
export const PENALTY_KINDS = ['late_marks', 'early_exits', 'short_hours', 'absent'] as const;
export type PenaltyKind = (typeof PENALTY_KINDS)[number];
export const PENALTY_KIND_LABELS: Record<PenaltyKind, string> = {
  late_marks: 'Late coming', early_exits: 'Early leaving', short_hours: 'Short hours', absent: 'Absent',
};

const interval = z.preprocess((v) => (v === '' || v == null ? 1 : v), z.coerce.number().int().min(1, 'At least 1').max(31, 'At most 31'));
const optionalDate = z.preprocess((v) => (v === '' || v == null ? undefined : v), isoDate.optional());

/**
 * The full attendance rule (a shift): timings and effective date, verification and automatic clock-in/out, overtime,
 * comp-off, automatic deduction, and the penalty rules (migration 20261021000600).
 */
export const attendanceRuleSchema = z
  .object({
    name: requiredText(60, 'Name'),
    description: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(300).optional()),
    effectiveFrom: optionalDate,
    startTime: time,
    endTime: time,
    breakMinutes: z.coerce.number().int().min(0).max(240),
    graceMinutes: z.coerce.number().int().min(0).max(240),
    earlyGraceMinutes: z.coerce.number().int().min(0).max(240),
    fullDayMinutes: z.coerce.number().int().min(60).max(1440),
    halfDayMinutes: z.coerce.number().int().min(30).max(1440),
    verifySelfie: checkbox,
    verifyGeofence: checkbox,
    verifyIp: checkbox,
    autoClockIn: checkbox,
    autoClockOut: checkbox,
    overtimeAfterMinutes: optionalInt(0, 720),
    compOffMinMinutes: optionalInt(60, 1440),
    compOffAutoApprove: checkbox,
    deductAbsent: checkbox,
    penaltiesEnabled: checkbox,
    lateMarksAllowed: optionalInt(0, 31),
    lateInterval: interval,
    lateMethod: z.enum(PENALTY_METHODS).default('half_day'),
    earlyMarksAllowed: optionalInt(0, 31),
    earlyInterval: interval,
    earlyMethod: z.enum(PENALTY_METHODS).default('half_day'),
    shortMarksAllowed: optionalInt(0, 31),
    shortInterval: interval,
    shortMethod: z.enum(SHORT_HOURS_METHODS).default('half_day_by_duration'),
    penaltyLeave1: optionalUuid,
    penaltyLeave2: optionalUuid,
  })
  .refine((v) => v.halfDayMinutes <= v.fullDayMinutes, { path: ['halfDayMinutes'], message: 'Can’t exceed a full day' })
  .refine((v) => !v.penaltyLeave1 || v.penaltyLeave1 !== v.penaltyLeave2, { path: ['penaltyLeave2'], message: 'Choose a different leave type' });

/** What a penalty rule does, in a sentence: "4 late arrivals allowed per cycle; then half a day for every 3 more, from Casual leave → loss of pay." */
export function describePenalty(allowed: number | null, step: number, method: PenaltyMethod, noun: string, ladder: string[]): string {
  if (allowed === null) return `No ${noun} penalty.`;
  if (method === 'half_day_by_duration') return 'A short day is a half day by its duration; nothing more is deducted.';
  const unit = method === 'full_day' ? 'a full day' : 'half a day';
  const then = method === 'hourly' ? 'then the time itself, pro rata to a full day'
    : step === 1 ? `then ${unit} for each one after that` : `then ${unit} for every ${step} more`;
  return `${allowed} ${noun} allowed per cycle; ${then}, from ${[...ladder, 'loss of pay'].join(' → ')}.`;
}

export const WEEK_DAY_CODES = ['W', 'H', 'O'] as const;
export const WEEK_DAY_LABELS: Record<(typeof WEEK_DAY_CODES)[number], string> = { W: 'Working day', H: 'Half day', O: 'Weekly off' };

/** A 5-week work-week pattern from 35 form fields named d{week}{day} (week 1–5, day 1 = Monday … 7 = Sunday). */
export const workWeekSchema = z.object({
  name: requiredText(60, 'Name'),
  description: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(300).optional()),
  pattern: z.array(z.string().regex(/^[WHO]{7}$/)).length(5),
});

export function weekPatternFromForm(form: { get(name: string): unknown }): string[] {
  return [1, 2, 3, 4, 5].map((w) => [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const v = String(form.get(`d${w}${d}`) ?? 'W');
    return (WEEK_DAY_CODES as readonly string[]).includes(v) ? v : 'W';
  }).join(''));
}

export const ATTENDANCE_REQUEST_KINDS = ['wfh', 'on_duty'] as const;
export const ATTENDANCE_REQUEST_LABELS: Record<(typeof ATTENDANCE_REQUEST_KINDS)[number], string> = { wfh: 'Work from home', on_duty: 'On duty' };

export const attendanceRequestSchema = z
  .object({
    kind: z.enum(ATTENDANCE_REQUEST_KINDS),
    startDate: isoDate,
    endDate: isoDate,
    reason: requiredText(500, 'Reason'),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'Must be on or after the start date' });

const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([12]?\d|3[0-2]))?$/;

export const attendanceSettingsSchema = z.object({
  cycleStartDay: z.coerce.number().int().min(1).max(28),
  remindMissingCheckout: checkbox,
  pendingDigest: checkbox,
  latePunchAlert: checkbox,
  skipLevelApproval: checkbox,
  dailySummary: checkbox,
  punchReminders: checkbox,
  compOffNotifyEmployee: checkbox,
  compOffNotifyHr: checkbox,
  regularizeDaysBack: z.preprocess((v) => (v === '' || v == null ? 60 : v), z.coerce.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days')),
  regularizeMonthlyLimit: optionalInt(1, 31),
  allowedIps: z.preprocess(
    (v) => String(v ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    z.array(z.string().regex(ipv4, 'Use IPv4 addresses, optionally with /bits')).max(50),
  ),
});

/** The same correction for several days at once (migration 20261021000600). */
export const bulkRegularizationSchema = z
  .object({
    workDates: z.array(isoDate).min(1, 'Choose at least one day').max(31, 'Choose at most 31 days'),
    checkIn: optionalTime,
    checkOut: optionalTime,
    reason: requiredText(500, 'Reason'),
  })
  .refine((v) => v.checkIn || v.checkOut, { path: ['checkIn'], message: 'Give a check-in time, a check-out time, or both' })
  .refine((v) => !v.checkIn || !v.checkOut || v.checkOut > v.checkIn, { path: ['checkOut'], message: 'Check-out must be after check-in' });

/** The cycle a day belongs to, named by the first of the month it ends in (on or after day N > 1: next month's cycle). */
export function attendanceCycleMonth(date: string, startDay: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (startDay <= 1 || Number(date.slice(8, 10)) < startDay) return `${date.slice(0, 7)}-01`;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** The attendance cycle a month names (the month it ends in): starting on day N > 1, from N of the month before. */
export function attendanceCycle(month: string, startDay: number): { from: string; to: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (startDay <= 1) return { from: `${month.slice(0, 7)}-01`, to: iso(new Date(Date.UTC(y, m, 0))) };
  return { from: iso(new Date(Date.UTC(y, m - 2, startDay))), to: iso(new Date(Date.UTC(y, m - 1, startDay - 1))) };
}
