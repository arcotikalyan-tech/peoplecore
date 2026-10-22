import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { employeeNames, getMyEmployee, managerOptions } from '@/server/employees';
import { getCourse, listEnrollments } from '@/server/learning';
import { courseLessons, learnSkills, lessonProgress } from '@/server/learn';
import { getStructure, structureOptions } from '@/server/structure';
import { assignCourseAction, enrollAction, saveCourseAction, updateEnrollmentAction } from '../actions';
import { AssignCourseForm, CompleteForm, CourseForm } from '../learning-forms';
import { duration, FORMAT_LABEL, STATUS_LABEL, STATUS_TONE } from '../labels';
import { completeLessonAction, courseSkillAction, coursePointsAction, courseStatusAction, deleteLessonAction, remindLearnersAction, saveLessonAction } from '../learn-actions';
import { Buttons, CourseSkillForm, LessonForm, PointsForm } from '../learn-client';

const STATUS_STEPS: Record<string, Array<{ text: string; value: string; variant?: 'primary' | 'secondary' | 'ghost' }>> = {
  draft: [{ text: 'Send for review', value: 'in_review', variant: 'secondary' }, { text: 'Publish', value: 'published', variant: 'primary' }],
  in_review: [{ text: 'Publish', value: 'published', variant: 'primary' }, { text: 'Back to draft', value: 'draft' }],
  published: [{ text: 'New draft version', value: 'draft' }, { text: 'Archive', value: 'archived' }],
  archived: [{ text: 'Publish again', value: 'published', variant: 'secondary' }],
};
const STATUS_NAME: Record<string, string> = { draft: 'Draft', in_review: 'In review', published: 'Published', archived: 'Archived' };

export const metadata: Metadata = { title: 'Course' };

