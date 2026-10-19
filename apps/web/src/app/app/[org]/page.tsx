import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowRight, BarChart3, Briefcase, CalendarDays, Clock, CreditCard, GraduationCap, LifeBuoy, Megaphone, Receipt, Sparkles,
  TreePalm, Trophy, UserPlus, Users, Wallet,
} from 'lucide-react';
import { addDays, legalName, todayIn } from '@peoplecore/shared';
import { Avatar } from '@/components/ui/avatar';
import { ButtonLink } from '@/components/ui/button';
import { BarChart, SplitBar } from '@/components/ui/charts';
import { cn } from '@/components/ui/cn';
import { Alert, EmptyState } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getPunches } from '@/server/attendance';
import { getOrgContext } from '@/server/context';
import {
  attendanceToday, exitsSince, headcountTrend, myWork, needsAttention, payrollTrend, upcomingHolidays,
} from '@/server/dashboard';
import { listAnnouncements } from '@/server/engagement';
import { countEmployees, getMyEmployee, probationDue, upcomingJoiners } from '@/server/employees';
import { getBalances } from '@/server/leave';
import { getPayslips } from '@/server/payroll';
import { getStructure } from '@/server/structure';
import { viewModeFor } from '@/server/view';
import { punchAction } from './attendance/actions';
import { PunchButton } from './attendance/attendance-forms';

export const metadata: Metadata = { title: 'Dashboard' };

const inr = (n: number) => `₹${n >= 1e7 ? `${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(2)} L` : n.toLocaleString('en-IN')}`;
const RUN_STATUS: Record<string, string> = { draft: 'Draft', computed: 'Computed, to approve', approved: 'Approved, to lock', locked: 'Locked' };

