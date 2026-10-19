import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { employeeNames, getMyEmployee } from '@/server/employees';
import { learningSummary, listCourses, listEnrollments } from '@/server/learning';
import { enrollAction, updateEnrollmentAction } from './actions';
import { CompleteForm } from './learning-forms';
import { duration, FORMAT_LABEL, STATUS_LABEL, STATUS_TONE } from './labels';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Learning' };

export default async function LearningPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'learning');
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const hr = ctx.can('learning.manage', 'org');
  const [courses, visible, summary] = await Promise.all([
    listCourses(ctx.org.id),
    listEnrollments(ctx.org.id),
    hr ? learningSummary(ctx.org.id) : Promise.resolve(null),
  ]);
  const today = todayIn(ctx.org.timezone);
  const course = new Map(courses.map((c) => [c.id, c]));
  const mine = visible.filter((x) => me && x.employee_id === me.id);
  const openMine = mine.filter((x) => x.status === 'assigned' || x.status === 'in_progress');
  const doneMine = mine.filter((x) => x.status === 'completed');
  const enrolledIn = new Set(openMine.map((x) => x.course_id));
  // Managers see their line here; HR works from each course's page instead of one org-wide list.
  const team = hr ? [] : visible.filter((x) => !me || x.employee_id !== me.id).filter((x) => x.status !== 'cancelled');
  const names = await employeeNames(ctx.org.id, team.map((x) => x.employee_id));
  const base = `/app/${slug}/learning`;
  const overdue = (x: { due_on: string | null; status: string }) => !!x.due_on && x.due_on < today && (x.status === 'assigned' || x.status === 'in_progress');

  return (
    <>
      <PageHeader title="Learning" description="Your training, your team’s progress, and the course catalog."
        actions={hr ? <ButtonLink href={`${base}/new`}>New course</ButtonLink> : undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {me && (
            <Card>
              <CardHeader title="Your learning" description={openMine.length ? `${openMine.length} to do` : 'Nothing to do right now'} />
              {openMine.length === 0 && doneMine.length === 0 && <p className="px-5 py-4 text-sm text-muted">Enrol in a course from the catalog, or wait for one to be assigned.</p>}
              <ul className="divide-y divide-line" aria-label="Your learning">
                {[...openMine, ...doneMine].map((x) => {
                  const c = course.get(x.course_id);
                  const title = c?.title ?? 'Course';
                  const open = x.status === 'assigned' || x.status === 'in_progress';
                  return (
                    <li key={x.id} className="space-y-2 px-5 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link className="font-medium text-primary hover:underline" href={`${base}/${x.course_id}`}>{title}</Link>
                        <span className="flex flex-wrap gap-1">
                          {x.mandatory && open && <Badge tone="warning">Mandatory</Badge>}
                          {overdue(x) && <Badge tone="danger">Overdue</Badge>}
                          {x.status === 'completed' && x.valid_until && x.valid_until < today
                            ? <Badge tone="danger">Lapsed</Badge>
                            : <Badge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Badge>}
                        </span>
                      </div>
                      <p className="text-xs text-muted">
                        {[x.due_on && open && `Due ${formatDate(x.due_on)}`, x.completed_at && `Completed ${formatDate(x.completed_at)}`,
                          x.valid_until && `valid until ${formatDate(x.valid_until)}`, x.source === 'recertification' && 'Renewal'].filter(Boolean).join(' · ')}
                      </p>
                      {open && (
                        <div className="flex flex-wrap items-end gap-3">
                          {c?.url && <a className="text-sm text-primary hover:underline" href={c.url} target="_blank" rel="noreferrer">Open course</a>}
                          {x.status === 'assigned' && (
                            <ActionForm action={updateEnrollmentAction.bind(null, slug)} label={`Start ${title}`} submit="Start" variant="secondary" size="sm"
                              hidden={{ enrollmentId: x.id, status: 'in_progress' }} className="inline-flex items-center gap-2" />
                          )}
                          <CompleteForm action={updateEnrollmentAction.bind(null, slug)} enrollmentId={x.id} label={`Complete ${title}`} />
                          {!x.mandatory && (
                            <ActionForm action={updateEnrollmentAction.bind(null, slug)} label={`Drop ${title}`} submit="Drop" variant="ghost" size="sm"
                              hidden={{ enrollmentId: x.id, status: 'cancelled' }} className="inline-flex items-center gap-2" />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          {team.length > 0 && (
            <Card>
              <CardHeader title="Your team" description="Training for people in your reporting line." />
              <Table caption="Your team’s learning">
                <thead><tr><Th>Person</Th><Th>Course</Th><Th>Status</Th><Th>Due</Th></tr></thead>
                <tbody>
                  {team.map((x) => (
                    <tr key={x.id}>
                      <Td className="font-medium">{names.get(x.employee_id) ?? '—'}</Td>
                      <Td><Link className="text-primary hover:underline" href={`${base}/${x.course_id}`}>{course.get(x.course_id)?.title ?? 'Course'}</Link></Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Badge>
                          {overdue(x) && <Badge tone="danger">Overdue</Badge>}
                        </span>
                      </Td>
                      <Td className="text-muted">{x.due_on ? formatDate(x.due_on) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader title="Catalog" description={hr ? 'Enrolled · completed · overdue · lapsing within 30 days' : undefined} />
          {courses.length === 0 && <p className="px-5 py-4 text-sm text-muted">No courses yet.</p>}
          <ul className="divide-y divide-line" aria-label="Catalog">
            {courses.map((c) => {
              const s = summary?.get(c.id);
              return (
                <li key={c.id} className="space-y-1 px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="font-medium text-primary hover:underline" href={`${base}/${c.id}`}>{c.title}</Link>
                    <span className="flex flex-wrap gap-1">
                      {!c.is_active && <Badge>Retired</Badge>}
                      {c.valid_for_months && <Badge>Renew every {c.valid_for_months} months</Badge>}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{[FORMAT_LABEL[c.format], duration(c.duration_minutes), c.category].filter(Boolean).join(' · ')}</p>
                  {s && <p className="text-xs tabular-nums text-muted">{s.enrolled} · {s.completed} · {s.overdue} · {s.lapsing}</p>}
                  {me && c.is_active && c.self_enroll && !enrolledIn.has(c.id) && (
                    <ActionForm action={enrollAction.bind(null, slug)} label={`Enrol in ${c.title}`} submit="Enrol" variant="secondary" size="sm"
                      hidden={{ courseId: c.id }} className="inline-flex items-center gap-2 pt-1" />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
