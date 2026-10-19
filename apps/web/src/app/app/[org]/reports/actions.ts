'use server';

import { revalidatePath } from 'next/cache';
import { todayIn } from '@peoplecore/shared';
import { z } from 'zod';
import { formDataAll, formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { BUILDER_COLUMNS, BUILDER_GROUPS, REPORT_BY_KEY, SCHEDULE_PERIODS } from '@/lib/report-catalog';
import { getOrgContext } from '@/server/context';
import { canRun } from '@/server/reports';
import { createClient } from '@/server/supabase';

/** Saved custom-report templates and report schedules. Both hold settings only; RLS keeps them to their owner. */

const path = (slug: string) => `/app/${slug}/reports`;
const uuid = z.uuid();
const optionalUuid = z.preprocess((v) => (v === '' ? undefined : v), uuid.optional());

export async function saveTemplateAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!canRun(ctx, 'directory')) return { ok: false, message: 'You can’t build reports.' };
  const name = z.string().trim().min(2, 'Name the template').max(80).safeParse(formData.get('templateName'));
  if (!name.success) return { ok: false, fieldErrors: { templateName: name.error.issues[0]!.message }, values: formValues(formData) };
  const columns = formDataAll(formData, 'columns').filter((c) => BUILDER_COLUMNS.some((b) => b.key === c));
  if (columns.length === 0) return { ok: false, message: 'Choose at least one column.' };
  const group = BUILDER_GROUPS.some((g) => g.key === formData.get('group')) ? String(formData.get('group')) : null;
  const supabase = await createClient();
  const { error } = await supabase.from('report_templates').insert({
    organization_id: ctx.org.id, name: name.data, config: { columns, group }, shared: formData.get('shared') === 'on',
  });
  if (error) return { ok: false, message: error.code === '23505' ? 'You already have a template with that name.' : toUserMessage(error), values: formValues(formData) };
  revalidatePath(path(slug));
  return { ok: true, message: `Template “${name.data}” saved. Run it from Saved Templates.` };
}

export async function deleteTemplateAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = uuid.safeParse(formData.get('templateId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('report_templates').delete().eq('id', id.data).select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length === 0) return { ok: false, message: 'Only the person who saved a template can delete it.' };
  revalidatePath(path(slug));
  return { ok: true, message: 'Template deleted.' };
}

/** The first reminder: next Monday (weekly) or the 1st of next month (monthly), in the organization's time zone. */
function firstRun(today: string, frequency: 'weekly' | 'monthly') {
  const d = new Date(`${today}T00:00:00Z`);
  if (frequency === 'weekly') { d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7)); return d.toISOString().slice(0, 10); }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export async function createScheduleAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const info = REPORT_BY_KEY.get(String(formData.get('report') ?? ''));
  if (!info || !canRun(ctx, info.access)) return { ok: false, message: 'You can’t run this report.' };
  const parsed = z.object({
    frequency: z.enum(['weekly', 'monthly']),
    period: z.string().refine((p) => SCHEDULE_PERIODS[info.param].some((x) => x.key === p), 'Choose a period'),
    department: optionalUuid, location: optionalUuid, template: optionalUuid,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose how often and for which period.', values: formValues(formData) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('report_schedules').insert({
    organization_id: ctx.org.id, report_key: info.key, frequency: v.frequency, next_run_on: firstRun(todayIn(ctx.org.timezone), v.frequency),
    params: { title: info.title, period: v.period, ...(v.department ? { department: v.department } : {}), ...(v.location ? { location: v.location } : {}), ...(v.template ? { template: v.template } : {}) },
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(path(slug));
  return { ok: true, message: `Scheduled. You’ll get an inbox reminder ${v.frequency === 'weekly' ? 'every Monday' : 'on the 1st of every month'}.` };
}

export async function deleteScheduleAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = uuid.safeParse(formData.get('scheduleId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('report_schedules').delete().eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(path(slug));
  return { ok: true, message: 'Schedule removed.' };
}
