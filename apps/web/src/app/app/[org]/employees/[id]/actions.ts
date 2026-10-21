'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  bankAccountSchema,
  checkDocumentFile,
  safeFileName,
  uploadDocumentSchema,
  emergencyContactSchema,
  familyMemberSchema,
  identitySchema,
  personalProfileSchema,
  qualificationSchema,
  updateWorkDetailsSchema,
  workProfileSchema,
  DOCUMENT_PROOFS,
} from '@peoplecore/shared';
import { z } from 'zod';
import type { Database } from '@peoplecore/db/types';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext, type OrgContext } from '@/server/context';
import { DOCUMENT_BUCKET, removeDocumentFile, storeDocumentFile } from '@/server/document-storage';
import { getEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';

/**
 * Profile actions. Org slug and employee id are bound by the page; every write is authorized again by
 * RLS or by the audited database functions, so these checks only produce friendlier messages.
 */

const profilePath = (orgSlug: string, employeeId: string) => `/app/${orgSlug}/employees/${employeeId}`;
const employeeIdSchema = z.uuid();

export async function updateWorkDetailsAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = updateWorkDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const extra = workProfileSchema.safeParse(Object.fromEntries(formData));
  if (!extra.success) return invalid(extra.error, formData);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .update({
      first_name: v.firstName,
      middle_name: v.middleName ?? null,
      last_name: v.lastName ?? null,
      work_email: v.workEmail ?? null,
      work_phone: v.workPhone ?? null,
      probation_end_date: v.probationEndDate ?? null,
      legal_entity_id: v.legalEntityId ?? null,
      ...(formData.has('jobTitle') ? { job_title: extra.data.jobTitle ?? null } : {}),
      ...(formData.has('billable') ? { billable: extra.data.billable === 'yes' } : {}),
    })
    .eq('id', employeeIdSchema.parse(employeeId))
    .eq('organization_id', ctx.org.id)
    .select('id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (data.length === 0) return { ok: false, message: 'You don’t have permission to edit this employee.' };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: 'Work details saved.' };
}

const PERSONAL_COLUMNS = {
  dateOfBirth: 'date_of_birth', gender: 'gender', personalEmail: 'personal_email', personalPhone: 'personal_phone',
  addressLine1: 'address_line1', addressLine2: 'address_line2', city: 'city', stateCode: 'state_code', postalCode: 'postal_code',
  bloodGroup: 'blood_group', maritalStatus: 'marital_status', isDisabled: 'is_disabled', alternatePhone: 'alternate_phone',
  permSameAsCurrent: 'perm_same_as_current', permAddressLine1: 'perm_address_line1', permAddressLine2: 'perm_address_line2',
  permCity: 'perm_city', permStateCode: 'perm_state_code', permPostalCode: 'perm_postal_code',
  linkedinUrl: 'linkedin_url', twitterUrl: 'twitter_url', websiteUrl: 'website_url',
} as const;
const PERSONAL_FLAGS = new Set(['isDisabled', 'permSameAsCurrent']);

/** Each Personal-tab card posts only its own fields; only those columns are written. */
export async function savePersonalDetailsAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = personalProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data as Record<string, unknown>;
  const row: Record<string, unknown> = { organization_id: ctx.org.id, employee_id: employeeIdSchema.parse(employeeId) };
  for (const [key, column] of Object.entries(PERSONAL_COLUMNS)) {
    if (!formData.has(key)) continue;
    row[column] = PERSONAL_FLAGS.has(key) ? v[key] === 'yes' : (v[key] ?? null);
  }
  if (row.perm_same_as_current === true) {
    for (const c of ['perm_address_line1', 'perm_address_line2', 'perm_city', 'perm_state_code', 'perm_postal_code']) row[c] = null;
  }

  const supabase = await createClient();
  const { error } = await supabase.from('employee_personal')
    .upsert(row as Database['public']['Tables']['employee_personal']['Insert'], { onConflict: 'employee_id' });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: 'Personal details saved.' };
}

// ─── Education and family ───────────────────────────────────────────────────

