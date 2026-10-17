'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addCandidateSchema, createRequisitionSchema, hireSchema, moveApplicationSchema, REQUISITION_STATUSES } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
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
  const existing = (data as { existing_candidate?: boolean }).existing_candidate;
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
    p_application: parsed.data.applicationId, p_date_of_joining: parsed.data.dateOfJoining, p_work_email: parsed.data.workEmail,
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
  return { ok: true, message: 'Candidate erased, with all their applications.' };
}
