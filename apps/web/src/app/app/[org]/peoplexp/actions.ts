'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** PeopleXP. Recognition, points and pulse go through database functions; the rest are table writes RLS restricts. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const NO_EMPLOYEE: ActionState = { ok: false, message: 'You need an employee record in this organization to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());
const back = (slug: string) => revalidatePath(`/app/${slug}/peoplexp`, 'layout');
const uuids = (fd: FormData, name: string) => fd.getAll(name).filter((x): x is string => typeof x === 'string' && z.uuid().safeParse(x).success);
const strings = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const admin = async (slug: string) => {
  const ctx = await getOrgContext(slug);
  return { ctx, ok: ctx.can('peoplexp.manage', 'org') };
};

// ─── Feed ────────────────────────────────────────────────────────────────────

export async function postAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return NO_EMPLOYEE;
  const parsed = z.object({
    body: z.string().trim().min(1, 'Write something').max(3000),
    kind: z.enum(['general', 'classified', 'announcement', 'celebration']),
    audience: z.enum(['team', 'department', 'location', 'org']),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data: emp } = await supabase.from('employees').select('department_id, location_id').eq('id', me.id).maybeSingle();
  if (v.audience === 'department' && !emp?.department_id) return { ok: false, message: 'You aren’t in a department; choose another audience.', values: formValues(formData) };
  if (v.audience === 'location' && !emp?.location_id) return { ok: false, message: 'You don’t have a work location; choose another audience.', values: formValues(formData) };
  const { error } = await supabase.from('pxp_posts').insert({
    organization_id: ctx.org.id, author_employee_id: me.id, kind: v.kind, body: v.body, audience: v.audience,
    audience_department_id: v.audience === 'department' ? emp?.department_id ?? null : null, audience_location_id: v.audience === 'location' ? emp?.location_id ?? null : null,
  });
  if (error) return { ok: false, message: error.code === '42501' && v.kind === 'announcement' ? 'Only PeopleXP admins post announcements.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Posted.' };
}

export async function deletePostAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('postId'));
  if (!id.success) return { ok: false, message: 'Post not found.' };
  const supabase = await createClient();
  const { error, count } = await supabase.from('pxp_posts').delete({ count: 'exact' }).eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  if (!count) return { ok: false, message: 'You can’t delete this post.' };
  back(slug);
  return { ok: true, message: 'Deleted.' };
}

export async function reactAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return NO_EMPLOYEE;
  const id = z.uuid().safeParse(formData.get('postId'));
  const emoji = z.enum(['👏', '❤️', '🎉', '😂', '💡']).safeParse(formData.get('emoji'));
  if (!id.success || !emoji.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const existing = await supabase.from('pxp_reactions').select('post_id').eq('post_id', id.data).eq('employee_id', me.id).eq('emoji', emoji.data).maybeSingle();
  const { error } = existing.data
    ? await supabase.from('pxp_reactions').delete().eq('post_id', id.data).eq('employee_id', me.id).eq('emoji', emoji.data)
    : await supabase.from('pxp_reactions').insert({ organization_id: ctx.org.id, post_id: id.data, employee_id: me.id, emoji: emoji.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: '' };
}

export async function commentAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return NO_EMPLOYEE;
  const parsed = z.object({ postId: z.uuid(), body: z.string().trim().min(1, 'Write a comment').max(1000) }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('pxp_comments').insert({ organization_id: ctx.org.id, post_id: parsed.data.postId, employee_id: me.id, body: parsed.data.body });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Comment added.' };
}

export async function recognizeAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const parsed = z.object({
    badgeId: z.uuid({ error: 'Choose a badge' }),
    message: z.string().trim().min(3, 'Say what they did').max(1000),
    audience: z.enum(['team', 'department', 'location', 'org']),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const recipients = uuids(formData, 'recipientId');
  if (recipients.length === 0) return { ok: false, message: 'Choose who you’re recognising.', values: formValues(formData) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pxp_recognize', {
    p_org: ctx.org.id, p_recipients: recipients, p_badge: parsed.data.badgeId, p_message: parsed.data.message, p_audience: parsed.data.audience,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: (data as { status: string }).status === 'pending' ? 'Sent for approval — high-value badges are checked by an admin first.' : 'Recognition posted 🎉' };
}

export async function decideRecognitionAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ok } = await admin(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('recognitionId'));
  if (!id.success) return { ok: false, message: 'Not found.' };
  const approve = formData.get('decision') !== 'reject';
  const supabase = await createClient();
  const { error } = await supabase.rpc('pxp_decide', { p_recognition: id.data, p_approve: approve });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash(approve ? 'Approved and posted.' : 'Rejected.');
  return { ok: true, message: '' };
}

