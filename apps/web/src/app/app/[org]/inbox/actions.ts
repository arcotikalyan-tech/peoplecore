'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Inbox actions. The database decides who may approve or complete what. */

const decisionSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(1000).optional(),
});

export async function decideApprovalAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  if (parsed.data.decision === 'reject' && !parsed.data.comment) {
    return { ok: false, message: 'Give a reason when rejecting.', fieldErrors: { comment: 'Required when rejecting' } };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_approval', {
    p_request: parsed.data.requestId, p_decision: parsed.data.decision, p_comment: parsed.data.comment,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: data === 'pending' ? 'Approved. It moves to the next approver.' : data === 'approved' ? 'Approved.' : 'Rejected.' };
}

export async function markNotificationsReadAction(orgSlug: string): Promise<void> {
  const ctx = await getOrgContext(orgSlug);
  const supabase = await createClient();
  await supabase.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.id).is('read_at', null);
  revalidatePath(`/app/${orgSlug}`, 'layout');
}

export async function completeTaskAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('taskId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_task_status', { p_task: id.data, p_status: 'done' });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Done.' };
}
