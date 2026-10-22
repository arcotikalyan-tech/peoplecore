import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { HubHeader, HubTabs, Panel, StatCard, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { STARTER_COURSES } from '@/lib/learn-library';
import { getOrgContext } from '@/server/context';
import { colleagueDirectory } from '@/server/engagement';
import { getMyEmployee } from '@/server/employees';
import { learnCourses, learnEnrollments, learnJourneys, learnRules, learnSettings, learnSkills, lessonCounts } from '@/server/learn';
import { requireModule } from '@/server/modules';
import { getStructure } from '@/server/structure';
import { viewModeFor } from '@/server/view';
import {
  addStarterCourseAction, applyRulesAction, enrollJourneyAction, remindOverdueAction, roleSkillAction, ruleToggleAction, saveJourneyAction, saveLearnSettingsAction, saveRuleAction, saveSkillAction,
} from './learn-actions';
import { AssignJourneyForm, Buttons, JourneyForm, LearnSettingsForm, RoleSkillForm, RuleForm, RunButton, SkillForm } from './learn-client';
import { STATUS_LABEL, STATUS_TONE } from './labels';
import { MyLearning } from './my-learning';

export const metadata: Metadata = { title: 'Learn' };

type Search = Record<string, string | undefined>;
const COURSE_STATUS: Record<string, { tone: 'success' | 'neutral' | 'warning' | 'primary'; label: string }> = {
  published: { tone: 'success', label: 'Published' }, draft: { tone: 'neutral', label: 'Draft' }, in_review: { tone: 'warning', label: 'In review' }, archived: { tone: 'neutral', label: 'Archived' },
};
const open = (s: string) => s === 'assigned' || s === 'in_progress';

/**
 * Learn (Kredily's Learn). HR (learning.manage, admin view): overview, journeys, courses & content, skills,
 * assignments, learners, analytics and settings. Everyone: my learning (with the catalog), explore, my journeys and a
 * calendar of due dates. Courses are edited on their own page (details, lessons, skills, status, assignment).
 */
export default async function LearningPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'learning');
  const base = `/app/${slug}/learning`;
  const today = todayIn(ctx.org.timezone);
  const isHr = ctx.can('learning.manage', 'org') && (await viewModeFor(ctx)) === 'admin';
  const tabs = isHr
    ? [{ key: 'overview', label: 'Overview' }, { key: 'journeys', label: 'Journeys' }, { key: 'courses', label: 'Courses & Content' }, { key: 'skills', label: 'Skills' },
       { key: 'assignments', label: 'Assignments' }, { key: 'learners', label: 'Learners' }, { key: 'analytics', label: 'Analytics' }, { key: 'settings', label: 'Settings' }]
    : [{ key: 'me', label: 'Me' }, { key: 'explore', label: 'Explore' }, { key: 'journeys', label: 'My Journeys' }, { key: 'calendar', label: 'Calendar' }];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : tabs[0]!.key;
  const p: Props = { slug, base, today, sp, orgId: ctx.org.id, userId: ctx.user.id };
  return (
    <>
      <HubHeader title={isHr ? 'Learn · L&D Cockpit' : 'Learn'} subtitle={isHr ? 'Journeys, courses, skills, assignment rules and analytics.' : 'Your training, journeys and what’s due.'}
        actions={isHr ? <Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}/new`}>＋ New course</Link> : undefined} />
      <HubTabs base={base} label="Learn sections" tabs={tabs} current={tab} />
      {tab === 'me' && <MyLearning slug={slug} />}
      {tab === 'explore' && <Explore {...p} />}
      {tab === 'journeys' && (isHr ? <Journeys {...p} /> : <MyJourneys {...p} />)}
      {tab === 'calendar' && <Calendar {...p} />}
      {tab === 'overview' && <Overview {...p} />}
      {tab === 'courses' && <Courses {...p} />}
      {tab === 'skills' && <Skills {...p} />}
      {tab === 'assignments' && <Assignments {...p} />}
      {tab === 'learners' && <Learners {...p} />}
      {tab === 'analytics' && <Analytics {...p} />}
      {tab === 'settings' && <Settings {...p} />}
    </>
  );
}

interface Props { slug: string; base: string; today: string; sp: Search; orgId: string; userId: string }

async function people(orgId: string) {
  const d = await colleagueDirectory(orgId);
  return { list: d, name: new Map(d.map((c) => [c.id, c.name])), dept: new Map(d.map((c) => [c.id, c.department ?? 'Unassigned'])) };
}

// ─── Employee views ─────────────────────────────────────────────────────────

async function Explore(p: Props) {
  const [courses, me, journeys, counts] = await Promise.all([learnCourses(p.orgId), getMyEmployee(p.orgId, p.userId), learnJourneys(p.orgId), lessonCounts(p.orgId)]);
  const mine = me ? await learnEnrollments(p.orgId, me.id) : [];
  const q = (p.sp.q ?? '').trim().toLowerCase();
  const live = courses.filter((c) => c.status === 'published' && (!q || `${c.title} ${c.category ?? ''} ${c.description ?? ''}`.toLowerCase().includes(q)));
  const cats = [...new Set(live.map((c) => c.category ?? 'General'))].sort();
  return (
    <div className="space-y-5">
      <form action={p.base} className="flex gap-2"><input type="hidden" name="tab" value="explore" />
        <input name="q" defaultValue={p.sp.q ?? ''} placeholder="Search courses" aria-label="Search courses" className="h-9 w-72 rounded-md border border-line-strong bg-surface px-2 text-sm" />
        <button className="h-9 rounded-md border border-line bg-surface px-3 text-sm hover:bg-subtle">Search</button></form>
      {journeys.filter((j) => j.status === 'published').length > 0 && (
        <Panel title="🛤 Journeys">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{journeys.filter((j) => j.status === 'published').map((j) => {
            const enrolled = me ? j.enrollments.some((e) => e.employee_id === me.id) : false;
            return (
              <div key={j.id} className="rounded-xl border border-line bg-raised p-4">
                <p className="font-semibold">{j.title}</p><p className="text-sm text-muted">{j.description ?? ''}</p>
                <p className="mt-1 text-xs text-muted">{j.steps.length} courses{j.points ? ` · ${j.points} pts` : ''}</p>
                <div className="mt-2">{enrolled ? <Badge tone="success">Enrolled</Badge> : me && <Buttons action={enrollJourneyAction.bind(null, p.slug)} hidden={{ journeyId: j.id }} label={`Start ${j.title}`} buttons={[{ text: 'Start journey', variant: 'secondary' }]} />}</div>
              </div>
            );
          })}</div>
        </Panel>
      )}
      {cats.map((cat) => (
        <Panel key={cat} title={cat}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{live.filter((c) => (c.category ?? 'General') === cat).map((c) => {
            const x = mine.find((m) => m.course_id === c.id && m.status !== 'cancelled');
            return (
              <Link key={c.id} href={`${p.base}/${c.id}`} className="lift block rounded-xl border border-line bg-raised p-4">
                <p className="font-semibold">{c.title}</p><p className="line-clamp-2 text-sm text-muted">{c.description ?? ''}</p>
                <p className="mt-2 text-xs text-muted">{[counts.get(c.id) ? `${counts.get(c.id)} lessons` : null, c.duration_minutes ? `${c.duration_minutes} min` : null, c.points ? `${c.points} pts` : null].filter(Boolean).join(' · ')}</p>
                {x && <span className="mt-2 inline-block"><Badge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Badge></span>}
              </Link>
            );
          })}</div>
        </Panel>
      ))}
      {live.length === 0 && <Panel title="Explore"><p className="text-sm text-muted">No courses match.</p></Panel>}
    </div>
  );
}

async function MyJourneys(p: Props) {
  const me = await getMyEmployee(p.orgId, p.userId);
  if (!me) return <Panel title="My journeys"><p className="text-sm text-muted">Needs an employee record.</p></Panel>;
  const [journeys, courses, mine] = await Promise.all([learnJourneys(p.orgId), learnCourses(p.orgId), learnEnrollments(p.orgId, me.id)]);
  const title = new Map(courses.map((c) => [c.id, c.title]));
  const enrolled = journeys.filter((j) => j.enrollments.some((e) => e.employee_id === me.id));
  if (enrolled.length === 0) return <Panel title="My journeys"><p className="text-sm text-muted">You aren’t on a journey yet. <Link className="text-primary" href={`${p.base}?tab=explore`}>Explore journeys →</Link></p></Panel>;
  return (
    <div className="space-y-4">{enrolled.map((j) => {
      const je = j.enrollments.find((e) => e.employee_id === me.id)!;
      const done = j.steps.filter((c) => mine.some((x) => x.course_id === c && x.status === 'completed')).length;
      return (
        <Panel key={j.id} title={j.title} meta={je.completed_at ? `Completed ${formatDate(je.completed_at)}` : `${done} of ${j.steps.length} done${je.due_on ? ` · due ${formatDate(je.due_on)}` : ''}`}>
          <div className="mb-3 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-success" style={{ width: `${j.steps.length ? (done / j.steps.length) * 100 : 0}%` }} /></div>
          <ol className="space-y-1.5 text-sm">{j.steps.map((c, i) => {
            const x = mine.find((m) => m.course_id === c && m.status !== 'cancelled');
            return <li key={c} className="flex items-center justify-between gap-2"><Link className="hover:underline" href={`${p.base}/${c}`}>{i + 1}. {title.get(c) ?? 'Course'}</Link>{x ? <Badge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Badge> : <span className="text-xs text-muted">—</span>}</li>;
          })}</ol>
        </Panel>
      );
    })}</div>
  );
}

async function Calendar(p: Props) {
  const me = await getMyEmployee(p.orgId, p.userId);
  const month = /^\d{4}-\d{2}$/.test(p.sp.m ?? '') ? p.sp.m! : p.today.slice(0, 7);
  const [courses, mine] = await Promise.all([learnCourses(p.orgId), me ? learnEnrollments(p.orgId, me.id) : Promise.resolve([])]);
  const title = new Map(courses.map((c) => [c.id, c.title]));
  const due = mine.filter((x) => open(x.status) && x.due_on?.startsWith(month));
  const shift = (by: number) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)); return d.toISOString().slice(0, 7); };
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" href={`${p.base}?tab=calendar&m=${shift(-1)}`}>‹</Link>
        <h2 className="min-w-40 text-center text-lg font-semibold">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
        <Link className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" href={`${p.base}?tab=calendar&m=${shift(1)}`}>›</Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs" role="grid" aria-label="Training due this month">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1 text-center font-semibold text-muted">{d}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = `${month}-${String(i + 1).padStart(2, '0')}`;
          const items = due.filter((x) => x.due_on === d);
          return (
            <div key={d} className={`min-h-16 rounded-lg border p-1 ${d === p.today ? 'border-primary' : 'border-line'}`}>
              <p className="tabular-nums">{i + 1}</p>
              {items.map((x) => <Link key={x.id} href={`${p.base}/${x.course_id}`} className={`mt-0.5 block truncate rounded px-1 ${d < p.today ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary'}`}>{title.get(x.course_id)}</Link>)}
            </div>
          );
        })}
      </div>
      {due.length === 0 && <p className="text-sm text-muted">Nothing due this month.</p>}
    </div>
  );
}

