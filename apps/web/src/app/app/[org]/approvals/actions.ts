'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Approval rules (escalation per step) and delegation. The database checks who may do what. */

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');

export async function saveEscalationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('org.manage', 'org')) return { ok: false, message: 'You don’t have permission to do that.' };
  const parsed = z.object({
    stepId: z.uuid(),
    hours: optional(z.coerce.number({ error: 'Enter hours' }).int('Whole hours').min(1, 'At least 1 hour').max(720, 'At most 720 hours (30 days)')),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('approval_flow_steps').update({ escalate_after_hours: parsed.data.hours ?? null })
    .eq('organization_id', ctx.org.id).eq('id', parsed.data.stepId).select('id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (data.length === 0) return { ok: false, message: 'You don’t have permission to do that.' };
  revalidatePath(`/app/${orgSlug}/approvals`);
  return { ok: true, message: parsed.data.hours ? `Escalates after ${parsed.data.hours} hours.` : 'Never escalates.' };
}

export async function delegateApprovalsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    delegateId: z.uuid({ error: 'Choose a colleague' }),
    startsOn: date,
    endsOn: date,
    note: optional(z.string().trim().max(300)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('delegate_approvals', {
    p_org: ctx.org.id, p_delegate: v.delegateId, p_starts: v.startsOn, p_ends: v.endsOn, p_note: sqlNull(v.note),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/inbox`);
  return { ok: true, message: 'Delegated. They’ve been told, and your team’s requests will show in their inbox too.' };
}

export async function endDelegationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('delegationId'));
  if (!id.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('end_delegation', { p_delegation: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/inbox`);
  await flash('Delegation ended.');
  return { ok: true, message: 'Delegation ended.' };
}