export async function checkinAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const mood = z.coerce.number().int().min(1).max(5).safeParse(formData.get('mood'));
  if (!mood.success) return { ok: false, message: 'Choose how you feel.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('pxp_checkin', { p_org: ctx.org.id, p_mood: mood.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Thanks for checking in.' };
}

// ─── Culture ─────────────────────────────────────────────────────────────────

export async function nominateAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return NO_EMPLOYEE;
  const parsed = z.object({ nomineeId: z.uuid({ error: 'Choose a colleague' }), valueId: z.uuid({ error: 'Choose a value' }), reason: z.string().trim().min(10, 'Tell us why (10+ characters)').max(1000) })
    .safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('pxp_nominations').insert({
    organization_id: ctx.org.id, nominee_employee_id: parsed.data.nomineeId, nominator_employee_id: me.id, value_id: parsed.data.valueId,
    month: `${new Date().toISOString().slice(0, 7)}-01`, reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: error.code === '23505' ? 'You’ve already nominated someone for this value this month.' : error.code === '23514' ? 'You can’t nominate yourself.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Nomination sent.' };
}

export async function nominationStatusAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('nominationId'));
  const status = z.enum(['winner', 'closed']).safeParse(formData.get('status'));
  if (!id.success || !status.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('pxp_nominations').update({ status: status.data }).eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash(status.data === 'winner' ? 'Marked as winner.' : 'Nomination closed.');
  return { ok: true, message: '' };
}

export async function saveOkrAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    okrId: optional(z.uuid()), title: z.string().trim().min(3, 'Name the objective').max(160), valueId: optional(z.uuid()),
    quarter: z.string().regex(/^\d{4}-(01|04|07|10)-01$/), ownerId: optional(z.uuid()),
    target: z.coerce.number({ error: 'Enter a target' }).positive('Enter a target').max(1e9), current: z.coerce.number().min(0).max(1e9).default(0),
    unit: z.string().trim().max(20).default('%'),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const row = { organization_id: ctx.org.id, title: v.title, value_id: v.valueId ?? null, quarter: v.quarter, owner_employee_id: v.ownerId ?? null, target: v.target, current: v.current, unit: v.unit || '%' };
  const supabase = await createClient();
  const { error } = v.okrId ? await supabase.from('pxp_okrs').update(row).eq('organization_id', ctx.org.id).eq('id', v.okrId) : await supabase.from('pxp_okrs').insert(row);
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.okrId ? 'OKR updated.' : 'OKR created.' };
}

export async function deleteOkrAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('okrId'));
  if (!id.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('pxp_okrs').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Deleted.' };
}

// ─── Rewards and points ──────────────────────────────────────────────────────

export async function redeemAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('rewardId'));
  if (!id.success) return { ok: false, message: 'Reward not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('pxp_redeem', { p_reward: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash('Reward requested — HR will be in touch.');
  return { ok: true, message: 'Requested.' };
}

export async function fulfilAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ok } = await admin(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('redemptionId'));
  const status = z.enum(['fulfilled', 'cancelled']).safeParse(formData.get('status'));
  if (!id.success || !status.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('pxp_fulfil', { p_redemption: id.data, p_status: status.data, p_note: String(formData.get('note') ?? '').trim() || undefined });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash(status.data === 'fulfilled' ? 'Marked fulfilled.' : 'Cancelled and refunded.');
  return { ok: true, message: '' };
}

