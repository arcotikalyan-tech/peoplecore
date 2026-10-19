'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Performance actions; the database decides who may write what at which stage. */

const done = (orgSlug: string, message: string): ActionState => {
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message };
};
const rating = z.coerce.number().int().min(1, 'Choose a rating').max(5);
const fields = (e: z.ZodError) => Object.fromEntries(e.issues.map((i) => [String(i.path[0]), i.message]));

export async function addGoalAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    employeeId: z.uuid(), title: z.string().trim().min(3, 'Describe the goal').max(200),
    weight: z.coerce.number().int().min(0).max(100), description: z.string().trim().max(2000).optional(),
    cycleId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fields(parsed.error), values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from('goals').insert({
    organization_id: ctx.org.id, employee_id: parsed.data.employeeId, title: parsed.data.title, weight: parsed.data.weight,
    description: parsed.data.description || null, cycle_id: parsed.data.cycleId ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, 'Goal added.');
}

export async function updateGoalAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({ goalId: z.uuid(), progress: z.coerce.number().int().min(0).max(100), status: z.enum(['active', 'completed', 'dropped']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Progress is a percentage (0–100).' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('goals').update({ progress: parsed.data.progress, status: parsed.data.status })
    .eq('organization_id', ctx.org.id).eq('id', parsed.data.goalId).select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length !== 1) return { ok: false, message: 'You can’t change this goal.' };
  return done(orgSlug, 'Goal updated.');
}

export async function selfReviewAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ reviewId: z.uuid(), rating, comments: z.string().trim().max(5000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fields(parsed.error), values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_self_review', { p_review: parsed.data.reviewId, p_rating: parsed.data.rating, p_comments: parsed.data.comments });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  const message = 'Self review submitted. Your manager reviews next.';
  await flash(message);
  return done(orgSlug, message);
}

export async function managerReviewAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ reviewId: z.uuid(), rating, comments: z.string().trim().max(5000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fields(parsed.error), values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_manager_review', { p_review: parsed.data.reviewId, p_rating: parsed.data.rating, p_comments: parsed.data.comments });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  const message = 'Manager review submitted.';
  await flash(message);
  return done(orgSlug, message);
}

export async function requestFeedbackAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ reviewId: z.uuid(), fromId: z.uuid({ error: 'Choose a colleague' }), question: z.string().trim().min(5, 'Ask a question').max(500) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fields(parsed.error), values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_feedback', { p_review: parsed.data.reviewId, p_from: parsed.data.fromId, p_question: parsed.data.question });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, 'Feedback requested. They have a task in their Inbox.');
}

export async function giveFeedbackAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ requestId: z.uuid(), response: z.string().trim().max(3000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('give_feedback', { p_request: parsed.data.requestId, p_response: parsed.data.response });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  const message = 'Thank you, your feedback was sent.';
  await flash(message);
  return done(orgSlug, message);
}

// ─── HR: cycles ─────────────────────────────────────────────────────────────

