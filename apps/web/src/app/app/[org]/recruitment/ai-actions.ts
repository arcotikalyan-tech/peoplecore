'use server';

import { revalidatePath } from 'next/cache';
import { jobDescription, resumeExtraction } from '@peoplecore/ai';
import { EMPLOYMENT_TYPE_LABELS } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { fileForAi, runAi, saveSuggestion, settleSuggestion } from '@/server/ai';
import { getOrgContext } from '@/server/context';
import { getRequisition } from '@/server/recruitment';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import type { DraftState, ResumeState } from './ai-recruiting';

/** AI help for recruiters: read a resume into the candidate form, draft a job description. Suggestions only. */

const DENIED = { ok: false, message: 'You don’t have permission to manage recruitment.' } as const;

async function authorize(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can('recruitment.manage', 'org') ? ctx : null;
}

export async function readResumeAction(orgSlug: string, _prev: ResumeState, formData: FormData): Promise<ResumeState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const file = await fileForAi(formData.get('resume'));
  if (!file.ok) return { ok: false, message: file.message };
  const result = await runAi(ctx, resumeExtraction, { file: file.file });
  if (!result.ok) return { ok: false, message: result.message };
  const r = result.output;
  if (!r.isResume) return { ok: true, result: r };
  const fields = Object.fromEntries(
    (['firstName', 'lastName', 'email', 'phone', 'currentCompany'] as const).filter((k) => r[k]).map((k) => [k, r[k] as string]));
  const suggestionId = await saveSuggestion(result.runId, 'candidate', null, {
    fields, currentTitle: r.currentTitle, totalExperienceYears: r.totalExperienceYears, skills: r.skills,
  });
  return { ok: true, result: r, ...(suggestionId ? { suggestionId } : {}) };
}

export async function draftDescriptionAction(orgSlug: string, requisitionId: string, _prev: DraftState, _formData: FormData): Promise<DraftState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const req = await getRequisition(ctx.org.id, z.uuid().parse(requisitionId));
  if (!req) return DENIED;
  const structure = await getStructure(ctx.org.id);
  const result = await runAi(ctx, jobDescription, {
    title: req.title,
    department: structure.departments.find((d) => d.id === req.department_id)?.name ?? null,
    location: structure.locations.find((l) => l.id === req.location_id)?.name ?? null,
    employmentType: EMPLOYMENT_TYPE_LABELS[req.employment_type],
    notes: req.description,
  });
  if (!result.ok) return { ok: false, message: result.message };
  const suggestionId = await saveSuggestion(result.runId, 'requisition', req.id, { fields: { description: result.output.text }, warnings: result.output.warnings });
  return { ok: true, draft: result.output, ...(suggestionId ? { suggestionId } : {}) };
}

export async function saveDescriptionAction(orgSlug: string, requisitionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = z.string().trim().max(5000, 'At most 5,000 characters').safeParse(formData.get('description') ?? '');
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { description: parsed.error.issues[0]!.message }, values: formValues(formData) };
  const supabase = await createClient();
  const { data, error } = await supabase.from('job_requisitions').update({ description: parsed.data || null })
    .eq('organization_id', ctx.org.id).eq('id', z.uuid().parse(requisitionId)).select('id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (data.length !== 1) return DENIED;
  await settleSuggestion(formData.get('suggestionId'), { description: parsed.data }, requisitionId);
  revalidatePath(`/app/${orgSlug}/recruitment`, 'layout');
  return { ok: true, message: 'Description saved.' };
}
