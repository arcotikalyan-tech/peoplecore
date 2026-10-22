'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  attendanceRequestSchema, attendanceRuleSchema, bulkRegularizationSchema, checkDocumentFile, attendanceSettingsSchema, deviceSchema, geofenceSchema, parseCsv,
  parseDeviceCsvRows, punchSchema, regularizationSchema, rosterSchema, shiftSchema, weekPatternFromForm, workWeekSchema, zonePoints, zoneSchema,
} from '@peoplecore/shared';
import { z } from 'zod';
import { formDataAll, formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';
import { removeDocumentFile, SELFIE_BUCKET, storeDocumentFile } from '@/server/document-storage';
import { requestIp } from '@/server/timesheet';
import type { ZoneTestState } from './automation-client';

/** Attendance actions. record_punch, request_regularization and the settings writes are checked in the database. */

export async function punchAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = punchSchema.safeParse(Object.fromEntries([...formData.entries()].filter(([k, v]) => v !== '' && k !== 'selfie')));
  if (!parsed.success) return { ok: false, message: 'Couldn’t record the punch. Reload and try again.' };
  const supabase = await createClient();
  // A selfie (when the rule asks for one) is stored first under the employee's own folder; the database checks the path.
  let selfie: string | null = null;
  const file = formData.get('selfie');
  if (file instanceof File && file.size > 0) {
    const me = await getMyEmployee(ctx.org.id, ctx.user.id);
    if (!me) return { ok: false, message: 'Your account isn’t linked to an employee record.' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkDocumentFile(bytes.byteLength, bytes.subarray(0, 16));
    if (!check.ok || check.type === 'application/pdf' || bytes.byteLength > 2 * 1024 * 1024) return { ok: false, message: 'Take a photo (JPEG or PNG, up to 2 MB).' };
    selfie = `${ctx.org.id}/${me.id}/${randomUUID()}`;
    if (!(await storeDocumentFile(selfie, bytes, check.type, SELFIE_BUCKET))) return { ok: false, message: 'The selfie could not be stored. Please try again.' };
  }
  const { error } = await supabase.rpc('record_punch', {
    p_client_id: parsed.data.clientId, p_method: 'web', p_latitude: parsed.data.latitude, p_longitude: parsed.data.longitude,
    p_accuracy_m: parsed.data.accuracy, p_org: ctx.org.id, p_ip: (await requestIp()) ?? undefined, p_selfie_path: selfie ?? undefined,
  });
  if (error) {
    if (selfie) await removeDocumentFile(selfie, SELFIE_BUCKET);
    return { ok: false, message: toUserMessage(error) };
  }
  revalidatePath(`/app/${orgSlug}/attendance`);
  return { ok: true, message: `Punch recorded at ${new Date().toLocaleTimeString('en-IN', { timeZone: ctx.org.timezone, hour: '2-digit', minute: '2-digit' })}.` };
}

const rotationSchema = z.object({
  name: z.string().trim().min(2, 'Name the rotation').max(80),
  periodDays: z.coerce.number().int().min(1, 'At least 1 day').max(31, 'At most 31 days'),
  startDate: z.iso.date({ error: 'Choose the first day' }),
});

export async function saveRotationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = rotationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const id = z.uuid().optional().safeParse(formData.get('rotationId') || undefined);
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const pattern = formData.getAll('shiftId').filter((x): x is string => typeof x === 'string' && z.uuid().safeParse(x).success);
  if (pattern.length < 2) return { ok: false, message: 'Choose at least two shifts in the order they rotate.', values: formValues(formData) };
  const supabase = await createClient();
  const row = { name: parsed.data.name, pattern, period_days: parsed.data.periodDays, start_date: parsed.data.startDate };
  const { error } = id.data
    ? await supabase.from('shift_rotations').update(row).eq('id', id.data).eq('organization_id', ctx.org.id)
    : await supabase.from('shift_rotations').insert({ ...row, organization_id: ctx.org.id });
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a rotation with that name.' : toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, id.data ? 'Rotation saved.' : 'Rotation created.');
}

