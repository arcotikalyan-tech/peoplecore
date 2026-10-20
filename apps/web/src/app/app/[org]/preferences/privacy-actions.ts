'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

const SCOPES = ['contact', 'address', 'family', 'emergency', 'custom'] as const;

/** The employee asks HR to erase optional personal data (the database checks who may ask and what). */
export async function requestDeletionAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const scope = formData.getAll('scope').filter((x): x is (typeof SCOPES)[number] => typeof x === 'string' && (SCOPES as readonly string[]).includes(x));
  if (scope.length === 0) return { ok: false, message: 'Choose what to erase.', values: formValues(formData) };
  const reason = z.string().trim().max(1000).safeParse(formData.get('reason') ?? '');
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_data_deletion', { p_org: ctx.org.id, p_scope: scope, p_reason: reason.success && reason.data ? reason.data : undefined });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${slug}/preferences`);
  await flash('Request sent to HR. You’ll be notified when it’s done.');
  return { ok: true, message: '' };
}

/** HR erases (approve) or declines (with a reason). */
export async function decideDeletionAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('employee.personal.update', 'org')) return { ok: false, message: 'You don’t have permission to do that.' };
  const id = z.uuid().safeParse(formData.get('requestId'));
  if (!id.success) return { ok: false, message: 'Request not found.' };
  const approve = formData.get('decision') === 'approve';
  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_data_deletion', { p_request: id.data, p_approve: approve, p_note: String(formData.get('note') ?? '').trim() || undefined });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${slug}/employees`);
  await flash(approve ? 'Erased. The employee has been told.' : 'Declined. The employee has been told why.');
  return { ok: true, message: '' };
}
