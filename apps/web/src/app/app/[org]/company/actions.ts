'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Company profile actions; RLS allows writes to org.manage holders only. */

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = (schema: z.ZodType) => z.preprocess(blank, schema.optional());
const done = (slug: string, message: string): ActionState => { revalidatePath(`/app/${slug}/company`); return { ok: true, message }; };
const invalid = (e: z.ZodError, fd: FormData): ActionState => ({
  ok: false, message: 'Please fix the highlighted fields.', values: formValues(fd),
  fieldErrors: Object.fromEntries(e.issues.map((i) => [String(i.path[0]), i.message])),
});
const fail = (e: { code?: string; message?: string }, fd?: FormData): ActionState => ({ ok: false, message: toUserMessage(e), values: fd ? formValues(fd) : undefined });

const detailsSchema = z.object({
  legal_name: z.string().trim().min(2, 'Enter the registered name').max(200),
  brand_name: opt(z.string().trim().max(120)),
  email: opt(z.email('Enter a valid email')),
  phone: opt(z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')),
  website: opt(z.string().trim().max(200)),
  industry: opt(z.string().trim().max(80)),
  linkedin: opt(z.url('Enter a full link')), twitter: opt(z.url('Enter a full link')), facebook: opt(z.url('Enter a full link')), instagram: opt(z.url('Enter a full link')),
});

const statutorySchema = z.object({
  entity_type: opt(z.enum(['private_limited', 'public_limited', 'llp', 'partnership', 'proprietorship', 'opc', 'section_8', 'trust', 'society', 'other'])),
  cin: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{21}$/, '21 characters, like U72900KA2020PTC123456')),
  llpin: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{3}-[0-9]{4}$/, 'Like AAB-1234')),
  incorporated_on: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')),
  pan: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Like AAACD1234E')),
  tan: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, 'Like BLRD12345E')),
  gstin: opt(z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, '15 characters, like 29AAACD1234E1Z5')),
  pf_code: opt(z.string().trim().max(30)),
  esi_code: opt(z.string().trim().max(30)),
});

export async function saveCompanyAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const section = formData.get('section');
  const supabase = await createClient();
  let patch: Record<string, unknown>;
  if (section === 'details') {
    const p = detailsSchema.safeParse(Object.fromEntries(formData));
    if (!p.success) return invalid(p.error, formData);
    const { linkedin, twitter, facebook, instagram, ...rest } = p.data;
    patch = { ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? null])), social: Object.fromEntries(Object.entries({ linkedin, twitter, facebook, instagram }).filter(([, v]) => v)) };
  } else if (section === 'statutory') {
    const p = statutorySchema.safeParse(Object.fromEntries(formData));
    if (!p.success) return invalid(p.error, formData);
    patch = Object.fromEntries(Object.entries(p.data).map(([k, v]) => [k, v ?? null]));
  } else return { ok: false, message: 'Invalid request.' };
  const { data, error } = await supabase.from('company_profiles').upsert({ organization_id: ctx.org.id, ...patch } as never, { onConflict: 'organization_id' }).select('organization_id');
  if (error) return fail(error, formData);
  if (!data?.length) return { ok: false, message: 'You don’t have permission to do that.' };
  return done(slug, 'Saved.');
}

const addressSchema = z.object({
  kind: z.enum(['registered', 'corporate', 'branch', 'custom']),
  label: opt(z.string().trim().max(80)),
  line1: z.string().trim().min(2, 'Enter the address').max(200),
  line2: opt(z.string().trim().max(200)),
  city: z.string().trim().min(2, 'Enter the city').max(100),
  state: opt(z.string().trim().max(100)),
  country: z.string().trim().min(2).max(80).default('India'),
  pincode: opt(z.string().trim().regex(/^[0-9A-Z -]{3,10}$/, 'Enter a valid PIN code')),
});

export async function saveAddressAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('addressId'));
  const p = addressSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const row = { ...Object.fromEntries(Object.entries(p.data).map(([k, v]) => [k, v ?? null])), organization_id: ctx.org.id } as never;
  const supabase = await createClient();
  const { error } = id.success
    ? await supabase.from('company_addresses').update(row).eq('organization_id', ctx.org.id).eq('id', id.data)
    : await supabase.from('company_addresses').insert(row);
  if (error) return fail(error.code === '23505' ? { message: 'There is already one of these; edit it instead.' } : error, formData);
  await flash('Address saved.');
  return done(slug, 'Address saved.');
}

