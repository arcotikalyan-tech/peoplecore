'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { checkDocumentFile, todayIn } from '@peoplecore/shared';
import { z } from 'zod';
import { formDataAll, formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { renderLetter, unknownTags } from '@/lib/letters';
import { getOrgContext, type OrgContext } from '@/server/context';
import { LETTER_BUCKET, removeDocumentFile, storeDocumentFile } from '@/server/document-storage';
import { flash } from '@/server/flash';
import { mergeValues } from '@/server/letters';
import { createClient } from '@/server/supabase';

/** Letters actions. The database decides (letter.manage, own requests); these checks give friendlier messages. */

const path = (slug: string) => `/app/${slug}/letters`;
const uuid = z.uuid();
const text = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

async function hr(slug: string): Promise<OrgContext | null> {
  const ctx = await getOrgContext(slug);
  return ctx.can('letter.manage', 'org') ? ctx : null;
}
const denied: ActionState = { ok: false, message: 'Only HR can do this.' };

// ─── Generate and release ───────────────────────────────────────────────────

export async function generateLettersAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(slug);
  if (!ctx) return denied;
  const templateId = uuid.safeParse(formData.get('templateId'));
  const employees = formDataAll(formData, 'employee').filter((id) => uuid.safeParse(id).success);
  const body = String(formData.get('body') ?? '').trim();
  const requestId = uuid.safeParse(formData.get('requestId'));
  if (!templateId.success || employees.length === 0) return { ok: false, message: 'Choose a letter and at least one employee.' };
  if (body.length < 10) return { ok: false, message: 'The letter is empty.', values: formValues(formData) };
  const bad = unknownTags(body);
  if (bad.length) return { ok: false, message: `Unknown merge tags: ${bad.map((t) => `{{ ${t} }}`).join(', ')}`, values: formValues(formData) };

  const supabase = await createClient();
  const { data: tpl } = await supabase.from('letter_templates').select('id, letter_type, signatory_id').eq('id', templateId.data).eq('organization_id', ctx.org.id).maybeSingle();
  if (!tpl) return { ok: false, message: 'That letter template no longer exists.' };
  const { data: sig } = tpl.signatory_id
    ? await supabase.from('letter_signatories').select('name, designation, address, signature_path').eq('id', tpl.signatory_id).maybeSingle()
    : { data: null };
  const fills: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith('fill:') && typeof v === 'string' && v.trim()) fills[k.slice(5)] = v.trim().slice(0, 300);
  const today = todayIn(ctx.org.timezone);

  const rows = [];
  for (const employeeId of employees.slice(0, 200)) {
    const values = {
      ...(await mergeValues(ctx.org.id, employeeId, today)),
      ...(sig ? { 'authorized signatory name': sig.name, 'authorized signatory designation': sig.designation, 'authorized signatory address': sig.address ?? '' } : {}),
      ...fills,
    };
    rows.push({
      organization_id: ctx.org.id, employee_id: employeeId, template_id: tpl.id, letter_type: tpl.letter_type,
      body: renderLetter(body, values), signatory: sig ?? {},
      request_id: requestId.success && employees.length === 1 ? requestId.data : null,
    });
  }
  const { data, error } = await supabase.from('letters').insert(rows).select('id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(path(slug));
  redirect(`${path(slug)}?tab=generate&drafts=${data.map((d) => d.id).join(',')}`);
}

export async function releaseLettersAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await hr(slug))) return denied;
  const ids = formDataAll(formData, 'letterId').filter((id) => uuid.safeParse(id).success);
  if (ids.length === 0) return { ok: false, message: 'Nothing to release.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('release_letters', { p_letters: ids });
  if (error) return { ok: false, message: toUserMessage(error) };
  await flash(`Released ${data} letter${data === 1 ? '' : 's'}. The employee${data === 1 ? ' has' : 's have'} been notified.`);
  revalidatePath(path(slug));
  redirect(`${path(slug)}?tab=requests&view=released`);
}

