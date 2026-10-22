import { addDays, ATTENDANCE_REQUEST_LABELS, ATTENDANCE_STATUS_LABELS, LEAVE_STATUS_LABELS, type AttendanceStatus } from '@peoplecore/shared';
import { BarChart } from '@/components/ui/charts';
import { cn } from '@/components/ui/cn';
import { Panel, StatCard } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate, formatDateTime } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import { getMyMonth, getPunches, getRegularizations } from '@/server/attendance';
import { attendanceRequests, myRule, regularizationCandidates, regularizationWindow } from '@/server/attendance-ops';
import { bulkRegularizeAction, punchAction, regularizeAction, requestAttendanceAction } from '../actions';
import { AttendanceRequestForm, PunchButton, RegularizeForm, RuleEditor, WorkWeekGrid } from '../attendance-forms';
import { ruleValues } from '../rule-values';
import { BulkRegularizeForm } from '../automation-client';
import { clock, hours, StatusChip } from './status';

interface Me { id: string }
type Month = Awaited<ReturnType<typeof getMyMonth>>;

const statusTone = (s: string) => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : s === 'pending' ? 'warning' : 'neutral') as 'success' | 'danger' | 'warning' | 'neutral';

function monthFigures(month: Month, tz: string) {
  const worked = month.filter((d) => ['present', 'half_day'].includes(d.status));
  const late = worked.filter((d) => d.late_minutes > 0).length;
  const ins = worked.filter((d) => d.first_in).map((d) => {
    const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d.first_in!)).split(':').map(Number);
    return h! * 60 + m!;
  });
  const avgIn = ins.length ? Math.round(ins.reduce((a, b) => a + b, 0) / ins.length) : null;
  const avgWorked = worked.length ? Math.round(worked.reduce((a, d) => a + d.worked_minutes, 0) / worked.length) : 0;
  return {
    present: month.filter((d) => ['present', 'half_day', 'wfh', 'on_duty'].includes(d.status)).length,
    absent: month.filter((d) => d.status === 'absent').length,
    late, punctuality: worked.length ? Math.round(((worked.length - late) / worked.length) * 100) : null,
    avgIn: avgIn === null ? '—' : `${String(Math.floor(avgIn / 60)).padStart(2, '0')}:${String(avgIn % 60).padStart(2, '0')}`,
    avgWorked,
  };
}