// ─── HR views ───────────────────────────────────────────────────────────────

async function Overview(p: Props) {
  const [courses, enrollments, journeys] = await Promise.all([learnCourses(p.orgId), learnEnrollments(p.orgId), learnJourneys(p.orgId)]);
  const live = enrollments.filter((x) => x.status !== 'cancelled');
  const completed = live.filter((x) => x.status === 'completed');
  const overdue = live.filter((x) => open(x.status) && x.due_on && x.due_on < p.today);
  const learners = new Set(live.filter((x) => open(x.status)).map((x) => x.employee_id));
  const pointsAwarded = completed.reduce((s, x) => s + (courses.find((c) => c.id === x.course_id)?.points ?? 0), 0);
  const review = courses.filter((c) => c.status === 'in_review');
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active learners" value={learners.size} note={`${live.filter((x) => open(x.status)).length} open enrolments`} tone="primary" />
        <StatCard label="Completion" value={`${live.length ? Math.round((completed.length / live.length) * 100) : 0}%`} note="all enrolments" tone="success" />
        <StatCard label="Overdue" value={overdue.length} note="reminder-eligible" tone={overdue.length ? 'danger' : 'muted'} href={`${p.base}?tab=learners&status=overdue`} />
        <StatCard label="Points earned" value={pointsAwarded} note="from course completions" tone="accent" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="🛤 Top journeys" flush action={<Link className="text-xs text-primary" href={`${p.base}?tab=journeys`}>All →</Link>}>
          {journeys.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No journeys yet.</p> : (
            <Table caption="Top journeys">
              <thead><tr><Th>Journey</Th><Th className="text-right">Enrolled</Th><Th className="text-right">Completion</Th></tr></thead>
              <tbody>{journeys.slice(0, 6).map((j) => <tr key={j.id}><Td>{j.title}</Td><Td className="text-right tabular-nums">{j.enrollments.length}</Td><Td className="text-right tabular-nums">{j.enrollments.length ? Math.round((j.enrollments.filter((e) => e.completed_at).length / j.enrollments.length) * 100) : 0}%</Td></tr>)}</tbody>
            </Table>
          )}
        </Panel>
        <Panel title="📝 Pending review" meta={`${review.length}`}>
          {review.length === 0 ? <p className="text-sm text-muted">Queue clear — nothing awaiting review 🎉</p> : (
            <ul className="space-y-1.5 text-sm">{review.map((c) => <li key={c.id}><Link className="text-primary hover:underline" href={`${p.base}/${c.id}`}>{c.title}</Link> <span className="text-muted">· v{c.version}</span></li>)}</ul>
          )}
        </Panel>
      </div>
      <Panel title="Recent completions" flush>
        {completed.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No activity yet.</p> : (
          <ul className="divide-y divide-line text-sm">{completed.slice(0, 10).map((x) => <li key={x.id} className="flex justify-between px-5 py-2"><span>{courses.find((c) => c.id === x.course_id)?.title}</span><span className="text-muted">{x.completed_at ? formatDate(x.completed_at) : ''}</span></li>)}</ul>
        )}
      </Panel>
    </div>
  );
}

