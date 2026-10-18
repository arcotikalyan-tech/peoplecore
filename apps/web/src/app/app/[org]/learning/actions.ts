'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formDataAll, formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';
import { FORMAT_LABEL, type CourseFormat } from './labels';

/** Learning actions. The database decides who may assign, record and cancel. */

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const FORMATS = Object.keys(FORMAT_LABEL) as [CourseFormat, ...CourseFormat[]];

export async function saveCourseAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('learning.manage', 'org')) return { ok: false, message: 'You don’t have permission to do that.' };
  const parsed = z.object({
    courseId: optional(z.uuid()),
    title: z.string().trim().min(3, 'Give the course a title').max(160),
    description: optional(z.string().trim().max(5000)),
    category: optional(z.string().trim().max(60)),
    format: z.enum(FORMATS),
    url: optional(z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'Use a full https:// link')),
    durationMinutes: optional(z.coerce.number({ error: 'Enter minutes' }).int('Whole minutes').min(1).max(10000)),
    validForMonths: optional(z.coerce.number({ error: 'Enter months' }).int('Whole months').min(1, 'At least 1 month').max(60, 'At most 60 months')),
    selfEnroll: z.preprocess((v) => v === 'on', z.boolean()),
    active: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const row = {
    title: v.title, description: v.description ?? null, category: v.category ?? null, format: v.format, url: v.url ?? null,
    duration_minutes: v.durationMinutes ?? null, valid_for_months: v.validForMonths ?? null, self_enroll: v.selfEnroll,
  };
  const result = v.courseId
    ? await supabase.from('courses').update({ ...row, is_active: v.active }).eq('organization_id', ctx.org.id).eq('id', v.courseId).select('id').single()
    : await supabase.from('courses').insert({ ...row, organization_id: ctx.org.id }).select('id').single();
  if (result.error) return { ok: false, message: toUserMessage(result.error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/learning`, 'layout');
  await flash(v.courseId ? 'Course saved.' : 'Course added.');
  redirect(`/app/${orgSlug}/learning/${result.data.id}`);
}

export async function assignCourseAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    courseId: z.uuid(),
    departmentId: optional(z.uuid()),
    dueOn: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')),
    mandatory: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const ids = new Set(formDataAll(formData, 'employeeIds').filter((x) => z.uuid().safeParse(x).success));
  const supabase = await createClient();
  if (v.departmentId) {
    // RLS limits this to people the caller can see; assign_course then checks each one.
    const { data, error } = await supabase.from('employees').select('id').eq('organization_id', ctx.org.id)
      .eq('department_id', v.departmentId).neq('status', 'exited').limit(5000);
    if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
    for (const e of data) ids.add(e.id);
  }
  if (ids.size === 0) return { ok: false, message: 'Choose people or a department.', fieldErrors: { employeeIds: 'Choose at least one person' }, values: formValues(formData) };
  const { data, error } = await supabase.rpc('assign_course', {
    p_course: v.courseId, p_employees: [...ids], p_due_on: sqlNull(v.dueOn), p_mandatory: v.mandatory,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/learning`, 'layout');
  const skipped = ids.size - (data ?? 0);
  return { ok: true, message: `Assigned to ${data} ${data === 1 ? 'person' : 'people'}.${skipped > 0 ? ` ${skipped} already enrolled.` : ''}` };
}

export async function enrollAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('courseId'));
  if (!id.success) return { ok: false, message: 'Course not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('enroll_in_course', { p_course: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/learning`, 'layout');
  await flash('Enrolled. It’s in your learning now.');
  return { ok: true, message: 'Enrolled.' };
}

export async function updateEnrollmentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    enrollmentId: z.uuid(),
    status: z.enum(['in_progress', 'completed', 'cancelled']),
    note: optional(z.string().trim().max(1000)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_enrollment', {
    p_enrollment: parsed.data.enrollmentId, p_status: parsed.data.status, p_note: sqlNull(parsed.data.note),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/learning`, 'layout');
  const message = parsed.data.status === 'completed' ? 'Marked complete.' : parsed.data.status === 'cancelled' ? 'Cancelled.' : 'Started.';
  await flash(message); // the row's buttons change with its status
  return { ok: true, message };
}
