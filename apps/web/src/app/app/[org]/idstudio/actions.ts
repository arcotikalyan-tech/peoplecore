'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { checkDocumentFile } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { CARD_FIELDS, TEMPLATES } from '@/lib/id-cards';
import { getOrgContext } from '@/server/context';
import { LETTER_BUCKET, removeDocumentFile, storeDocumentFile } from '@/server/document-storage';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** ID Studio designs (org.manage; RLS enforces). Logos are stored with the letterhead art (private bucket, signed links). */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const page = (slug: string) => `/app/${slug}/idstudio`;
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour');
const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as [string, ...string[]];
const FIELD_KEYS = new Set<string>(CARD_FIELDS.map(([k]) => k));

async function manager(slug: string) {
  const ctx = await getOrgContext(slug);
  return ctx.can('org.manage', 'org') ? ctx : null;
}

export async function createDesignAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manager(slug);
  if (!ctx) return DENIED;
  const parsed = z.object({ name: z.string().trim().min(2, 'Name the design').max(60), template: z.enum(TEMPLATE_KEYS), cardType: z.enum(['id', 'visiting']).default('id') })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Name the design and pick a template.', values: formValues(formData) };
  const supabase = await createClient();
  const { count } = await supabase.from('id_card_designs').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).eq('card_type', parsed.data.cardType);
  const visiting = parsed.data.cardType === 'visiting';
  const { data, error } = await supabase.from('id_card_designs')
    .insert({
      organization_id: ctx.org.id, name: parsed.data.name, template: parsed.data.template, is_default: (count ?? 0) === 0, card_type: parsed.data.cardType,
      ...(visiting ? { orientation: 'landscape', fields: ['designation', 'phone', 'work_email', 'office_address', 'website'], show_photo: false } : {}),
    }).select('id').single();
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(page(slug));
  await flash('Design created. Choose its fields next.');
  redirect(`${page(slug)}?tab=fields&design=${data.id}`);
}

export async function setTemplateAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manager(slug);
  if (!ctx) return DENIED;
  const parsed = z.object({ designId: z.uuid(), template: z.enum(TEMPLATE_KEYS) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Pick a template.' };
  const supabase = await createClient();
  const { error } = await supabase.from('id_card_designs').update({ template: parsed.data.template }).eq('organization_id', ctx.org.id).eq('id', parsed.data.designId);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(page(slug));
  return { ok: true, message: 'Template applied.' };
}

export async function saveFieldsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manager(slug);
  if (!ctx) return DENIED;
  const parsed = z.object({ designId: z.uuid(), name: z.string().trim().min(2, 'Name the design').max(60), orientation: z.enum(['portrait', 'landscape']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please check the design name.', values: formValues(formData) };
  const fields = formData.getAll('field').map(String).filter((f) => FIELD_KEYS.has(f));
  const labels = formData.getAll('customLabel').map((x) => String(x).trim());
  const values = formData.getAll('customValue').map((x) => String(x).trim());
  const custom = labels.map((label, i) => ({ label, value: values[i] ?? '' })).filter((c) => c.label || c.value);
  if (custom.some((c) => !c.label || !c.value || c.label.length > 30 || c.value.length > 60)) {
    return { ok: false, message: 'Give each custom line a label (up to 30 characters) and a value (up to 60).', values: formValues(formData) };
  }
  if (custom.length > 4) return { ok: false, message: 'Up to four custom lines.', values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from('id_card_designs').update({
    name: parsed.data.name, orientation: parsed.data.orientation, fields, custom_fields: custom,
    ...(formData.has('photoField') ? { show_photo: formData.get('showPhoto') === 'on' } : {}),
  }).eq('organization_id', ctx.org.id).eq('id', parsed.data.designId);
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(page(slug));
  return { ok: true, message: 'Fields and layout saved.' };
}

export async function saveAdvancedAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manager(slug);
  if (!ctx) return DENIED;
  const parsed = z.object({
    designId: z.uuid(), primary: colour, accent: colour, text: colour, qrContent: z.enum(['vcard', 'employee_code']),
    backText: z.string().trim().max(400).optional(),
  }).safeParse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === 'string')));
  if (!parsed.success) return { ok: false, message: 'Please check the colours.', values: formValues(formData) };
  const v = parsed.data;
  let logoPath: string | undefined;
  const file = formData.get('logo');
  if (file instanceof File && file.size > 0) {
    if (file.size > 1048576) return { ok: false, message: 'The logo must be 1 MB or smaller.', values: formValues(formData) };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkDocumentFile(bytes.byteLength, bytes.subarray(0, 16));
    if (!check.ok || check.type === 'application/pdf') return { ok: false, message: 'Upload the logo as a PNG or JPEG.', values: formValues(formData) };
    logoPath = `${ctx.org.id}/idcard-${randomUUID()}`;
    if (!(await storeDocumentFile(logoPath, bytes, check.type, LETTER_BUCKET))) return { ok: false, message: 'The logo could not be stored. Please try again.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('id_card_designs').update({
    primary_color: v.primary, accent_color: v.accent, text_color: v.text, qr_content: v.qrContent, back_text: v.backText || null,
    show_logo: formData.get('showLogo') === 'on', show_qr: formData.get('showQr') === 'on', ...(logoPath ? { logo_path: logoPath } : {}),
  }).eq('organization_id', ctx.org.id).eq('id', v.designId);
  if (error) {
    if (logoPath) await removeDocumentFile(logoPath, LETTER_BUCKET);
    return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  }
  revalidatePath(page(slug));
  return { ok: true, message: 'Design saved.' };
}

export async function setDefaultDesignAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('designId'));
  if (!id.success) return { ok: false, message: 'Design not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_default_id_card', { p_design: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(page(slug));
  return { ok: true, message: 'Now the default.' };
}

export async function deleteDesignAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await manager(slug);
  if (!ctx) return DENIED;
  const id = z.uuid().safeParse(formData.get('designId'));
  if (!id.success) return { ok: false, message: 'Design not found.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('id_card_designs').delete().eq('organization_id', ctx.org.id).eq('id', id.data).select('logo_path').maybeSingle();
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data?.logo_path) await removeDocumentFile(data.logo_path, LETTER_BUCKET);
  revalidatePath(page(slug));
  await flash('Design deleted.');
  redirect(page(slug));
}

/** Rolls a design out: it becomes the default for its kind and everyone is told their card is ready. */
export async function rollOutDesignAction(slug: string, designId: string): Promise<ActionState> {
  const ctx = await manager(slug);
  if (!ctx) return DENIED;
  if (!z.uuid().safeParse(designId).success) return { ok: false, message: 'Design not found.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('roll_out_id_card', { p_design: designId });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(page(slug));
  const n = Number(data);
  return { ok: true, message: `Rolled out: ${n} ${n === 1 ? 'person was' : 'people were'} told their card is ready.` };
}
