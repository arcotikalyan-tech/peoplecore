'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { checkDocumentFile, STAT_FORM_BY_ID } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { removeDocumentFile, STATUTORY_BUCKET, storeDocumentFile } from '@/server/document-storage';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Compliance: record filings (with proof), reopen them, scope settings and establishment registrations. statutory.manage; RLS decides. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());
const back = (slug: string) => revalidatePath(`/app/${slug}/statutory`, 'layout');

export async function recordFilingAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('statutory.manage', 'org')) return DENIED;
  const parsed = z.object({
    formId: z.string().refine((v) => STAT_FORM_BY_ID.has(v), 'Unknown form'),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    dueOn: optional(z.iso.date()),
    status: z.enum(['filed', 'not_applicable']),
    filedOn: optional(z.iso.date({ error: 'Enter the date it was filed' })),
    reference: optional(z.string().trim().max(80, 'At most 80 characters')),
    note: optional(z.string().trim().max(500, 'At most 500 characters')),
  }).refine((v) => v.status !== 'filed' || !!v.filedOn, { path: ['filedOn'], message: 'Enter the date it was filed' })
    .safeParse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === 'string')));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;

  let proof: { path: string; name: string } | null = null;
  const file = formData.get('proof');
  if (file instanceof File && file.size > 0) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkDocumentFile(bytes.byteLength, bytes.subarray(0, 16));
    if (!check.ok) return { ok: false, message: check.message, values: formValues(formData) };
    const path = `${ctx.org.id}/${randomUUID()}`;
    if (!(await storeDocumentFile(path, bytes, check.type, STATUTORY_BUCKET))) return { ok: false, message: 'The file could not be stored. Please try again.', values: formValues(formData) };
    proof = { path, name: file.name.slice(0, 200) || 'proof' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('statutory_filings').upsert({
    organization_id: ctx.org.id, form_id: v.formId, period_start: v.periodStart, period_end: v.periodEnd, due_on: v.dueOn ?? null,
    status: v.status, filed_on: v.status === 'filed' ? v.filedOn! : null, reference: v.reference ?? null, note: v.note ?? null,
    ...(proof ? { proof_path: proof.path, proof_name: proof.name } : {}),
  }, { onConflict: 'organization_id,form_id,period_start' });
  if (error) {
    if (proof) await removeDocumentFile(proof.path, STATUTORY_BUCKET);
    return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  }
  back(slug);
  const name = STAT_FORM_BY_ID.get(v.formId)!.form;
  await flash(v.status === 'filed' ? `${name} marked filed.` : `${name} marked not applicable for this period.`);
  return { ok: true, message: 'Saved.' };
}

export async function reopenFilingAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('statutory.manage', 'org')) return DENIED;
  const id = z.uuid().safeParse(formData.get('filingId'));
  if (!id.success) return { ok: false, message: 'Filing not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('statutory_filings').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash('Reopened: the obligation is pending again.');
  return { ok: true, message: 'Reopened.' };
}

export async function saveScopeAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('statutory.manage', 'org')) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.from('statutory_scope').upsert({
    organization_id: ctx.org.id, contract_labour: formData.get('contractLabour') === 'on', factory: formData.get('factory') === 'on',
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Scope saved. Applicability re-evaluated.' };
}

export async function saveRegistrationAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('statutory.manage', 'org')) return DENIED;
  const parsed = z.object({
    locationId: z.uuid(),
    ptNumber: optional(z.string().trim().max(40, 'At most 40 characters')),
    ptEnrolment: optional(z.string().trim().max(40, 'At most 40 characters')),
    lwfNumber: optional(z.string().trim().max(40, 'At most 40 characters')),
    seNumber: optional(z.string().trim().max(60, 'At most 60 characters')),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('establishment_registrations').upsert({
    organization_id: ctx.org.id, location_id: v.locationId, pt_number: v.ptNumber ?? null, pt_enrolment: v.ptEnrolment ?? null,
    lwf_number: v.lwfNumber ?? null, se_number: v.seNumber ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Registrations saved.' };
}
