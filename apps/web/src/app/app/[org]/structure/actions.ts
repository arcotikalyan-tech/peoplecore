'use server';

import { revalidatePath } from 'next/cache';
import { createDepartmentSchema, createDesignationSchema, createLocationSchema } from '@peoplecore/shared';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Structure writes. RLS requires org.manage; the UI check only gives a friendlier message. */
async function authorize(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can('org.manage') ? ctx : null;
}

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to change the organization structure.' };

export async function createDepartmentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = createDepartmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);

  const supabase = await createClient();
  const { error } = await supabase.from('departments').insert({
    organization_id: ctx.org.id,
    code: parsed.data.code,
    name: parsed.data.name,
    parent_id: parsed.data.parentId ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: `Department “${parsed.data.name}” created.` };
}

export async function createDesignationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = createDesignationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);

  const supabase = await createClient();
  const { error } = await supabase.from('designations').insert({
    organization_id: ctx.org.id,
    title: parsed.data.title,
    level: parsed.data.level ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: `Designation “${parsed.data.title}” created.` };
}

export async function createLocationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = createLocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);

  const supabase = await createClient();
  const { error } = await supabase.from('locations').insert({
    organization_id: ctx.org.id,
    code: parsed.data.code,
    name: parsed.data.name,
    city: parsed.data.city ?? null,
    state_code: parsed.data.stateCode ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: `Location “${parsed.data.name}” created.` };
}
