import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { Alert, Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { colleagueOptions } from '@/server/engagement';
import { getMyEmployee } from '@/server/employees';
import { listGrievances } from '@/server/grievances';
import { raiseGrievanceAction } from './actions';
import { RaiseGrievanceForm } from './grievance-forms';
import { CATEGORY_LABEL, OPEN_STATUSES, STATUS_LABEL, STATUS_TONE } from './labels';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Grievances' };

export default async function GrievancesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'grievances');
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const handler = ctx.can('grievance.manage', 'org') || ctx.can('grievance.read', 'org');
  const [cases, colleagues] = await Promise.all([listGrievances(ctx.org.id), me ? colleagueOptions(ctx.org.id, me.id) : Promise.resolve([])]);
  const mine = cases.filter((c) => me && c.reporter_id === me.id);
  const handling = cases.filter((c) => !me || c.reporter_id !== me.id);
  const base = `/app/${slug}/grievances`;
  const now = new Date().getTime();
  const days = (iso: string) => Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));

  return (
    <>
      <PageHeader title="Grievances" description="Raise a concern in confidence. Only the people handling it can read it, and never anyone you name." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {handler && (
            <Card>
              <CardHeader title="Cases" description="Cases you manage or investigate. Cases that name you are never shown to you." />
              <Table caption="Cases">
                <thead><tr><Th>#</Th><Th>Case</Th><Th>Status</Th><Th>Raised</Th></tr></thead>
                <tbody>
                  {handling.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted">No cases.</td></tr>}
                  {handling.map((c) => (
                    <tr key={c.id}>
                      <Td className="tabular-nums text-muted">{c.number}</Td>
                      <Td className="font-medium">
                        <Link className="text-primary hover:underline" href={`${base}/${c.id}`}>{c.subject}</Link>
                        <span className="block text-xs font-normal text-muted">{CATEGORY_LABEL[c.category]}</span>
                      </Td>
                      <Td><Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge></Td>
                      <Td className="text-muted">
                        {formatDate(c.created_at)}
                        {OPEN_STATUSES.includes(c.status) && <span className="block text-xs">{days(c.created_at)} days open</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          {me && (
            <Card>
              <CardHeader title="Your concerns" />
              {mine.length === 0 ? <p className="px-5 py-4 text-sm text-muted">You haven’t raised any.</p> : (
                <ul className="divide-y divide-line" aria-label="Your concerns">
                  {mine.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                      <span>
                        <Link className="font-medium text-primary hover:underline" href={`${base}/${c.id}`}>{c.subject}</Link>
                        <span className="block text-xs text-muted">Case #{c.number} · {formatDate(c.created_at)}</span>
                      </span>
                      <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        {me && (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Raise a concern" />
              <RaiseGrievanceForm action={raiseGrievanceAction.bind(null, slug)} colleagues={colleagues} today={todayIn(ctx.org.timezone)} />
            </Card>
            <Alert title="What happens next">
              HR reviews it and may ask a small group to investigate. You can follow progress and exchange messages here.
              Raising a concern in good faith never counts against you.
            </Alert>
          </div>
        )}
      </div>
    </>
  );
}
