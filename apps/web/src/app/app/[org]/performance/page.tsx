import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonClass } from '@/components/ui/button';
import { HubTabs, Panel, StatCard } from '@/components/ui/hub';
import { Badge, Card, CardHeader, DetailList } from '@/components/ui/surface';
import { getOrgContext, type OrgContext } from '@/server/context';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import { viewModeFor } from '@/server/view';
import { getMyEmployee, managerOptions } from '@/server/employees';
import { namesFor } from '@/server/leave';
import { getCycles, getGoals, getMyReviews, getPendingFeedback, getTeamReviews, myFeedback, reviewView } from '@/server/performance';
import {
  addGoalAction, assignKraAction, giveFeedbackAction, managerReviewAction, rateSkillsAction, requestFeedbackAction, saveKraAction, savePmsSettingsAction,
  saveSkillAction, selfReviewAction, toggleLibraryAction, updateGoalAction,
} from './actions';
import {
  AssignKraForm, FeedbackRequestForm, GiveFeedbackForm, GoalForm, GoalProgressForm, KraForm, PmsSettingsForm, ReviewForm, SkillForm, SkillRatingForm, SmallAction,
} from './performance-forms';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Performance' };

type Search = Record<string, string | undefined>;
type Skill = { skill_id: string; name: string; category: string; self_rating: number | null; manager_rating: number | null };

async function pmsSettings(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('pms_settings').select('*').eq('organization_id', orgId).single();
  return data ?? { evaluation_period: 'annual', rating_labels: ['Below expectations', 'Partly meets', 'Meets expectations', 'Exceeds expectations', 'Exceptional'], goals_weight: 70, goal_weightage: true, self_appraisal: true, peer_feedback: true };
}
async function reviewSkills(reviewId: string): Promise<Skill[]> {
  const supabase = await createClient();
  return ((await supabase.rpc('review_skills', { p_review: reviewId })).data ?? []) as Skill[];
}

/**
 * Performance (Kredily's PMS): HR gets a hub, cycles, the KRA and skills libraries and settings; everyone gets
 * My Performance — goals (with weightage), the self review with skill ratings, the team's reviews and feedback.
 */
export default async function PerformancePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'performance');
  if (!ctx.can('performance.read')) notFound();
  const hr = ctx.can('performance.manage', 'org') && (await viewModeFor(ctx)) === 'admin';
  const base = `/app/${slug}/performance`;
  const tabs = hr
    ? [{ key: 'hub', label: '✦ Hub' }, { key: 'mine', label: 'My Performance' }, { key: 'kras', label: 'KRAs' }, { key: 'skills', label: 'Skills' }, { key: 'settings', label: 'Settings' }]
    : [{ key: 'mine', label: 'My Performance' }];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : tabs[0]!.key;
  const settings = await pmsSettings(ctx.org.id);
  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="mt-1 text-sm text-muted">Goals and KRAs, skills, reviews and feedback · {settings.evaluation_period.replace('_', '-')} evaluation.</p>
        </div>
        {ctx.can('performance.manage', 'org') && <Link className={buttonClass('secondary')} href={`${base}/cycles`}>Review cycles</Link>}
      </header>
      {tabs.length > 1 && <HubTabs base={base} label="Performance sections" tabs={tabs} current={tab} />}
      {tab === 'hub' && <PmsHub ctx={ctx} base={base} labels={settings.rating_labels} />}
      {tab === 'mine' && <MyPerformance ctx={ctx} slug={slug} labels={settings.rating_labels} peerFeedback={settings.peer_feedback} />}
      {tab === 'kras' && <Kras ctx={ctx} slug={slug} />}
      {tab === 'skills' && <Skills ctx={ctx} slug={slug} />}
      {tab === 'settings' && <Panel title="Settings"><PmsSettingsForm action={savePmsSettingsAction.bind(null, slug)} s={settings} /></Panel>}
    </>
  );
}

