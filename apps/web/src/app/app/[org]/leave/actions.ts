'use server';

import { revalidatePath } from 'next/cache';
import { adjustLeaveSchema, applyLeaveSchema, holidaySchema, leavePolicySchema } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';

/** Leave actions. apply_leave / cancel_leave / adjust_leave_balance check permissions in the database. */

export async function applyLeaveAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = applyLeaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const employeeId = v.employeeId ?? (await getMyEmployee(ctx.org.id, ctx.user.id))?.id;
  if (!employeeId) return { ok: false, message: 'Your account isn’t linked to an employee record. Ask HR to link it.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('apply_leave', {
    p_employee: employeeId, p_type: v.leaveTypeId, p_start: v.startDate, p_end: v.endDate,
    p_half_start: v.halfDayStart, p_half_end: v.halfDayEnd, p_reason: v.reason,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Leave requested. Your manager has been asked to approve it.' };
}

export async function cancelLeaveAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('requestId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_leave', { p_request: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  await flash('Leave cancelled.');
  return { ok: true, message: 'Leave cancelled.' };
}

async function manager(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can('leave.manage', 'org') ? ctx : null;
}
const DENIED: ActionState = { ok: false, message: 'You don’t have permission to change leave settings.' };

export async function adjustBalanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await manager(orgSlug))) return DENIED;
  const parsed = adjustLeaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('adjust_leave_balance', {
    p_employee: parsed.data.employeeId, p_type: parsed.data.leaveTypeId, p_days: parsed.data.days, p_note: parsed.data.note,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/leave`, 'layout');
  return { ok: true, message: `Balance adjusted by ${parsed.data.days} day(s).` };
}

export async function addHolidayAction(orgSlug: string, calendarId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manager(orgSlug);
  if (!ctx) return DENIED;
  const parsed = holidaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').insert({
    organization_id: ctx.org.id, calendar_id: z.uuid().parse(calendarId), holiday_date: parsed.data.holidayDate,
    name: parsed.data.name, is_optional: parsed.data.isOptional,
  });
  if (error) {
    const message = error.code === '23505' ? 'There is already a holiday on that date.' : toUserMessage(error);
    return { ok: false, message, values: formValues(formData) };
  }
  revalidatePath(`/app/${orgSlug}/leave`, 'layout');
  return { ok: true, message: `“${parsed.data.name}” added.` };
}

export async function removeHolidayAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manager(orgSlug);
  if (!ctx) return DENIED;
  const id = z.uuid().safeParse(formData.get('holidayId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/leave`, 'layout');
  return { ok: true, message: 'Holiday removed.' };
}

export async function addPolicyVersionAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manager(orgSlug);
  if (!ctx) return DENIED;
  const parsed = leavePolicySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('leave_policies').insert({
    organization_id: ctx.org.id, leave_type_id: v.leaveTypeId, effective_from: v.effectiveFrom,
    accrual_period: v.accrualPeriod, accrual_days: v.accrualPeriod === 'none' ? 0 : v.accrualDays,
    carry_forward_max: v.carryForwardMax ?? null,
  });
  if (error) {
    const message = error.code === '23505' ? 'A version already starts on that date for this leave type.' : toUserMessage(error);
    return { ok: false, message, values: formValues(formData) };
  }
  revalidatePath(`/app/${orgSlug}/leave`, 'layout');
  return { ok: true, message: 'New policy version saved. It applies from its start date; earlier periods keep the old rules.' };
}
