import 'server-only';
import { createClient } from './supabase';

/** Courses and enrolments. RLS: learners see their own, managers their reporting line, HR everything. */

const COURSE_COLUMNS = 'id, title, description, category, format, url, duration_minutes, valid_for_months, self_enroll, is_active';

export async function listCourses(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').select(COURSE_COLUMNS)
    .eq('organization_id', orgId).order('is_active', { ascending: false }).order('title');
  if (error) throw new Error(`Failed to load courses (${error.code})`);
  return data;
}

export async function getCourse(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').select(COURSE_COLUMNS).eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load the course (${error.code})`);
  return data;
}

/** Enrolments the caller may see, optionally for one course or one person; newest first. */
export async function listEnrollments(orgId: string, filter: { courseId?: string; employeeId?: string } = {}) {
  const supabase = await createClient();
  let q = supabase.from('course_enrollments')
    .select('id, course_id, employee_id, source, mandatory, due_on, status, started_at, completed_at, completion_note, valid_until, created_at')
    .eq('organization_id', orgId);
  if (filter.courseId) q = q.eq('course_id', filter.courseId);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error(`Failed to load enrolments (${error.code})`);
  return data;
}

export async function learningSummary(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('learning_summary', { p_org: orgId });
  if (error) throw new Error(`Failed to load the learning summary (${error.code})`);
  return new Map(data.map((r) => [r.course_id, { enrolled: Number(r.enrolled), completed: Number(r.completed), overdue: Number(r.overdue), lapsing: Number(r.lapsing) }]));
}
