'use server';

import { revalidatePath } from 'next/cache';
import {
  archiveStructureSchema,
  createDepartmentSchema,
  createDesignationSchema,
  createLocationSchema,
  updateDepartmentSchema,
  updateDesignationSchema,
  updateLocationSchema,
  type StructureKind,
} from '@peoplecore/shared';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
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

// ─── Edit, archive, restore ─────────────────────────────────────────────────
// Updates filter by organization as well as id and must touch exactly one row: zero rows means the item
// is gone or RLS refused it, which we report without saying which.

const NOT_FOUND: ActionState = { ok: false, message: 'This item no longer exists, or you can’t change it.' };

export async function updateDepartmentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = updateDepartmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('departments')
    .update({ code: parsed.data.code, name: parsed.data.name, parent_id: parsed.data.parentId ?? null })
    .eq('organization_id', ctx.org.id)
    .eq('id', parsed.data.id)
    .select('id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (data.length !== 1) return NOT_FOUND;
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: `Department “${parsed.data.name}” updated.` };
}

export async function updateDesignationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = updateDesignationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('designations')
    .update({ title: parsed.data.title, level: parsed.data.level ?? null })
    .eq('organization_id', ctx.org.id)
    .eq('id', parsed.data.id)
    .select('id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (data.length !== 1) return NOT_FOUND;
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: `Designation “${parsed.data.title}” updated.` };
}

export async function updateLocationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = updateLocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('locations')
    .update({ code: parsed.data.code, name: parsed.data.name, city: parsed.data.city ?? null, state_code: parsed.data.stateCode ?? null })
    .eq('organization_id', ctx.org.id)
    .eq('id', parsed.data.id)
    .select('id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (data.length !== 1) return NOT_FOUND;
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: `Location “${parsed.data.name}” updated.` };
}

const TABLES = { department: 'departments', designation: 'designations', location: 'locations' } as const satisfies Record<StructureKind, string>;

/** Archive or restore. The database refuses to archive anything still in use (see migration 20261018000400). */
export async function setStructureArchivedAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = archiveStructureSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(TABLES[parsed.data.kind])
    .update({ archived_at: parsed.data.archive ? new Date().toISOString() : null })
    .eq('organization_id', ctx.org.id)
    .eq('id', parsed.data.id)
    .select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length !== 1) return NOT_FOUND;
  revalidatePath(`/app/${orgSlug}`, 'layout');
  await flash(parsed.data.archive ? 'Archived. You can restore it from the archived list.' : 'Restored.');
  return { ok: true, message: parsed.data.archive ? 'Archived. You can restore it from the archived list.' : 'Restored.' };
}