/** Removes a rotation; the people on it go back to their assigned or default rule. */
export async function deleteRotationAction(orgSlug: string, rotationId: string): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  if (!z.uuid().safeParse(rotationId).success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('shift_rotations').delete().eq('id', rotationId).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Rotation removed.');
}

/** Ends someone's rotation today (they go back to their assigned or default rule from tomorrow). */
export async function endRotationAssignmentAction(orgSlug: string, assignmentId: string, today: string): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  if (!z.uuid().safeParse(assignmentId).success || !z.iso.date().safeParse(today).success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('rotation_assignments').update({ effective_to: today }).eq('id', assignmentId).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Rotation ended.');
}

export async function assignRotationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = z.object({ employeeId: z.uuid({ error: 'Choose an employee' }), rotationId: z.uuid({ error: 'Choose a rotation' }), effectiveFrom: z.iso.date({ error: 'Choose a date' }) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('rotation_assignments').insert({
    organization_id: ctx.org.id, employee_id: parsed.data.employeeId, rotation_id: parsed.data.rotationId, effective_from: parsed.data.effectiveFrom,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, 'Rotation assigned.');
}

export async function regularizeAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = regularizationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return { ok: false, message: 'Your account isn’t linked to an employee record.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_regularization', {
    p_employee: me.id, p_date: parsed.data.workDate, p_in: parsed.data.checkIn, p_out: parsed.data.checkOut, p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Regularization requested. Your manager has been asked to approve it.' };
}

/** The same correction for several days; days that can't be asked for are reported, the rest go ahead. */
export async function bulkRegularizeAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = bulkRegularizationSchema.safeParse({ ...Object.fromEntries(formData), workDates: formDataAll(formData, 'workDates') });
  if (!parsed.success) return invalid(parsed.error, formData);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return { ok: false, message: 'Your account isn’t linked to an employee record.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('request_regularizations', {
    p_employee: me.id, p_dates: parsed.data.workDates, p_in: sqlNull(parsed.data.checkIn), p_out: sqlNull(parsed.data.checkOut), p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  const r = data as { requested: number; errors: Array<{ date: string; message: string }> };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  const skipped = r.errors.length ? ` ${r.errors.length} not sent: ${r.errors.slice(0, 3).map((x) => `${x.date}: ${x.message}`).join('; ')}` : '';
  return { ok: r.errors.length === 0, message: `${r.requested} regularization${r.requested === 1 ? '' : 's'} requested.${skipped}` };
}

export async function reviewAnomalyAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ flagId: z.uuid(), status: z.enum(['resolved', 'dismissed']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_anomaly', { p_flag: parsed.data.flagId, p_status: parsed.data.status });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/attendance`);
  return { ok: true, message: parsed.data.status === 'resolved' ? 'Marked resolved.' : 'Dismissed.' };
}

async function manage(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can('attendance.manage', 'org') ? ctx : null;
}
/** Devices: attendance admins and attendance device admins. */
async function manageDevices(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can('attendance.manage', 'org') || ctx.can('attendance.device.manage', 'org') ? ctx : null;
}
const DENIED: ActionState = { ok: false, message: 'You don’t have permission to change attendance settings.' };
const done = (orgSlug: string, message: string): ActionState => {
  revalidatePath(`/app/${orgSlug}/attendance`, 'layout');
  return { ok: true, message };
};

export async function createShiftAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = shiftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('shifts').insert({
    organization_id: ctx.org.id, code: v.code, name: v.name, start_time: v.startTime, end_time: v.endTime,
    break_minutes: v.breakMinutes, grace_minutes: v.graceMinutes, full_day_minutes: v.fullDayMinutes, half_day_minutes: v.halfDayMinutes,
  });
  if (error) return { ok: false, message: error.code === '23505' ? 'A shift with this code already exists.' : toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, `Shift ${v.code} created.`);
}

export async function assignRosterAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = rosterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('roster_assignments').insert({
    organization_id: ctx.org.id, employee_id: parsed.data.employeeId, shift_id: parsed.data.shiftId,
    effective_from: parsed.data.effectiveFrom, effective_to: parsed.data.effectiveTo ?? null,
  });
  if (error) return { ok: false, message: error.code === '23P01' ? 'This overlaps another shift assignment for the employee.' : toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, 'Shift assigned.');
}

export async function createGeofenceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = geofenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('geofences').insert({
    organization_id: ctx.org.id, location_id: v.locationId, name: v.name, latitude: v.latitude, longitude: v.longitude, radius_m: v.radiusM,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, `Geofence “${v.name}” added.`);
}

/** Adds or edits a zone: a circle, a rectangle or a polygon (the database checks the corners and sets the centre). */
export async function saveZoneAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = zoneSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const id = z.uuid().optional().safeParse(formData.get('zoneId') || undefined);
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const v = parsed.data;
  const points = zonePoints(v);
  const row = {
    location_id: v.locationId, name: v.name, shape: v.shape, points,
    latitude: v.shape === 'circle' ? v.latitude : points![0]![0], longitude: v.shape === 'circle' ? v.longitude : points![0]![1],
    radius_m: v.shape === 'circle' ? v.radiusM : null,
  };
  const supabase = await createClient();
  const { error } = id.data
    ? await supabase.from('geofences').update(row).eq('id', id.data).eq('organization_id', ctx.org.id)
    : await supabase.from('geofences').insert({ ...row, organization_id: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, `Zone “${v.name}” saved.`);
}

export async function setZoneActiveAction(orgSlug: string, zoneId: string, active: boolean): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  if (!z.uuid().safeParse(zoneId).success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('geofences').update({ is_active: active }).eq('id', zoneId).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, active ? 'Zone switched on.' : 'Zone switched off.');
}