export async function addQualificationAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = qualificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('employee_qualifications').insert({
    organization_id: ctx.org.id, employee_id: employeeIdSchema.parse(employeeId), level: v.level, degree: v.degree,
    specialization: v.specialization ?? null, institution: v.institution, start_year: v.startYear ?? null, end_year: v.endYear ?? null,
    score: v.score ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(profilePath(orgSlug, employeeId));
  await flash('Qualification added.');
  return { ok: true, message: 'Qualification added.' };
}

export async function addFamilyMemberAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = familyMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('employee_family_members').insert({
    organization_id: ctx.org.id, employee_id: employeeIdSchema.parse(employeeId), name: v.name, relationship: v.relationship,
    date_of_birth: v.dateOfBirth ?? null, gender: v.gender ?? null, phone: v.phone ?? null, occupation: v.occupation ?? null,
    is_dependent: v.isDependent === 'yes',
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(profilePath(orgSlug, employeeId));
  await flash('Family member added.');
  return { ok: true, message: 'Family member added.' };
}

const REMOVABLE = { qualification: 'employee_qualifications', family: 'employee_family_members' } as const;

export async function removeProfileRowAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const kind = z.enum(['qualification', 'family']).safeParse(formData.get('kind'));
  const rowId = z.uuid().safeParse(formData.get('rowId'));
  if (!kind.success || !rowId.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from(REMOVABLE[kind.data]).delete().eq('id', rowId.data).eq('employee_id', employeeId).select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length === 0) return { ok: false, message: 'You can’t remove this.' };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: 'Removed.' };
}

export async function addEmergencyContactAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);

  const supabase = await createClient();
  const { count } = await supabase.from('emergency_contacts').select('id', { count: 'exact', head: true }).eq('employee_id', employeeId);
  if ((count ?? 0) >= 5) return { ok: false, message: 'Up to 5 emergency contacts can be added.' };
  const { error } = await supabase.from('emergency_contacts').insert({
    organization_id: ctx.org.id,
    employee_id: employeeIdSchema.parse(employeeId),
    name: parsed.data.name,
    relationship: parsed.data.relationship,
    phone: parsed.data.phone,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: 'Emergency contact added.' };
}

export async function removeEmergencyContactAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const contactId = employeeIdSchema.safeParse(formData.get('contactId'));
  if (!contactId.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('emergency_contacts').delete().eq('id', contactId.data).eq('employee_id', employeeId).select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length === 0) return { ok: false, message: 'You can’t remove this contact.' };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: 'Emergency contact removed.' };
}

// ─── Identity numbers & bank accounts: full values only on explicit, audited request ───────────

export interface IdentityValues {
  pan: string | null;
  aadhaar_last4: string | null;
  uan: string | null;
  esic_number: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
}
/** Result of an audited "show full values" request. `values` keeps its ActionState meaning (echoed form input). */
export interface RevealState<T> extends ActionState {
  revealed?: T | null;
  intent?: 'view' | 'edit';
}

export async function revealIdentityAction(orgSlug: string, employeeId: string, _prev: RevealState<IdentityValues>, formData: FormData): Promise<RevealState<IdentityValues>> {
  await getOrgContext(orgSlug);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('reveal_employee_identity', { p_employee: employeeIdSchema.parse(employeeId) });
  if (error) return { ok: false, message: toUserMessage(error) };
  return { ok: true, revealed: (data[0] as IdentityValues | undefined) ?? null, intent: formData.get('intent') === 'edit' ? 'edit' : 'view' };
}

export async function saveIdentityAction(orgSlug: string, employeeId: string, _prev: RevealState<IdentityValues>, formData: FormData): Promise<RevealState<IdentityValues>> {
  await getOrgContext(orgSlug);
  const parsed = identitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...invalid(parsed.error, formData), intent: 'edit' };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_employee_identity', {
    p_employee: employeeIdSchema.parse(employeeId),
    p_pan: v.pan,
    p_aadhaar_last4: v.aadhaarLast4,
    p_uan: v.uan,
    p_esic_number: v.esicNumber,
    p_passport_number: v.passportNumber,
    p_passport_expiry: v.passportExpiry,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData), intent: 'edit' };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: 'Identity details saved.' };
}

export interface BankValues {
  account_holder_name: string;
  bank_name: string;
  account_number: string;
  ifsc: string;
  account_type: string;
}

export async function revealBankAction(orgSlug: string, employeeId: string, _prev: RevealState<BankValues>, _formData: FormData): Promise<RevealState<BankValues>> {
  await getOrgContext(orgSlug);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('reveal_employee_bank_account', { p_employee: employeeIdSchema.parse(employeeId) });
  if (error) return { ok: false, message: toUserMessage(error) };
  return { ok: true, revealed: (data[0] as BankValues | undefined) ?? null, intent: 'view' };
}

