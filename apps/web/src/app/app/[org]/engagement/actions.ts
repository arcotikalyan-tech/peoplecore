'use server';

import { revalidatePath } from 'next/cache';
import { addDays, isIsoDate, startOfDayIn, todayIn } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';

/** Announcements and kudos. The database checks announcement.manage, audiences and membership. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optionalId = z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional());

const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Give it a title').max(160),
  body: z.string().trim().min(3, 'Write the announcement').max(10000),
  departmentId: optionalId,
  locationId: optionalId,
  requiresAck: z.preprocess((v) => v === 'on', z.boolean()),
  showUntil: z.preprocess((v) => (v === '' ? undefined : v), z.string().refine(isIsoDate, 'Choose a date').optional()),
});

export async function publishAnnouncementAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('announcement.manage', 'org')) return DENIED;
  const parsed = announcementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  if (v.showUntil && v.showUntil < todayIn(ctx.org.timezone)) {
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { showUntil: 'Choose today or a later date' }, values: formValues(formData) };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('announcements').insert({
    organization_id: ctx.org.id, title: v.title, body: v.body, department_id: v.departmentId ?? null, location_id: v.locationId ?? null,
    requires_ack: v.requiresAck,
    // Shown through the end of the chosen day in the organization's time zone.
    expires_at: v.showUntil ? startOfDayIn(addDays(v.showUntil, 1), ctx.org.timezone).toISOString() : null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/engagement`);
  return { ok: true, message: 'Announcement published.' };
}

export async function deleteAnnouncementAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('announcement.manage', 'org')) return DENIED;
  const id = z.uuid().safeParse(formData.get('announcementId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('announcements').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/engagement`);
  await flash('Announcement removed.');
  return { ok: true, message: 'Announcement removed.' };
}

export async function acknowledgeAnnouncementAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!(await getMyEmployee(ctx.org.id, ctx.user.id))) return { ok: false, message: 'Your account isn’t linked to an employee record.' };
  const id = z.uuid().safeParse(formData.get('announcementId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('acknowledge_announcement', { p_announcement: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/engagement`);
  await flash('Acknowledged.');
  return { ok: true, message: 'Acknowledged.' };
}

export async function giveKudosAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    to: z.uuid({ error: 'Choose a colleague' }),
    message: z.string().trim().min(3, 'Say what they did').max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('give_kudos', { p_org: ctx.org.id, p_to: parsed.data.to, p_message: parsed.data.message });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/engagement`);
  return { ok: true, message: 'Kudos sent.' };
}