export async function deleteZoneAction(orgSlug: string, zoneId: string): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  if (!z.uuid().safeParse(zoneId).success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('geofences').delete().eq('id', zoneId).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Zone removed.');
}

/** Tests a point against the zones, the way a check-in there would be judged. */
export async function testZoneAction(orgSlug: string, _prev: ZoneTestState, formData: FormData): Promise<ZoneTestState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = z.object({
    locationId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
    latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180),
    accuracy: z.preprocess((v) => (v === '' ? 0 : v), z.coerce.number().int().min(0).max(5000)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Give a latitude and a longitude (and an accuracy in metres, if you know it).' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('test_geofence', {
    p_org: ctx.org.id, p_location: sqlNull(parsed.data.locationId), p_lat: parsed.data.latitude, p_lng: parsed.data.longitude, p_accuracy: parsed.data.accuracy,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  return { ok: true, results: data as unknown as ZoneTestState['results'], point: [parsed.data.latitude, parsed.data.longitude] };
}

export async function createDeviceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manageDevices(orgSlug);
  if (!ctx) return DENIED;
  const parsed = deviceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('biometric_devices').insert({
    organization_id: ctx.org.id, serial_number: parsed.data.serialNumber, name: parsed.data.name, location_id: parsed.data.locationId ?? null,
  });
  if (error) return { ok: false, message: error.code === '23505' ? 'A device with this serial number already exists.' : toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, `Device “${parsed.data.name}” added.`);
}

