import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import { memberDirectory, myDelegations } from '@/server/approvals';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getInbox } from '@/server/inbox';
import { delegateApprovalsAction, endDelegationAction } from '../approvals/actions';
import { DelegateForm } from '../approvals/approval-forms';
import { completeTaskAction, decideApprovalAction, markNotificationsReadAction } from './actions';
import { ApprovalsPanel, CompleteTask } from './inbox-forms';

export const metadata: Metadata = { title: 'Inbox' };

export default async function InboxPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const today = todayIn(ctx.org.timezone);
  const [{ approvals, notifications, tasks }, delegations, members] = await Promise.all([
    getInbox(ctx.org.id, me?.id ?? null),
    myDelegations(ctx.org.id, ctx.user.id, today),
    memberDirectory(ctx.org.id),
  ]);
  const memberName = new Map(members.map((m) => [m.user_id, m.name]));
  const base = `/app/${slug}`;
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader title="Inbox" description="Approvals waiting for you, your tasks and recent notifications."
        actions={ctx.can('org.manage', 'org') ? <ButtonLink href={`${base}/approvals`} variant="secondary">Approval rules</ButtonLink> : undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Waiting for your approval" description={`${approvals.length}`} />
            <ApprovalsPanel
              action={decideApprovalAction.bind(null, slug)}
              items={approvals.map((a) => ({
                id: a.id,
                summary: a.summary,
                href: a.link ? `${base}${a.link}` : null,
                stepLabel: a.step_label,
                meta: `${humanize(a.subject_type)} · from ${a.requested_by_name} · ${formatDateTime(a.created_at, ctx.org.timezone)}`,
                onBehalfOf: a.via === 'delegation' ? (a.on_behalf_of_name ?? 'a colleague') : null,
                escalated: a.escalated,
              }))}
            />
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
                      <p className="text-sm font-medium">
                        {t.subject_type === 'interview' ? <Link className="hover:underline" href={`${base}/recruitment/interviews`}>{t.title}</Link> : t.title}
                      </p>
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
        <div className="space-y-6">
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
        <Card>
          <CardHeader title="Away? Delegate your approvals"
            description="Requests from your team also go to a colleague for a few days. HR, finance and offer approvals aren’t delegated." />
          {delegations.length > 0 && (
            <ul className="divide-y divide-line border-b border-line" aria-label="Delegations">
              {delegations.map((d) => {
                const mine = d.delegator_user_id === ctx.user.id;
                const other = memberName.get(mine ? d.delegate_user_id : d.delegator_user_id) ?? 'a colleague';
                return (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      <span className="font-medium">{mine ? `To ${other}` : `From ${other}`}</span>
                      <span className="block text-xs text-muted">{formatDate(d.starts_on)} – {formatDate(d.ends_on)}{d.note ? ` · ${d.note}` : ''}</span>
                    </span>
                    {mine && (
                      <ActionForm action={endDelegationAction.bind(null, slug)} label={`End delegation to ${other}`} submit="End"
                        hidden={{ delegationId: d.id }} variant="ghost" size="sm" className="inline-flex items-center gap-2" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <DelegateForm action={delegateApprovalsAction.bind(null, slug)} today={today}
            people={members.filter((m) => m.user_id !== ctx.user.id).map((m) => ({ value: m.user_id, label: m.name }))} />
        </Card>
        </div>
      </div>
    </>
  );
}