export async function adjustPointsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ employeeId: z.uuid({ error: 'Choose a person' }), delta: z.coerce.number({ error: 'Enter points' }).int('Whole points').refine((n) => n !== 0, 'Not zero'), note: z.string().trim().min(3, 'Give a reason').max(200) })
    .safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('pxp_adjust', { p_employee: parsed.data.employeeId, p_delta: parsed.data.delta, p_note: parsed.data.note });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Points adjusted.' };
}

// ─── Settings: values, badges, rewards, rules ───────────────────────────────

export async function saveValueAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ valueId: optional(z.uuid()), name: z.string().trim().min(2, 'Name the value').max(60), emoji: z.string().trim().min(1).max(8).default('⭐'), description: optional(z.string().trim().max(300)), archive: optional(z.literal('1')) })
    .safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const row = { organization_id: ctx.org.id, name: v.name, emoji: v.emoji, description: v.description ?? null, archived_at: v.archive ? new Date().toISOString() : null };
  const supabase = await createClient();
  const { error } = v.valueId ? await supabase.from('pxp_values').update(row).eq('organization_id', ctx.org.id).eq('id', v.valueId) : await supabase.from('pxp_values').insert(row);
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a value with that name.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.archive ? 'Value archived.' : 'Value saved.' };
}

export async function saveBadgeAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ badgeId: optional(z.uuid()), name: z.string().trim().min(2, 'Name the badge').max(60), emoji: z.string().trim().min(1).max(8).default('🏅'),
    points: z.coerce.number({ error: 'Enter points' }).int().min(0).max(100000), valueId: optional(z.uuid()), active: z.enum(['true', 'false']).default('true') }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const row = { organization_id: ctx.org.id, name: v.name, emoji: v.emoji, points: v.points, value_id: v.valueId ?? null, active: v.active === 'true' };
  const supabase = await createClient();
  const { error } = v.badgeId ? await supabase.from('pxp_badges').update(row).eq('organization_id', ctx.org.id).eq('id', v.badgeId) : await supabase.from('pxp_badges').insert(row);
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a badge with that name.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Badge saved.' };
}

export async function saveRewardAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ rewardId: optional(z.uuid()), name: z.string().trim().min(2, 'Name the reward').max(80), description: optional(z.string().trim().max(300)),
    cost: z.coerce.number({ error: 'Enter the cost in points' }).int().min(1).max(1_000_000), stock: optional(z.coerce.number().int().min(0).max(1_000_000)),
    active: z.enum(['true', 'false']).default('true') }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const row = { organization_id: ctx.org.id, name: v.name, description: v.description ?? null, cost: v.cost, stock: v.stock ?? null, active: v.active === 'true' };
  const supabase = await createClient();
  const { error } = v.rewardId ? await supabase.from('pxp_rewards').update(row).eq('organization_id', ctx.org.id).eq('id', v.rewardId) : await supabase.from('pxp_rewards').insert(row);
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a reward with that name.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Reward saved.' };
}

export async function saveRulesAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    dailyRecognitions: z.coerce.number({ error: 'Enter a number' }).int().min(1, 'At least 1').max(100),
    dailyPoints: z.coerce.number({ error: 'Enter a number' }).int().min(1, 'At least 1').max(100000),
    threshold: z.coerce.number({ error: 'Enter a number' }).int().min(1, 'At least 1').max(100000),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('pxp_settings').upsert({
    organization_id: ctx.org.id, daily_recognition_limit: parsed.data.dailyRecognitions, daily_points_limit: parsed.data.dailyPoints, high_value_threshold: parsed.data.threshold,
    require_approval: formData.get('requireApproval') === 'on', points_enabled: formData.get('pointsEnabled') === 'on',
    notify_recipient: formData.get('notifyRecipient') === 'on', notify_manager: formData.get('notifyManager') === 'on',
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Settings saved.' };
}