export async function importDevicePunchesAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manageDevices(orgSlug);
  if (!ctx) return DENIED;
  const deviceId = z.uuid().safeParse(formData.get('deviceId'));
  const file = formData.get('file');
  if (!deviceId.success) return { ok: false, message: 'Choose a device.' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose the CSV exported from the device.' };
  if (file.size > 2 * 1024 * 1024) return { ok: false, message: 'Files can be at most 2 MB.' };
  let rows;
  try {
    rows = parseDeviceCsvRows(parseCsv(await file.text()));
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  if (rows.error) return { ok: false, message: rows.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_device_punches', { p_device: deviceId.data, p_rows: rows.rows });
  if (error) return { ok: false, message: toUserMessage(error) };
  const r = data as { inserted: number; duplicates: number; errors: Array<{ line: number; message: string }> };
  revalidatePath(`/app/${orgSlug}/attendance`, 'layout');
  const problems = r.errors.length ? ` ${r.errors.length} line(s) skipped: ${r.errors.slice(0, 3).map((e) => `line ${e.line}: ${e.message}`).join('; ')}` : '';
  return { ok: r.errors.length === 0, message: `${r.inserted} punch(es) imported, ${r.duplicates} already seen.${problems}` };
}

// ─── Attendance operations (migration 20261019000100) ───────────────────────

export async function requestAttendanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = attendanceRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return { ok: false, message: 'Your account isn’t linked to an employee record.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_attendance', {
    p_employee: me.id, p_kind: parsed.data.kind, p_start: parsed.data.startDate, p_end: parsed.data.endDate, p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: `${parsed.data.kind === 'wfh' ? 'Work from home' : 'On duty'} requested. Your manager has been asked to approve it.` };
}

const dayKey = z.object({ employeeId: z.uuid(), workDate: z.iso.date() });

export async function decideOvertimeAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = dayKey.extend({ decision: z.enum(['approve', 'reject']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_overtime', { p_employee: parsed.data.employeeId, p_date: parsed.data.workDate, p_approve: parsed.data.decision === 'approve' });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, parsed.data.decision === 'approve' ? 'Overtime approved.' : 'Overtime rejected.');
}

export async function revertCompOffAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await manage(orgSlug))) return DENIED;
  const parsed = dayKey.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('revert_comp_off', { p_employee: parsed.data.employeeId, p_date: parsed.data.workDate });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Comp-off reverted.');
}

export async function runPenaltiesAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const month = z.string().regex(/^\d{4}-\d{2}$/).safeParse(formData.get('month'));
  if (!month.success) return { ok: false, message: 'Choose a month.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('run_attendance_penalties', { p_org: ctx.org.id, p_month: `${month.data}-01` });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, data ? `${data} penalt${data === 1 ? 'y' : 'ies'} applied or updated.` : 'No one is over their late-mark allowance this month.');
}

export async function revertPenaltyAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await manage(orgSlug))) return DENIED;
  const id = z.uuid().safeParse(formData.get('penaltyId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('revert_attendance_penalty', { p_penalty: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Penalty reverted.');
}

/** Saves an attendance rule (a shift): an existing one by id, or a new one with a generated code. */
export async function saveRuleAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = attendanceRuleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const id = z.uuid().optional().safeParse(formData.get('ruleId') || undefined);
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const v = parsed.data;
  const row = {
    name: v.name, description: v.description ?? null, effective_from: v.effectiveFrom ?? null, start_time: v.startTime, end_time: v.endTime,
    break_minutes: v.breakMinutes, grace_minutes: v.graceMinutes, early_grace_minutes: v.earlyGraceMinutes, full_day_minutes: v.fullDayMinutes,
    half_day_minutes: v.halfDayMinutes, verify_selfie: v.verifySelfie, verify_geofence: v.verifyGeofence, verify_ip: v.verifyIp,
    auto_clock_in: v.autoClockIn, auto_clock_out: v.autoClockOut, overtime_after_minutes: v.overtimeAfterMinutes ?? null,
    comp_off_min_minutes: v.compOffMinMinutes ?? null, comp_off_auto_approve: v.compOffAutoApprove, deduct_absent: v.deductAbsent,
    penalties_enabled: v.penaltiesEnabled, late_marks_allowed: v.lateMarksAllowed ?? null, late_interval: v.lateInterval, late_method: v.lateMethod,
    late_penalty_days: v.lateMethod === 'full_day' ? 1 : 0.5,
    early_marks_allowed: v.earlyMarksAllowed ?? null, early_interval: v.earlyInterval, early_method: v.earlyMethod,
    short_marks_allowed: v.shortMarksAllowed ?? null, short_interval: v.shortInterval, short_method: v.shortMethod,
    penalty_leave_order: [v.penaltyLeave1, v.penaltyLeave1 ? v.penaltyLeave2 : undefined].filter((x): x is string => !!x),
  };
  const supabase = await createClient();
  const { error } = id.data
    ? await supabase.from('shifts').update(row).eq('id', id.data).eq('organization_id', ctx.org.id)
    : await supabase.from('shifts').insert({ ...row, organization_id: ctx.org.id, code: v.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 8) + '_' + Math.random().toString(36).slice(2, 5).toUpperCase() });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, `Rule “${v.name}” saved.`);
}

