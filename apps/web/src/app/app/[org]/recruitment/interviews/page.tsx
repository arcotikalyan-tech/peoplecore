import type { Metadata } from 'next';
import { INTERVIEW_MODE_LABELS } from '@peoplecore/shared';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { getMyInterviews } from '@/server/recruitment';
import { submitScorecardAction } from '../actions';
import { ScorecardForm } from '../recruitment-forms';

export const metadata: Metadata = { title: 'My interviews' };

/** For any member on an interview panel: what they need for the interview, and their scorecard. */
export default async function MyInterviewsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const interviews = await getMyInterviews(ctx.org.id);
  const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: ctx.org.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const now = new Date().toISOString();

  return (
    <>
      <PageHeader title="My interviews" description="Rate each criterion and give a recommendation after the interview. You’ll see the other interviewers’ scorecards once you’ve submitted yours." />
      <div className="space-y-4">
        {interviews.length === 0 && <Card><p className="px-5 py-4 text-sm text-muted">You’re not on any interview panels.</p></Card>}
        {interviews.map((i) => (
          <Card key={i.interview_id}>
            <CardHeader
              title={`${i.candidate_name} · ${i.round_name}`}
              description={`${i.requisition_title}${i.current_company ? ` · currently at ${i.current_company}` : ''}`}
              actions={<Badge tone={i.scorecard_submitted ? 'success' : i.status === 'cancelled' ? 'danger' : 'warning'}>{i.scorecard_submitted ? 'Scorecard submitted' : i.status === 'cancelled' ? 'Cancelled' : 'Scorecard due'}</Badge>}
            />
            <div className="space-y-4 px-5 py-4">
              <p className="text-sm">{when(i.scheduled_at)} · {i.duration_minutes} min · {INTERVIEW_MODE_LABELS[i.mode]}{i.location ? ` · ${i.location}` : ''}</p>
              {!i.scorecard_submitted && i.status !== 'cancelled' && (i.scheduled_at <= now
                ? <ScorecardForm action={submitScorecardAction.bind(null, slug)} interviewId={i.interview_id} label={`${i.candidate_name} ${i.round_name}`} />
                : <p className="text-sm text-muted">The scorecard opens once the interview has started.</p>)}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
