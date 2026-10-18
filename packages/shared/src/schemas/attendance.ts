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

/** The full attendance rule (a shift): timings, verification, overtime, comp-off and the late-mark penalty. */
export const attendanceRuleSchema = z
  .object({
    name: requiredText(60, 'Name'),
    description: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(300).optional()),
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
    overtimeAfterMinutes: optionalInt(0, 720),
    compOffMinMinutes: optionalInt(60, 1440),
    lateMarksAllowed: optionalInt(0, 31),
    latePenaltyDays: z.enum(['0.5', '1']).transform(Number),
  })
  .refine((v) => v.halfDayMinutes <= v.fullDayMinutes, { path: ['halfDayMinutes'], message: 'Can’t exceed a full day' });

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
  allowedIps: z.preprocess(
    (v) => String(v ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    z.array(z.string().regex(ipv4, 'Use IPv4 addresses, optionally with /bits')).max(50),
  ),
});