export async function letterStatusAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await hr(slug))) return denied;
  const id = uuid.safeParse(formData.get('letterId'));
  const op = formData.get('op');
  if (!id.success || (op !== 'cancel' && op !== 'delete')) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = op === 'delete'
    ? await supabase.from('letters').delete().eq('id', id.data).eq('status', 'draft').select('id')
    : await supabase.from('letters').update({ status: 'cancelled' }).eq('id', id.data).select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length === 0) return { ok: false, message: 'This letter can’t be changed.' };
  await flash(op === 'delete' ? 'Draft discarded.' : 'Letter cancelled.');
  revalidatePath(path(slug));
  redirect(path(slug) + (op === 'delete' ? '?tab=generate' : '?tab=requests&view=released'));
}

// ─── Requests ───────────────────────────────────────────────────────────────

export async function requestLetterAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const parsed = z.object({ templateId: uuid, reason: text(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose a letter.', fieldErrors: { templateId: 'Choose a letter' }, values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_letter', { p_org: ctx.org.id, p_template: parsed.data.templateId, p_reason: parsed.data.reason ?? '' });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(path(slug));
  return { ok: true, message: 'Request sent. HR has been notified.' };
}

export async function closeRequestAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = uuid.safeParse(formData.get('requestId'));
  const status = formData.get('status');
  if (!id.success || (status !== 'rejected' && status !== 'withdrawn')) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('close_letter_request', { p_request: id.data, p_status: status, p_note: String(formData.get('note') ?? '').slice(0, 500) });
  if (error) return { ok: false, message: toUserMessage(error) };
  await flash(status === 'rejected' ? 'Request declined.' : 'Request withdrawn.');
  revalidatePath(path(slug));
  return { ok: true, message: status === 'rejected' ? 'Request declined.' : 'Request withdrawn.' };
}

// ─── Templates ──────────────────────────────────────────────────────────────

const templateSchema = z.object({
  templateId: z.preprocess((v) => (v === '' ? undefined : v), uuid.optional()),
  letterType: z.string().trim().min(2, 'Name the letter type').max(80),
  name: z.string().trim().min(1, 'Name the template').max(60),
  body: z.string().trim().min(10, 'Write the letter').max(20000),
  signatoryId: z.preprocess((v) => (v === '' ? undefined : v), uuid.optional()),
  selfServe: z.preprocess((v) => v === 'on' || v === 'yes', z.boolean()),
});

export async function saveTemplateAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(slug);
  if (!ctx) return denied;
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fe, values: formValues(formData) };
  }
  const v = parsed.data;
  const bad = unknownTags(v.body);
  if (bad.length) return { ok: false, message: `Unknown merge tags: ${bad.map((t) => `{{ ${t} }}`).join(', ')}`, values: formValues(formData) };
  const supabase = await createClient();
  const row = { letter_type: v.letterType, name: v.name, body: v.body, signatory_id: v.signatoryId ?? null, self_serve: v.selfServe };
  const { data, error } = v.templateId
    ? await supabase.from('letter_templates').update(row).eq('id', v.templateId).eq('organization_id', ctx.org.id).select('id')
    : await supabase.from('letter_templates').insert({ ...row, organization_id: ctx.org.id }).select('id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (!v.templateId) {
    await flash('Letter template created.');
    redirect(`${path(slug)}?tab=settings&view=setup&template=${data[0]!.id}`);
  }
  revalidatePath(path(slug));
  return { ok: true, message: 'Template saved.' };
}