export async function removeRowAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const table = z.enum(['company_addresses', 'company_officers', 'grades']).safeParse(formData.get('table'));
  const id = z.uuid().safeParse(formData.get('id'));
  if (!table.success || !id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from(table.data).delete().eq('organization_id', ctx.org.id).eq('id', id.data).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, message: 'You don’t have permission to do that.' };
  return done(slug, 'Removed.');
}

export async function saveOfficerAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = z.object({
    kind: z.enum(['director', 'auditor', 'secretary']),
    name: z.string().trim().min(2, 'Enter the name').max(120),
    email: opt(z.email('Enter a valid email')),
    phone: opt(z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')),
    identifier: opt(z.string().trim().max(40)),
    firm: opt(z.string().trim().max(120)),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('company_officers').insert({ ...Object.fromEntries(Object.entries(p.data).map(([k, v]) => [k, v ?? null])), organization_id: ctx.org.id } as never);
  if (error) return fail(error, formData);
  return done(slug, 'Added.');
}

export async function saveCustomFieldAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = z.object({
    fieldId: opt(z.uuid()),
    label: z.string().trim().min(2, 'Name the field').max(60),
    field_type: z.enum(['text', 'number', 'date', 'select', 'boolean']),
    options: z.string().trim().max(1000).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const options = (p.data.options ?? '').split(/[\n,]/).map((o) => o.trim()).filter(Boolean);
  if (p.data.field_type === 'select' && options.length === 0) return { ok: false, message: 'List the options, separated by commas.', fieldErrors: { options: 'Required for a list' }, values: formValues(formData) };
  const row = {
    label: p.data.label, field_type: p.data.field_type, options: p.data.field_type === 'select' ? options : [],
    required: formData.get('required') === 'on', editable_by_employee: formData.get('editable') === 'on',
  };
  const supabase = await createClient();
  const { error } = p.data.fieldId
    ? await supabase.from('employee_custom_fields').update(row).eq('organization_id', ctx.org.id).eq('id', p.data.fieldId as string)
    : await supabase.from('employee_custom_fields').insert({ ...row, organization_id: ctx.org.id });
  if (error) return fail(error.code === '23505' ? { message: 'A field with this name already exists.' } : error, formData);
  return done(slug, 'Field saved.');
}

export async function archiveCustomFieldAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const restore = formData.get('restore') === '1';
  const supabase = await createClient();
  const { error } = await supabase.from('employee_custom_fields').update({ archived_at: restore ? null : new Date().toISOString() }).eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return fail(error);
  return done(slug, restore ? 'Restored.' : 'Archived. Existing values are kept.');
}

export async function saveGradeAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = z.object({ name: z.string().trim().min(1, 'Name the grade').max(40), rank: z.coerce.number().int().min(0).max(999).default(0), description: opt(z.string().trim().max(200)) })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('grades').insert({ organization_id: ctx.org.id, name: p.data.name, rank: p.data.rank, description: (p.data.description as string | undefined) ?? null });
  if (error) return fail(error.code === '23505' ? { message: 'This grade already exists.' } : error, formData);
  return done(slug, 'Grade added.');
}

export async function setDesignationGradeAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const designation = z.uuid().safeParse(formData.get('designationId'));
  const grade = formData.get('gradeId');
  if (!designation.success || (grade && !z.uuid().safeParse(grade).success)) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('designations').update({ grade_id: grade ? String(grade) : null }).eq('organization_id', ctx.org.id).eq('id', designation.data);
  if (error) return fail(error);
  return done(slug, 'Grade set.');
}

/** Custom field values on an employee's profile (HR, or the employee for fields marked editable). */
export async function saveCustomValuesAction(slug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!z.uuid().safeParse(employeeId).success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const upserts: Array<{ organization_id: string; employee_id: string; field_id: string; value: string }> = [];
  const deletes: string[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith('field:')) continue;
    const id = k.slice(6);
    if (!z.uuid().safeParse(id).success) continue;
    const value = String(v).trim();
    if (value) upserts.push({ organization_id: ctx.org.id, employee_id: employeeId, field_id: id, value }); else deletes.push(id);
  }
  if (upserts.length) {
    const { error } = await supabase.from('employee_custom_values').upsert(upserts, { onConflict: 'employee_id,field_id' });
    if (error) return fail(error, formData);
  }
  if (deletes.length) await supabase.from('employee_custom_values').delete().eq('employee_id', employeeId).in('field_id', deletes);
  revalidatePath(`/app/${slug}/employees/${employeeId}`);
  return { ok: true, message: 'Saved.' };
}