export async function setDefaultRuleAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const id = z.uuid().safeParse(formData.get('ruleId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const cleared = await supabase.from('shifts').update({ is_default: false }).eq('organization_id', ctx.org.id).eq('is_default', true);
  if (cleared.error) return { ok: false, message: toUserMessage(cleared.error) };
  const { error } = await supabase.from('shifts').update({ is_default: true }).eq('id', id.data).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Default rule changed. It applies to everyone without an assigned rule.');
}

/** Copies a rule (not its assignments) as a starting point for a new one. */
export async function duplicateRuleAction(orgSlug: string, ruleId: string): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  if (!z.uuid().safeParse(ruleId).success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data: rule } = await supabase.from('shifts').select('*').eq('id', ruleId).eq('organization_id', ctx.org.id).maybeSingle();
  if (!rule) return { ok: false, message: 'That rule no longer exists.' };
  const { id: _id, created_at: _c, is_default: _d, code: _code, name, ...rest } = rule;
  const copy = `Copy of ${name}`.slice(0, 60);
  const { error } = await supabase.from('shifts').insert({
    ...rest, name: copy, is_default: false, code: name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 6) + '_' + Math.random().toString(36).slice(2, 5).toUpperCase(),
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, `“${copy}” created. Assign people to it under Assignments.`);
}

export async function saveWorkWeekAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = workWeekSchema.safeParse({ name: formData.get('name'), description: formData.get('description') ?? undefined, pattern: weekPatternFromForm(formData) });
  if (!parsed.success) return invalid(parsed.error, formData);
  const id = z.uuid().optional().safeParse(formData.get('weekId') || undefined);
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const row = { name: parsed.data.name, description: parsed.data.description ?? null, pattern: parsed.data.pattern };
  const supabase = await createClient();
  const { error } = id.data
    ? await supabase.from('work_week_rules').update(row).eq('id', id.data).eq('organization_id', ctx.org.id)
    : await supabase.from('work_week_rules').insert({ ...row, organization_id: ctx.org.id });
  if (error) return { ok: false, message: error.code === '23505' ? 'A work week with this name already exists.' : toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, `Work week “${parsed.data.name}” saved.`);
}

export async function setDefaultWorkWeekAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const id = z.uuid().safeParse(formData.get('weekId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const cleared = await supabase.from('work_week_rules').update({ is_default: false }).eq('organization_id', ctx.org.id).eq('is_default', true);
  if (cleared.error) return { ok: false, message: toUserMessage(cleared.error) };
  const { error } = await supabase.from('work_week_rules').update({ is_default: true }).eq('id', id.data).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Default work week set. It applies to everyone without an assigned work week.');
}

export async function assignWorkWeekAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = z.object({ weekId: z.uuid(), employeeIds: z.array(z.uuid()).min(1, 'Choose at least one person').max(500), effectiveFrom: z.iso.date() })
    .safeParse({ weekId: formData.get('weekId'), employeeIds: formData.getAll('employeeIds'), effectiveFrom: formData.get('effectiveFrom') });
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('work_week_assignments').upsert(
    parsed.data.employeeIds.map((e) => ({ organization_id: ctx.org.id, employee_id: e, rule_id: parsed.data.weekId, effective_from: parsed.data.effectiveFrom })),
    { onConflict: 'employee_id,effective_from' });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, `Work week assigned to ${parsed.data.employeeIds.length} ${parsed.data.employeeIds.length === 1 ? 'person' : 'people'}.`);
}

export async function saveAttendanceSettingsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
  if (!ctx) return DENIED;
  const parsed = attendanceSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('attendance_settings').update({
    cycle_start_day: v.cycleStartDay, remind_missing_checkout: v.remindMissingCheckout, pending_digest: v.pendingDigest,
    late_punch_alert: v.latePunchAlert, skip_level_approval: v.skipLevelApproval, allowed_ips: v.allowedIps,
    daily_summary: v.dailySummary, punch_reminders: v.punchReminders, comp_off_notify_employee: v.compOffNotifyEmployee,
    comp_off_notify_hr: v.compOffNotifyHr, regularize_days_back: v.regularizeDaysBack, regularize_monthly_limit: v.regularizeMonthlyLimit ?? null,
  }).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, 'Attendance settings saved.');
}

