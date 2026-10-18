'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Assets and system access. The database enforces who may issue, return, grant and revoke. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const isoDate = z.iso.date({ error: 'Enter a valid date' });

const assetSchema = z.object({
  assetId: optional(z.uuid()),
  name: z.string().trim().min(2, 'Name the asset').max(120),
  category: z.string().trim().min(2, 'Say what kind of asset it is').max(60),
  tag: optional(z.string().trim().max(40, 'Keep the tag under 40 characters')),
  serialNumber: optional(z.string().trim().max(80)),
  locationId: optional(z.uuid()),
  purchasedOn: optional(isoDate),
  purchaseCost: optional(z.coerce.number({ error: 'Enter an amount' }).min(0, 'Enter an amount').max(9_999_999_999)),
  warrantyUntil: optional(isoDate),
  notes: optional(z.string().trim().max(2000)),
});

export async function saveAssetAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('asset.manage', 'org')) return DENIED;
  const parsed = assetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const row = {
    name: v.name, category: v.category, serial_number: v.serialNumber ?? null, location_id: v.locationId ?? null,
    purchased_on: v.purchasedOn ?? null, purchase_cost: v.purchaseCost ?? null, warranty_until: v.warrantyUntil ?? null, notes: v.notes ?? null,
  };
  const result = v.assetId
    ? await supabase.from('assets').update({ ...row, ...(v.tag ? { tag: v.tag } : {}) })
        .eq('organization_id', ctx.org.id).eq('id', v.assetId).select('id, tag').single()
    : await supabase.from('assets').insert({ ...row, tag: v.tag ?? '', organization_id: ctx.org.id }).select('id, tag').single();
  if (result.error) return { ok: false, message: toUserMessage(result.error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/assets`, 'layout');
  await flash(v.assetId ? 'Asset saved.' : `Asset ${result.data.tag} added.`);
  redirect(`/app/${orgSlug}/assets/${result.data.id}`);
}

export async function deleteAssetAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('asset.manage', 'org')) return DENIED;
  const id = z.uuid().safeParse(formData.get('assetId'));
  if (!id.success) return { ok: false, message: 'Asset not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('assets').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) {
    return { ok: false, message: error.code === '23503' ? 'This asset has been issued before, so its history is kept. Retire it instead.' : toUserMessage(error) };
  }
  revalidatePath(`/app/${orgSlug}/assets`, 'layout');
  await flash('Asset deleted.');
  redirect(`/app/${orgSlug}/assets`);
}

export async function issueAssetAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    assetId: z.uuid(),
    employeeId: z.uuid({ error: 'Choose a person' }),
    dueBackOn: optional(isoDate),
    condition: optional(z.string().trim().max(500)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('issue_asset', {
    p_asset: v.assetId, p_employee: v.employeeId, p_due_back: sqlNull(v.dueBackOn), p_condition: sqlNull(v.condition),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/assets`, 'layout');
  await flash('Issued. They’ve been asked to confirm they have it.'); // the issue form gives way to the return form
  return { ok: true, message: 'Issued.' };
}

export async function returnAssetAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    assetId: z.uuid(),
    status: z.enum(['in_stock', 'in_repair', 'retired', 'lost']),
    condition: optional(z.string().trim().max(500)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('return_asset', { p_asset: v.assetId, p_status: v.status, p_condition: sqlNull(v.condition) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/assets`, 'layout');
  await flash(v.status === 'lost' ? 'Recorded as lost.' : 'Return recorded.');
  return { ok: true, message: 'Return recorded.' };
}

export async function setAssetStatusAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('asset.manage', 'org')) return DENIED;
  const parsed = z.object({ assetId: z.uuid(), status: z.enum(['in_stock', 'in_repair', 'retired', 'lost']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('assets').update({ status: parsed.data.status })
    .eq('organization_id', ctx.org.id).eq('id', parsed.data.assetId);
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/assets`, 'layout');
  return { ok: true, message: 'Status changed.' };
}

export async function acknowledgeAssetAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('assignmentId'));
  if (!id.success) return { ok: false, message: 'Asset not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('acknowledge_asset', { p_assignment: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/assets`);
  await flash('Thanks. Receipt confirmed.');
  return { ok: true, message: 'Receipt confirmed.' };
}

export async function saveSystemAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('asset.manage', 'org')) return DENIED;
  const parsed = z.object({
    systemId: optional(z.uuid()),
    name: z.string().trim().min(2, 'Name the system').max(80),
    ownerId: optional(z.uuid()),
    active: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const row = { name: v.name, owner_employee_id: v.ownerId ?? null, is_active: v.systemId ? v.active : true };
  const { error } = v.systemId
    ? await supabase.from('access_systems').update(row).eq('organization_id', ctx.org.id).eq('id', v.systemId)
    : await supabase.from('access_systems').insert({ ...row, organization_id: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/assets/access`);
  return { ok: true, message: v.systemId ? 'Saved.' : 'System added.' };
}

export async function grantAccessAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    employeeId: z.uuid({ error: 'Choose a person' }),
    systemId: z.uuid({ error: 'Choose a system' }),
    account: z.string().trim().min(1, 'Enter the account name or email').max(160),
    level: optional(z.string().trim().max(60)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('grant_access', {
    p_system: v.systemId, p_employee: v.employeeId, p_account: v.account, p_level: sqlNull(v.level),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/assets`, 'layout');
  return { ok: true, message: 'Access recorded.' };
}

export async function revokeAccessAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ grantId: z.uuid(), note: optional(z.string().trim().max(500)) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_access', { p_grant: parsed.data.grantId, p_note: sqlNull(parsed.data.note) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/assets`, 'layout');
  await flash('Access revoked.'); // the row leaves the active list
  return { ok: true, message: 'Access revoked.' };
}
