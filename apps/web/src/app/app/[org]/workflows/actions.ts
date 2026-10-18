'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Saving workflows (each save is a new version) and stopping runs. The database validates every step. */

const json = z.string().transform((s, c) => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    c.addIssue({ code: 'custom', message: 'Invalid steps' });
    return z.NEVER;
  }
});

export async function saveWorkflowAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('workflow.manage', 'org')) return { ok: false, message: 'You don’t have permission to do that.' };
  const parsed = z.object({
    workflowId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
    name: z.string().trim().min(3, 'Name the workflow').max(120),
    trigger: z.string().min(1, 'Choose what starts it'),
    conditions: json,
    steps: json,
    active: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_workflow', {
    p_org: ctx.org.id, p_definition: (v.workflowId ?? null) as string, p_name: v.name, p_trigger: v.trigger,
    p_conditions: v.conditions as never, p_steps: v.steps as never, p_active: v.active,
  });
  if (error) {
    const message = error.code === '23505' ? 'A workflow with this name already exists.' : toUserMessage(error);
    return { ok: false, message, values: formValues(formData) };
  }
  revalidatePath(`/app/${orgSlug}/workflows`, 'layout');
  await flash(v.active ? 'Saved and switched on.' : 'Saved. It’s switched off until you turn it on.');
  redirect(`/app/${orgSlug}/workflows/${data}`);
}

export async function stopRunAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('runId'));
  if (!id.success) return { ok: false, message: 'Run not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('stop_workflow_run', { p_run: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/workflows`, 'layout');
  await flash('Run stopped.');
  return { ok: true, message: 'Run stopped.' };
}
