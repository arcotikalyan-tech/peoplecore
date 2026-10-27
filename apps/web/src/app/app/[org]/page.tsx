import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { addDays, todayIn } from '@peoplecore/shared';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/surface';
import { getMyMonth, getPunches } from '@/server/attendance';
import { myRule } from '@/server/attendance-ops';
import { orgControls } from '@/server/modules';
import { getOrgContext } from '@/server/context';
import {
  attendanceSnapshot, averagePresence, complianceStatus, exitsSince, headcountTrend, myWork, needsAttention, payrollActivity, payrollTrend,
  upcomingBirthdays, upcomingHolidays,
} from '@/server/dashboard';
import { listAnnouncements } from '@/server/engagement';
import { countEmployees, getMyEmployee } from '@/server/employees';
import { ProfileChecklist } from '@/components/profile-checklist';
import { createClient } from '@/server/supabase';
import { profileProgress, type Completeness } from '@/lib/profile-checklist';
import { getBalances } from '@/server/leave';
import { orgSetup } from '@/server/setup';
import { viewModeFor } from '@/server/view';
import { punchAction } from './attendance/actions';
import { PunchButton } from './attendance/attendance-forms';
import { DismissInsight, QuickAccess, type QuickTile } from './dashboard-client';
import { SetupCard } from './setup/checklist';

export const metadata: Metadata = { title: 'Dashboard' };

const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `₹${Math.round(n / 1e3)}K` : `₹${n.toLocaleString('en-IN')}`);
const RUN_STATUS: Record<string, string> = { draft: 'Draft', computed: 'Computed', approved: 'Approved', locked: 'Locked' };

/**
 * The dashboard, laid out like Kredily's: greeting, today's summary, headline figures, trends, today's attendance
 * snapshot, quick access, compliance and recent payroll activity; on the right work hours, announcements,
 * birthdays and holidays. The "Me" view shows the person's own month, leave and actions.
 */