export async function archiveTemplateAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(slug);
  if (!ctx) return denied;
  const id = uuid.safeParse(formData.get('templateId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('letter_templates').update({ archived_at: new Date().toISOString(), self_serve: false }).eq('id', id.data).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  await flash('Template archived.');
  redirect(`${path(slug)}?tab=settings&view=setup`);
}

// ─── Signatories and letterhead ─────────────────────────────────────────────

/** Stores an uploaded PNG/JPEG (≤ 1 MB) in letter-assets; returns its path, null when no file was chosen. */
async function storeImage(ctx: OrgContext, file: FormDataEntryValue | null): Promise<{ path: string | null; error?: string }> {
  if (!(file instanceof File) || file.size === 0) return { path: null };
  if (file.size > 1048576) return { path: null, error: 'Images must be 1 MB or smaller.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkDocumentFile(bytes.byteLength, bytes.subarray(0, 16));
  if (!check.ok || check.type === 'application/pdf') return { path: null, error: 'Upload a PNG or JPEG image.' };
  const p = `${ctx.org.id}/${randomUUID()}`;
  if (!(await storeDocumentFile(p, bytes, check.type, LETTER_BUCKET))) return { path: null, error: 'The image could not be stored. Please try again.' };
  return { path: p };
}

export async function saveSignatoryAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(slug);
  if (!ctx) return denied;
  const parsed = z.object({
    signatoryId: z.preprocess((v) => (v === '' ? undefined : v), uuid.optional()),
    name: z.string().trim().min(2, 'Enter a name').max(120),
    designation: z.string().trim().min(2, 'Enter a designation').max(120),
    address: text(300),
  }).safeParse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === 'string')));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fe, values: formValues(formData) };
  }
  const img = await storeImage(ctx, formData.get('signature'));
  if (img.error) return { ok: false, fieldErrors: { signature: img.error }, values: formValues(formData) };
  const v = parsed.data;
  const supabase = await createClient();
  const row = { name: v.name, designation: v.designation, address: v.address ?? null, ...(img.path ? { signature_path: img.path } : {}) };
  const { error } = v.signatoryId
    ? await supabase.from('letter_signatories').update(row).eq('id', v.signatoryId).eq('organization_id', ctx.org.id)
    : await supabase.from('letter_signatories').insert({ ...row, organization_id: ctx.org.id });
  if (error) {
    if (img.path) await removeDocumentFile(img.path, LETTER_BUCKET);
    return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  }
  revalidatePath(path(slug));
  await flash(v.signatoryId ? 'Signatory updated.' : 'Signatory added.');
  return { ok: true, message: v.signatoryId ? 'Signatory updated.' : 'Signatory added.' };
}

export async function removeSignatoryAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(slug);
  if (!ctx) return denied;
  const id = uuid.safeParse(formData.get('signatoryId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('letter_signatories').delete().eq('id', id.data).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  // Released letters keep their own copy of the signatory, so the image stays for them.
  revalidatePath(path(slug));
  return { ok: true, message: 'Signatory removed.' };
}

export async function saveLetterheadAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(slug);
  if (!ctx) return denied;
  const header = z.enum(['classic', 'none', 'custom']).safeParse(formData.get('headerStyle'));
  const footer = z.enum(['band', 'none', 'custom']).safeParse(formData.get('footerStyle'));
  if (!header.success || !footer.success) return { ok: false, message: 'Choose a header and a footer.' };
  const [h, f] = [await storeImage(ctx, formData.get('header')), await storeImage(ctx, formData.get('footer'))];
  if (h.error || f.error) return { ok: false, fieldErrors: { ...(h.error ? { header: h.error } : {}), ...(f.error ? { footer: f.error } : {}) } };
  const supabase = await createClient();
  const { error } = await supabase.from('letter_settings').upsert({
    organization_id: ctx.org.id, header_style: header.data, footer_style: footer.data,
    ...(h.path ? { header_path: h.path } : {}), ...(f.path ? { footer_path: f.path } : {}),
  }, { onConflict: 'organization_id' });
  if (error) return { ok: false, message: error.code === '23514' ? 'Upload an image to use a custom header or footer.' : toUserMessage(error) };
  revalidatePath(path(slug));
  return { ok: true, message: 'Letterhead saved.' };
}
