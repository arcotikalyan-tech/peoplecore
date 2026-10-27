import 'server-only';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/** Learn (L&D cockpit) reads. RLS decides: HR sees everything, managers their line, learners their own. */

export async function learnCourses(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('courses')
    .select('id, title, description, category, format, url, duration_minutes, valid_for_months, self_enroll, is_active, status, version, points, created_at, updated_at')
    .eq('organization_id', orgId).order('updated_at', { ascending: false });
  return data ?? [];
}

export async function learnEnrollments(orgId: string, employeeId?: string) {
  const supabase = await createClient();
  let q = supabase.from('course_enrollments').select('id, course_id, employee_id, source, mandatory, due_on, status, started_at, completed_at, valid_until, created_at')
    .eq('organization_id', orgId);
  if (employeeId) q = q.eq('employee_id', employeeId);
  const { data } = await allRows((a, b) => q.order('created_at', { ascending: false }).order('id').range(a, b));
  return data ?? [];
}

export async function learnSkills(orgId: string) {
  const supabase = await createClient();
  const [skills, courseSkills, people, roles] = await Promise.all([
    supabase.from('learn_skills').select('id, name, category').eq('organization_id', orgId).order('name'),
    supabase.from('course_skills').select('course_id, skill_id, level').eq('organization_id', orgId),
    supabase.from('employee_skills').select('employee_id, skill_id, level, achieved_at').eq('organization_id', orgId),
    supabase.from('designation_skills').select('designation_id, skill_id, level').eq('organization_id', orgId),
  ]);
  return { skills: skills.data ?? [], courseSkills: courseSkills.data ?? [], employeeSkills: people.data ?? [], roleSkills: roles.data ?? [] };
}

export async function learnJourneys(orgId: string) {
  const supabase = await createClient();
  const [journeys, steps, enrollments] = await Promise.all([
    supabase.from('learn_journeys').select('id, title, description, status, points, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('journey_steps').select('journey_id, position, course_id').eq('organization_id', orgId).order('position'),
    supabase.from('journey_enrollments').select('id, journey_id, employee_id, source, due_on, enrolled_at, completed_at').eq('organization_id', orgId),
  ]);
  return (journeys.data ?? []).map((j) => ({
    ...j, steps: (steps.data ?? []).filter((s) => s.journey_id === j.id).map((s) => s.course_id),
    enrollments: (enrollments.data ?? []).filter((e) => e.journey_id === j.id),
  }));
}

export async function learnRules(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('learn_rules').select('*').eq('organization_id', orgId).order('created_at', { ascending: false });
  return data ?? [];
}

export async function learnSettings(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('learn_settings').select('*').eq('organization_id', orgId).maybeSingle();
  return {
    journey_points: data?.journey_points ?? 200, due_soon_days: data?.due_soon_days ?? 3,
    overdue_alerts: data?.overdue_alerts ?? true, certificate_accent: data?.certificate_accent ?? '#5652e8',
    signature_name: data?.signature_name ?? null, signature_title: data?.signature_title ?? null,
  };
}

export async function courseLessons(orgId: string, courseId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('course_lessons').select('id, position, title, kind, body, url, duration_minutes').eq('organization_id', orgId).eq('course_id', courseId).order('position');
  return data ?? [];
}

export async function lessonProgress(enrollmentIds: string[]) {
  if (enrollmentIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase.from('lesson_progress').select('enrollment_id, lesson_id, completed_at').in('enrollment_id', enrollmentIds.slice(0, 1000));
  return data ?? [];
}

export async function lessonCounts(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('course_lessons').select('course_id').eq('organization_id', orgId);
  const m = new Map<string, number>();
  for (const l of data ?? []) m.set(l.course_id, (m.get(l.course_id) ?? 0) + 1);
  return m;
}