async function Journeys(p: Props) {
  const [journeys, courses, dir] = await Promise.all([learnJourneys(p.orgId), learnCourses(p.orgId), people(p.orgId)]);
  const options = courses.filter((c) => c.status === 'published').map((c) => ({ value: c.id, label: c.title }));
  const title = new Map(courses.map((c) => [c.id, c.title]));
  return (
    <div className="space-y-5">
      {journeys.length === 0 && <Panel title="Journeys"><p className="text-sm text-muted">No journeys yet — compose published courses into your first journey.</p></Panel>}
      {journeys.map((j) => (
        <Panel key={j.id} title={j.title} meta={`${j.steps.length} courses · ${j.enrollments.length} enrolled · ${j.enrollments.filter((e) => e.completed_at).length} completed`}
          action={<Badge tone={j.status === 'published' ? 'success' : 'neutral'}>{j.status}</Badge>}>
          <ol className="mb-3 flex flex-wrap gap-2 text-xs">{j.steps.map((c, i) => <li key={c} className="rounded-full border border-line px-2 py-0.5">{i + 1}. {title.get(c)}</li>)}</ol>
          <details><summary className="cursor-pointer text-xs text-primary">Edit</summary><div className="mt-3"><JourneyForm action={saveJourneyAction.bind(null, p.slug)} courses={options} journey={j} /></div></details>
          {j.status === 'published' && <details className="mt-2"><summary className="cursor-pointer text-xs text-primary">Assign people</summary><div className="mt-3">
            <AssignJourneyForm action={enrollJourneyAction.bind(null, p.slug)} journeyId={j.id} today={p.today} people={dir.list.map((c) => ({ value: c.id, label: c.name }))} /></div></details>}
        </Panel>
      ))}
      <Panel title="＋ New journey">{options.length === 0 ? <p className="text-sm text-muted">Publish a course first.</p> : <JourneyForm action={saveJourneyAction.bind(null, p.slug)} courses={options} />}</Panel>
    </div>
  );
}