// ─── Bulk boards and saved views (migration 20261021000600) ─────────────────

const dayItem = /^([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/;
const dayItems = (formData: FormData) => formDataAll(formData, 'item').map((x) => dayItem.exec(x)).filter((m): m is RegExpExecArray => !!m)
  .map((m) => ({ employeeId: m[1]!, workDate: m[2]! }));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Penalty log: revert the selected penalties (their leave comes back). */
export async function penaltyBoardAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await manage(orgSlug))) return DENIED;
  const ids = formDataAll(formData, 'item').filter((x) => z.uuid().safeParse(x).success);
  if (ids.length === 0) return { ok: false, message: 'Choose the penalties to revert.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('revert_attendance_penalties', { p_ids: ids });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, `${plural(Number(data), 'penalty', 'penalties')} reverted.`);
}

/** Comp-off log: approve or reject comp-off that is waiting, or revert credited comp-off. */
export async function compOffBoardAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const op = z.enum(['approve', 'reject', 'revert']).safeParse(formData.get('op'));
  const items = dayItems(formData);
  if (!op.success || items.length === 0) return { ok: false, message: 'Choose the comp-off to act on.' };
  const supabase = await createClient();
  const { data, error } = op.data === 'revert'
    ? await supabase.rpc('revert_comp_offs', { p_items: items })
    : await supabase.rpc('decide_comp_offs', { p_items: items, p_approve: op.data === 'approve' });
  if (error) return { ok: false, message: toUserMessage(error) };
  const n = Number(data);
  return done(orgSlug, n === 0 ? 'Nothing to change: those were already decided.'
    : `${plural(n, 'comp-off')} ${op.data === 'approve' ? 'approved and credited' : op.data === 'reject' ? 'rejected' : 'reverted'}.`);
}

/** Overtime log: approve or reject the selected overtime. */
export async function overtimeBoardAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const op = z.enum(['approve', 'reject']).safeParse(formData.get('op'));
  const items = dayItems(formData);
  if (!op.success || items.length === 0) return { ok: false, message: 'Choose the overtime to decide.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_overtimes', { p_items: items, p_approve: op.data === 'approve' });
  if (error) return { ok: false, message: toUserMessage(error) };
  const n = Number(data);
  return done(orgSlug, n === 0 ? 'Nothing to change: those were already decided.' : `${plural(n, 'overtime entry', 'overtime entries')} ${op.data === 'approve' ? 'approved' : 'rejected'}.`);
}

const VIEW_PARAMS = ['tab', 'view', 'date', 'month', 'q', 'dept', 'kind', 'status'];

/** Keeps the current filters of a page as a named view for the person saving it. */
export async function saveViewAction(orgSlug: string, page: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const name = z.string().trim().min(1, 'Name the view').max(60).safeParse(formData.get('name'));
  if (!name.success) return { ok: false, message: 'Name the view (up to 60 characters).' };
  let params: Record<string, string>;
  try {
    const raw = JSON.parse(String(formData.get('params') ?? '{}')) as Record<string, unknown>;
    params = Object.fromEntries(Object.entries(raw).filter(([k, v]) => VIEW_PARAMS.includes(k) && typeof v === 'string' && v.length <= 100)) as Record<string, string>;
  } catch {
    return { ok: false, message: 'Invalid request.' };
  }
  const supabase = await createClient();
  const { count } = await supabase.from('saved_views').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('page', page);
  if ((count ?? 0) >= 30) return { ok: false, message: 'You can keep up to 30 views here. Remove one first.' };
  const { error } = await supabase.from('saved_views').upsert({ organization_id: ctx.org.id, user_id: ctx.user.id, page, name: name.data, params },
    { onConflict: 'organization_id,user_id,page,name' });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/attendance`);
  return { ok: true, message: `View “${name.data}” saved.` };
}

export async function deleteViewAction(orgSlug: string, viewId: string): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!z.uuid().safeParse(viewId).success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('saved_views').delete().eq('id', viewId).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/attendance`);
  return { ok: true, message: 'View removed.' };
}
