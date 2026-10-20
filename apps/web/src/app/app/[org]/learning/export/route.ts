import { NextResponse } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { colleagueDirectory } from '@/server/engagement';
import { learnCourses, learnEnrollments } from '@/server/learn';
import { createClient } from '@/server/supabase';

/** Every enrolment as CSV for HR (learning.manage), read through RLS; the export is logged. */
export async function GET(_req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('learning.manage', 'org')) return new NextResponse('Not found', { status: 404 });
  const [enrollments, courses, dir] = await Promise.all([learnEnrollments(ctx.org.id), learnCourses(ctx.org.id), colleagueDirectory(ctx.org.id)]);
  const course = new Map(courses.map((c) => [c.id, c.title]));
  const person = new Map(dir.map((c) => [c.id, c]));
  const supabase = await createClient();
  await supabase.rpc('log_report_export', { p_org: ctx.org.id, p_report: 'learning_enrolments', p_params: {} as never, p_rows: enrollments.length });
  const csv = toCsv(['Employee', 'Department', 'Course', 'Source', 'Mandatory', 'Status', 'Due', 'Completed', 'Valid until'],
    enrollments.map((x) => [person.get(x.employee_id)?.name ?? '', person.get(x.employee_id)?.department ?? '', course.get(x.course_id) ?? '', x.source, x.mandatory ? 'Yes' : 'No',
      x.status, x.due_on ?? '', x.completed_at?.slice(0, 10) ?? '', x.valid_until ?? '']));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="learning-enrolments.csv"', 'Cache-Control': 'no-store' } });
}
