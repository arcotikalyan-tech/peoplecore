import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getInbox } from '@/server/inbox';
import { completeTaskAction, decideApprovalAction, markNotificationsReadAction } from './actions';
import { ApprovalDecision, CompleteTask } from './inbox-forms';

export const metadata: Metadata = { title: 'Inbox' };

export default async function InboxPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const { approvals, notifications, tasks } = await getInbox(ctx.org.id, me?.id ?? null);
  const base = `/app/${slug}`;
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader title="Inbox" description="Approvals waiting for you, your tasks and recent notifications." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Waiting for your approval" description={`${approvals.length}`} />
            {approvals.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Nothing to approve.</p>
            ) : (
              <ul className="divide-y divide-line" aria-label="Approvals">
                {approvals.map((a) => (
                  <li key={a.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">
                        {a.link ? <Link className="hover:underline" href={`${base}${a.link}`}>{a.summary}</Link> : a.summary}
                      </p>
                      <Badge>{a.step_label}</Badge>
                    </div>
                    <p className="text-xs text-muted">{humanize(a.subject_type)} · from {a.requested_by_name} · {formatDateTime(a.created_at, ctx.org.timezone)}</p>
                    <ApprovalDecision action={decideApprovalAction.bind(null, slug)} requestId={a.id} summary={a.summary} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Your tasks" description={`${tasks.length} open`} />
            {tasks.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No open tasks.</p>
            ) : (
              <ul className="divide-y divide-line" aria-label="Tasks">
                {tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">{t.title}</p>
                      {t.details && <p className="text-xs text-muted">{t.details}</p>}
                      {t.due_on && <p className="text-xs text-muted">Due {formatDate(t.due_on)}</p>}
                    </div>
                    <CompleteTask action={completeTaskAction.bind(null, slug)} taskId={t.id} title={t.title} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader
            title="Notifications"
            description={unread ? `${unread} unread` : 'All caught up'}
            actions={unread > 0 && (
              <form action={markNotificationsReadAction.bind(null, slug)}>
                <button className="text-sm font-medium text-primary hover:underline">Mark all read</button>
              </form>
            )}
          />
          {notifications.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No notifications yet.</p>
          ) : (
            <ul className="divide-y divide-line" aria-label="Notifications">
              {notifications.map((n) => (
                <li key={n.id} className={`px-5 py-3 text-sm ${n.read_at ? '' : 'bg-primary-soft/40'}`}>
                  <p className="font-medium">{n.link ? <Link className="hover:underline" href={`${base}${n.link}`}>{n.title}</Link> : n.title}</p>
                  {n.body && <p className="text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-muted">{formatDateTime(n.created_at, ctx.org.timezone)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
