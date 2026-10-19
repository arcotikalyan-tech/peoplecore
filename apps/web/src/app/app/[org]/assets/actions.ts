'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseCsv } from '@peoplecore/shared';
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
  categoryId: z.uuid({ error: 'Choose a category' }),
  condition: z.enum(['new', 'good', 'fair', 'poor', 'damaged']).default('good'),
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
    name: v.name, category_id: v.categoryId, condition: v.condition, serial_number: v.serialNumber ?? null, location_id: v.locationId ?? null,
    purchased_on: v.purchasedOn ?? null, purchase_cost: v.purchaseCost ?? null, warranty_until: v.warrantyUntil ?? null, notes: v.notes ?? null,
  };
  const result = v.assetId
    ? await supabase.from('assets').update({ ...row, ...(v.tag ? { tag: v.tag } : {}) })
        .eq('organization_id', ctx.org.id).eq('id', v.assetId).select('id, tag').single()
    : await supabase.from('assets').insert({ ...row, category: '', tag: v.tag ?? '', organization_id: ctx.org.id }).select('id, tag').single();
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

const back = (slug: string) => revalidatePath(`/app/${slug}/assets`, 'layout');
const yes = (v: unknown) => v === 'on' || v === 'yes' || v === 'true';

export async function saveAssetCategoryAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('asset.manage', 'org')) return DENIED;
  const parsed = z.object({
    categoryId: optional(z.uuid()),
    name: z.string().trim().min(2, 'Name the category').max(60),
    icon: optional(z.string().trim().max(8)),
    description: optional(z.string().trim().max(200)),
    usefulLife: optional(z.coerce.number({ error: 'Enter months' }).int('Whole months').min(1, 'At least 1 month').max(600)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const row = { name: v.name, icon: v.icon ?? null, description: v.description ?? null, useful_life_months: v.usefulLife ?? null, requestable: yes(formData.get('requestable')) };
  const supabase = await createClient();
  const { error } = v.categoryId
    ? await supabase.from('asset_categories').update(row).eq('organization_id', ctx.org.id).eq('id', v.categoryId)
    : await supabase.from('asset_categories').insert({ ...row, organization_id: ctx.org.id });
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a category with that name.' : toUserMessage(error), values: formValues(formData) };
  back(orgSlug);
  return { ok: true, message: v.categoryId ? 'Category saved.' : `Category ${v.name} added.` };
}

export async function deleteAssetCategoryAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('asset.manage', 'org')) return DENIED;
  const id = z.uuid().safeParse(formData.get('categoryId'));
  if (!id.success) return { ok: false, message: 'Category not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('asset_categories').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: error.code === '23503' ? 'Assets or requests use this category, so it can’t be deleted.' : toUserMessage(error) };
  back(orgSlug);
  await flash('Category deleted.');
  return { ok: true, message: 'Category deleted.' };
}

export async function requestAssetAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    categoryId: z.uuid({ error: 'Choose a category' }),
    reason: z.string().trim().min(3, 'Say why you need it').max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_asset', { p_org: ctx.org.id, p_category: parsed.data.categoryId, p_reason: parsed.data.reason });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(orgSlug);
  return { ok: true, message: 'Request raised. Asset managers have been told.' };
}

