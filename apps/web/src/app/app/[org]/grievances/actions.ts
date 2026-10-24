'use server';

import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { checkDocumentFile, safeFileName, todayIn } from '@peoplecore/shared';
import { z } from 'zod';
import { formDataAll, formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { GRIEVANCE_BUCKET, removeDocumentFile, storeDocumentFile } from '@/server/document-storage';
import { createClient } from '@/server/supabase';
import { CATEGORY_LABEL, type GrievanceCategory } from './labels';

/** Grievance actions. The database decides who may see, write on, move or staff a case. */

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const CATEGORIES = Object.keys(CATEGORY_LABEL) as [GrievanceCategory, ...GrievanceCategory[]];

export async function raiseGrievanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    category: z.enum(CATEGORIES, { error: 'Choose what it is about' }),
    subject: z.string().trim().min(3, 'Give it a short title').max(160),
    description: z.string().trim().min(20, 'Describe what happened in a few sentences').max(10000),
    incidentOn: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')),
    anonymous: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const respondents = [...new Set(formDataAll(formData, 'respondents'))];
  if (!respondents.every((r) => z.uuid().safeParse(r).success)) return { ok: false, message: 'Choose people from the list.', values: formValues(formData) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('raise_grievance', {
    p_org: ctx.org.id, p_category: v.category, p_subject: v.subject, p_description: v.description,
    p_incident_on: sqlNull(v.incidentOn), p_respondents: respondents, p_anonymous: v.anonymous,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  await flash(v.anonymous ? 'Submitted anonymously. The people handling it won’t see your name; you’ll hear back here.' : 'Submitted in confidence. You’ll hear back here.');
  redirect(`/app/${orgSlug}/grievances/${data}`);
}

export async function grievanceMessageAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    caseId: z.uuid(),
    body: z.string().trim().min(1, 'Write a message').max(5000),
    internal: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_grievance_note', { p_case: parsed.data.caseId, p_body: parsed.data.body, p_internal: parsed.data.internal });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  return { ok: true, message: parsed.data.internal ? 'Internal note added.' : 'Message sent.' };
}

export async function updateGrievanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    caseId: z.uuid(),
    status: z.enum(['in_review', 'investigating', 'resolved', 'closed']),
    outcome: optional(z.string().trim().max(5000)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_grievance', { p_case: v.caseId, p_status: v.status, p_outcome: sqlNull(v.outcome) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances`, 'layout');
  if (v.status === 'closed') {
    await flash('Case closed.'); // the update form goes away with it
    return { ok: true, message: 'Case closed.' };
  }
  return { ok: true, message: 'Case updated. The person who raised it has been told.' };
}

export async function withdrawGrievanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), reason: optional(z.string().trim().max(1000)) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('withdraw_grievance', { p_case: parsed.data.caseId, p_reason: sqlNull(parsed.data.reason) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances`, 'layout');
  await flash('Withdrawn.');
  return { ok: true, message: 'Withdrawn.' };
}

export async function addInvestigatorAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), userId: z.uuid({ error: 'Choose someone' }) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_grievance_access', { p_case: parsed.data.caseId, p_user: parsed.data.userId, p_allow: true });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  return { ok: true, message: 'Added. They’ve been told.' };
}

export async function removeInvestigatorAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), userId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_grievance_access', { p_case: parsed.data.caseId, p_user: parsed.data.userId, p_allow: false });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  await flash('Removed from the case.');
  return { ok: true, message: 'Removed.' };
}

export async function addRespondentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), employeeId: z.uuid({ error: 'Choose someone' }) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_grievance_respondent', { p_case: parsed.data.caseId, p_employee: parsed.data.employeeId });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  return { ok: true, message: 'Added. They can’t see this case.' };
}

// ─── POSH ────────────────────────────────────────────────────────────────────

const isoDate = z.iso.date({ error: 'Choose a date' });
const posh = (orgSlug: string) => revalidatePath(`/app/${orgSlug}/grievances`, 'layout');

/** Adds a member to the Internal Committee register (case managers; the database checks the law's make-up rules). */
export async function addCommitteeMemberAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    role: z.enum(['presiding_officer', 'member', 'external_member'], { error: 'Choose a role' }),
    employeeId: optional(z.uuid({ error: 'Choose an employee' })),
    externalName: optional(z.string().trim().min(2, 'Give their name').max(120)),
    externalOrg: optional(z.string().trim().max(160)),
    woman: z.enum(['yes', 'no'], { error: 'Choose one' }),
    termFrom: isoDate,
    termUntil: isoDate,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const external = v.role === 'external_member';
  const fail = (field: string, message: string): ActionState => ({ ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { [field]: message }, values: formValues(formData) });
  if (external && !v.externalName) return fail('externalName', 'Give the external member’s name');
  if (external && v.employeeId) return fail('employeeId', 'Leave this empty for the external member');
  if (!external && !v.employeeId) return fail('employeeId', 'Choose an employee');
  if (!external && (v.externalName || v.externalOrg)) return fail('externalName', 'Only for the external member');
  if (v.role === 'presiding_officer' && v.woman !== 'yes') return fail('woman', 'The presiding officer is a woman (section 4)');
  if (v.termUntil <= v.termFrom) return fail('termUntil', 'After the start');
  const max = new Date(`${v.termFrom}T00:00:00Z`);
  max.setUTCFullYear(max.getUTCFullYear() + 3);
  if (v.termUntil > max.toISOString().slice(0, 10)) return fail('termUntil', 'Terms are three years at most');
  const supabase = await createClient();
  const { error } = await supabase.from('posh_committee_members').insert({
    organization_id: ctx.org.id, role: v.role, employee_id: external ? null : v.employeeId!, external_name: external ? v.externalName! : null,
    external_org: external ? v.externalOrg ?? null : null, woman: v.woman === 'yes', term_from: v.termFrom, term_until: v.termUntil,
  });
  if (error) return { ok: false, message: error.code === '23505' ? 'They’re already on the committee for that term.' : toUserMessage(error), values: formValues(formData) };
  posh(orgSlug);
  return { ok: true, message: 'Added to the committee.' };
}

/** Ends a member's term today (or removes a term that hasn't really started). */
export async function endCommitteeTermAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('memberId'));
  if (!id.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { data: m } = await supabase.from('posh_committee_members').select('term_from').eq('organization_id', ctx.org.id).eq('id', id.data).maybeSingle();
  if (!m) return { ok: false, message: 'Not found.' };
  const today = todayIn(ctx.org.timezone);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const { error } = m.term_from < yesterday
    ? await supabase.from('posh_committee_members').update({ term_until: yesterday }).eq('organization_id', ctx.org.id).eq('id', id.data)
    : await supabase.from('posh_committee_members').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  posh(orgSlug);
  return { ok: true, message: 'Term ended.' };
}

/** Records (or clears) a statutory step of a POSH case: its handlers only. */
export async function recordPoshStepAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    caseId: z.uuid(),
    step: z.enum(['filing_extended', 'conciliation_requested', 'conciliation_settled', 'notice_sent', 'reply_received', 'inquiry_completed', 'report_sent', 'action_taken']),
    on: optional(isoDate),
    action: optional(z.string().max(40)),
    clear: optional(z.literal('yes')),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  if (!v.clear && !v.on) return { ok: false, message: 'Choose a date.', fieldErrors: { on: 'Choose a date' }, values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_posh_step', { p_case: v.caseId, p_step: v.step, p_on: sqlNull(v.clear ? undefined : v.on), p_action: sqlNull(v.clear ? undefined : v.action) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances/${v.caseId}`);
  return { ok: true, message: v.clear ? 'Cleared.' : 'Recorded.' };
}

export async function addPoshSessionAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    heldOn: isoDate,
    audience: z.enum(['employees', 'committee']),
    title: z.string().trim().min(3, 'Give it a title').max(160),
    attendees: optional(z.coerce.number({ error: 'Enter a number' }).int('Enter a whole number').min(0).max(1_000_000)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  if (v.heldOn > todayIn(ctx.org.timezone)) return { ok: false, message: 'Record sessions once they’ve been held.', fieldErrors: { heldOn: 'Not in the future' }, values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from('posh_sessions').insert({ organization_id: ctx.org.id, held_on: v.heldOn, audience: v.audience, title: v.title, attendees: v.attendees ?? null });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  posh(orgSlug);
  return { ok: true, message: 'Session recorded.' };
}

export async function deletePoshSessionAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('sessionId'));
  if (!id.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('posh_sessions').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  posh(orgSlug);
  return { ok: true, message: 'Removed.' };
}

/**
 * Attaches a file to a case. The case must be visible to the caller and open before anything is stored; the database
 * checks again when recording it (who may write, internal files, ten at most), and the file is removed if that refuses.
 */
export async function attachGrievanceFileAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const caseId = z.uuid().safeParse(formData.get('caseId'));
  if (!caseId.success) return { ok: false, message: 'Case not found.' };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a file.', fieldErrors: { file: 'Choose a file' } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkDocumentFile(bytes.byteLength, bytes.subarray(0, 16));
  if (!check.ok) return { ok: false, message: check.message, fieldErrors: { file: check.message } };
  const supabase = await createClient();
  const { data: found } = await supabase.from('grievances').select('id, status').eq('organization_id', ctx.org.id).eq('id', caseId.data).maybeSingle();
  if (!found) return { ok: false, message: 'Case not found.' };
  if (found.status === 'closed' || found.status === 'withdrawn') return { ok: false, message: 'This case is closed.' };
  const id = randomUUID();
  const path = `${ctx.org.id}/${found.id}/${id}`;
  if (!(await storeDocumentFile(path, bytes, check.type, GRIEVANCE_BUCKET))) return { ok: false, message: 'The file could not be stored. Please try again.' };
  const { error } = await supabase.rpc('add_grievance_file', {
    p_case: found.id, p_id: id, p_name: safeFileName(file.name), p_type: check.type, p_size: bytes.byteLength,
    p_sha256: createHash('sha256').update(bytes).digest('hex'), p_internal: formData.get('internal') === 'on',
  });
  if (error) {
    await removeDocumentFile(path, GRIEVANCE_BUCKET);
    return { ok: false, message: toUserMessage(error) };
  }
  revalidatePath(`/app/${orgSlug}/grievances/${found.id}`);
  return { ok: true, message: 'File attached.' };
}

export async function removeGrievanceFileAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), fileId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'File not found.' };
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc('remove_grievance_file', { p_id: parsed.data.fileId });
  if (error) return { ok: false, message: toUserMessage(error) };
  if (path) await removeDocumentFile(path, GRIEVANCE_BUCKET);
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  return { ok: true, message: 'File removed.' };
}
