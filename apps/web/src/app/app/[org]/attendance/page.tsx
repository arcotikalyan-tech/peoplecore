import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ATTENDANCE_STATUS_LABELS, LEAVE_STATUS_LABELS, todayIn, type AttendanceStatus } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate, humanize } from '@/lib/format';
import { getDays, getMyMonth, getOpenAnomalies, getPunches, getRegularizations } from '@/server/attendance';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { namesFor } from '@/server/leave';
import { punchAction, regularizeAction, reviewAnomalyAction } from './actions';
import { PunchButton, RegularizeForm, ReviewAnomaly } from './attendance-forms';

export const metadata: Metadata = { title: 'Attendance' };

const tone: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'primary'> = {
  present: 'success', half_day: 'warning', absent: 'danger', on_leave: 'primary', weekly_off: 'neutral', holiday: 'neutral', not_marked: 'neutral',
};

export default async function AttendancePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('attendance.read')) notFound();
  const tz = ctx.org.timezone;
  const today = todayIn(tz);
  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
  const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const hours = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');

  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const seesTeam = ctx.can('attendance.read', 'org') || ctx.can('attendance.read', 'team');
  const reviews = ctx.can('attendance.manage', 'org') || ctx.can('attendance.approve');
  const [month, punches, regs, team, anomalies] = await Promise.all([
    me ? getMyMonth(me.id, today) : Promise.resolve([]),
    me ? getPunches(ctx.org.id, me.id, 36) : Promise.resolve([]),
    me ? getRegularizations(ctx.org.id, me.id) : Promise.resolve([]),
    seesTeam ? getDays(ctx.org.id, { from: today, to: today }) : Promise.resolve([]),
    reviews ? getOpenAnomalies(ctx.org.id) : Promise.resolve([]),
  ]);
  const todayPunches = punches.filter((p) => localDate(p.punched_at) === today);
  const teamToday = team.filter((d) => d.employee_id !== me?.id);
  const names = await namesFor(ctx.org.id, [...teamToday.map((d) => d.employee_id), ...anomalies.map((a) => a.employee_id)]);
  const todayRow = month.find((d) => d.work_date === today);

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Check in and out, your month, and corrections."
        actions={
          <div className="flex gap-2">
            {ctx.can('attendance.read', 'org') && <Link className={buttonClass('secondary')} href={`/app/${slug}/attendance/summary`}>Monthly summary</Link>}
            {ctx.can('attendance.manage', 'org') && <Link className={buttonClass('secondary')} href={`/app/${slug}/attendance/settings`}>Settings</Link>}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {me && (
            <Card>
              <CardHeader title="Today" description={formatDate(today)} />
              <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <DetailList items={[
                  { label: 'Status', value: todayRow ? ATTENDANCE_STATUS_LABELS[todayRow.status] : 'Not marked yet' },
                  { label: 'Punches', value: todayPunches.length ? todayPunches.map((p) => time(p.punched_at)).join(', ') : 'None yet' },
                ]} />
                <PunchButton action={punchAction.bind(null, slug)} label={todayPunches.length % 2 === 0 ? 'Check in' : 'Check out'} />
              </div>
            </Card>
          )}
          {me && (
            <Card>
              <CardHeader title="This month" description="Worked time excludes the shift break." />
              <Table caption="Your attendance this month">
                <thead><tr><Th>Day</Th><Th>Status</Th><Th>In</Th><Th>Out</Th><Th>Worked</Th><Th>Late</Th></tr></thead>
                <tbody>
                  {month.map((d) => (
                    <tr key={d.work_date}>
                      <Td className="whitespace-nowrap">{formatDate(d.work_date)}</Td>
                      <Td>
                        <Badge tone={tone[d.status]}>{ATTENDANCE_STATUS_LABELS[d.status]}</Badge>
                        {d.is_regularized && <span className="ml-1 text-xs text-muted">regularized</span>}
                      </Td>
                      <Td className="tabular-nums">{time(d.first_in)}</Td>
                      <Td className="tabular-nums">{time(d.last_out)}</Td>
                      <Td className="tabular-nums">{hours(d.worked_minutes)}</Td>
                      <Td className="tabular-nums">{d.late_minutes ? `${d.late_minutes} min` : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          {seesTeam && (
            <Card>
              <CardHeader title="Team today" description={ctx.can('attendance.read', 'org') ? 'Everyone' : 'Your reporting line'} />
              {teamToday.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No attendance recorded for others today yet.</p>
              ) : (
                <ul className="divide-y divide-line" aria-label="Team today">
                  {teamToday.map((d) => (
                    <li key={d.employee_id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                      <span className="font-medium">{names.get(d.employee_id) ?? 'Someone'}</span>
                      <span className="flex items-center gap-2 text-muted">{time(d.first_in)} <Badge tone={tone[d.status]}>{ATTENDANCE_STATUS_LABELS[d.status]}</Badge></span>
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
              <CardHeader title="Regularize a day" description="Missed a punch? Your manager approves the correction." />
              <RegularizeForm action={regularizeAction.bind(null, slug)} maxDate={today} />
              {regs.length > 0 && (
                <ul className="divide-y divide-line border-t border-line text-sm" aria-label="Your regularizations">
                  {regs.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                      <span>{formatDate(r.work_date)} · {[r.check_in?.slice(0, 5), r.check_out?.slice(0, 5)].filter(Boolean).join(' – ')}</span>
                      <Badge tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : r.status === 'pending' ? 'warning' : 'neutral'}>{LEAVE_STATUS_LABELS[r.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {reviews && (
            <Card>
              <CardHeader title="To review" description="Flags are evidence to check, never proof on their own." />
              {anomalies.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">Nothing flagged.</p>
              ) : (
                <ul className="divide-y divide-line" aria-label="Flags">
                  {anomalies.map((a) => (
                    <li key={a.id} className="space-y-1 px-5 py-3 text-sm">
                      <p><span className="font-medium">{names.get(a.employee_id) ?? 'Someone'}</span> · {humanize(a.rule)}</p>
                      <p className="text-muted">{a.explanation}</p>
                      {a.employee_id !== me?.id && <ReviewAnomaly action={reviewAnomalyAction.bind(null, slug)} flagId={a.id} label={`${names.get(a.employee_id) ?? ''} ${humanize(a.rule)}`} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
