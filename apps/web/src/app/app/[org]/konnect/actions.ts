'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';

/** Konnect (the discussion board). RLS decides every write: authors their own posts, announcement managers moderate. */

const done = (slug: string, message: string): ActionState => {
  revalidatePath(`/app/${slug}/konnect`);
  return { ok: true, message };
};
const NO_EMPLOYEE: ActionState = { ok: false, message: 'Only employees can post. Your account isn’t linked to an employee record.' };

const threadSchema = z.object({
  topicId: z.uuid({ error: 'Choose a topic' }),
  title: z.string().trim().min(3, 'At least 3 characters').max(160, 'At most 160 characters'),
  body: z.string().trim().min(1, 'Write something').max(5000, 'At most 5,000 characters'),
});

export async function createThreadAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const parsed = threadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return NO_EMPLOYEE;
  const supabase = await createClient();
  const { error } = await supabase.from('konnect_threads').insert({
    organization_id: ctx.org.id, topic_id: parsed.data.topicId, author_employee_id: me.id, title: parsed.data.title, body: parsed.data.body,
  });
  if (error) return { ok: false, message: error.code === '42501' ? 'That topic is closed for new discussions.' : toUserMessage(error), values: formValues(formData) };
  return done(slug, 'Discussion started.');
}

export async function editThreadAction(slug: string, threadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const parsed = threadSchema.omit({ topicId: true }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('konnect_threads').update({ title: parsed.data.title, body: parsed.data.body })
    .eq('id', threadId).eq('organization_id', ctx.org.id).select('id');
  if (error || !data?.length) return { ok: false, message: error ? toUserMessage(error) : 'You can only edit your own discussions.', values: formValues(formData) };
  return done(slug, 'Discussion updated.');
}

export async function replyAction(slug: string, threadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const body = z.string().trim().min(1, 'Write a reply').max(3000, 'At most 3,000 characters').safeParse(formData.get('body'));
  if (!body.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { body: body.error.issues[0]!.message }, values: formValues(formData) };
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return NO_EMPLOYEE;
  const supabase = await createClient();
  const { error } = await supabase.from('konnect_replies').insert({ organization_id: ctx.org.id, thread_id: threadId, author_employee_id: me.id, body: body.data });
  if (error) return { ok: false, message: error.code === '42501' ? 'This discussion is locked.' : toUserMessage(error), values: formValues(formData) };
  return done(slug, 'Reply posted.');
}

export async function likeAction(slug: string, threadId: string, like: boolean): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return NO_EMPLOYEE;
  const supabase = await createClient();
  const { error } = like
    ? await supabase.from('konnect_likes').upsert({ organization_id: ctx.org.id, thread_id: threadId, employee_id: me.id }, { onConflict: 'thread_id,employee_id', ignoreDuplicates: true })
    : await supabase.from('konnect_likes').delete().eq('thread_id', threadId).eq('employee_id', me.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, like ? 'Liked.' : 'Like removed.');
}

const MODERATION = { pin: { pinned: true }, unpin: { pinned: false }, lock: { locked: true }, unlock: { locked: false }, hide: { hidden: true }, unhide: { hidden: false } } as const;

export async function moderateThreadAction(slug: string, threadId: string, op: keyof typeof MODERATION): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('announcement.manage', 'org')) return { ok: false, message: 'Only moderators can do that.' };
  const supabase = await createClient();
  const { error } = await supabase.from('konnect_threads').update(MODERATION[op]).eq('id', threadId).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, { pin: 'Pinned.', unpin: 'Unpinned.', lock: 'Locked: no new replies.', unlock: 'Unlocked.', hide: 'Hidden from everyone but its author.', unhide: 'Visible again.' }[op]);
}

export async function deleteThreadAction(slug: string, threadId: string): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data, error } = await supabase.from('konnect_threads').delete().eq('id', threadId).eq('organization_id', ctx.org.id).select('id');
  if (error || !data?.length) return { ok: false, message: error ? toUserMessage(error) : 'You can only remove your own discussions.' };
  return done(slug, 'Discussion removed.');
}

export async function deleteReplyAction(slug: string, replyId: string): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data, error } = await supabase.from('konnect_replies').delete().eq('id', replyId).eq('organization_id', ctx.org.id).select('id');
  if (error || !data?.length) return { ok: false, message: error ? toUserMessage(error) : 'You can only remove your own replies.' };
  return done(slug, 'Reply removed.');
}

export async function hideReplyAction(slug: string, replyId: string, hide: boolean): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('announcement.manage', 'org')) return { ok: false, message: 'Only moderators can do that.' };
  const supabase = await createClient();
  const { error } = await supabase.from('konnect_replies').update({ hidden: hide }).eq('id', replyId).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, hide ? 'Reply hidden.' : 'Reply visible again.');
}

export async function addTopicAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('announcement.manage', 'org')) return { ok: false, message: 'Only moderators can add topics.' };
  const parsed = z.object({
    name: z.string().trim().min(2, 'At least 2 characters').max(40, 'At most 40 characters'),
    emoji: z.string().trim().max(8).optional(),
    description: z.string().trim().max(200).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { count } = await supabase.from('konnect_topics').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id);
  const { error } = await supabase.from('konnect_topics').insert({
    organization_id: ctx.org.id, name: parsed.data.name, emoji: parsed.data.emoji || null, description: parsed.data.description || null, position: (count ?? 0) + 1,
  });
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a topic with that name.' : toUserMessage(error), values: formValues(formData) };
  return done(slug, `Topic “${parsed.data.name}” added.`);
}

export async function archiveTopicAction(slug: string, topicId: string, archive: boolean): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('announcement.manage', 'org')) return { ok: false, message: 'Only moderators can do that.' };
  const supabase = await createClient();
  const { error } = await supabase.from('konnect_topics').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', topicId).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, archive ? 'Topic closed: its discussions stay readable.' : 'Topic open again.');
}
