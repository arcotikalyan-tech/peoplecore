'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { dismissSuggestion } from '@/server/ai';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

const whole = (min: number, max: number, what: string) =>
  z.preprocess((v) => String(v ?? '').replace(/[,\s_]/g, ''), z.coerce.number({ error: `Enter ${what}` }).int(`Enter a whole number`)
    .min(min, `At least ${min.toLocaleString('en-IN')}`).max(max, `At most ${max.toLocaleString('en-IN')}`));

export async function saveAiSettingsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    enabled: z.preprocess((v) => v === 'on', z.boolean()),
    budget: whole(1000, 1_000_000_000, 'a budget'),
    hourly: whole(1, 1000, 'a limit'),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_ai_settings', {
    p_org: ctx.org.id, p_enabled: parsed.data.enabled, p_monthly_token_budget: parsed.data.budget, p_hourly_limit: parsed.data.hourly,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: parsed.data.enabled ? 'Saved. AI assistants are on.' : 'Saved. AI assistants are off.' };
}

/** "Dismiss" on an AI suggestion: recorded as rejected. Only the person who asked can. */
export async function dismissSuggestionAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('suggestionId'));
  if (!id.success) return { ok: false, message: 'Not found.' };
  const { error } = await dismissSuggestion(id.data);
  return error ? { ok: false, message: toUserMessage(error) } : { ok: true, message: 'Dismissed.' };
}