export async function cancelAssetRequestAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('requestId'));
  if (!id.success) return { ok: false, message: 'Request not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_asset_request', { p_request: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(orgSlug);
  return { ok: true, message: 'Cancelled.' };
}

export async function decideAssetRequestAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    requestId: z.uuid(),
    decision: z.enum(['approve', 'reject']),
    assetId: optional(z.uuid()),
    note: optional(z.string().trim().max(500)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_asset_request', {
    p_request: v.requestId, p_approve: v.decision === 'approve', p_note: sqlNull(v.note), p_asset: sqlNull(v.decision === 'approve' ? v.assetId : undefined),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(orgSlug);
  const message = data === 'fulfilled' ? 'Approved and issued.' : data === 'approved' ? 'Approved. Issue an asset when one is ready.' : 'Request rejected.';
  await flash(message);
  return { ok: true, message };
}

export async function sendForRepairAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    assetId: z.uuid(),
    issue: z.string().trim().min(3, 'Describe the problem').max(500),
    vendor: optional(z.string().trim().max(120)),
    expectedOn: optional(isoDate),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('send_asset_for_repair', { p_asset: v.assetId, p_issue: v.issue, p_vendor: sqlNull(v.vendor), p_expected: sqlNull(v.expectedOn) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(orgSlug);
  await flash('Sent for repair.');
  return { ok: true, message: 'Sent for repair.' };
}

export async function completeRepairAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    repairId: z.uuid(),
    cost: optional(z.coerce.number({ error: 'Enter an amount' }).min(0, 'Enter an amount').max(9_999_999_999)),
    outcome: z.enum(['in_stock', 'retired']),
    condition: optional(z.enum(['new', 'good', 'fair', 'poor', 'damaged'])),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('complete_asset_repair', { p_repair: v.repairId, p_cost: sqlNull(v.cost), p_outcome: v.outcome, p_condition: sqlNull(v.condition) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(orgSlug);
  await flash(v.outcome === 'retired' ? 'Repair closed; the asset is retired.' : 'Repair complete. The asset is available again.');
  return { ok: true, message: 'Repair complete.' };
}

export async function setRecoveryAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    assignmentId: z.uuid(),
    amount: z.coerce.number({ error: 'Enter the amount due' }).positive('Enter the amount due').max(99_999_999),
    note: z.string().trim().min(3, 'Say what the dues are for').max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_asset_recovery', { p_assignment: v.assignmentId, p_amount: v.amount, p_note: v.note });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(orgSlug);
  return { ok: true, message: 'Dues recorded.' };
}

export async function settleRecoveryAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ assignmentId: z.uuid(), mode: z.enum(['recovered', 'waived', 'payroll']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose how the dues are settled.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('settle_asset_recovery', { p_assignment: parsed.data.assignmentId, p_mode: parsed.data.mode });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(orgSlug);
  const message = { recovered: 'Marked as recovered.', waived: 'Dues waived.', payroll: 'Added to the next payroll run as a deduction.' }[parsed.data.mode];
  await flash(message);
  return { ok: true, message };
}

/** CSV with columns name, category, tag, serial_number, condition, location, purchased_on, purchase_cost, warranty_until, notes. */
export async function importAssetsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('asset.manage', 'org')) return DENIED;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
  if (file.size > 2_000_000) return { ok: false, message: 'Keep the file under 2 MB.' };
  let rows: string[][];
  try { rows = parseCsv(await file.text()); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'The file could not be read.' }; }
  const [head, ...body] = rows;
  if (!head || body.length === 0) return { ok: false, message: 'The file has no rows.' };
  if (body.length > 2000) return { ok: false, message: 'Import at most 2,000 assets at a time.' };
  const col = (k: string) => head.findIndex((h) => h.trim().toLowerCase().replace(/\s+/g, '_') === k);
  const idx = Object.fromEntries(['name', 'category', 'tag', 'serial_number', 'condition', 'location', 'purchased_on', 'purchase_cost', 'warranty_until', 'notes'].map((k) => [k, col(k)]));
  if (idx.name! < 0 || idx.category! < 0) return { ok: false, message: 'The file needs name and category columns.' };
  const supabase = await createClient();
  const { data: locs } = await supabase.from('locations').select('id, name').eq('organization_id', ctx.org.id);
  const loc = new Map((locs ?? []).map((l) => [l.name.trim().toLowerCase(), l.id]));
  const get = (r: string[], k: string) => (idx[k]! >= 0 ? (r[idx[k]!] ?? '').trim() : '');
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const problems: string[] = [];
  const records = body.flatMap((r, i) => {
    const line = i + 2;
    if (r.every((c) => !c.trim())) return [];
    const name = get(r, 'name'); const category = get(r, 'category'); const condition = get(r, 'condition').toLowerCase() || 'good';
    const location = get(r, 'location'); const cost = get(r, 'purchase_cost').replace(/[,₹\s]/g, '');
    if (name.length < 2) problems.push(`Line ${line}: name is missing.`);
    if (category.length < 2) problems.push(`Line ${line}: category is missing.`);
    if (!['new', 'good', 'fair', 'poor', 'damaged'].includes(condition)) problems.push(`Line ${line}: condition must be new, good, fair, poor or damaged.`);
    if (location && !loc.has(location.toLowerCase())) problems.push(`Line ${line}: no location called “${location}”.`);
    if (cost && !(Number(cost) >= 0)) problems.push(`Line ${line}: purchase cost isn’t a number.`);
    for (const k of ['purchased_on', 'warranty_until']) if (get(r, k) && !date.test(get(r, k))) problems.push(`Line ${line}: ${k} must be YYYY-MM-DD.`);
    return [{
      organization_id: ctx.org.id, name, category, tag: get(r, 'tag'), serial_number: get(r, 'serial_number') || null, condition,
      location_id: location ? loc.get(location.toLowerCase()) ?? null : null, purchased_on: get(r, 'purchased_on') || null,
      purchase_cost: cost ? Number(cost) : null, warranty_until: get(r, 'warranty_until') || null, notes: get(r, 'notes') || null,
    }];
  });
  if (problems.length) return { ok: false, message: `Nothing imported. ${problems.slice(0, 3).join(' ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}` };
  const { error } = await supabase.from('assets').insert(records);
  if (error) return { ok: false, message: `Nothing imported. ${error.code === '23505' ? 'A tag or serial number is already in the register (or repeated in the file).' : toUserMessage(error)}` };
  back(orgSlug);
  return { ok: true, message: `Imported ${records.length} asset${records.length === 1 ? '' : 's'}.` };
}