export default async function CoursePage({ params, searchParams }: {
  params: Promise<{ org: string; courseId: string }>; searchParams: Promise<{ edit?: string }>;
}) {
  const { org: slug, courseId } = await params;
  const editing = (await searchParams).edit === '1';
  const ctx = await getOrgContext(slug);
  const c = /^[0-9a-f-]{36}$/i.test(courseId) ? await getCourse(ctx.org.id, courseId) : null;
  if (!c) notFound();
  const hr = ctx.can('learning.manage', 'org');
  const lineManager = ctx.can('employee.read', 'team');
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const [enrollments, people, structure] = await Promise.all([
    listEnrollments(ctx.org.id, { courseId: c.id }),
    (hr || lineManager) && c.is_active ? managerOptions(ctx.org.id) : Promise.resolve([]),
    hr && c.is_active ? getStructure(ctx.org.id) : Promise.resolve(null),
  ]);
  // People the caller can assign to: everyone current (HR) or their reporting line (RLS already limits the list).
  const assignable = people.filter((p) => !me || p.value !== me.id);
  const names = await employeeNames(ctx.org.id, enrollments.map((x) => x.employee_id));
  const today = todayIn(ctx.org.timezone);
  const myOpen = enrollments.find((x) => me && x.employee_id === me.id && (x.status === 'assigned' || x.status === 'in_progress'));
  const others = enrollments.filter((x) => !me || x.employee_id !== me.id);
  const myDone = enrollments.find((x) => me && x.employee_id === me.id && x.status === 'completed');
  const [lessons, skills, progress] = await Promise.all([courseLessons(ctx.org.id, c.id), learnSkills(ctx.org.id), lessonProgress(myOpen ? [myOpen.id] : [])]);
  const doneLessons = new Set(progress.map((x) => x.lesson_id));
  const taught = skills.courseSkills.filter((x) => x.course_id === c.id);

  return (
    <>
      <PageHeader eyebrow={FORMAT_LABEL[c.format]} title={c.title}
        actions={<>
          <Badge tone={c.status === 'published' ? 'success' : c.status === 'in_review' ? 'warning' : 'neutral'}>{STATUS_NAME[c.status]} · v{c.version}</Badge>
          {myDone && <ButtonLink href={`/app/${slug}/learning/certificate/${myDone.id}`} variant="secondary">🎓 Certificate</ButtonLink>}
          {c.url && <ButtonLink href={c.url} variant="secondary" target="_blank" rel="noreferrer">Open course</ButtonLink>}
          {hr && !editing && <ButtonLink href={`/app/${slug}/learning/${c.id}?edit=1`} variant="secondary">Edit</ButtonLink>}
          <ButtonLink href={`/app/${slug}/learning`} variant="ghost">Learning</ButtonLink>
        </>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {editing && hr ? (
            <Card><CardHeader title="Edit course" /><CourseForm action={saveCourseAction.bind(null, slug)} course={c} /></Card>
          ) : (
            <Card>
              <CardHeader title="About" />
              {c.description && <div className="whitespace-pre-line px-5 pt-4 text-sm leading-6">{c.description}</div>}
              <div className="px-5 py-4">
                <DetailList items={[
                  { label: 'Topic', value: c.category ?? '—' },
                  { label: 'Duration', value: duration(c.duration_minutes) ?? '—' },
                  { label: 'Renewal', value: c.valid_for_months ? `Every ${c.valid_for_months} months` : 'Doesn’t expire' },
                  { label: 'Enrolment', value: c.self_enroll ? 'Anyone can enrol' : 'Assigned by HR or managers' },
                ]} />
              </div>
              {me && !myOpen && c.is_active && c.self_enroll && (
                <ActionForm action={enrollAction.bind(null, slug)} label={`Enrol in ${c.title}`} submit="Enrol" hidden={{ courseId: c.id }}
                  className="flex items-center gap-3 border-t border-line px-5 py-3" />
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Lessons" description={lessons.length ? `${lessons.length} lesson${lessons.length === 1 ? '' : 's'}${myOpen ? ` · ${doneLessons.size} done` : ''}` : 'No lessons — the course is completed as a whole.'} />
            {lessons.length > 0 && (
              <ol className="divide-y divide-line" aria-label="Lessons">
                {lessons.map((l) => (
                  <li key={l.id} className="space-y-2 px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{l.position}. {l.title} <span className="font-normal text-muted">· {l.kind}{l.duration_minutes ? ` · ${l.duration_minutes} min` : ''}</span></span>
                      {myOpen && (doneLessons.has(l.id) ? <Badge tone="success">Done</Badge>
                        : <Buttons action={completeLessonAction.bind(null, slug)} hidden={{ lessonId: l.id }} label={`Mark ${l.title} done`} buttons={[{ text: 'Mark done', variant: 'secondary' }]} />)}
                    </div>
                    {l.url && <a className="text-primary hover:underline" href={l.url} target="_blank" rel="noreferrer">{l.kind === 'video' ? '▶ Watch' : '↗ Open'}</a>}
                    {l.body && <p className="whitespace-pre-line text-muted">{l.body}</p>}
                    {hr && (
                      <details><summary className="cursor-pointer text-xs text-primary">Edit lesson</summary>
                        <div className="mt-2 space-y-2"><LessonForm action={saveLessonAction.bind(null, slug)} courseId={c.id} lesson={l} />
                          <Buttons action={deleteLessonAction.bind(null, slug)} hidden={{ lessonId: l.id }} label={`Remove ${l.title}`} buttons={[{ text: 'Remove lesson' }]} confirm="Remove this lesson?" /></div>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {hr && <div className="border-t border-line px-5 py-4"><LessonForm action={saveLessonAction.bind(null, slug)} courseId={c.id} /></div>}
          </Card>

          {(hr || others.length > 0) && (
            <Card>
              <CardHeader title="Enrolments" description={hr ? 'Everyone enrolled.' : 'People in your reporting line.'}
                actions={hr && others.some((x) => x.status === 'assigned' || x.status === 'in_progress') ? (
                  <Buttons action={remindLearnersAction.bind(null, slug)} hidden={{ courseId: c.id }} label="Remind learners"
                    buttons={[{ text: '🔔 Remind everyone not finished', name: 'scope', value: 'all', variant: 'secondary' }, { text: 'Overdue only', name: 'scope', value: 'overdue' }]} />
                ) : undefined} />
              <Table caption="Enrolments">
                <thead><tr><Th>Person</Th><Th>Status</Th><Th>Due</Th><Th>Completed</Th><Th><span className="sr-only">Record</span></Th></tr></thead>
                <tbody>
                  {others.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No one enrolled yet.</td></tr>}
                  {others.map((x) => {
                    const open = x.status === 'assigned' || x.status === 'in_progress';
                    const name = names.get(x.employee_id) ?? 'Employee';
                    return (
                      <tr key={x.id}>
                        <Td className="font-medium">{name}</Td>
                        <Td>
                          <span className="flex flex-wrap gap-1">
                            <Badge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Badge>
                            {x.mandatory && open && <Badge tone="warning">Mandatory</Badge>}
                            {open && x.due_on && x.due_on < today && <Badge tone="danger">Overdue</Badge>}
                          </span>
                        </Td>
                        <Td className="text-muted">{x.due_on ? formatDate(x.due_on) : '—'}</Td>
                        <Td className="text-muted">
                          {x.completed_at ? formatDate(x.completed_at) : '—'}
                          {x.valid_until && <span className="block text-xs">valid until {formatDate(x.valid_until)}</span>}
                        </Td>
                        <Td>{open && <CompleteForm action={updateEnrollmentAction.bind(null, slug)} enrollmentId={x.id} label={`Record completion for ${name}`} />}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-6">
        {hr && (
          <Card>
            <CardHeader title="Lifecycle" description="Only published courses are live. Editing a published course starts a new draft version." />
            <div className="space-y-3 px-5 py-4">
              <Buttons action={courseStatusAction.bind(null, slug)} hidden={{ courseId: c.id }} label="Course status"
                buttons={(STATUS_STEPS[c.status] ?? []).map((b) => ({ ...b, name: 'status' }))} />
              <PointsForm action={coursePointsAction.bind(null, slug)} courseId={c.id} points={c.points} />
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Skills" description="What completing this course teaches." />
          <ul className="divide-y divide-line px-5 text-sm">
            {taught.length === 0 && <li className="py-3 text-muted">No skills tagged.</li>}
            {taught.map((t) => (
              <li key={t.skill_id} className="flex items-center justify-between py-2"><span>{skills.skills.find((x) => x.id === t.skill_id)?.name} · Level {t.level}</span>
                {hr && <Buttons action={courseSkillAction.bind(null, slug)} hidden={{ courseId: c.id, skillId: t.skill_id, level: String(t.level), remove: '1' }} label="Remove skill" buttons={[{ text: 'Remove' }]} />}</li>
            ))}
          </ul>
          {hr && <div className="border-t border-line px-5 py-4"><CourseSkillForm action={courseSkillAction.bind(null, slug)} courseId={c.id} skills={skills.skills.map((x) => ({ value: x.id, label: x.name }))} /></div>}
        </Card>
        {c.is_active && assignable.length > 0 && (
          <Card>
            <CardHeader title="Assign" description="They’re notified and see it in their learning." />
            <AssignCourseForm action={assignCourseAction.bind(null, slug)} courseId={c.id} today={today} people={assignable}
              departments={structure ? structureOptions(structure).departments : null} />
          </Card>
        )}
        </div>
      </div>
    </>
  );
}
