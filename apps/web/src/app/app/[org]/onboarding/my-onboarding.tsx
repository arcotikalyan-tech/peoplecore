import Link from 'next/link';
import { HubHeader, Panel, StatCard } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';
import { completeTaskAction } from '../inbox/actions';
import { CompleteTask } from '../inbox/inbox-forms';

/** A new joiner's own onboarding: their plan's progress, their tasks, and policies still to acknowledge. */
export async function MyOnboarding({ slug, orgId, userId }: { slug: string; orgId: string; userId: string }) {
  const me = await getMyEmployee(orgId, userId);
  const supabase = await createClient();
  const plan = me ? (await supabase.from('onboarding_plans').select('id, status, started_at, completed_at').eq('employee_id', me.id).order('started_at', { ascending: false }).limit(1).maybeSingle()).data : null;
  const [tasks, policies, acks] = await Promise.all([
    plan ? supabase.from('tasks').select('id, title, details, due_on, status, assignee_employee_id').eq('subject_type', 'onboarding_plan').eq('subject_id', plan.id).order('due_on').then((r) => r.data ?? []) : Promise.resolve([]),
    supabase.from('policy_documents').select('id, title, version, requires_acknowledgement').eq('organization_id', orgId).is('retired_at', null).eq('requires_acknowledgement', true).then((r) => r.data ?? []),
    me ? supabase.from('policy_acknowledgements').select('policy_id').eq('employee_id', me.id).then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  const mine = tasks.filter((t) => t.assignee_employee_id === me?.id);
  const done = tasks.filter((t) => t.status !== 'open').length;
  const acked = new Set(acks.map((a) => a.policy_id));
  const toAck = policies.filter((p) => !acked.has(p.id));
  return (
    <>
      <HubHeader title="My onboarding" subtitle="Your first days: tasks for you, what others are setting up, and policies to read." />
      {!plan ? (
        <Panel title="Welcome"><p className="text-sm text-muted">You don’t have an onboarding plan. Your tasks, if any, are in your <Link className="text-primary" href={`/app/${slug}/inbox`}>Inbox</Link>.</p></Panel>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Progress" value={`${tasks.length ? Math.round((done / tasks.length) * 100) : 100}%`} note={`${done} of ${tasks.length} tasks done`} tone="primary" />
            <StatCard label="For you" value={mine.filter((t) => t.status === 'open').length} note="open tasks" tone={mine.some((t) => t.status === 'open') ? 'warning' : 'success'} />
            <StatCard label="Policies to read" value={toAck.length} tone={toAck.length ? 'warning' : 'success'} href={`/app/${slug}/policies`} />
          </div>
          <Panel title="Your tasks" meta={plan.completed_at ? `Completed ${formatDate(plan.completed_at)}` : `Started ${formatDate(plan.started_at)}`}>
            {mine.length === 0 ? <p className="text-sm text-muted">Nothing for you to do — others are setting things up.</p> : (
              <ul className="divide-y divide-line text-sm" aria-label="Your onboarding tasks">{mine.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-medium">{t.title}</span>{t.due_on && <span className="text-muted"> · due {formatDate(t.due_on)}</span>}{t.details && <span className="block text-xs text-muted">{t.details}</span>}</span>
                  {t.status === 'open' ? <CompleteTask action={completeTaskAction.bind(null, slug)} taskId={t.id} title={t.title} /> : <Badge tone="success">Done</Badge>}
                </li>
              ))}</ul>
            )}
          </Panel>
          {tasks.length > mine.length && <p className="text-xs text-muted">{tasks.length - mine.length} more task{tasks.length - mine.length === 1 ? '' : 's'} for your manager, IT or HR are part of your plan.</p>}
          {toAck.length > 0 && (
            <Panel title="Policies to read and acknowledge">
              <ul className="space-y-1.5 text-sm">{toAck.map((p) => <li key={p.id}><Link className="text-primary hover:underline" href={`/app/${slug}/policies`}>{p.title}</Link> <span className="text-muted">· v{p.version}</span></li>)}</ul>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
