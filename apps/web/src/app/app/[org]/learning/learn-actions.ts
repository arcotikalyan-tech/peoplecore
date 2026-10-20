'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Learn: course lifecycle and lessons, skills, journeys, rules, reminders and settings. learning.manage; RLS decides. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());
const back = (slug: string) => revalidatePath(`/app/${slug}/learning`, 'layout');
const strings = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const uuids = (fd: FormData, name: string) => fd.getAll(name).filter((x): x is string => typeof x === 'string' && z.uuid().safeParse(x).success);
const hr = async (slug: string) => {
  const ctx = await getOrgContext(slug);
  return { ctx, ok: ctx.can('learning.manage', 'org') };
};

export async function courseStatusAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ courseId: z.uuid(), status: z.enum(['draft', 'in_review', 'published', 'archived']) }).safeParse(strings(formData));
  if (!parsed.success) return { ok: false, message: 'Course not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('courses').update({ status: parsed.data.status }).eq('organization_id', ctx.org.id).eq('id', parsed.data.courseId);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash({ draft: 'Back to draft.', in_review: 'Sent for review.', published: 'Published — learners can see it.', archived: 'Archived.' }[parsed.data.status]);
  return { ok: true, message: '' };
}

export async function coursePointsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ courseId: z.uuid(), points: z.coerce.number({ error: 'Enter points' }).int().min(0).max(100000) }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('courses').update({ points: parsed.data.points }).eq('organization_id', ctx.org.id).eq('id', parsed.data.courseId);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Points saved.' };
}

export async function saveLessonAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    lessonId: optional(z.uuid()), courseId: z.uuid(), title: z.string().trim().min(2, 'Name the lesson').max(160),
    kind: z.enum(['text', 'video', 'link']), body: optional(z.string().trim().max(20000)),
    url: optional(z.url({ protocol: /^https$/, error: 'Enter an https:// link' }).max(500)),
    minutes: optional(z.coerce.number().int().min(1).max(600)), position: optional(z.coerce.number().int().min(1).max(500)),
  }).refine((v) => v.kind === 'text' || !!v.url, { path: ['url'], message: 'Videos and links need a URL' }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  let position = v.position;
  if (!v.lessonId && !position) {
    const { count } = await supabase.from('course_lessons').select('id', { count: 'exact', head: true }).eq('course_id', v.courseId);
    position = (count ?? 0) + 1;
  }
  const row = { organization_id: ctx.org.id, course_id: v.courseId, title: v.title, kind: v.kind, body: v.body ?? null, url: v.url ?? null, duration_minutes: v.minutes ?? null, ...(position ? { position } : {}) };
  const { error } = v.lessonId ? await supabase.from('course_lessons').update(row).eq('organization_id', ctx.org.id).eq('id', v.lessonId)
    : await supabase.from('course_lessons').insert({ ...row, position: position! });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.lessonId ? 'Lesson saved.' : `${v.title} added.` };
}

export async function deleteLessonAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('lessonId'));
  if (!id.success) return { ok: false, message: 'Lesson not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('course_lessons').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Lesson removed.' };
}

export async function completeLessonAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('lessonId'));
  if (!id.success) return { ok: false, message: 'Lesson not found.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('complete_lesson', { p_lesson: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  const r = data as { done: number; total: number };
  if (r.done >= r.total) await flash('Course complete 🎉');
  return { ok: true, message: `${r.done} of ${r.total} lessons done.` };
}

export async function saveSkillAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ name: z.string().trim().min(2, 'Name the skill').max(80), category: optional(z.string().trim().max(60)) }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('learn_skills').insert({ organization_id: ctx.org.id, name: parsed.data.name, category: parsed.data.category ?? null });
  if (error) return { ok: false, message: error.code === '23505' ? 'That skill already exists.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: `${parsed.data.name} added.` };
}

export async function courseSkillAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ courseId: z.uuid(), skillId: z.uuid({ error: 'Choose a skill' }), level: z.coerce.number().int().min(1).max(5), remove: optional(z.literal('1')) }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = v.remove ? await supabase.from('course_skills').delete().eq('course_id', v.courseId).eq('skill_id', v.skillId)
    : await supabase.from('course_skills').upsert({ organization_id: ctx.org.id, course_id: v.courseId, skill_id: v.skillId, level: v.level });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: v.remove ? 'Skill removed.' : 'Skill saved.' };
}

export async function roleSkillAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ designationId: z.uuid({ error: 'Choose a designation' }), skillId: z.uuid({ error: 'Choose a skill' }), level: z.coerce.number().int().min(1).max(5), remove: optional(z.literal('1')) }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = v.remove ? await supabase.from('designation_skills').delete().eq('designation_id', v.designationId).eq('skill_id', v.skillId)
    : await supabase.from('designation_skills').upsert({ organization_id: ctx.org.id, designation_id: v.designationId, skill_id: v.skillId, level: v.level });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: v.remove ? 'Requirement removed.' : 'Requirement saved.' };
}