export async function saveBankAccountAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = bankAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_employee_bank_account', {
    p_employee: employeeIdSchema.parse(employeeId),
    p_account_holder_name: v.accountHolderName,
    p_bank_name: v.bankName,
    p_account_number: v.accountNumber,
    p_ifsc: v.ifsc,
    p_account_type: v.accountType,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: 'Bank account updated. The previous account was archived.' };
}

// ─── Documents ──────────────────────────────────────────────────────────────

/** Org-wide permission, or self scope on the caller's own record. Checked before any file is touched. */
async function mayForEmployee(ctx: OrgContext, employeeId: string, key: 'employee.document.upload' | 'employee.document.delete') {
  if (ctx.can(key, 'org')) return true;
  if (!ctx.can(key, 'self')) return false;
  const employee = await getEmployee(ctx.org.id, employeeId);
  return employee?.user_id === ctx.user.id;
}

export async function uploadDocumentAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const id = employeeIdSchema.parse(employeeId);
  if (!(await mayForEmployee(ctx, id, 'employee.document.upload'))) {
    return { ok: false, message: 'You don’t have permission to add documents for this employee.' };
  }
  const parsed = uploadDocumentSchema.safeParse({ category: formData.get('category'), title: formData.get('title') });
  if (!parsed.success) return invalid(parsed.error, formData);

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, fieldErrors: { file: 'Choose a file to upload.' }, values: formValues(formData) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkDocumentFile(bytes.byteLength, bytes.subarray(0, 16));
  if (!check.ok) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { file: check.message }, values: formValues(formData) };

  const documentId = randomUUID();
  const path = `${ctx.org.id}/${id}/${documentId}`;
  if (!(await storeDocumentFile(path, bytes, check.type, DOCUMENT_BUCKET))) {
    return { ok: false, message: 'The file could not be stored. Please try again.', values: formValues(formData) };
  }
  // The database re-checks the permission as the caller and has the final say.
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_employee_document', {
    p_employee: id,
    p_id: documentId,
    p_category: parsed.data.category,
    p_title: parsed.data.title,
    p_file_name: safeFileName(file.name),
    p_content_type: check.type,
    p_size_bytes: bytes.byteLength,
  });
  if (error) {
    await removeDocumentFile(path, DOCUMENT_BUCKET);
    return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  }
  const proves = proofsFrom(formData);
  if (proves.length > 0) await supabase.rpc('set_document_proofs', { p_document: documentId, p_proves: proves });
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: `“${parsed.data.title}” uploaded.` };
}

export async function deleteDocumentAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const id = employeeIdSchema.parse(employeeId);
  const documentId = z.uuid().safeParse(formData.get('documentId'));
  if (!documentId.success) return { ok: false, message: 'Invalid request.' };
  if (!(await mayForEmployee(ctx, id, 'employee.document.delete'))) {
    return { ok: false, message: 'You don’t have permission to delete this document.' };
  }

  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc('delete_employee_document', { p_document: documentId.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  // The record is already hidden and audited. If removing the file fails it stays unreachable (no signed
  // URL is ever issued for a deleted record) until a cleanup job exists; see BUILD_STATUS known issues.
  await removeDocumentFile(path, DOCUMENT_BUCKET);
  revalidatePath(profilePath(orgSlug, employeeId));
  await flash('Document deleted.');
  return { ok: true, message: 'Document deleted.' };
}

const proofsFrom = (formData: FormData) =>
  formData.getAll('proves').map(String).filter((p): p is (typeof DOCUMENT_PROOFS)[number] => (DOCUMENT_PROOFS as readonly string[]).includes(p));

export async function setProofsAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const documentId = z.uuid().safeParse(formData.get('documentId'));
  if (!documentId.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_document_proofs', { p_document: documentId.data, p_proves: proofsFrom(formData) });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: 'Saved.' };
}

export async function verifyDocumentAction(orgSlug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const documentId = z.uuid().safeParse(formData.get('documentId'));
  if (!documentId.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('verify_employee_document', { p_document: documentId.data, p_verified: formData.get('verified') === 'yes' });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(profilePath(orgSlug, employeeId));
  return { ok: true, message: formData.get('verified') === 'yes' ? 'Verified.' : 'Verification removed.' };
}
