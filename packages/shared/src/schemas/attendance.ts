import { z } from 'zod';
import { isoDate, optionalUuid, requiredText, uuid } from './common.ts';

/** Mirrors the attendance enums and checks (migration 20261018001300). */
export const ATTENDANCE_STATUSES = ['present', 'half_day', 'absent', 'on_leave', 'weekly_off', 'holiday', 'not_marked'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', half_day: 'Half day', absent: 'Absent', on_leave: 'On leave',
  weekly_off: 'Weekly off', holiday: 'Holiday', not_marked: 'Not marked yet',
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
