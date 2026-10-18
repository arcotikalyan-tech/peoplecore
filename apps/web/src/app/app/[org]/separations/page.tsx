import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { colleagueNames } from '@/server/engagement';
import { employeeNames, getMyEmployee, managerOptions } from '@/server/employees';
import { clearanceItems, listSeparations, noticePeriods } from '@/server/separations';
import { resignAction, startExitAction } from './actions';
import { STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from './labels';
import { ResignForm, StartExitForm } from './separation-forms';

export const metadata: Metadata = { title: 'Separations' };

export default async function SeparationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const hr = ctx.can('separation.manage', 'org');
  const [all, notice, people] = await Promise.all([
    listSeparations(ctx.org.id),
    noticePeriods(ctx.org.id),
    hr ? managerOptions(ctx.org.id) : Promise.resolve([]),
  ]);
  const mine = all.filter((s) => me && s.employee_id === me.id);
  const others = all.filter((s) => !me || s.employee_id !== me.id);
  const open = (s: { status: string }) => s.status === 'submitted' || s.status === 'approved';
  const items = await clearanceItems(ctx.org.id, others.filter((s) => s.status !== 'cancelled').map((s) => s.id));
  const [names, colleagues] = await Promise.all([employeeNames(ctx.org.id, others.map((s) => s.employee_id)), colleagueNames(ctx.org.id)]);
  const name = (id: string) => names.get(id) ?? colleagues.get(id) ?? 'Employee';
  const today = todayIn(ctx.org.timezone);
  const base = `/app/${slug}/separations`;
  const myNotice = notice.find((n) => n.employment_type === me?.employment_type)?.notice_days ?? 30;
  const noticeEnd = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + myNotice); return d.toISOString().slice(0, 10); })();
  const canResign = !!me && (me.status === 'active') && !mine.some(open);

  return (
    <>
      <PageHeader title="Separations" description="Resignations and exits: notice, approval, clearance and the last working day." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {others.length > 0 || hr ? (
            <Card>
              <CardHeader title={hr ? 'All separations' : 'Separations you’re involved in'} />
              <Table caption="Separations">
                <thead><tr><Th>Employee</Th><Th>Type</Th><Th>Status</Th><Th>Last day</Th><Th>Clearance</Th></tr></thead>
                <tbody>
                  {others.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No separations.</td></tr>}
                  {others.map((s) => {
                    const mineItems = items.filter((i) => i.separation_id === s.id);
                    const done = mineItems.filter((i) => i.status !== 'pending').length;
                    return (
                      <tr key={s.id}>
                        <Td className="font-medium"><Link className="text-primary hover:underline" href={`${base}/${s.id}`}>{name(s.employee_id)}</Link></Td>
                        <Td>{TYPE_LABEL[s.type]}</Td>
                        <Td><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></Td>
                        <Td className="text-muted">{formatDate(s.last_working_day)}</Td>
                        <Td className="tabular-nums text-muted">{mineItems.length ? `${done} of ${mineItems.length}` : '—'}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          ) : null}
          {mine.length > 0 && (
            <Card>
              <CardHeader title="Your separation" />
              <ul className="divide-y divide-line" aria-label="Your separation">
                {mine.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <Link className="font-medium text-primary hover:underline" href={`${base}/${s.id}`}>{TYPE_LABEL[s.type]}, last day {formatDate(s.last_working_day)}</Link>
                    <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {hr && (
            <Card>
              <CardHeader title="Start an exit" description="Termination, retirement, end of contract, or a resignation received outside PeopleCore." />
              <StartExitForm action={startExitAction.bind(null, slug)} today={today} people={people.filter((p) => !me || p.value !== me.id)} />
            </Card>
          )}
          {canResign && (
            <Card>
              <CardHeader title="Resign" description="Your manager approves first, then HR. You can withdraw until it’s approved." />
              <ResignForm action={resignAction.bind(null, slug)} today={today} noticeDays={myNotice} noticeEnd={noticeEnd} />
            </Card>
          )}
          {hr && (
            <Card>
              <CardHeader title="Notice periods" />
              <ul className="divide-y divide-line text-sm" aria-label="Notice periods">
                {notice.map((n) => (
                  <li key={n.employment_type} className="flex justify-between px-5 py-2">
                    <span className="capitalize">{n.employment_type}</span><span className="tabular-nums">{n.notice_days} days</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