export async function createCycleAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('performance.manage', 'org')) return { ok: false, message: 'You don’t have permission to do that.' };
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
  const parsed = z.object({
    name: z.string().trim().min(2, 'Name the cycle').max(80), periodStart: date, periodEnd: date,
    selfReviewDue: z.preprocess((v) => (v === '' ? undefined : v), date.optional()),
    managerReviewDue: z.preprocess((v) => (v === '' ? undefined : v), date.optional()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fields(parsed.error), values: formValues(formData) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('review_cycles').insert({
    organization_id: ctx.org.id, name: v.name, period_start: v.periodStart, period_end: v.periodEnd,
    self_review_due: v.selfReviewDue ?? null, manager_review_due: v.managerReviewDue ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, 'Cycle created. Activate it to open reviews.');
}

export async function cycleStepAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ cycleId: z.uuid(), step: z.enum(['activate', 'share']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = parsed.data.step === 'activate'
    ? await supabase.rpc('activate_review_cycle', { p_cycle: parsed.data.cycleId })
    : await supabase.rpc('share_review_cycle', { p_cycle: parsed.data.cycleId });
  if (error) return { ok: false, message: toUserMessage(error) };
  const message = parsed.data.step === 'activate' ? `Opened ${data} reviews. Everyone has a self-review task.` : `Shared ${data} results with employees.`;
  await flash(message);
  return done(orgSlug, message);
}

export async function calibrateAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ reviewId: z.uuid(), rating, note: z.string().trim().max(1000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose a rating.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('calibrate_review', { p_review: parsed.data.reviewId, p_final_rating: parsed.data.rating, p_note: parsed.data.note ?? '' });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Calibrated.');
}

// ─── PMS settings, KRAs, skills, skill ratings ──────────────────────────────

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };

export async function savePmsSettingsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('performance.manage', 'org')) return DENIED;
  const parsed = z.object({
    evaluationPeriod: z.enum(['quarterly', 'half_yearly', 'annual']),
    goalsWeight: z.coerce.number({ error: 'Enter a percentage' }).int().min(0, '0 to 100').max(100, '0 to 100'),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fields(parsed.error), values: formValues(formData) };
  const labels = [1, 2, 3, 4, 5].map((n) => String(formData.get(`label${n}`) ?? '').trim().slice(0, 40));
  if (labels.some((l) => l.length < 2)) return { ok: false, message: 'Name every rating on the scale.', values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from('pms_settings').update({
    evaluation_period: parsed.data.evaluationPeriod, goals_weight: parsed.data.goalsWeight, rating_labels: labels,
    goal_weightage: formData.get('goalWeightage') === 'on', self_appraisal: formData.get('selfAppraisal') === 'on', peer_feedback: formData.get('peerFeedback') === 'on',
  }).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, 'Performance settings saved.');
}

export async function saveKraAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('performance.manage', 'org')) return DENIED;
  const parsed = z.object({
    kraId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
    title: z.string().trim().min(3, 'Describe the KRA').max(200),
    description: z.string().trim().max(1000).optional(),
    departmentId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
    weight: z.coerce.number({ error: 'Enter a weight' }).int().min(0, '0 to 100').max(100, '0 to 100'),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fields(parsed.error), values: formValues(formData) };
  const v = parsed.data;
  const row = { title: v.title, description: v.description || null, department_id: v.departmentId ?? null, weight: v.weight };
  const supabase = await createClient();
  const { error } = v.kraId
    ? await supabase.from('pms_kras').update(row).eq('organization_id', ctx.org.id).eq('id', v.kraId)
    : await supabase.from('pms_kras').insert({ ...row, organization_id: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, v.kraId ? 'KRA saved.' : 'KRA added.');
}

export async function toggleLibraryAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('performance.manage', 'org')) return DENIED;
  const parsed = z.object({ table: z.enum(['pms_kras', 'pms_skills']), id: z.uuid(), active: z.enum(['yes', 'no']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from(parsed.data.table).update({ is_active: parsed.data.active === 'yes' }).eq('organization_id', ctx.org.id).eq('id', parsed.data.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, parsed.data.active === 'yes' ? 'Turned on.' : 'Turned off.');
}

/** Assign a KRA as a goal (with its weight) to everyone in a department, or everyone, in the chosen cycle. */
export async function assignKraAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('performance.manage', 'org')) return DENIED;
  const parsed = z.object({ kraId: z.uuid(), cycleId: z.uuid({ error: 'Choose a cycle' }), departmentId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose a cycle.', fieldErrors: fields(parsed.error) };
  const supabase = await createClient();
  const { data: kra } = await supabase.from('pms_kras').select('title, description, weight').eq('organization_id', ctx.org.id).eq('id', parsed.data.kraId).single();
  let q = supabase.from('employees').select('id').eq('organization_id', ctx.org.id).in('status', ['active', 'on_notice']);
  if (parsed.data.departmentId) q = q.eq('department_id', parsed.data.departmentId);
  const [{ data: emps }, { data: existing }] = await Promise.all([
    q, supabase.from('goals').select('employee_id').eq('organization_id', ctx.org.id).eq('cycle_id', parsed.data.cycleId).eq('title', kra?.title ?? ''),
  ]);
  if (!kra) return { ok: false, message: 'KRA not found.' };
  const have = new Set((existing ?? []).map((g) => g.employee_id));
  const rows = (emps ?? []).filter((e) => !have.has(e.id)).map((e) => ({
    organization_id: ctx.org.id, employee_id: e.id, cycle_id: parsed.data.cycleId, title: kra.title, description: kra.description, weight: kra.weight,
  }));
  if (rows.length === 0) return { ok: true, message: 'Everyone already has this goal.' };
  const { error } = await supabase.from('goals').insert(rows);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, `Assigned to ${rows.length} employee${rows.length === 1 ? '' : 's'}.`);
}

export async function saveSkillAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('performance.manage', 'org')) return DENIED;
  const parsed = z.object({
    name: z.string().trim().min(2, 'Name the skill').max(80),
    category: z.string().trim().min(2, 'Name the category').max(40),
    description: z.string().trim().max(500).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fields(parsed.error), values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from('pms_skills').insert({ organization_id: ctx.org.id, name: parsed.data.name, category: parsed.data.category, description: parsed.data.description || null });
  if (error) return { ok: false, message: error.code === '23505' ? 'That skill is already in the library.' : toUserMessage(error), values: formValues(formData) };
  return done(orgSlug, `Skill ${parsed.data.name} added.`);
}

export async function rateSkillsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ reviewId: z.uuid(), as: z.enum(['self', 'manager']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Review not found.' };
  const ratings: Record<string, number> = {};
  for (const [k, v] of formData.entries()) {
    const m = /^skill:([0-9a-f-]{36})$/i.exec(k);
    if (m && v !== '') ratings[m[1]!] = Number(v);
  }
  if (Object.keys(ratings).length === 0) return { ok: false, message: 'Rate at least one skill.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('rate_review_skills', { p_review: parsed.data.reviewId, p_as: parsed.data.as, p_ratings: ratings });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(orgSlug, 'Skill ratings saved.');
}