export async function saveJourneyAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    journeyId: optional(z.uuid()), title: z.string().trim().min(3, 'Name the journey').max(160), description: optional(z.string().trim().max(2000)),
    points: z.coerce.number().int().min(0).max(100000).default(0), status: z.enum(['draft', 'published', 'archived']).default('draft'),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const steps = uuids(formData, 'courseId');
  if (steps.length === 0) return { ok: false, message: 'Add at least one course.', values: formValues(formData) };
  const v = parsed.data;
  const supabase = await createClient();
  const row = { organization_id: ctx.org.id, title: v.title, description: v.description ?? null, points: v.points, status: v.status };
  const saved = v.journeyId ? await supabase.from('learn_journeys').update(row).eq('organization_id', ctx.org.id).eq('id', v.journeyId).select('id').single()
    : await supabase.from('learn_journeys').insert(row).select('id').single();
  if (saved.error) return { ok: false, message: toUserMessage(saved.error), values: formValues(formData) };
  const id = saved.data.id;
  const del = await supabase.from('journey_steps').delete().eq('journey_id', id);
  if (del.error) return { ok: false, message: toUserMessage(del.error) };
  const { error } = await supabase.from('journey_steps').insert([...new Set(steps)].map((course_id, i) => ({ organization_id: ctx.org.id, journey_id: id, position: i + 1, course_id })));
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.journeyId ? 'Journey saved.' : `${v.title} created.` };
}

export async function enrollJourneyAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('journeyId'));
  if (!id.success) return { ok: false, message: 'Journey not found.' };
  const people = uuids(formData, 'employeeId');
  const due = z.iso.date().safeParse(formData.get('dueOn'));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('enroll_journey', { p_journey: id.data, p_employees: people.length ? people : undefined, p_due: due.success ? due.data : undefined });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: people.length ? `Enrolled ${data} ${data === 1 ? 'person' : 'people'}.` : 'You’re enrolled — the courses are in your learning.' };
}

export async function saveRuleAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    name: z.string().trim().min(3, 'Name the rule').max(120), target: z.string().regex(/^(course|journey):[0-9a-f-]{36}$/, 'Choose what to assign'),
    departmentId: optional(z.uuid()), designationId: optional(z.uuid()), locationId: optional(z.uuid()),
    employmentType: optional(z.enum(['permanent', 'contract', 'intern', 'temporary', 'consultant'])),
    trigger: z.enum(['new_joiners', 'everyone']), dueDays: z.coerce.number().int().min(1).max(365), recurrence: z.enum(['none', 'yearly']), mandatory: optional(z.literal('on')),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const [kind, id] = v.target.split(':') as ['course' | 'journey', string];
  const supabase = await createClient();
  const { error } = await supabase.from('learn_rules').insert({
    organization_id: ctx.org.id, name: v.name, course_id: kind === 'course' ? id : null, journey_id: kind === 'journey' ? id : null,
    department_id: v.departmentId ?? null, designation_id: v.designationId ?? null, location_id: v.locationId ?? null, employment_type: v.employmentType ?? null,
    trigger: v.trigger, due_days: v.dueDays, recurrence: v.recurrence, mandatory: v.mandatory === 'on',
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  const applied = await supabase.rpc('apply_learning_rules', { p_org: ctx.org.id });
  back(slug);
  return { ok: true, message: `Rule created${applied.data ? ` — assigned to ${applied.data} ${applied.data === 1 ? 'person' : 'people'} now` : ''}.` };
}

export async function ruleToggleAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('ruleId'));
  const op = formData.get('op');
  if (!id.success) return { ok: false, message: 'Rule not found.' };
  const supabase = await createClient();
  const { error } = op === 'delete' ? await supabase.from('learn_rules').delete().eq('organization_id', ctx.org.id).eq('id', id.data)
    : await supabase.from('learn_rules').update({ active: op === 'on' }).eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash(op === 'delete' ? 'Rule deleted.' : op === 'on' ? 'Rule switched on.' : 'Rule paused.');
  return { ok: true, message: '' };
}

export async function applyRulesAction(slug: string): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_learning_rules', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: data ? `Assigned to ${data} ${data === 1 ? 'person' : 'people'}.` : 'Everyone matching already has it.' };
}

export async function remindOverdueAction(slug: string): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('remind_overdue_learning', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  return { ok: true, message: data ? `Reminded ${data} ${data === 1 ? 'person' : 'people'}.` : 'No one is overdue.' };
}

export async function saveLearnSettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await hr(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    journeyPoints: z.coerce.number().int().min(0).max(100000), dueSoonDays: z.coerce.number().int().min(0).max(30),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a colour'), signatureName: optional(z.string().trim().max(80)), signatureTitle: optional(z.string().trim().max(80)),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('learn_settings').upsert({
    organization_id: ctx.org.id, journey_points: v.journeyPoints, due_soon_days: v.dueSoonDays, certificate_accent: v.accent,
    signature_name: v.signatureName ?? null, signature_title: v.signatureTitle ?? null,
    overdue_alerts: formData.get('overdueAlerts') === 'on',
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Settings saved.' };
}
