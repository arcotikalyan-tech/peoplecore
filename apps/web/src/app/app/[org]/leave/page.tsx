import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LEAVE_STATUS_LABELS, todayIn, type LeaveStatus } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getBalances, getLeaveSetup, getRequests, namesFor } from '@/server/leave';
import { applyLeaveAction, cancelLeaveAction } from './actions';
import { ApplyLeaveForm, CancelLeave } from './leave-forms';

export const metadata: Metadata = { title: 'Leave' };

const tone: Record<LeaveStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const range = (r: { start_date: string; end_date: string; half_day_start: boolean; half_day_end: boolean }) =>
  `${formatDate(r.start_date)}${r.half_day_start ? ' (pm)' : ''}${r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ''}${r.half_day_end ? ' (am)' : ''}`;

export default async function LeavePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('leave.read')) notFound();
  const today = todayIn(ctx.org.timezone);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const seesOthers = ctx.can('leave.read', 'org') || ctx.can('leave.read', 'team');

  const [balances, mine, others, setup] = await Promise.all([
    me ? getBalances(me.id) : Promise.resolve([]),
    me ? getRequests(ctx.org.id, { employeeId: me.id }) : Promise.resolve([]),
    seesOthers ? getRequests(ctx.org.id, { from: today, to: plusDays(today, 30), excludeEmployeeId: me?.id }) : Promise.resolve([]),
    getLeaveSetup(ctx.org.id),
  ]);
  const typeName = new Map(setup.types.map((t) => [t.id, t.name]));
  const names = await namesFor(ctx.org.id, others.map((r) => r.employee_id));
  const upcomingHolidays = setup.holidays.filter((h) => h.holiday_date >= today).slice(0, 6);
  const activeOthers = others.filter((r) => r.status === 'pending' || r.status === 'approved').sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <>
      <PageHeader
        title="Leave"
        description="Balances, requests and who’s away."
        actions={ctx.can('leave.manage', 'org') && <Link className={buttonClass('secondary')} href={`/app/${slug}/leave/settings`}>Leave settings</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {me && (
            <Card>
              <CardHeader title="Your balances" description="Available = balance minus pending requests." />
              <ul className="grid gap-px bg-line sm:grid-cols-2" aria-label="Balances">
                {balances.map((b) => (
                  <li key={b.leave_type_id} className="bg-surface px-5 py-4">
                    <p className="text-sm text-muted">{b.name}{!b.is_paid && ' (unpaid)'}</p>
                    <p className="text-2xl font-semibold tabular-nums">{b.allow_negative ? '—' : b.available}</p>
                    <p className="text-xs text-muted">
                      {b.allow_negative ? `${-b.balance} taken` : `balance ${b.balance}${b.pending ? `, ${b.pending} pending` : ''}`}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {me && (
            <Card>
              <CardHeader title="Your requests" />
              {mine.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No leave requested yet.</p>
              ) : (
                <Table caption="Your leave requests">
                  <thead><tr><Th>Type</Th><Th>Dates</Th><Th>Days</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.id}>
                        <Td>{typeName.get(r.leave_type_id)}</Td>
                        <Td className="whitespace-nowrap">{range(r)}</Td>
                        <Td className="tabular-nums">{r.days}</Td>
                        <Td><Badge tone={tone[r.status]}>{LEAVE_STATUS_LABELS[r.status]}</Badge></Td>
                        <Td className="text-right">
                          {(r.status === 'pending' || (r.status === 'approved' && r.start_date > today)) && (
                            <CancelLeave action={cancelLeaveAction.bind(null, slug)} requestId={r.id} label={`${typeName.get(r.leave_type_id)} ${range(r)}`} />
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
          {seesOthers && (
            <Card>
              <CardHeader title="Who’s away (next 30 days)" description={ctx.can('leave.read', 'org') ? 'Everyone' : 'Your reporting line'} />
              {activeOthers.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">Nobody has leave booked.</p>
              ) : (
                <ul className="divide-y divide-line" aria-label="Who’s away">
                  {activeOthers.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                      <span><span className="font-medium">{names.get(r.employee_id) ?? 'Someone'}</span> · {typeName.get(r.leave_type_id)}</span>
                      <span className="flex items-center gap-2 text-muted">{range(r)} <Badge tone={tone[r.status]}>{LEAVE_STATUS_LABELS[r.status]}</Badge></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {me && (
            <Card>
              <CardHeader title="Request leave" />
              <ApplyLeaveForm action={applyLeaveAction.bind(null, slug)} today={today}
                types={balances.map((b) => ({ value: b.leave_type_id, label: b.allow_negative ? b.name : `${b.name} (${b.available} available)` }))} />
            </Card>
          )}
          <Card>
            <CardHeader title="Upcoming holidays" />
            {upcomingHolidays.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No holidays scheduled.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {upcomingHolidays.map((h) => (
                  <li key={h.id} className="flex justify-between px-5 py-2.5">
                    <span>{h.name}{h.is_optional && <span className="text-muted"> (optional)</span>}</span>
                    <span className="text-muted">{formatDate(h.holiday_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
