'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { SETUP_STEPS } from '@/lib/org-setup';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const schema = z.object({ step: z.string().regex(/^[a-z_]{3,40}$/), mark: z.enum(['done', 'skipped', 'clear']) });

/**
 * Marks an organization setup step by hand: "Looks right" for steps that start with defaults (confirm steps),
 * "Not needed" for optional steps, or undoes either. Steps the data decides can't be ticked by hand.
 */
export async function markSetupAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org') && !ctx.can('onboarding.manage', 'org')) return DENIED;
  const parsed = schema.safeParse(Object.fromEntries(formData));
  const step = parsed.success ? SETUP_STEPS.find((s) => s.key === parsed.data.step) : undefined;
  if (!parsed.success || !step) return { ok: false, message: 'Step not found.' };
  const { mark } = parsed.data;
  if (mark === 'done' && step.check !== 'confirm') return { ok: false, message: 'This step is done once the details are filled in.' };
  if (mark === 'skipped' && step.required) return { ok: false, message: 'Every company needs this step.' };

  const supabase = await createClient();
  const { error } = mark === 'clear'
    ? await supabase.from('org_setup_steps').delete().eq('organization_id', ctx.org.id).eq('step_key', step.key)
    : await supabase.from('org_setup_steps').upsert({ organization_id: ctx.org.id, step_key: step.key, status: mark, done_at: new Date().toISOString() });
  if (error) return { ok: false, message: toUserMessage(error) };
  for (const path of ['', '/setup', '/settings', '/onboarding']) revalidatePath(`/app/${slug}${path}`);
  return { ok: true, message: mark === 'done' ? `${step.title}: done.` : mark === 'skipped' ? `${step.title}: not needed.` : `${step.title}: back on the list.` };
}
