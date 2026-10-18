'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Helpdesk and knowledge-base actions. The database decides who may reply, change or close a ticket. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export async function raiseTicketAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    categoryId: z.uuid({ error: 'Choose a category' }),
    subject: z.string().trim().min(3, 'Give the ticket a short subject').max(160),
    description: z.string().trim().min(10, 'Describe the problem in a sentence or two').max(5000),
    priority: z.enum(PRIORITIES),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('raise_ticket', {
    p_org: ctx.org.id, p_category: v.categoryId, p_subject: v.subject, p_description: v.description, p_priority: v.priority,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  await flash('Ticket raised. You’ll be notified when someone replies.');
  redirect(`/app/${orgSlug}/helpdesk/${data}`);
}

export async function replyTicketAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    ticketId: z.uuid(),
    body: z.string().trim().min(1, 'Write a reply').max(5000),
    internal: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('comment_ticket', { p_ticket: parsed.data.ticketId, p_body: parsed.data.body, p_internal: parsed.data.internal });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/helpdesk/${parsed.data.ticketId}`);
  return { ok: true, message: parsed.data.internal ? 'Internal note added.' : 'Reply sent.' };
}

export async function updateTicketAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    ticketId: z.uuid(),
    status: z.enum(STATUSES),
    assigneeId: optional(z.uuid()),
    priority: optional(z.enum(PRIORITIES)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_ticket', {
    p_ticket: v.ticketId, p_status: v.status, p_assignee: sqlNull(v.assigneeId), p_priority: sqlNull(v.priority),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/helpdesk`, 'layout');
  if (v.status === 'closed') {
    await flash('Ticket closed.'); // the update and close forms go away with it
    return { ok: true, message: 'Ticket closed.' };
  }
  return { ok: true, message: v.status === 'resolved' ? 'Resolved. The requester has been told.' : 'Ticket updated.' };
}

export async function saveCategoryAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('helpdesk.manage', 'org')) return DENIED;
  const parsed = z.object({
    categoryId: optional(z.uuid()),
    name: z.string().trim().min(2, 'Name the category').max(60),
    assigneeId: optional(z.uuid()),
    active: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const row = { name: v.name, default_assignee_id: v.assigneeId ?? null, is_active: v.categoryId ? v.active : true };
  const { error } = v.categoryId
    ? await supabase.from('ticket_categories').update(row).eq('organization_id', ctx.org.id).eq('id', v.categoryId)
    : await supabase.from('ticket_categories').insert({ ...row, organization_id: ctx.org.id });
  if (error) {
    const message = error.code === '23505' ? 'A category with this name already exists.' : toUserMessage(error);
    return { ok: false, message, values: formValues(formData) };
  }
  revalidatePath(`/app/${orgSlug}/helpdesk/settings`);
  return { ok: true, message: v.categoryId ? 'Saved.' : 'Category added.' };
}

const articleSchema = z.object({
  articleId: optional(z.uuid()),
  title: z.string().trim().min(3, 'Give the article a title').max(160),
  category: optional(z.string().trim().max(60)),
  body: z.string().trim().min(10, 'Write the article (at least a sentence)').max(50000),
  published: z.preprocess((v) => v === 'on', z.boolean()),
});

export async function saveArticleAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('helpdesk.manage', 'org')) return DENIED;
  const parsed = articleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const row = { title: v.title, category: v.category ?? null, body: v.body, published: v.published };
  const result = v.articleId
    ? await supabase.from('kb_articles').update(row).eq('organization_id', ctx.org.id).eq('id', v.articleId).select('id').single()
    : await supabase.from('kb_articles').insert({ ...row, organization_id: ctx.org.id }).select('id').single();
  if (result.error) return { ok: false, message: toUserMessage(result.error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/knowledge`, 'layout');
  await flash(v.published ? 'Article published.' : 'Draft saved. Only helpdesk staff can see it.');
  redirect(`/app/${orgSlug}/knowledge/${result.data.id}`);
}
