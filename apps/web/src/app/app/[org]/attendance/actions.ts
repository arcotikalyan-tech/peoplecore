'use server';

import { revalidatePath } from 'next/cache';
import {
  deviceSchema, geofenceSchema, parseCsv, parseDeviceCsvRows, punchSchema, regularizationSchema, rosterSchema, shiftSchema,
} from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';

/** Attendance actions. record_punch, request_regularization and the settings writes are checked in the database. */

export async function punchAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = punchSchema.safeParse(Object.fromEntries([...formData.entries()].filter(([, v]) => v !== '')));
  if (!parsed.success) return { ok: false, message: 'Couldn’t record the punch. Reload and try again.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_punch', {
    p_client_id: parsed.data.clientId, p_method: 'web', p_latitude: parsed.data.latitude, p_longitude: parsed.data.longitude,
    p_accuracy_m: parsed.data.accuracy, p_org: ctx.org.id,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/attendance`);
  return { ok: true, message: `Punch recorded at ${new Date().toLocaleTimeString('en-IN', { timeZone: ctx.org.timezone, hour: '2-digit', minute: '2-digit' })}.` };
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

export async function createDeviceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manage(orgSlug);
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
  const ctx = await manage(orgSlug);
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