export default async function Dashboard({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const orgId = ctx.org.id;
  const base = `/app/${slug}`;
  const tz = ctx.org.timezone;
  const today = todayIn(tz);
  const in30 = addDays(today, 30);
  const view = await viewModeFor(ctx);
  const admin = view === 'admin';
  const seesPeople = admin && (ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team'));
  const seesPayroll = admin && (ctx.can('payroll.prepare', 'org') || ctx.can('payroll.approve', 'org'));
  const seesAttendance = admin && (ctx.can('attendance.read', 'org') || ctx.can('attendance.read', 'team'));

  const me = await getMyEmployee(orgId, ctx.user.id);
  const [work, attention, workforce, trend, pay, presence, exits, holidays, announcements, punches, balances, payslips, structure] = await Promise.all([
    myWork(orgId, me?.id ?? null, today),
    needsAttention(ctx, today),
    seesPeople
      ? Promise.all([
          countEmployees(orgId, { status: 'active' }),
          countEmployees(orgId, { status: 'pre_joining' }),
          countEmployees(orgId, { status: 'on_notice' }),
          countEmployees(orgId, { probationEndsBetween: [today, in30] }),
          upcomingJoiners(orgId),
          probationDue(orgId, today, in30),
        ])
      : null,
    seesPeople ? headcountTrend(orgId, today) : null,
    seesPayroll ? payrollTrend(orgId, today) : null,
    seesAttendance ? attendanceToday(orgId, today) : null,
    seesPeople ? exitsSince(orgId, addDays(today, -30), today) : null,
    upcomingHolidays(orgId, today, 8),
    listAnnouncements(orgId, me?.id ?? null).catch(() => []),
    me ? getPunches(orgId, me.id, 36) : [],
    !admin && me ? getBalances(me.id).catch(() => []) : [],
    !admin && me ? getPayslips(orgId, me.id).catch(() => []) : [],
    admin && ctx.can('org.manage') ? getStructure(orgId) : null,
  ]);

  const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const todayPunches = punches.filter((p) => localDate(p.punched_at) === today);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = me?.first_name ?? null;
  const headcount = workforce?.[0] ?? null;
  const attrition = headcount && exits !== null ? (exits / headcount) * 100 : null;
  const seenHolidays = new Set<string>();
  const nextHolidays = holidays.filter((h) => !seenHolidays.has(h.holiday_date + h.name) && seenHolidays.add(h.holiday_date + h.name)).slice(0, 4);
  const liveAnnouncements = announcements.filter((a) => !a.expires_at || a.expires_at >= today).slice(0, 3);

  // A plain-language summary of what needs doing today, built from the same counts as the cards.
  const summary = [
    work.approvals ? `${work.approvals} approval${work.approvals === 1 ? '' : 's'} waiting for you` : null,
    work.tasks ? `${work.tasks} open task${work.tasks === 1 ? '' : 's'}` : null,
    presence && presence.onLeave ? `${presence.onLeave} on leave today` : null,
    presence && presence.late ? `${presence.late} late today` : null,
    attention.latestRun && attention.latestRun.status !== 'locked' ? `payroll for ${monthName(attention.latestRun.period_month)} is ${RUN_STATUS[attention.latestRun.status]?.toLowerCase()}` : null,
    workforce && workforce[3] ? `${workforce[3]} probation review${workforce[3] === 1 ? '' : 's'} due within 30 days` : null,
  ].filter(Boolean);

  const quick = [
    { href: `${base}/attendance`, label: 'Attendance', icon: Clock, show: ctx.can('attendance.read') },
    { href: `${base}/leave`, label: 'Leave', icon: TreePalm, show: ctx.can('leave.read') },
    { href: seesPayroll ? `${base}/payroll` : `${base}/payslips`, label: seesPayroll ? 'Payroll' : 'Payslips', icon: seesPayroll ? Wallet : Receipt, show: true },
    { href: `${base}/employees`, label: 'People', icon: Users, show: ctx.can('employee.read') },
    { href: `${base}/expenses`, label: 'Expenses', icon: CreditCard, show: true },
    { href: `${base}/performance`, label: 'Performance', icon: Trophy, show: ctx.can('performance.read') },
    { href: `${base}/recruitment`, label: 'Hiring', icon: Briefcase, show: admin && ctx.can('recruitment.read') },
    { href: `${base}/learning`, label: 'Learning', icon: GraduationCap, show: true },
    { href: `${base}/helpdesk`, label: 'Helpdesk', icon: LifeBuoy, show: true },
    { href: `${base}/insights`, label: 'Insights', icon: BarChart3, show: seesPeople },
  ].filter((q) => q.show).slice(0, 8);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="mt-1 text-sm text-muted">
            {formatDate(today)} · {ctx.org.name}{headcount !== null ? ` · ${headcount.toLocaleString('en-IN')} active employees` : ''}
          </p>
        </header>

        {structure && structure.departments.length === 0 && (
          <Alert tone="info" title="Set up your organization">
            Add departments, designations and locations first, so new employees can be placed correctly.{' '}
            <Link href={`${base}/structure`} className="font-medium text-primary hover:underline">Open organization setup →</Link>
          </Alert>
        )}

        <section aria-label="Today" className="flex items-start gap-3 rounded-xl border border-primary/25 bg-gradient-to-r from-primary-soft to-surface px-4 py-3.5">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-fg"><Sparkles className="size-4" /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Today</p>
            <p className="mt-0.5 text-sm">{summary.length ? `${capitalise(summary.join(' · '))}.` : 'You’re all caught up. Nothing is waiting for you.'}</p>
          </div>
          {work.approvals ? <ButtonLink href={`${base}/inbox`} size="sm" className="ml-auto hidden sm:inline-flex">Review <ArrowRight className="size-3.5" /></ButtonLink> : null}
        </section>

        {admin && seesPeople && (
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
            <Kpi label="Headcount" value={headcount?.toLocaleString('en-IN') ?? '—'} note="active employees" tone="primary" href={`${base}/employees?status=active`} />
            {pay && <Kpi label="Monthly payroll" value={pay.latest ? inr(Number(pay.latest.total_net)) : '—'} note={pay.latest ? `${monthName(pay.latest.period_month)} · net payout` : 'no locked run yet'} tone="success" href={`${base}/payroll`} />}
            {presence && <Kpi label="Present today" value={presence.present === null ? '—' : String(presence.present)} note={headcount ? `of ${headcount.toLocaleString('en-IN')} · ${presence.late ?? 0} late` : 'clocked in'} tone="info" href={`${base}/attendance`} />}
            <Kpi label="Attrition (30 days)" value={attrition === null ? '—' : `${attrition.toFixed(1)}%`} note={`${exits ?? 0} exits / headcount`} tone="warning" />
            <Kpi label="Joining soon" value={String(workforce?.[1] ?? '—')} note={`${workforce?.[2] ?? 0} on notice`} tone="accent" href={`${base}/employees?status=pre_joining`} />
          </section>
        )}

        <section aria-label="Needs your attention" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Waiting for your approval" value={work.approvals} href={`${base}/inbox`} />
          <Stat label="Your open tasks" value={work.tasks} href={`${base}/inbox`} />
          {admin && attention.openTickets !== undefined && (
            <Stat label="Open helpdesk tickets" value={attention.openTickets} href={`${base}/helpdesk`}
              note={attention.breachedTickets ? `${attention.breachedTickets} past their SLA` : undefined} />
          )}
          {admin && attention.openSeparations !== undefined && <Stat label="Exits in progress" value={attention.openSeparations} href={`${base}/separations`} />}
          {admin && attention.overdueTraining !== undefined && <Stat label="Overdue training" value={attention.overdueTraining} href={`${base}/learning`} />}
          {admin && attention.settlementsToApprove !== undefined && attention.settlementsToApprove !== 0 && (
            <Stat label="Settlements to approve" value={attention.settlementsToApprove} href={`${base}/separations`} />
          )}
          {admin && attention.latestRun !== undefined && (
            <Stat label={attention.latestRun ? `Payroll, ${monthName(attention.latestRun.period_month)}` : 'Payroll'}
              value={attention.latestRun ? (RUN_STATUS[attention.latestRun.status] ?? attention.latestRun.status) : 'No runs yet'} href={`${base}/payroll`} />
          )}
        </section>

        {(trend || pay) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {trend && (
              <Panel title="Headcount trend" meta="6 months">
                <BarChart label="Headcount at each month end" data={trend} />
              </Panel>
            )}
            {pay && (
              <Panel title="Payroll spend" meta="net, locked runs">
                <BarChart label="Net payroll by month" data={pay.months} format={(n) => (n ? inr(n) : '—')} empty="No locked payroll run in the last 6 months." />
              </Panel>
            )}
          </div>
        )}

        {presence && (
          <Panel title="Attendance today" meta={formatDate(today)} action={<Link href={`${base}/attendance`} className="text-sm font-medium text-primary hover:underline">Open</Link>}>
            <SplitBar label="Attendance today" parts={[
              { label: 'Present', value: presence.present ?? 0, tone: 'success' },
              { label: 'Late', value: presence.late ?? 0, tone: 'warning' },
              { label: 'On leave', value: presence.onLeave ?? 0, tone: 'info' },
              { label: 'Absent', value: presence.absent ?? 0, tone: 'danger' },
              { label: 'Not marked', value: Math.max(0, (headcount ?? 0) - (presence.present ?? 0) - (presence.onLeave ?? 0) - (presence.absent ?? 0)), tone: 'muted' },
            ]} />
          </Panel>
        )}

        {!admin && me && balances.length > 0 && (
          <Panel title="My leave balance" action={<Link href={`${base}/leave`} className="text-sm font-medium text-primary hover:underline">Apply leave</Link>}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {balances.slice(0, 8).map((b) => (
                <li key={b.leave_type_id} className="rounded-lg border border-line bg-subtle/50 p-3">
                  <p className="truncate text-xs text-muted">{b.name}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{b.available}</p>
                  {b.pending > 0 && <p className="text-xs text-warning">{b.pending} pending</p>}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {!admin && payslips[0] && (
          <Panel title="Latest payslip" meta={monthName(payslips[0].period_month)} action={<Link href={`${base}/payslips/${payslips[0].run_id}`} className="text-sm font-medium text-primary hover:underline">View</Link>}>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-muted">Gross</p><p className="mt-1 text-lg font-semibold tabular-nums">{inr(Number(payslips[0].gross))}</p></div>
              <div><p className="text-xs text-muted">Deductions</p><p className="mt-1 text-lg font-semibold tabular-nums">{inr(Number(payslips[0].deductions))}</p></div>
              <div><p className="text-xs text-muted">Net pay</p><p className="mt-1 text-lg font-semibold tabular-nums text-success">{inr(Number(payslips[0].net))}</p></div>
            </div>
          </Panel>
        )}

        {workforce && (
          <>
            {!ctx.can('employee.read', 'org') && <p className="text-sm text-muted">Figures include only the people in your reporting line.</p>}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Upcoming joiners" meta="by joining date" flush>
                <PeopleList base={base} empty="No upcoming joiners."
                  rows={workforce[4].map((e) => ({ id: e.id, name: legalName(e), meta: `Joins ${formatDate(e.date_of_joining)}` }))} />
              </Panel>
              <Panel title="Probation reviews due" meta="next 30 days" flush>
                <PeopleList base={base} empty="No probation reviews due in the next 30 days."
                  rows={workforce[5].map((e) => ({ id: e.id, name: legalName(e), meta: `Ends ${formatDate(e.probation_end_date)}` }))} />
              </Panel>
            </div>
          </>
        )}

        <Panel title="Quick access">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {quick.map((q) => (
              <li key={q.href}>
                <Link href={q.href} className="lift group flex flex-col items-center gap-2 rounded-xl border border-line bg-subtle/40 px-3 py-4 text-sm font-medium hover:border-primary/40 hover:bg-primary-soft">
                  <span className="grid size-10 place-items-center rounded-xl bg-surface text-primary ring-1 ring-line group-hover:ring-primary/30"><q.icon className="size-5" /></span>
                  {q.label}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        {!workforce && !me && (
          <Panel title="Nothing to show yet">
            <EmptyState title="Nothing to show yet" description="Your HR team hasn’t linked an employee profile to your account." />
          </Panel>
        )}
      </div>

      <aside className="space-y-4" aria-label="At a glance">
        {me && (
          <section className="lift-soft rounded-xl border border-line bg-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Work hours</p>
            <p className="mt-1 text-sm text-muted">
              {todayPunches.length ? `Punches today: ${todayPunches.map((p) => time(p.punched_at)).join(', ')}` : 'You haven’t checked in today.'}
            </p>
            <div className="mt-3 [&_button]:w-full">
              <PunchButton action={punchAction.bind(null, slug)} label={todayPunches.length % 2 === 0 ? 'Check in' : 'Check out'} />
            </div>
          </section>
        )}

        <RailCard title="Announcements" icon={<Megaphone className="size-4" />} href={`${base}/engagement`}>
          {liveAnnouncements.length === 0 ? <p className="text-sm text-muted">No announcements yet.</p> : (
            <ul className="space-y-3">
              {liveAnnouncements.map((a) => (
                <li key={a.id}>
                  <p className="line-clamp-1 text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted">{formatDate(a.published_at)}{a.requires_ack && !a.acknowledgedAt ? ' · needs your acknowledgement' : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </RailCard>

        <RailCard title="Holidays" icon={<CalendarDays className="size-4" />} href={`${base}/leave`}>
          {nextHolidays.length === 0 ? <p className="text-sm text-muted">No upcoming holidays.</p> : (
            <ul className="space-y-2.5">
              {nextHolidays.map((h) => (
                <li key={h.id} className="flex items-center gap-3">
                  <span className="grid w-11 shrink-0 rounded-lg border border-line bg-subtle py-1 text-center leading-tight">
                    <span className="text-[10px] font-semibold uppercase text-primary">{new Date(`${h.holiday_date}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
                    <span className="text-sm font-semibold">{Number(h.holiday_date.slice(8, 10))}</span>
                  </span>
                  <span className="min-w-0 text-sm"><span className="block truncate font-medium">{h.name}</span>{h.is_optional && <span className="text-xs text-muted">Optional</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </RailCard>

        {me && work.training.length > 0 && (
          <RailCard title="Your training" icon={<GraduationCap className="size-4" />} href={`${base}/learning`}>
            <ul className="space-y-2.5" aria-label="Your training">
              {work.training.map((t) => (
                <li key={t.id} className="text-sm">
                  <p className="truncate font-medium">{t.title}{t.mandatory && <span className="ml-2 text-xs text-muted">Mandatory</span>}</p>
                  <p className={cn('text-xs', t.overdue ? 'font-medium text-danger' : 'text-muted')}>{t.dueOn ? `${t.overdue ? 'Overdue since' : 'Due'} ${formatDate(t.dueOn)}` : 'No due date'}</p>
                </li>
              ))}
            </ul>
          </RailCard>
        )}

        {me && (
          <RailCard title="My profile" icon={<UserPlus className="size-4" />} href={`${base}/employees/${me.id}`}>
            <div className="flex items-center gap-3">
              <Avatar name={legalName(me)} />
              <p className="min-w-0 text-sm"><span className="block truncate font-medium">{legalName(me)}</span><span className="text-muted">{me.employee_code}</span></p>
            </div>
          </RailCard>
        )}
      </aside>
    </div>
  );
}

function monthName(iso: string) {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const KPI_TONES = {
  primary: 'text-primary', success: 'text-success', info: 'text-info', warning: 'text-warning', accent: 'text-accent',
} as const;

function Kpi({ label, value, note, tone, href }: { label: string; value: string; note: string; tone: keyof typeof KPI_TONES; href?: string }) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', KPI_TONES[tone])}>{value}</p>
      <p className="mt-1 truncate text-xs text-muted">{note}</p>
    </>
  );
  const cls = 'lift block rounded-xl border border-line bg-surface p-4';
  return href ? <Link href={href} className={cn(cls, 'hover:border-line-strong')}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Stat({ label, value, href, note }: { label: string; value: number | string | null; href?: string; note?: string }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn('mt-1.5 font-semibold tabular-nums tracking-tight', typeof value === 'string' ? 'text-base' : 'text-2xl')}>
        {value === null ? '—' : typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </p>
      {note && <p className="mt-1 text-xs font-medium text-danger">{note}</p>}
    </>
  );
  const cls = 'lift rounded-xl border border-line bg-surface p-4';
  return href ? <Link href={href} className={cn(cls, 'transition-colors hover:border-line-strong')}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Panel({ title, meta, action, flush, children }: { title: string; meta?: string; action?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <section className="lift-soft rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h2 className="text-sm font-semibold">{title}{meta && <span className="ml-2 font-normal text-muted">{meta}</span>}</h2>
        {action}
      </header>
      <div className={flush ? 'pb-2' : 'px-5 pb-5 pt-3'}>{children}</div>
    </section>
  );
}

function RailCard({ title, icon, href, children }: { title: string; icon: ReactNode; href: string; children: ReactNode }) {
  return (
    <section className="lift-soft rounded-xl border border-line bg-surface p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="text-primary">{icon}</span>{title}</h2>
        <Link href={href} className="text-xs font-medium text-muted hover:text-fg">View all</Link>
      </header>
      {children}
    </section>
  );
}

function PeopleList({ rows, base, empty }: { rows: Array<{ id: string; name: string; meta: string }>; base: string; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`${base}/employees/${r.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-subtle">
            <Avatar name={r.name} size="sm" />
            <span className="flex-1 truncate font-medium">{r.name}</span>
            <span className="text-muted">{r.meta}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
