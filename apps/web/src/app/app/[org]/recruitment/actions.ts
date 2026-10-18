'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addCandidateSchema, createRequisitionSchema, hireSchema, interviewSchema, moveApplicationSchema, offerSchema, REQUISITION_STATUSES,
  SCORECARD_CRITERIA, scorecardSchema, zonedLocalToIso,
} from '@peoplecore/shared';
import { z } from 'zod';
import { formDataAll, formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { settleSuggestion } from '@/server/ai';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Recruitment writes. The database functions check permissions as the caller; these checks only give friendlier messages. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to manage recruitment.' };
const id = z.uuid();

async function authorize(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can('recruitment.manage', 'org') ? ctx : null;
}

export async function createRequisitionAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = createRequisitionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_requisition', {
    p_org: ctx.org.id, p_title: v.title, p_openings: v.openings, p_employment_type: v.employmentType,
    p_department_id: v.departmentId, p_designation_id: v.designationId, p_location_id: v.locationId,
    p_hiring_manager: v.hiringManagerId, p_description: v.description,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/recruitment`);
  redirect(`/app/${orgSlug}/recruitment/${data}`);
}

export async function setRequisitionStatusAction(orgSlug: string, requisitionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const status = z.enum(REQUISITION_STATUSES).safeParse(formData.get('status'));
  if (!status.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('job_requisitions').update({ status: status.data })
    .eq('organization_id', ctx.org.id).eq('id', id.parse(requisitionId)).select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length !== 1) return DENIED;
  revalidatePath(`/app/${orgSlug}/recruitment`, 'layout');
  return { ok: true, message: 'Status updated.' };
}

export async function addCandidateAction(orgSlug: string, requisitionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = addCandidateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('add_application', {
    p_requisition: id.parse(requisitionId), p_first_name: v.firstName, p_last_name: v.lastName, p_email: v.email,
    p_phone: v.phone, p_source: v.source, p_current_company: v.currentCompany, p_consent: true,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/recruitment`, 'layout');
  const { existing_candidate: existing, candidate_id: candidateId } = data as { existing_candidate?: boolean; candidate_id?: string };
  await settleSuggestion(formData.get('suggestionId'), {
    firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone, currentCompany: v.currentCompany,
  }, candidateId);
  return {
    ok: true,
    message: existing
      ? 'This person was already a candidate; their existing record was added to this requisition.'
      : `${v.firstName} added to the pipeline.`,
  };
}

export async function moveApplicationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = moveApplicationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose a stage.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('move_application', {
    p_application: parsed.data.applicationId, p_stage: parsed.data.stage, p_note: parsed.data.note,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/recruitment`, 'layout');
  await flash('Moved.');
  return { ok: true, message: 'Moved.' };
}

export async function hireAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('recruitment.manage', 'org') || !ctx.can('employee.create', 'org')) {
    return { ok: false, message: 'Hiring creates an employee record, which needs HR permissions.' };
  }
  const parsed = hireSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('hire_application', {
    p_application: parsed.data.applicationId, p_date_of_joining: sqlNull(parsed.data.dateOfJoining), p_work_email: parsed.data.workEmail,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  redirect(`/app/${orgSlug}/employees/${data}?created=1`);
}

export async function eraseCandidateAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const candidateId = id.safeParse(formData.get('candidateId'));
  if (!candidateId.success || formData.get('confirm') !== 'on') {
    return { ok: false, message: 'Tick the box to confirm. Erasing can’t be undone.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('erase_candidate', { p_candidate: candidateId.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/recruitment`, 'layout');
  await flash('Candidate erased, with all their applications.');
  return { ok: true, message: 'Candidate erased, with all their applications.' };
}

export async function saveCandidateRetentionAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = z.object({
    days: z.coerce.number({ error: 'Enter days' }).int('Whole days').min(30, 'At least 30 days').max(3650, 'At most 3,650 days'),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_candidate_retention', { p_org: ctx.org.id, p_days: parsed.data.days });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/recruitment`);
  return { ok: true, message: 'Saved.' };
}

// ─── Offers, interviews, publishing ─────────────────────────────────────────

export async function saveOfferAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = offerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_offer_version', {
    p_application: v.applicationId, p_annual_ctc: v.annualCtc, p_joining_date: v.joiningDate, p_expires_on: v.expiresOn,
    p_designation: v.designationId, p_terms: v.terms,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/recruitment`, 'layout');
  return { ok: true, message: 'Offer saved as a draft. Submit it for approval when ready.' };
}

const offerStep = z.object({ offerId: z.uuid(), step: z.enum(['submit', 'sent', 'accepted', 'declined', 'withdrawn']) });

export async function offerStepAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = offerStep.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = parsed.data.step === 'submit'
    ? await supabase.rpc('submit_offer', { p_offer: parsed.data.offerId })
    : await supabase.rpc('set_offer_status', { p_offer: parsed.data.offerId, p_status: parsed.data.step });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  const messages = { submit: 'Sent for approval.', sent: 'Marked as sent.', accepted: 'Acceptance recorded. You can hire now.', declined: 'Marked as declined.', withdrawn: 'Offer withdrawn.' };
  return { ok: true, message: messages[parsed.data.step] };
}

export async function scheduleInterviewAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = interviewSchema.safeParse({ ...Object.fromEntries(formData), panelistIds: formDataAll(formData, 'panelistIds') });
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('schedule_interview', {
    p_application: v.applicationId, p_round: v.roundName, p_at: zonedLocalToIso(v.scheduledAt, ctx.org.timezone),
    p_duration: v.durationMinutes, p_mode: v.mode, p_location: sqlNull(v.location), p_panelists: v.panelistIds,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Interview scheduled. The interviewers have a task and a notification.' };
}

export async function submitScorecardAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const ratings = SCORECARD_CRITERIA.map((criterion, i) => ({ criterion, rating: formData.get(`rating${i}`) }));
  const parsed = scorecardSchema.safeParse({ ...Object.fromEntries(formData), ratings });
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_scorecard', {
    p_interview: parsed.data.interviewId, p_recommendation: parsed.data.recommendation, p_summary: parsed.data.summary, p_ratings: parsed.data.ratings,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Scorecard submitted. You can now see the other interviewers’ scorecards.' };
}

export async function publishRequisitionAction(orgSlug: string, requisitionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const publish = formData.get('publish') === 'true';
  const supabase = await createClient();
  const { data, error } = await supabase.from('job_requisitions').update({ is_published: publish })
    .eq('organization_id', ctx.org.id).eq('id', id.parse(requisitionId)).select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length !== 1) return DENIED;
  revalidatePath(`/app/${orgSlug}/recruitment`, 'layout');
  return { ok: true, message: publish ? 'Published on the careers page.' : 'Removed from the careers page.' };
}