export default async function Dashboard({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const [controls, view, jar, me] = await Promise.all([orgControls(ctx.org.id), viewModeFor(ctx), cookies(), getMyEmployee(ctx.org.id, ctx.user.id)]);
  const orgId = ctx.org.id;
  const base = `/app/${slug}`;
  const tz = ctx.org.timezone;
  const today = todayIn(tz);
  const monthStart = `${today.slice(0, 7)}-01`;
  const admin = view === 'admin';
  const seesPeople = admin && (ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team'));
  const seesPayroll = admin && (ctx.can('payroll.prepare', 'org') || ctx.can('payroll.approve', 'org'));
  const seesAttendance = admin && (ctx.can('attendance.read', 'org') || ctx.can('attendance.read', 'team'));

  const [work, attention, headcount, trend, pay, snapshot, presence, exits, compliance, activity, holidays, birthdays, announcements, punches, balances, myDays, rule, setup, completeness] = await Promise.all([
    myWork(orgId, me?.id ?? null, today),
    needsAttention(ctx, today),
    seesPeople ? countEmployees(orgId, { status: 'active' }) : null,
    seesPeople ? headcountTrend(orgId, today) : null,
    seesPayroll ? payrollTrend(orgId, today) : null,
    seesAttendance ? attendanceSnapshot(orgId, today) : null,
    seesAttendance ? averagePresence(orgId, monthStart, today) : null,
    seesPeople ? exitsSince(orgId, addDays(today, -30), today) : null,
    seesPayroll ? complianceStatus(orgId) : null,
    seesPayroll ? payrollActivity(orgId) : [],
    upcomingHolidays(orgId, today, 8),
    upcomingBirthdays(orgId, 45),
    listAnnouncements(orgId, me?.id ?? null).catch(() => []),
    me ? getPunches(orgId, me.id, 36) : [],
    me ? getBalances(me.id).catch(() => []) : [],
    !admin && me ? getMyMonth(me.id, monthStart).catch(() => []) : [],
    me ? myRule(orgId, me.id, today).catch(() => null) : null,
    admin && (ctx.can('org.manage', 'org') || ctx.can('onboarding.manage', 'org')) ? orgSetup(orgId) : null,
    me ? createClient().then((db) => db.rpc('my_profile_completeness', { p_org: orgId })).then((r) => r.data as unknown as Completeness | null) : null,
  ]);

  const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const todayPunches = punches.filter((p) => localDate(p.punched_at) === today);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const longDate = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${today}T00:00:00Z`));
  const attrition = headcount && exits !== null ? (exits / headcount) * 100 : null;
  const seen = new Set<string>();
  const nextHolidays = holidays.filter((h) => !seen.has(h.holiday_date + h.name) && seen.add(h.holiday_date + h.name)).slice(0, 4);
  const liveAnnouncements = announcements.filter((a) => !a.expires_at || a.expires_at >= today).slice(0, 3);
  const shift = rule?.shift ?? null;

  const summary = [
    work.approvals ? `${work.approvals} approval${work.approvals === 1 ? '' : 's'} waiting for you` : null,
    work.tasks ? `${work.tasks} open task${work.tasks === 1 ? '' : 's'}` : null,
    snapshot && snapshot.onLeave.length ? `${snapshot.onLeave.length} on leave today` : null,
    snapshot && snapshot.late.length ? `${snapshot.late.length} late today` : null,
    admin && attention.openTickets ? `${attention.openTickets} open helpdesk ticket${attention.openTickets === 1 ? '' : 's'}` : null,
    admin && attention.openSeparations ? `${attention.openSeparations} exit${attention.openSeparations === 1 ? '' : 's'} in progress` : null,
    admin && attention.overdueTraining ? `${attention.overdueTraining} overdue training` : null,
    attention.latestRun && attention.latestRun.status !== 'locked' ? `payroll for ${monthName(attention.latestRun.period_month)} is ${RUN_STATUS[attention.latestRun.status]?.toLowerCase()}` : null,
  ].filter(Boolean);
  const showInsight = jar.get('pc-insight')?.value !== today;

  const tiles: QuickTile[] = [
    { key: 'attendance', href: `${base}/attendance`, label: 'Attendance', emoji: '📊' },
    { key: 'leave', href: `${base}/leave`, label: 'Leave', emoji: '🏖' },
    { key: 'payroll', href: seesPayroll ? `${base}/payroll` : `${base}/payslips`, label: seesPayroll ? 'Payroll' : 'Payslips', emoji: '💰' },
    { key: 'directory', href: `${base}/employees`, label: 'Directory', emoji: '👥' },
    { key: 'performance', href: `${base}/performance`, label: 'Performance', emoji: '🏆' },
    { key: 'expense', href: `${base}/expenses`, label: 'Expense', emoji: '🧾' },
    { key: 'engagement', href: `${base}/engagement`, label: 'Engagement', emoji: '💬' },
    { key: 'learning', href: `${base}/learning`, label: 'Learning', emoji: '🎓' },
    { key: 'helpdesk', href: `${base}/helpdesk`, label: 'Helpdesk', emoji: '🛟' },
    { key: 'assets', href: `${base}/assets`, label: 'Assets', emoji: '💻' },
    ...(admin && ctx.can('recruitment.read') ? [{ key: 'hiring', href: `${base}/recruitment`, label: 'Hiring', emoji: '🧲' }] : []),
    ...(seesPeople ? [{ key: 'insights', href: `${base}/insights`, label: 'Reports', emoji: '📈' }] : []),
  ];
  const chosenRaw = jar.get('pc-quick')?.value;
  const chosen = chosenRaw ? chosenRaw.split('.').filter((k) => tiles.some((t) => t.key === k)) : null;

  const daysPresent = myDays.filter((d) => ['present', 'wfh', 'on_duty'].includes(d.status)).length + myDays.filter((d) => d.status === 'half_day').length * 0.5;
  const leaveLeft = balances.filter((b) => !b.allow_negative).reduce((s, b) => s + b.available, 0);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        <header>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{greeting}{me ? `, ${me.first_name}` : ''} <span aria-hidden="true">👋</span></h1>
          <p className="mt-1 text-sm text-muted">{longDate} · {ctx.org.name}{admin && headcount !== null ? ` · ${headcount.toLocaleString('en-IN')} employees` : ''}</p>
        </header>

        {setup && setup.percent < 100 && <SetupCard slug={slug} orgName={ctx.org.name} progress={setup} />}

        {admin && showInsight && (
          <section aria-label="Today" className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary-soft to-surface px-4 py-3.5">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-fg"><Sparkles className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Today · {ctx.org.name}</p>
              <p className="mt-0.5 text-sm font-medium">{summary.length ? `${capitalise(summary.join(' · '))}.` : 'You’re all caught up. Nothing is waiting for you.'}</p>
            </div>
            <span className="flex items-center gap-2">
              <Link href={work.approvals ? `${base}/inbox` : seesPeople ? `${base}/insights` : `${base}/inbox`} className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-fg">{work.approvals ? 'Review →' : 'View report →'}</Link>
              <DismissInsight today={today} />
            </span>
          </section>
        )}

        {admin ? (
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
            {headcount !== null && <Kpi label="Headcount" value={headcount.toLocaleString('en-IN')} note="active employees" tone="primary" href={`${base}/employees?status=active`} />}
            {pay && <Kpi label="Monthly payroll" value={pay.latest ? inr(Number(pay.latest.total_net)) : '—'} note={pay.latest ? `${shortMonth(pay.latest.period_month)} · net payout` : 'no locked run yet'} tone="success" href={`${base}/payroll`} />}
            {compliance && <Kpi label="Compliance score" value={compliance.score === null ? '—' : `${compliance.score}%`} note="PF · ESI · PT · TDS" tone="warning" href={`${base}/payroll`} />}
            {snapshot && <Kpi label="Avg presence" value={presence === null ? '—' : `${presence}%`} note="this month" tone="info" href={`${base}/attendance?tab=analytics`} />}
            {headcount !== null && <Kpi label="Attrition (30d)" value={attrition === null ? '—' : `${Number(attrition.toFixed(1))}%`} note="terminations / headcount" tone="danger" href={`${base}/separations`} />}
            {headcount === null && <Kpi label="Waiting for you" value={String(work.approvals ?? 0)} note="approvals" tone="primary" href={`${base}/inbox`} />}
          </section>
        ) : (
          <section aria-label="Key figures" className="grid grid-cols-3 gap-3">
            <Kpi label="Days present" value={me ? num(daysPresent) : '—'} note="this month" tone="success" href={`${base}/attendance?tab=calendar`} />
            <Kpi label="Leave balance" value={me ? num(leaveLeft) : '—'} note="days remaining" tone="primary" href={`${base}/leave`} />
            <Kpi label="Pending actions" value={String((work.approvals ?? 0) + (work.tasks ?? 0))} note={(work.approvals ?? 0) + (work.tasks ?? 0) ? 'waiting for you' : 'all clear'} tone="warning" href={`${base}/inbox`} />
          </section>
        )}

        {(trend || pay) && (
          <div className={cn('grid gap-5', trend && pay && 'lg:grid-cols-2')}>
            {trend && (
              <Card title="📈 Headcount Trend" meta="6 months">
                <Bars data={trend.map((t) => ({ label: t.label, value: t.value ?? 0 }))} />
                <p className="mt-3 text-xs text-muted">{trend.at(-1)?.value ?? 0} employees · <span className={cn((trend.at(-1)?.value ?? 0) - (trend[0]?.value ?? 0) >= 0 ? 'text-success' : 'text-danger')}>
                  {(trend.at(-1)?.value ?? 0) - (trend[0]?.value ?? 0) >= 0 ? '▲ +' : '▼ '}{(trend.at(-1)?.value ?? 0) - (trend[0]?.value ?? 0)}</span> over 6 months</p>
              </Card>
            )}
            {pay && (
              <Card title="💰 Payroll Spend" meta="net · 6 months">
                <Bars data={pay.months} format={(n) => (n ? inr(n) : '')} tone="success" />
                <p className="mt-3 text-xs text-muted">{pay.months.some((m) => m.value) ? `Latest: ${inr(pay.months.at(-1)?.value ?? 0)}` : 'No completed payroll run in this period'}</p>
              </Card>
            )}
          </div>
        )}

        {snapshot && (
          <Card title="📊 Attendance Snapshot" badge="Live" action={<Link href={`${base}/attendance`} className="text-sm font-medium text-primary hover:underline">Today · {snapshot.total} employees</Link>}>
            <div className="grid gap-5 md:grid-cols-3 md:divide-x md:divide-line">
              <SnapshotColumn title="Late Arrival" tone="warning" people={snapshot.late} empty="No late arrivals today" href={`${base}/attendance?tab=hub&pulse=late`} />
              <SnapshotColumn title="On Leave" tone="info" people={snapshot.onLeave} empty="No one on leave today" href={`${base}/attendance?tab=hub&pulse=on_leave`} className="md:pl-5" />
              <SnapshotColumn title="Absent" tone="danger" people={snapshot.absent} empty="Everyone is in" href={`${base}/attendance?tab=hub&pulse=absent`} className="md:pl-5" />
            </div>
          </Card>
        )}

        <QuickAccess tiles={tiles} chosen={chosen} />

        {!admin && me && balances.length > 0 && (
          <Card title="🏖 My Leave Balance" action={<Link href={`${base}/leave`} className="text-sm font-medium text-primary hover:underline">Apply leave</Link>}>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-label="My leave balance">
              {balances.filter((b) => !b.allow_negative).slice(0, 8).map((b) => {
                const total = Math.max(b.balance + 0, b.available);
                const pct = total > 0 ? Math.min(100, (b.available / total) * 100) : 0;
                return (
                  <li key={b.leave_type_id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                    <span className="relative grid size-12 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums"
                      style={{ background: `conic-gradient(var(--primary) ${pct}%, var(--subtle) 0)` }}>
                      <span className="grid size-9 place-items-center rounded-full bg-surface">{num(b.available)}</span>
                    </span>
                    <span className="min-w-0 text-sm"><span className="block truncate font-medium">{b.name}</span><span className="text-xs text-muted">Pending: {num(b.pending)}</span></span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {!admin && me && (
          <Card title={`📅 My Attendance — ${new Date(`${monthStart}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`}
            action={<Link href={`${base}/attendance?tab=calendar`} className="text-sm font-medium text-primary hover:underline">View all</Link>} flush>
            <table className="w-full text-sm">
              <caption className="sr-only">My attendance this month</caption>
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Date</th><th>In</th><th>Out</th><th>Hours</th><th className="pr-5">Status</th></tr></thead>
              <tbody className="divide-y divide-line">
                {[...myDays].filter((d) => d.work_date <= today).sort((a, b) => b.work_date.localeCompare(a.work_date)).slice(0, 5).map((d) => (
                  <tr key={d.work_date}>
                    <td className="px-5 py-2">{shortDay(d.work_date)}</td>
                    <td className="tabular-nums">{d.first_in ? time(d.first_in) : '—'}</td>
                    <td className="tabular-nums">{d.last_out ? time(d.last_out) : '—'}</td>
                    <td className="tabular-nums">{d.worked_minutes ? `${Math.floor(d.worked_minutes / 60)}h ${d.worked_minutes % 60}m` : '—'}</td>
                    <td className="pr-5 capitalize text-muted">{d.status.replaceAll('_', ' ')}</td>
                  </tr>
                ))}
                {myDays.length === 0 && <tr><td colSpan={5} className="px-5 py-4 text-muted">No attendance recorded this month.</td></tr>}
              </tbody>
            </table>
          </Card>
        )}

        {compliance && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="⚖️ Compliance Status" meta={compliance.run ? `from ${shortMonth(compliance.run.period_month)} payroll` : undefined}>
              <ul className="space-y-2.5 text-sm" aria-label="Compliance status">
                {compliance.lines.map((l) => (
                  <li key={l.label} className="flex justify-between gap-3">
                    <span>{l.label}</span>
                    <span className={cn(l.state === 'Compliant' ? 'font-medium text-success' : l.state === 'Attention' ? 'font-medium text-warning' : 'text-muted')}>
                      {l.state === 'Compliant' ? '✓ ' : ''}{l.state}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="🕐 Recent Activity" meta="payroll">
              {activity.length === 0 ? <p className="text-sm text-muted">No payroll activity recorded yet</p> : (
                <ul className="space-y-3 text-sm" aria-label="Recent activity">
                  {activity.map((a) => (
                    <li key={a.id}>
                      <Link href={`${base}/payroll/${a.id}`} className="flex items-center justify-between gap-3 hover:text-primary">
                        <span><span className="font-medium">{shortMonth(a.period)} payroll</span> <span className="text-muted">· {RUN_STATUS[a.status] ?? a.status}</span></span>
                        <span className="text-xs text-muted">{a.at ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(a.at)) : ''}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {!me && !admin && (
          <EmptyState title="Nothing to show yet" description="Your HR team hasn’t linked an employee profile to your account." />
        )}
      </div>

      <aside className="space-y-4" aria-label="At a glance">
        {completeness && !profileProgress(completeness).complete && (
          <section aria-label="Complete your profile" className="lift-soft rounded-2xl border border-primary/25 bg-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Complete your profile</p>
            <p className="mb-3 mt-1 text-xs text-muted">HR and payroll need these to pay you and reach you in an emergency.</p>
            <ProfileChecklist base={base} c={completeness} />
          </section>
        )}
        {me && (
          <section aria-label="Work hours" className="lift-soft rounded-2xl border border-primary/20 bg-gradient-to-b from-warning-soft/60 to-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">⏱ Work hours</p>
            {todayPunches.length > 0 && <p className="mt-1 text-sm text-muted">Punches today: {todayPunches.map((p) => time(p.punched_at)).join(', ')}</p>}
            <div className="mt-3 [&_button]:h-11 [&_button]:w-full [&_button]:rounded-xl [&_button]:text-[15px]">
              <PunchButton action={punchAction.bind(null, slug)} label={todayPunches.length % 2 === 0 ? '🕐 Clock In' : '🕐 Clock Out'} selfie={!!shift?.verify_selfie} />
            </div>
            <p className="mt-2 text-center text-xs text-muted">Office hours: {shift ? `${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)}` : '—'}</p>
          </section>
        )}

        <RailCard title="📢 Announcements" action={ctx.can('announcement.manage', 'org')
          ? <Link href={`${base}/engagement`} className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-fg">+ New</Link>
          : <Link href={`${base}/engagement`} className="text-xs font-medium text-primary hover:underline">View all →</Link>}>
          {liveAnnouncements.length === 0 ? <p className="text-sm text-muted">No announcements yet.</p> : (
            <ul className="space-y-3">
              {liveAnnouncements.map((a) => (
                <li key={a.id}>
                  <p className="line-clamp-1 text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted">{shortDay(a.published_at.slice(0, 10))}{a.requires_ack && !a.acknowledgedAt ? ' · needs your acknowledgement' : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </RailCard>

        {controls.birthdays_visible && <RailCard title="🎂 Upcoming Birthdays">
          {birthdays.length === 0 ? <p className="text-sm text-muted">No birthdays in the next few weeks.</p> : (
            <ul className="space-y-3" aria-label="Upcoming birthdays">
              {birthdays.slice(0, 5).map((b) => (
                <li key={b.employee_id} className="flex items-center gap-3 text-sm">
                  <Avatar name={b.name} size="sm" />
                  <span className="flex-1 truncate font-medium">{b.name}</span>
                  <span className="text-xs text-muted">{b.next_birthday === today ? 'Today 🎉' : shortDay(b.next_birthday)}</span>
                </li>
              ))}
            </ul>
          )}
        </RailCard>}

        <RailCard title="🗓️ Holidays" action={<Link href={`${base}/holidays?tab=list`} className="text-xs font-medium text-primary hover:underline">View all →</Link>}>
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
          <RailCard title="🎓 Your training" action={<Link href={`${base}/learning`} className="text-xs font-medium text-primary hover:underline">View all →</Link>}>
            <ul className="space-y-2.5" aria-label="Your training">
              {work.training.map((t) => (
                <li key={t.id} className="text-sm">
                  <p className="truncate font-medium">{t.title}{t.mandatory && <span className="ml-2 text-xs text-muted">Mandatory</span>}</p>
                  <p className={cn('text-xs', t.overdue ? 'font-medium text-danger' : 'text-muted')}>{t.dueOn ? `${t.overdue ? 'Overdue since' : 'Due'} ${shortDay(t.dueOn)}` : 'No due date'}</p>
                </li>
              ))}
            </ul>
          </RailCard>
        )}
      </aside>
    </div>
  );
}

function monthName(iso: string) {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}
const shortMonth = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const shortDay = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const KPI_TONES = { primary: 'text-primary', success: 'text-success', info: 'text-info', warning: 'text-warning', danger: 'text-danger' } as const;

function Kpi({ label, value, note, tone, href }: { label: string; value: string; note: string; tone: keyof typeof KPI_TONES; href?: string }) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn('mt-2 text-[26px] font-bold leading-none tabular-nums tracking-tight', KPI_TONES[tone])}>{value}</p>
      <p className="mt-2 truncate text-xs text-muted">{note}</p>
    </>
  );
  const cls = 'lift block rounded-2xl border border-line bg-surface p-4';
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Card({ title, meta, badge, action, flush, children }: { title: string; meta?: string; badge?: string; action?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <section aria-label={title.replace(/^\W+\s*/u, '')} className="lift-soft rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">{title}
          {badge && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success">{badge}</span>}
        </h2>
        {action ?? (meta && <span className="text-xs text-muted">{meta}</span>)}
      </header>
      <div className={flush ? 'pb-2 pt-2' : 'px-5 pb-5 pt-3'}>{children}</div>
    </section>
  );
}

function Bars({ data, format, tone = 'primary' }: { data: Array<{ label: string; value: number }>; format?: (n: number) => string; tone?: 'primary' | 'success' }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const summary = data.map((d) => `${d.label}: ${format ? format(d.value) : d.value}`).join(', ');
  return (
    <figure aria-label={summary} className="flex h-32 items-end gap-2">
      {data.map((d, i) => {
        const last = i === data.length - 1;
        const pct = max ? Math.max(6, (d.value / max) * 100) : 6;
        return (
          <div key={d.label} className="flex h-full flex-1 flex-col justify-end gap-1.5" aria-hidden="true">
            <div className="relative flex-1">
              <div className={cn('absolute inset-x-0 bottom-0 rounded-md transition-all', tone === 'success'
                ? (last ? 'bg-success' : 'bg-success/30') : (last ? 'bg-primary' : 'bg-primary/40'), !max && 'opacity-40')} style={{ height: `${pct}%` }} />
            </div>
            <span className={cn('text-center text-[11px]', last ? 'font-semibold text-primary' : 'text-muted')}>{d.label}</span>
          </div>
        );
      })}
    </figure>
  );
}

const SNAP_TONES = { warning: 'border-warning/40 bg-warning-soft text-warning', info: 'border-info/40 bg-info-soft text-info', danger: 'border-danger/40 bg-danger-soft text-danger' };

function SnapshotColumn({ title, tone, people, empty, href, className }: {
  title: string; tone: keyof typeof SNAP_TONES; people: Array<{ id: string; name: string }>; empty: string; href: string; className?: string;
}) {
  return (
    <div className={className} aria-label={title} role="group">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className={cn('min-w-7 rounded-lg border px-2 py-0.5 text-center text-xs font-semibold tabular-nums', SNAP_TONES[tone])}>{people.length}</span>
      </div>
      {people.length === 0 ? <p className="mt-3 text-sm text-muted">{empty}</p> : (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          {people.slice(0, 4).map((p) => (
            <li key={p.id} className="flex items-center gap-1.5 text-sm"><Avatar name={p.name} size="sm" className="size-5 text-[9px]" />{p.name.split(' ')[0]}</li>
          ))}
        </ul>
      )}
      <Link href={href} className="mt-3 inline-flex rounded-full border border-primary/30 bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
        {people.length > 4 ? `+${people.length - 4}  View All` : 'View All'}
      </Link>
    </div>
  );
}

function RailCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title.replace(/^\W+\s*/u, '')} className="lift-soft rounded-2xl border border-line bg-surface p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