async function Courses(p: Props) {
  const [courses, enrollments, counts, skills] = await Promise.all([learnCourses(p.orgId), learnEnrollments(p.orgId), lessonCounts(p.orgId), learnSkills(p.orgId)]);
  const status = ['draft', 'in_review', 'published', 'archived'].includes(p.sp.status ?? '') ? p.sp.status! : null;
  const rows = courses.filter((c) => !status || c.status === status);
  const size = 25;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Number(p.sp.page) || 1));
  const skillName = new Map(skills.skills.map((s) => [s.id, s.name]));
  return (
    <div className="space-y-4">
      <SubTabs base={p.base} param="status" extra={{ tab: 'courses' }} label="Course status" current={status ?? 'all'} tabs={[
        { key: 'all', label: 'All', count: courses.length }, ...(['published', 'draft', 'in_review', 'archived'] as const).map((s) => ({ key: s, label: COURSE_STATUS[s]!.label, count: courses.filter((c) => c.status === s).length })),
      ]} />
      <Panel title="Course library" flush action={<Link className="text-xs text-primary" href={`${p.base}/new`}>＋ New course</Link>}>
        <Table caption="Course library">
          <thead><tr><Th>Course</Th><Th>Skills</Th><Th>Status</Th><Th>Version</Th><Th className="text-right">Lessons</Th><Th className="text-right">Enrolled</Th><Th className="text-right">Completion</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted">No courses match.</td></tr>}
            {rows.slice((page - 1) * size, page * size).map((c) => {
              const xs = enrollments.filter((x) => x.course_id === c.id && x.status !== 'cancelled');
              return (
                <tr key={c.id}>
                  <Td><Link className="font-medium text-primary hover:underline" href={`${p.base}/${c.id}`}>{c.title}</Link><p className="text-xs text-muted">{c.category ?? ''}</p></Td>
                  <Td className="text-xs">{skills.courseSkills.filter((s) => s.course_id === c.id).map((s) => `${skillName.get(s.skill_id)} L${s.level}`).join(', ') || '—'}</Td>
                  <Td><Badge tone={COURSE_STATUS[c.status]!.tone}>{COURSE_STATUS[c.status]!.label}</Badge></Td>
                  <Td className="tabular-nums">v{c.version}</Td>
                  <Td className="text-right tabular-nums">{counts.get(c.id) ?? 0}</Td>
                  <Td className="text-right tabular-nums">{xs.length}</Td>
                  <Td className="text-right tabular-nums">{xs.length ? Math.round((xs.filter((x) => x.status === 'completed').length / xs.length) * 100) : 0}%</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <Pagination page={page} pageCount={pages} total={rows.length} hrefFor={(n) => `${p.base}?tab=courses${status ? `&status=${status}` : ''}&page=${n}`} />
      </Panel>
      <StarterLibrary p={p} courses={courses} />
    </div>
  );
}

/** Ready-made starter courses: one click adds a draft with its lessons, to review and publish. */
function StarterLibrary({ p, courses }: { p: Props; courses: Array<{ id: string; title: string }> }) {
  const have = new Map(courses.map((c) => [c.title.trim().toLowerCase(), c.id]));
  return (
    <Panel title="Starter library" meta={`${STARTER_COURSES.length} ready-made courses · added as drafts for you to review`}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Starter courses">
        {STARTER_COURSES.map((c) => {
          const id = have.get(c.title.toLowerCase());
          return (
            <li key={c.key} className="flex flex-col justify-between gap-3 rounded-xl border border-line p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.category}</p>
                <p className="mt-1 font-medium">{c.title}</p>
                <p className="mt-1 text-xs text-muted">{c.lessons.length} lessons · {c.minutes} min{c.validForMonths ? ` · renew every ${c.validForMonths} months` : ''}</p>
              </div>
              {id ? <Link className="text-sm text-primary hover:underline" href={`${p.base}/${id}`}>✓ In your catalog · open</Link>
                : <RunButton action={addStarterCourseAction.bind(null, p.slug, c.key)} label={`Add ${c.title}`}>＋ Add to catalog</RunButton>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

async function Skills(p: Props) {
  const [s, courses, structure] = await Promise.all([learnSkills(p.orgId), learnCourses(p.orgId), getStructure(p.orgId)]);
  const title = new Map(courses.map((c) => [c.id, c.title]));
  const cats = [...new Set(s.skills.map((x) => x.category ?? 'Uncategorised'))];
  const skillOpts = s.skills.map((x) => ({ value: x.id, label: x.name }));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Courses teach skills at a level → completions write each person’s proficiency → designations require skills. Coverage shows where the catalogue has gaps.</p>
      <Panel title="Skill taxonomy" flush>
        {s.skills.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No skills yet — add your taxonomy.</p> : (
          <Table caption="Skill taxonomy">
            <thead><tr><Th>Skill</Th><Th>Category</Th><Th>Covering courses</Th><Th className="text-right">People with proficiency</Th></tr></thead>
            <tbody>{s.skills.map((x) => <tr key={x.id}><Td className="font-medium">{x.name}</Td><Td>{x.category ?? '—'}</Td>
              <Td className="text-xs">{s.courseSkills.filter((c) => c.skill_id === x.id).map((c) => `${title.get(c.course_id)} (L${c.level})`).join(', ') || <span className="text-warning">No course</span>}</Td>
              <Td className="text-right tabular-nums">{s.employeeSkills.filter((e) => e.skill_id === x.id).length}</Td></tr>)}</tbody>
          </Table>
        )}
        <div className="border-t border-line px-5 py-4"><SkillForm action={saveSkillAction.bind(null, p.slug)} /></div>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Org skill coverage" meta="share of each category’s skills covered by a course">
          {cats.length === 0 ? <p className="text-sm text-muted">No skills yet.</p> : (
            <ul className="space-y-2">{cats.map((cat) => {
              const inCat = s.skills.filter((x) => (x.category ?? 'Uncategorised') === cat);
              const covered = inCat.filter((x) => s.courseSkills.some((c) => c.skill_id === x.id)).length;
              return <li key={cat}><div className="flex justify-between text-sm"><span>{cat}</span><span className="text-muted">{covered}/{inCat.length}</span></div>
                <div className="mt-1 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-primary" style={{ width: `${(covered / inCat.length) * 100}%` }} /></div></li>;
            })}</ul>
          )}
        </Panel>
        <Panel title="Role requirements">
          {s.roleSkills.length === 0 ? <p className="text-sm text-muted">No role requirements yet.</p> : (
            <ul className="mb-3 divide-y divide-line text-sm">{s.roleSkills.map((r) => (
              <li key={`${r.designation_id}${r.skill_id}`} className="flex items-center justify-between py-1.5"><span>{desig.get(r.designation_id) ?? 'Designation'} → {s.skills.find((x) => x.id === r.skill_id)?.name} L{r.level}</span>
                <Buttons action={roleSkillAction.bind(null, p.slug)} hidden={{ designationId: r.designation_id, skillId: r.skill_id, level: String(r.level), remove: '1' }} label="Remove requirement" buttons={[{ text: 'Remove' }]} /></li>
            ))}</ul>
          )}
          {s.skills.length > 0 && <RoleSkillForm action={roleSkillAction.bind(null, p.slug)} skills={skillOpts} designations={structure.designations.map((d) => ({ value: d.id, label: d.title }))} />}
        </Panel>
      </div>
    </div>
  );
}

async function Assignments(p: Props) {
  const [rules, courses, journeys, structure] = await Promise.all([learnRules(p.orgId), learnCourses(p.orgId), learnJourneys(p.orgId), getStructure(p.orgId)]);
  const targets = [
    ...courses.filter((c) => c.status === 'published').map((c) => ({ value: `course:${c.id}`, label: `Course · ${c.title}` })),
    ...journeys.filter((j) => j.status === 'published').map((j) => ({ value: `journey:${j.id}`, label: `Journey · ${j.title}` })),
  ];
  const label = (r: (typeof rules)[number]) => r.course_id ? courses.find((c) => c.id === r.course_id)?.title : journeys.find((j) => j.id === r.journey_id)?.title;
  const scope = (r: (typeof rules)[number]) => [r.department_id && structure.departments.find((d) => d.id === r.department_id)?.name, r.designation_id && structure.designations.find((d) => d.id === r.designation_id)?.title,
    r.location_id && structure.locations.find((l) => l.id === r.location_id)?.name, r.employment_type].filter(Boolean).join(' · ') || 'Everyone';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">⚙️ Rules read the directory every day — set once and new joiners get their training automatically. Manual assignment is on each course’s page.</p>
        <RunButton action={applyRulesAction.bind(null, p.slug)} label="Run rules now">Run rules now</RunButton>
      </div>
      <Panel title="Assignment rules" flush>
        {rules.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No rules yet — create one to auto-enrol.</p> : (
          <Table caption="Assignment rules">
            <thead><tr><Th>Rule</Th><Th>Assigns</Th><Th>Who</Th><Th>Trigger</Th><Th>Due</Th><Th>Recurrence</Th><Th>Active</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.id}><Td className="font-medium">{r.name}</Td><Td>{label(r)}</Td><Td className="text-xs">{scope(r)}</Td><Td>{r.trigger === 'new_joiners' ? 'New joiners' : 'Everyone'}</Td><Td>{r.due_days} days</Td><Td>{r.recurrence === 'yearly' ? 'Yearly' : 'Once'}</Td>
                <Td><Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'On' : 'Paused'}</Badge></Td>
                <Td className="whitespace-nowrap text-right"><Buttons action={ruleToggleAction.bind(null, p.slug)} hidden={{ ruleId: r.id }} label={`Rule ${r.name}`}
                  buttons={[{ text: r.active ? 'Pause' : 'Switch on', name: 'op', value: r.active ? 'off' : 'on' }, { text: 'Delete', name: 'op', value: 'delete' }]} /></Td></tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
      <Panel title="＋ New rule">{targets.length === 0 ? <p className="text-sm text-muted">Publish a course or journey first.</p> : (
        <RuleForm action={saveRuleAction.bind(null, p.slug)} targets={targets} departments={structure.departments.map((d) => ({ value: d.id, label: d.name }))}
          designations={structure.designations.map((d) => ({ value: d.id, label: d.title }))} locations={structure.locations.map((l) => ({ value: l.id, label: l.name }))} />
      )}</Panel>
    </div>
  );
}

async function Learners(p: Props) {
  const [enrollments, courses, dir] = await Promise.all([learnEnrollments(p.orgId), learnCourses(p.orgId), people(p.orgId)]);
  const live = enrollments.filter((x) => x.status !== 'cancelled');
  const st = p.sp.status ?? '';
  const q = (p.sp.q ?? '').toLowerCase();
  const rows = live.filter((x) => (!st || (st === 'overdue' ? open(x.status) && !!x.due_on && x.due_on < p.today : x.status === st))
    && (!q || `${dir.name.get(x.employee_id) ?? ''} ${courses.find((c) => c.id === x.course_id)?.title ?? ''}`.toLowerCase().includes(q)));
  const size = 25;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Number(p.sp.page) || 1));
  const overdue = live.filter((x) => open(x.status) && x.due_on && x.due_on < p.today).length;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Enrolments" value={live.length} note={`across ${new Set(live.map((x) => x.employee_id)).size} people`} tone="primary" />
        <StatCard label="Rule- or HR-assigned" value={`${live.length ? Math.round((live.filter((x) => x.source !== 'self').length / live.length) * 100) : 0}%`} />
        <StatCard label="Completed" value={live.filter((x) => x.status === 'completed').length} tone="success" />
        <StatCard label="Overdue" value={overdue} tone={overdue ? 'danger' : 'muted'} />
      </div>
      <Panel title="All enrolments" flush action={<div className="flex items-center gap-3"><RunButton action={remindOverdueAction.bind(null, p.slug)} label="Remind everyone overdue">🔔 Remind overdue</RunButton><a className="text-xs text-primary" href={`${p.base}/export`} download>⬇ Export</a></div>}>
        <form className="flex flex-wrap gap-2 px-5 pb-3" action={p.base}><input type="hidden" name="tab" value="learners" />
          <input name="q" defaultValue={p.sp.q ?? ''} placeholder="Search person or course" aria-label="Search" className="h-9 w-64 rounded-md border border-line-strong bg-surface px-2 text-sm" />
          <select name="status" defaultValue={st} aria-label="Status" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm"><option value="">All</option><option value="assigned">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="overdue">Overdue</option></select>
          <button className="h-9 rounded-md border border-line bg-surface px-3 text-sm hover:bg-subtle">Filter</button></form>
        <Table caption="All enrolments">
          <thead><tr><Th>Employee</Th><Th>Dept</Th><Th>Learning</Th><Th>Status</Th><Th>Due</Th><Th>Source</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">No enrolments match.</td></tr>}
            {rows.slice((page - 1) * size, page * size).map((x) => (
              <tr key={x.id}><Td className="font-medium">{dir.name.get(x.employee_id) ?? '—'}</Td><Td>{dir.dept.get(x.employee_id) ?? '—'}</Td>
                <Td><Link className="text-primary hover:underline" href={`${p.base}/${x.course_id}`}>{courses.find((c) => c.id === x.course_id)?.title}</Link></Td>
                <Td><Badge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Badge>{open(x.status) && x.due_on && x.due_on < p.today && <span className="ml-1"><Badge tone="danger">Overdue</Badge></span>}</Td>
                <Td>{x.due_on ? formatDate(x.due_on) : '—'}</Td><Td className="capitalize">{x.source}</Td></tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={page} pageCount={pages} total={rows.length} hrefFor={(n) => `${p.base}?tab=learners&page=${n}${st ? `&status=${st}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`} />
      </Panel>
    </div>
  );
}

async function Analytics(p: Props) {
  const [enrollments, journeys, s, dir, structure] = await Promise.all([learnEnrollments(p.orgId), learnJourneys(p.orgId), learnSkills(p.orgId), people(p.orgId), getStructure(p.orgId)]);
  const live = enrollments.filter((x) => x.status !== 'cancelled');
  const depts = [...new Set(live.map((x) => dir.dept.get(x.employee_id) ?? 'Unassigned'))].map((d) => {
    const xs = live.filter((x) => (dir.dept.get(x.employee_id) ?? 'Unassigned') === d);
    return { d, n: xs.length, pct: Math.round((xs.filter((x) => x.status === 'completed').length / xs.length) * 100) };
  });
  const weekAgo = new Date(new Date().getTime() - 7 * 86_400_000).toISOString();
  const active = new Set(live.filter((x) => (x.started_at && x.started_at >= weekAgo) || (x.completed_at && x.completed_at >= weekAgo)).map((x) => x.employee_id));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Completion by department">
          {depts.length === 0 ? <p className="text-sm text-muted">No enrolments yet.</p> : (
            <ul className="space-y-2">{depts.map((x) => <li key={x.d}><div className="flex justify-between text-sm"><span>{x.d}</span><span className="text-muted">{x.pct}% of {x.n}</span></div>
              <div className="mt-1 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-success" style={{ width: `${x.pct}%` }} /></div></li>)}</ul>
          )}
        </Panel>
        <Panel title="Journey funnels">
          {journeys.length === 0 ? <p className="text-sm text-muted">No journeys yet.</p> : (
            <ul className="space-y-2 text-sm">{journeys.map((j) => <li key={j.id} className="flex justify-between"><span>{j.title}</span><span className="tabular-nums text-muted">{j.enrollments.length} enrolled → {j.enrollments.filter((e) => e.completed_at).length} completed</span></li>)}</ul>
          )}
        </Panel>
        <Panel title="Skill coverage vs required">
          {s.roleSkills.length === 0 ? <p className="text-sm text-muted">No skill is required of a designation yet. Set role requirements under Skills.</p> : (
            <ul className="space-y-1.5 text-sm">{s.roleSkills.map((r) => {
              const meeting = s.employeeSkills.filter((e) => e.skill_id === r.skill_id && e.level >= r.level).length;
              return <li key={`${r.designation_id}${r.skill_id}`} className="flex justify-between"><span>{desig.get(r.designation_id)} · {s.skills.find((x) => x.id === r.skill_id)?.name} L{r.level}</span><span className="tabular-nums text-muted">{meeting} people at level</span></li>;
            })}</ul>
          )}
        </Panel>
        <Panel title="Engagement">
          <p className="text-sm">Weekly active learners: <span className="font-semibold">{active.size}</span> of {new Set(live.map((x) => x.employee_id)).size} enrolled</p>
          <p className="mt-1 text-xs text-muted">Counts people who started or completed a course in the last 7 days. Session length and streaks aren’t recorded.</p>
        </Panel>
      </div>
    </div>
  );
}

async function Settings(p: Props) {
  const s = await learnSettings(p.orgId);
  return <Panel title="Learn settings"><LearnSettingsForm action={saveLearnSettingsAction.bind(null, p.slug)} s={s} /></Panel>;
}
