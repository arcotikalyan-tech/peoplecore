import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { getMyEmployee, managerOptions } from '@/server/employees';
import { namesFor } from '@/server/leave';
import { getCycles, getGoals, getMyReviews, getPendingFeedback, getTeamReviews, myFeedback, reviewView } from '@/server/performance';
import { addGoalAction, giveFeedbackAction, managerReviewAction, requestFeedbackAction, selfReviewAction, updateGoalAction } from './actions';
import { FeedbackRequestForm, GiveFeedbackForm, GoalForm, GoalProgressForm, ReviewForm } from './performance-forms';

export const metadata: Metadata = { title: 'Performance' };

const RATING_LABEL = ['', 'Below expectations', 'Partly meets', 'Meets expectations', 'Exceeds expectations', 'Exceptional'];

export default async function PerformancePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('performance.read')) notFound();
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

  return (
    <>
      <PageHeader title="Performance" description="Goals, reviews and feedback."
        actions={ctx.can('performance.manage', 'org') && <Link className={buttonClass('secondary')} href={`/app/${slug}/performance/cycles`}>Review cycles</Link>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {me && (
            <Card>
              <CardHeader title="Your goals" description={`${goals.length} goal${goals.length === 1 ? '' : 's'}`} />
              <ul className="divide-y divide-line" aria-label="Your goals">
                {goals.map((g) => (
                  <li key={g.id} className="space-y-2 px-5 py-3">
                    <div className="flex justify-between gap-2 text-sm"><span className="font-medium">{g.title}</span><span className="text-muted">{g.weight}% · {g.progress}%</span></div>
                    <div className="h-1.5 rounded-full bg-subtle" aria-hidden="true"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${g.progress}%` }} /></div>
                    <GoalProgressForm action={updateGoalAction.bind(null, slug)} goalId={g.id} title={g.title} progress={g.progress} status={g.status} />
                  </li>
                ))}
              </ul>
              <GoalForm action={addGoalAction.bind(null, slug)} employeeId={me.id} />
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
                <ReviewForm action={selfReviewAction.bind(null, slug)} reviewId={current.review_id} label="Self review" submit="Submit self review" />
              ) : (
                <DetailList items={[
                  { label: 'Your rating', value: myView.self_rating ? `${myView.self_rating} · ${RATING_LABEL[myView.self_rating]}` : null },
                  { label: 'Manager’s rating', value: myView.manager_rating ? `${myView.manager_rating} · ${RATING_LABEL[myView.manager_rating]}` : 'Shared when the cycle closes' },
                  { label: 'Final rating', value: myView.final_rating ? `${myView.final_rating} · ${RATING_LABEL[myView.final_rating]}` : 'Shared when the cycle closes' },
                  { label: 'Manager’s comments', value: myView.manager_comments },
                ]} />
              )}
              {feedback.length > 0 && (
                <ul className="divide-y divide-line border-t border-line text-sm" aria-label="Feedback">
                  {feedback.map((f, i) => <li key={i} className="px-5 py-3"><p className="text-muted">{f.question}</p><p>{f.response}</p></li>)}
                </ul>
              )}
              {current.cycle_status === 'active' && colleagues.length > 0 && (
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