/** The employee's own hub: today, the month, and asking for corrections, work from home or on duty. */
export async function MyHub({ ctx, slug, me, today }: { ctx: OrgContext; slug: string; me: Me; today: string }) {
  const tz = ctx.org.timezone;
  const [month, punches, regs, requests, regWindow] = await Promise.all([
    getMyMonth(me.id, today), getPunches(ctx.org.id, me.id, 36), getRegularizations(ctx.org.id, me.id), attendanceRequests(ctx.org.id, { employeeId: me.id }),
    regularizationWindow(ctx.org.id),
  ]);
  const earliest = addDays(today, -regWindow.daysBack);
  const pendingDays = new Set(regs.filter((r) => r.status === 'pending').map((r) => r.work_date));
  const fixable = (await regularizationCandidates(ctx.org.id, me.id, earliest, addDays(today, -1))).filter((d) => !pendingDays.has(d.work_date));
  const time = clock(tz);
  const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const todayPunches = punches.filter((p) => localDate(p.punched_at) === today);
  const todayRow = month.find((d) => d.work_date === today);
  const f = monthFigures(month, tz);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <section aria-label="Today" className="flex flex-wrap items-center gap-5 rounded-xl border border-primary/25 bg-gradient-to-r from-primary-soft to-surface p-5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Today · {formatDate(today)}</p>
            <p className="mt-1 text-lg font-semibold">{todayRow ? ATTENDANCE_STATUS_LABELS[todayRow.status as AttendanceStatus] : 'Not marked yet'}</p>
            <p className="text-sm text-muted">{todayPunches.length ? `Punches: ${todayPunches.map((p) => time(p.punched_at)).join(', ')}` : 'No punches yet today.'}</p>
          </div>
          <PunchButton action={punchAction.bind(null, slug)} label={todayPunches.length % 2 === 0 ? 'Check in' : 'Check out'} />
        </section>
        <section aria-label="This month at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Days present" value={f.present} note="incl. WFH and on duty" tone="success" />
          <StatCard label="Late arrivals" value={f.late} note={f.punctuality === null ? 'no days worked yet' : `${f.punctuality}% on time`} tone="warning" />
          <StatCard label="Average check-in" value={f.avgIn} note="this month" tone="info" />
          <StatCard label="Average worked" value={hours(f.avgWorked)} note="per day worked" tone="primary" />
        </section>
        <Panel title="This month" meta="worked time excludes the shift break" flush>
          <Table caption="Your attendance this month">
            <thead><tr><Th>Day</Th><Th>Status</Th><Th>In</Th><Th>Out</Th><Th>Worked</Th><Th>Late</Th></tr></thead>
            <tbody>
              {month.map((d) => (
                <tr key={d.work_date}>
                  <Td className="whitespace-nowrap">{formatDate(d.work_date)}</Td>
                  <Td><StatusChip status={d.status} />{d.is_regularized && <span className="ml-1 text-xs text-muted">regularized</span>}</Td>
                  <Td className="tabular-nums">{time(d.first_in)}</Td>
                  <Td className="tabular-nums">{time(d.last_out)}</Td>
                  <Td className="tabular-nums">{hours(d.worked_minutes)}</Td>
                  <Td className="tabular-nums">{d.late_minutes ? `${d.late_minutes} min` : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
      <div className="space-y-5">
        <Panel title="Regularize a day" meta={`missed a punch? your manager approves the correction · up to ${regWindow.daysBack} days back${regWindow.monthlyLimit ? ` · ${regWindow.monthlyLimit} a month` : ''}`} flush>
          <RegularizeForm action={regularizeAction.bind(null, slug)} maxDate={today} />
          {regs.length > 0 && (
            <ul className="divide-y divide-line border-t border-line text-sm" aria-label="Your regularizations">
              {regs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <span>{formatDate(r.work_date)} · {[r.check_in?.slice(0, 5), r.check_out?.slice(0, 5)].filter(Boolean).join(' – ')}</span>
                  <Badge tone={statusTone(r.status)}>{LEAVE_STATUS_LABELS[r.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Regularize several days" meta="the same times for each day you pick" flush>
          <BulkRegularizeForm action={bulkRegularizeAction.bind(null, slug)} days={fixable.map((d) => ({
            date: d.work_date,
            label: `${formatDate(d.work_date)} · ${d.punch_count % 2 === 1 ? 'missing punch' : d.status === 'absent' ? 'absent' : d.status === 'half_day' ? 'half day' : `late ${d.late_minutes} min`}`,
          }))} />
        </Panel>
        <Panel title="Work from home or on duty" meta="your manager approves">
          <AttendanceRequestForm action={requestAttendanceAction.bind(null, slug)} minDate={addDays(today, -30)} maxDate={addDays(today, 90)} />
          {requests.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line text-sm" aria-label="Your work-from-home and on-duty requests">
              {requests.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                  <span>{ATTENDANCE_REQUEST_LABELS[r.kind]} · {r.start_date === r.end_date ? formatDate(r.start_date) : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`}</span>
                  <Badge tone={statusTone(r.status)}>{LEAVE_STATUS_LABELS[r.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** A month calendar of the person's own days. */
export async function MyCalendar({ ctx, me, month }: { ctx: OrgContext; me: Me; month: string }) {
  const days = await getMyMonth(me.id, month);
  const byDate = new Map(days.map((d) => [d.work_date, d]));
  const first = `${month.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const cells = [...Array<null>(offset).fill(null), ...Array.from({ length: lastDay }, (_, i) => `${month.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`)];
  const time = clock(ctx.org.timezone);
  return (
    <Panel title="My attendance" meta={new Date(`${first}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}>
      <div className="grid grid-cols-7 gap-2 text-xs" role="grid" aria-label="Attendance calendar">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} role="columnheader" className="pb-1 text-center font-medium text-muted">{d}</div>)}
        {cells.map((d, i) => {
          const row = d ? byDate.get(d) : undefined;
          return (
            <div key={d ?? `pad-${i}`} role="gridcell" className={cn('min-h-20 rounded-lg border p-2', d ? 'border-line bg-subtle/40' : 'border-transparent')}>
              {d && (
                <>
                  <p className="font-semibold">{Number(d.slice(8))}</p>
                  {row && <StatusChip status={row.status} code className="mt-1" />}
                  {row?.first_in && <p className="mt-1 text-[10px] text-muted">{time(row.first_in)}–{time(row.last_out)}</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export async function MyLogs({ ctx, me }: { ctx: OrgContext; me: Me }) {
  const punches = await getPunches(ctx.org.id, me.id, 24 * 30);
  return (
    <Panel title="My punches" meta="last 30 days" flush>
      <Table caption="Your punches">
        <thead><tr><Th>When</Th><Th>How</Th></tr></thead>
        <tbody>
          {[...punches].reverse().map((p) => (
            <tr key={p.id}><Td className="tabular-nums">{formatDateTime(p.punched_at, ctx.org.timezone)}</Td><Td className="capitalize text-muted">{p.method}</Td></tr>
          ))}
          {punches.length === 0 && <tr><Td className="py-6 text-center text-muted">No punches in the last 30 days.</Td></tr>}
        </tbody>
      </Table>
    </Panel>
  );
}

export async function MyRule({ ctx, me, today }: { ctx: OrgContext; me: Me; today: string }) {
  const { shift, week } = await myRule(ctx.org.id, me.id, today);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="My attendance rule" meta="read-only; set by HR">
        {shift ? <RuleEditor readOnly rule={ruleValues(shift)} /> : <p className="text-sm text-muted">No rule applies yet. Ask HR.</p>}
      </Panel>
      <Panel title="My work week" meta={week?.name}>
        {week ? <WorkWeekGrid pattern={week.pattern} /> : <p className="text-sm text-muted">Your holiday calendar’s weekly offs apply.</p>}
      </Panel>
    </div>
  );
}

export async function MyInsights({ ctx, me, today }: { ctx: OrgContext; me: Me; today: string }) {
  const tz = ctx.org.timezone;
  const prev = addDays(`${today.slice(0, 7)}-01`, -1);
  const [thisMonth, lastMonth] = await Promise.all([getMyMonth(me.id, today), getMyMonth(me.id, prev)]);
  const days = [...lastMonth, ...thisMonth].filter((d) => d.work_date >= addDays(today, -29)).sort((a, b) => a.work_date.localeCompare(b.work_date));
  const f = monthFigures(days, tz);
  return (
    <div className="space-y-5">
      <section aria-label="Last 30 days" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Punctuality" value={f.punctuality === null ? '—' : `${f.punctuality}%`} note={`${f.late} late of the days worked`} tone="success" />
        <StatCard label="Average check-in" value={f.avgIn} note="last 30 days" tone="info" />
        <StatCard label="Average worked" value={hours(f.avgWorked)} note="per day worked" tone="primary" />
        <StatCard label="Absences" value={f.absent} note="last 30 days" tone="danger" />
      </section>
      <Panel title="Worked hours" meta="last 30 days">
        <BarChart label="Worked hours per day" data={days.map((d) => ({ label: d.work_date.slice(8), value: Math.round(d.worked_minutes / 6) / 10 }))} format={(n) => (n ? `${n}h` : '')} height={150} empty="No days recorded yet." />
      </Panel>
    </div>
  );
}
