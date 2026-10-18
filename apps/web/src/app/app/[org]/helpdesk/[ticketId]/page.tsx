import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { formatDateTime } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { colleagueNames, colleagueOptions } from '@/server/engagement';
import { getMyEmployee } from '@/server/employees';
import { getTicket, getTicketCategories, ticketThread } from '@/server/helpdesk';
import { replyTicketAction, updateTicketAction } from '../actions';
import { ReplyForm, UpdateTicketForm } from '../helpdesk-forms';
import { STATUS_LABEL, TICKET_TONE, isOverdue } from '../tone';

export const metadata: Metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: { params: Promise<{ org: string; ticketId: string }> }) {
  const { org: slug, ticketId } = await params;
  const ctx = await getOrgContext(slug);
  const ticket = /^[0-9a-f-]{36}$/i.test(ticketId) ? await getTicket(ctx.org.id, ticketId) : null;
  if (!ticket) notFound();
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const helpdesk = ctx.can('helpdesk.manage', 'org');
  const isAssignee = !!me && ticket.assignee_id === me.id;
  const isRequester = !!me && ticket.requester_id === me.id;
  const agent = helpdesk || isAssignee;
  const [thread, names, categories, assignees] = await Promise.all([
    ticketThread(ticket.id),
    colleagueNames(ctx.org.id),
    getTicketCategories(ctx.org.id, true),
    helpdesk ? colleagueOptions(ctx.org.id) : Promise.resolve(null),
  ]);
  const closed = ticket.status === 'closed';
  const now = new Date().toISOString();
  const tz = ctx.org.timezone;

  return (
    <>
      <PageHeader eyebrow={`Ticket #${ticket.number}`} title={ticket.subject}
        actions={<span className="flex flex-wrap gap-2">
          <Badge tone={TICKET_TONE[ticket.status]}>{agent && ticket.status === 'waiting' ? 'Waiting on requester' : STATUS_LABEL[ticket.status]}</Badge>
          {agent && isOverdue(ticket, now) && <Badge tone="danger">SLA missed</Badge>}
        </span>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Conversation" />
          <div className="whitespace-pre-line border-b border-line px-5 py-4 text-sm leading-6">{ticket.description}</div>
          <ol className="divide-y divide-line" aria-label="Replies">
            {thread.map((c) => (
              <li key={c.id} className={c.internal ? 'bg-warning-soft px-5 py-3 text-sm' : 'px-5 py-3 text-sm'}>
                <p className="text-xs text-muted">
                  <span className="font-medium text-fg">{c.mine ? 'You' : c.author_name}</span> · {formatDateTime(c.created_at, tz)}
                  {c.internal && <> · <span className="font-medium text-warning">Internal note</span></>}
                </p>
                <p className="mt-1 whitespace-pre-line">{c.body}</p>
              </li>
            ))}
          </ol>
          {closed
            ? <p className="border-t border-line px-5 py-4 text-sm text-muted">This ticket is closed. Raise a new one if you still need help.</p>
            : (agent || isRequester) && <ReplyForm action={replyTicketAction.bind(null, slug)} ticketId={ticket.id} agent={agent} />}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <DetailList items={[
              { label: 'Requester', value: names.get(ticket.requester_id) ?? (isRequester ? 'You' : null) },
              { label: 'Category', value: categories.find((c) => c.id === ticket.category_id)?.name },
              { label: 'Priority', value: ticket.priority },
              { label: 'Assignee', value: ticket.assignee_id ? names.get(ticket.assignee_id) : 'Helpdesk staff' },
              { label: 'Raised', value: formatDateTime(ticket.created_at, tz) },
              { label: 'Response due', value: formatDateTime(ticket.sla_due_at, tz) },
            ]} />
          </Card>
          {agent && !closed && (
            <Card>
              <CardHeader title="Update" />
              <UpdateTicketForm action={updateTicketAction.bind(null, slug)} ticketId={ticket.id} status={ticket.status} priority={ticket.priority}
                assigneeId={ticket.assignee_id} assignees={assignees} />
            </Card>
          )}
          {isRequester && !agent && !closed && (
            <Card>
              <CardHeader title="Sorted?" description="Close the ticket if you no longer need help." />
              <div className="px-5 py-4">
                <ActionForm action={updateTicketAction.bind(null, slug)} label="Close ticket" submit="Close ticket" hidden={{ ticketId: ticket.id, status: 'closed' }}
                  variant="secondary" size="sm" className="flex flex-wrap items-center gap-3" />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