async function MyPerformance({ ctx, slug, labels, peerFeedback }: { ctx: OrgContext; slug: string; labels: string[]; peerFeedback: boolean }) {
  const RATING_LABEL = ['', ...labels];
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const [goals, myReviews, team, cycles, pending, colleagues] = await Promise.all([
    me ? getGoals(ctx.org.id, me.id) : Promise.resolve([]),
    me ? getMyReviews(ctx.org.id) : Promise.resolve([]),
    getTeamReviews(ctx.org.id, me?.id ?? null),
    getCycles(ctx.org.id),
    me ? getPendingFeedback(ctx.org.id, me.id) : Promise.resolve([]),
    ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team') ? managerOptions(ctx.org.id) : Promise.resolve([]),
  ]);
  const current = myReviews[0];
  const [myView, feedback] = current ? await Promise.all([reviewView(current.review_id), myFeedback(current.review_id)]) : [null, []];
  const activeCycles = new Set(cycles.filter((c) => c.status === 'active').map((c) => c.id));
  const teamActive = team.filter((r) => activeCycles.has(r.cycle_id) || r.status !== 'not_started');
  const teamViews = await Promise.all(teamActive.slice(0, 50).map((r) => reviewView(r.id)));
  const names = await namesFor(ctx.org.id, teamActive.map((r) => r.employee_id));
  const activeCycle = cycles.find((c) => c.status === 'active') ?? cycles.find((c) => c.status === 'draft');
  const mySkills = current ? await reviewSkills(current.review_id) : [];
  const teamSkills = new Map(await Promise.all(teamViews.filter((v) => v?.can_manager_review).map(async (v) => [v!.review_id, await reviewSkills(v!.review_id)] as const)));
  const cycleGoals = activeCycle ? goals.filter((g) => g.cycle_id === activeCycle.id && g.status !== 'dropped') : [];
  const weightSum = cycleGoals.reduce((s, g) => s + g.weight, 0);

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {me && (
            <Card>
              <CardHeader title="Your goals" description={`${goals.length} goal${goals.length === 1 ? '' : 's'}${activeCycle && cycleGoals.length ? ` · ${activeCycle.name} weights ${weightSum}%` : ''}`} />
              {activeCycle && cycleGoals.length > 0 && weightSum !== 100 && <p className="px-5 pt-3 text-sm text-warning">Goal weights for {activeCycle.name} add up to {weightSum}%. Make them 100% before your self review.</p>}
              <ul className="divide-y divide-line" aria-label="Your goals">
                {goals.map((g) => (
                  <li key={g.id} className="space-y-2 px-5 py-3">
                    <div className="flex justify-between gap-2 text-sm"><span className="font-medium">{g.title}</span><span className="text-muted">{g.weight}% · {g.progress}%</span></div>
                    <div className="h-1.5 rounded-full bg-subtle" aria-hidden="true"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${g.progress}%` }} /></div>
                    <GoalProgressForm action={updateGoalAction.bind(null, slug)} goalId={g.id} title={g.title} progress={g.progress} status={g.status} />
                  </li>
                ))}
              </ul>
              <GoalForm action={addGoalAction.bind(null, slug)} employeeId={me.id} cycleId={activeCycle?.id} />
            </Card>
          )}
          {teamViews.length > 0 && (
            <Card>
              <CardHeader title="Your team’s reviews" />
              <ul className="divide-y divide-line" aria-label="Team reviews">
                {teamViews.map((v) => v && (
                  <li key={v.review_id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-5 text-sm">
                      <span className="font-medium">{names.get(v.employee_id) ?? 'Employee'} · {v.cycle_name}</span>
                      <Badge tone={v.status === 'calibrated' ? 'success' : v.status === 'not_started' ? 'neutral' : 'warning'}>{v.status.replace('_', ' ')}</Badge>
                    </div>
                    {v.self_rating && <p className="px-5 text-sm text-muted">Self: {v.self_rating} · {RATING_LABEL[v.self_rating]} — {v.self_comments}</p>}
                    {v.manager_rating && <p className="px-5 text-sm text-muted">Manager: {v.manager_rating} — {v.manager_comments}</p>}
                    {v.can_manager_review && (teamSkills.get(v.review_id) ?? []).length > 0 && (
                      <SkillRatingForm action={rateSkillsAction.bind(null, slug)} reviewId={v.review_id} as="manager" label={`Skills for ${names.get(v.employee_id)}`} skills={teamSkills.get(v.review_id)!} />
                    )}
                    {v.can_manager_review && <ReviewForm action={managerReviewAction.bind(null, slug)} reviewId={v.review_id} label={`Manager review for ${names.get(v.employee_id)}`} submit="Submit manager review" />}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {current && myView && (
            <Card>
              <CardHeader title={`Your review · ${current.cycle_name}`} description={current.cycle_status === 'shared' ? 'Results shared' : current.status === 'not_started' ? 'Your self review is open' : 'In progress'} />
              {current.status === 'not_started' && current.cycle_status === 'active' ? (
                <>
                  {mySkills.length > 0 && <SkillRatingForm action={rateSkillsAction.bind(null, slug)} reviewId={current.review_id} as="self" label="Rate your skills" skills={mySkills} />}
                  <ReviewForm action={selfReviewAction.bind(null, slug)} reviewId={current.review_id} label="Self review" submit="Submit self review" />
                </>
              ) : (
                <DetailList items={[
                  { label: 'Your rating', value: myView.self_rating ? `${myView.self_rating} · ${RATING_LABEL[myView.self_rating]}` : null },
                  { label: 'Manager’s rating', value: myView.manager_rating ? `${myView.manager_rating} · ${RATING_LABEL[myView.manager_rating]}` : 'Shared when the cycle closes' },
                  { label: 'Final rating', value: myView.final_rating ? `${myView.final_rating} · ${RATING_LABEL[myView.final_rating]}` : 'Shared when the cycle closes' },
                  { label: 'Manager’s comments', value: myView.manager_comments },
                ]} />
              )}
              {current.status !== 'not_started' && mySkills.some((k) => k.self_rating || k.manager_rating) && (
                <ul className="divide-y divide-line border-t border-line text-sm" aria-label="Skill ratings">
                  {mySkills.map((k) => <li key={k.skill_id} className="flex justify-between px-5 py-2"><span>{k.name}</span><span className="tabular-nums text-muted">self {k.self_rating ?? '—'} · manager {k.manager_rating ?? '—'}</span></li>)}
                </ul>
              )}
              {feedback.length > 0 && (
                <ul className="divide-y divide-line border-t border-line text-sm" aria-label="Feedback">
                  {feedback.map((f, i) => <li key={i} className="px-5 py-3"><p className="text-muted">{f.question}</p><p>{f.response}</p></li>)}
                </ul>
              )}
              {peerFeedback && current.cycle_status === 'active' && colleagues.length > 0 && (
                <FeedbackRequestForm action={requestFeedbackAction.bind(null, slug)} reviewId={current.review_id} colleagues={colleagues.filter((c) => c.value !== me?.id)} />
              )}
            </Card>
          )}
          {pending.length > 0 && (
            <Card>
              <CardHeader title="Feedback you’ve been asked for" description="Your name isn’t shown to the person." />
              {pending.map((p) => <GiveFeedbackForm key={p.id} action={giveFeedbackAction.bind(null, slug)} requestId={p.id} question={p.question} />)}
            </Card>
          )}
          {!current && <Card><p className="px-5 py-4 text-sm text-muted">No review open for you.</p></Card>}
        </div>
      </div>
    </>
  );
}

async function PmsHub({ ctx, base, labels }: { ctx: OrgContext; base: string; labels: string[] }) {
  const supabase = await createClient();
  const [cycles, reviews, goals] = await Promise.all([
    getCycles(ctx.org.id), getTeamReviews(ctx.org.id, null),
    supabase.from('goals').select('cycle_id, progress, status').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
  ]);
  const cycle = cycles.find((c) => c.status === 'active' || c.status === 'calibration') ?? cycles[0];
  const rs = cycle ? reviews.filter((r) => r.cycle_id === cycle.id) : [];
  const count = (s: string) => rs.filter((r) => r.status === s).length;
  const gs = cycle ? goals.filter((g) => g.cycle_id === cycle.id && g.status !== 'dropped') : [];
  const avg = gs.length ? Math.round(gs.reduce((s, g) => s + g.progress, 0) / gs.length) : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: rs.filter((r) => r.final_rating === n).length }));
  const top = Math.max(1, ...dist.map((d) => d.c));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cycle" value={cycle?.name ?? '—'} note={cycle ? cycle.status : 'Create one under Review cycles'} href={`${base}/cycles`} />
        <StatCard label="Self reviews" value={`${rs.length - count('not_started')}/${rs.length}`} note={`${count('not_started')} not started`} tone="primary" />
        <StatCard label="Manager reviews" value={count('manager_submitted') + count('calibrated')} note={`${count('self_submitted')} waiting for managers`} tone="warning" />
        <StatCard label="Goal progress" value={`${avg}%`} note={`${gs.length} goals in this cycle`} tone="success" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Review pipeline">
          <ol className="flex flex-wrap gap-2" aria-label="Review pipeline">
            {[['Not started', count('not_started')], ['Self submitted', count('self_submitted')], ['Manager submitted', count('manager_submitted')], ['Calibrated', count('calibrated')]].map(([l, n]) => (
              <li key={l} className="flex-1 rounded-xl border border-line p-3 text-center"><p className="text-2xl font-bold tabular-nums">{n}</p><p className="text-xs text-muted">{l}</p></li>
            ))}
          </ol>
        </Panel>
        <Panel title="Rating distribution">
          <ul className="space-y-2" aria-label="Rating distribution">
            {dist.map((d) => (
              <li key={d.n} className="text-sm">
                <div className="flex justify-between"><span>{d.n} · {labels[d.n - 1]}</span><span className="tabular-nums text-muted">{d.c}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-subtle"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(d.c / top) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

async function Kras({ ctx, slug }: { ctx: OrgContext; slug: string }) {
  const supabase = await createClient();
  const [kras, structure, cycles] = await Promise.all([
    supabase.from('pms_kras').select('id, title, description, department_id, weight, is_active').eq('organization_id', ctx.org.id).order('created_at').then((r) => r.data ?? []),
    getStructure(ctx.org.id), getCycles(ctx.org.id),
  ]);
  const departments = structure.departments.map((d) => ({ value: d.id, label: d.name }));
  const dept = new Map(departments.map((d) => [d.value, d.label]));
  const open = cycles.filter((c) => c.status === 'draft' || c.status === 'active').map((c) => ({ value: c.id, label: c.name }));
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="KRA library" meta={`${kras.length}`}>
        {kras.length === 0 ? <p className="text-sm text-muted">No KRAs yet. Add the key result areas people are measured on.</p> : (
          <ul className="divide-y divide-line" aria-label="KRAs">
            {kras.map((k) => (
              <li key={k.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <div><p className="font-medium">{k.title} <span className="font-normal text-muted">· {k.weight}% · {k.department_id ? dept.get(k.department_id) : 'Everyone'}</span></p>
                    {k.description && <p className="text-xs text-muted">{k.description}</p>}</div>
                  <SmallAction action={toggleLibraryAction.bind(null, slug)} label={`${k.is_active ? 'Turn off' : 'Turn on'} ${k.title}`} submit={k.is_active ? 'Turn off' : 'Turn on'}
                    hidden={{ table: 'pms_kras', id: k.id, active: k.is_active ? 'no' : 'yes' }} variant="secondary" />
                </div>
                {k.is_active && open.length > 0 && <AssignKraForm action={assignKraAction.bind(null, slug)} kraId={k.id} title={k.title} cycles={open} departments={departments} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Add KRA"><KraForm action={saveKraAction.bind(null, slug)} departments={departments} /></Panel>
    </div>
  );
}

async function Skills({ ctx, slug }: { ctx: OrgContext; slug: string }) {
  const supabase = await createClient();
  const skills = (await supabase.from('pms_skills').select('id, name, category, description, is_active').eq('organization_id', ctx.org.id).order('category').order('name')).data ?? [];
  const cats = [...new Set(skills.map((s) => s.category))];
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="Skills library" meta={`${skills.filter((s) => s.is_active).length} active · rated in every review`}>
        {skills.length === 0 ? <p className="text-sm text-muted">No skills yet. Skills you add are rated by employees and their managers in each review.</p> : cats.map((c) => (
          <div key={c} className="mb-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{c}</p>
            <ul className="divide-y divide-line" aria-label={`${c} skills`}>
              {skills.filter((s) => s.category === c).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className={s.is_active ? '' : 'text-muted line-through'}>{s.name}{s.description && <span className="block text-xs text-muted">{s.description}</span>}</span>
                  <SmallAction action={toggleLibraryAction.bind(null, slug)} label={`${s.is_active ? 'Turn off' : 'Turn on'} ${s.name}`} submit={s.is_active ? 'Turn off' : 'Turn on'}
                    hidden={{ table: 'pms_skills', id: s.id, active: s.is_active ? 'no' : 'yes' }} variant="secondary" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Panel>
      <Panel title="Add skill"><SkillForm action={saveSkillAction.bind(null, slug)} /></Panel>
    </div>
  );
}
