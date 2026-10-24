import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate, formatDateTime } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { colleagueNames } from '@/server/engagement';
import { getMyEmployee } from '@/server/employees';
import { getTicketCategories, helpdeskSatisfaction, listTickets } from '@/server/helpdesk';
import { raiseTicketAction } from './actions';
import { RaiseTicketForm } from './helpdesk-forms';
import { STATUS_LABEL, TICKET_TONE, isOverdue } from './tone';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Helpdesk' };

export default async function HelpdeskPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ view?: string }> }) {
  const { org: slug } = await params;
  const { view } = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'helpdesk');
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const agent = ctx.can('helpdesk.manage', 'org');
  const showAll = view === 'all';
  const [categories, mine, assigned, queue, names, satisfaction] = await Promise.all([
    getTicketCategories(ctx.org.id),
    me ? listTickets(ctx.org.id, { requesterId: me.id }) : Promise.resolve([]),
    me && !agent ? listTickets(ctx.org.id, { assigneeId: me.id, open: true }) : Promise.resolve([]),
    agent ? listTickets(ctx.org.id, { open: !showAll }) : Promise.resolve([]),
    colleagueNames(ctx.org.id),
    agent ? helpdeskSatisfaction(ctx.org.id) : Promise.resolve(null),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const base = `/app/${slug}/helpdesk`;
  const now = new Date().toISOString();

  const table = (rows: typeof mine, caption: string, withPeople: boolean) => (
    <Table caption={caption}>
      <thead><tr><Th>#</Th><Th>Subject</Th>{withPeople && <Th>Requester</Th>}{withPeople && <Th>Assignee</Th>}<Th>Status</Th><Th>{withPeople ? 'Due' : 'Raised'}</Th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={withPeople ? 6 : 4} className="px-4 py-6 text-center text-sm text-muted">No tickets.</td></tr>}
        {rows.map((t) => (
          <tr key={t.id}>
            <Td className="tabular-nums text-muted">{t.number}</Td>
            <Td className="font-medium">
              <Link className="text-primary hover:underline" href={`${base}/${t.id}`}>{t.subject}</Link>
              <span className="block text-xs font-normal text-muted">{categoryName.get(t.category_id) ?? ''} · {t.priority}</span>
            </Td>
            {withPeople && <Td>{names.get(t.requester_id) ?? '—'}</Td>}
            {withPeople && <Td>{t.assignee_id ? (names.get(t.assignee_id) ?? '—') : <span className="text-muted">Unassigned</span>}</Td>}
            <Td>
              <span className="flex flex-wrap gap-1">
                <Badge tone={TICKET_TONE[t.status]}>{withPeople && t.status === 'waiting' ? 'Waiting on requester' : STATUS_LABEL[t.status]}</Badge>
                {withPeople && isOverdue(t, now) && <Badge tone="danger">SLA missed</Badge>}
              </span>
            </Td>
            <Td className="text-muted">{withPeople ? formatDateTime(t.sla_due_at, ctx.org.timezone) : formatDate(t.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader title="Helpdesk" description="Ask HR, payroll or IT for help. Each ticket has a response target set by its priority."
        actions={<>
          <ButtonLink href={`/app/${slug}/knowledge`} variant="secondary">Knowledge base</ButtonLink>
          {agent && <ButtonLink href={`${base}/settings`} variant="secondary">Settings</ButtonLink>}
        </>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {agent && (
            <Card>
              <CardHeader title={showAll ? 'All tickets' : 'Open tickets'}
                actions={<Link className="text-sm text-primary hover:underline" href={showAll ? base : `${base}?view=all`}>{showAll ? 'Show open only' : 'Show all'}</Link>} />
              {table(queue, showAll ? 'All tickets' : 'Open tickets', true)}
              {satisfaction && (
                <p className="border-t border-line px-5 py-3 text-sm text-muted" aria-label="Satisfaction">
                  {satisfaction.responses === 0 ? 'No ratings in the last 90 days.' : <>
                    Satisfaction, last 90 days: <span className="font-semibold text-fg">{satisfaction.average} of 5</span> from {satisfaction.responses} rating{satisfaction.responses === 1 ? '' : 's'}
                    {satisfaction.low > 0 && <> · {satisfaction.low} rated 1 or 2</>}
                  </>}
                </p>
              )}
            </Card>
          )}
          {assigned.length > 0 && <Card><CardHeader title="Assigned to you" />{table(assigned, 'Assigned to you', true)}</Card>}
          {me && <Card><CardHeader title="Your tickets" />{table(mine, 'Your tickets', false)}</Card>}
        </div>
        {me && (
          <Card>
            <CardHeader title="Raise a ticket" description="Check the knowledge base first: many answers are already there." />
            <RaiseTicketForm action={raiseTicketAction.bind(null, slug)} categories={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Card>
        )}
      </div>
    </>
  );
}
