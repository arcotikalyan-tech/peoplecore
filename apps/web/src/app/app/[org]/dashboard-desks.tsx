import Link from 'next/link';
import { ATTENDANCE_STATUS_LABELS, dayProgress, punchState, type AttendanceStatus, type Obligation } from '@peoplecore/shared';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Badge } from '@/components/ui/surface';
import { formatDateTime, humanize } from '@/lib/format';
import type { Desks, TeamMember, myWork } from '@/server/dashboard';
import { clock, hours } from './attendance/_tabs/status';
import { decideApprovalAction } from './inbox/actions';
import { ApprovalsPanel } from './inbox/inbox-forms';
import { Card, CardLink, TodoRow, inr, monthName, num, plural, shortDay } from './dashboard-ui';

/**
 * The role desks on the dashboard (data: dashboard_desks). A manager's team today, this month and what is coming up;
 * HR's people operations; payroll's next run and what changes it; finance's money going out; hiring; the audit log for
 * auditors; attendance devices. Every count links to the page where it is acted on.
 */

type Team = NonNullable<Desks['team']>;
type Tone = 'success' | 'warning' | 'danger' | 'primary' | 'neutral' | 'ai';
type Group = 'in' | 'out' | 'leave' | 'away' | 'off' | 'not_in' | 'absent';
export interface TeamRow { member: TeamMember; label: string; tone: Tone; group: Group; atWork: number; breaks: number }

const AT_WORK = new Set(['present', 'half_day', 'wfh', 'on_duty']);
const late = (m: number) => (m < 60 ? `${m}m` : hours(m));

/** Where someone in the team is today, from their punches first, then leave, offs and requests. */
export function teamRow(m: TeamMember, now: Date): TeamRow {
  const progress = m.punches.length ? dayProgress(m.punches, now, { fullDayMinutes: 480, halfDayMinutes: 240, breakMinutes: 0 }) : null;
  const row = (label: string, tone: Tone, group: Group): TeamRow => ({ member: m, label, tone, group, atWork: progress?.atWorkMinutes ?? m.worked, breaks: progress?.breakMinutes ?? m.breaks });
  if (m.punches.length) {
    const s = punchState(m.punches);
    if (s.paused) return row(s.paused === 'lunch' ? 'At lunch' : 'On a break', 'warning', 'in');
    if (s.checkedIn) return row(m.request === 'wfh' ? 'Working from home' : m.request === 'on_duty' ? 'On duty' : 'Checked in', 'success', 'in');
    return row('Checked out', 'neutral', 'out');
  }
  if (m.status && AT_WORK.has(m.status)) return row(ATTENDANCE_STATUS_LABELS[m.status as AttendanceStatus], 'success', 'out');
  if (m.leave?.status === 'approved') return row(m.leave.half_day ? `Half day · ${m.leave.what}` : m.leave.what, 'primary', 'leave');
  if (m.status === 'on_leave') return row('On leave', 'primary', 'leave');
  if (m.status === 'weekly_off' || m.status === 'holiday') return row(m.status === 'holiday' ? 'Holiday' : 'Weekly off', 'neutral', 'off');
  if (m.request === 'on_duty') return row('On duty', 'primary', 'away');
  if (m.status === 'absent') return row('Absent', 'danger', 'absent');
  return row(m.request === 'wfh' ? 'WFH · not checked in' : m.leave ? 'Not checked in · leave asked' : 'Not checked in', 'warning', 'not_in');
}

export function teamCounts(rows: TeamRow[]) {
  return {
    in: rows.filter((r) => r.group === 'in' || r.group === 'out').length,
    leave: rows.filter((r) => r.group === 'leave').length,
    notIn: rows.filter((r) => r.group === 'not_in' || r.group === 'absent').length,
    late: rows.filter((r) => r.member.late > 0).length,
  };
}

const SHOWN = 15;
/** Columns that only fit beside the name and status from tablet width; on a phone the times go under the status. */
const WIDE = 'hidden sm:table-cell';

export function TeamTodayCard({ rows, base, tz }: { rows: TeamRow[]; base: string; tz: string }) {
  const time = clock(tz);
  return (
    <Card title="👥 My team today" badge="Live" action={<CardLink href={`${base}/attendance?tab=logs`}>Full day log →</CardLink>} flush>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">My team today</caption>
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="px-5 py-2">Name</th><th className="pr-5 sm:pr-0">Status</th><th className={WIDE}>In</th><th className={WIDE}>Out</th><th className={WIDE}>At work</th><th className={`${WIDE} pr-5`}>Breaks</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.slice(0, SHOWN).map(({ member: m, label, tone, group, atWork, breaks }) => (
              <tr key={m.id}>
                <td className="px-5 py-2.5">
                  <Link href={`${base}/employees/${m.id}?tab=attendance`} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
                    <Avatar name={m.name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.name}</span>
                      <span className="block truncate text-xs text-muted">{[m.title, !m.direct && 'Indirect report', m.notice && 'On notice'].filter(Boolean).join(' · ')}</span>
                    </span>
                  </Link>
                </td>
                <td className="pr-5 sm:whitespace-nowrap sm:pr-0">
                  <Badge tone={tone}>{label}</Badge>
                  {m.late > 0 && <span className="ml-1.5 text-xs font-medium text-warning">Late {late(m.late)}</span>}
                  {m.first_in && (
                    <span className="mt-1 block text-xs tabular-nums text-muted sm:hidden">
                      In {time(m.first_in)}{group === 'out' ? ` · out ${time(m.last_out)}` : ''} · at work {hours(atWork)}
                    </span>
                  )}
                </td>
                <td className={`${WIDE} tabular-nums`}>{time(m.first_in)}</td>
                <td className={`${WIDE} tabular-nums`}>{group === 'out' ? time(m.last_out) : '—'}</td>
                <td className={`${WIDE} tabular-nums`}>{hours(atWork)}</td>
                <td className={`${WIDE} pr-5 tabular-nums`}>{hours(breaks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && (
        <p className="px-5 pt-2 text-xs text-muted">Showing {SHOWN} of {rows.length}. <Link href={`${base}/attendance?tab=logs`} className="font-medium text-primary hover:underline">See everyone →</Link></p>
      )}
    </Card>
  );
}

export function TeamAwayCard({ away, base, today }: { away: Team['away']; base: string; today: string }) {
  return (
    <Card title="🏖 Away in the next two weeks" action={<CardLink href={`${base}/leave?tab=calendar`}>Team calendar →</CardLink>}>
      {away.length === 0 ? <p className="text-sm text-muted">Nobody in your team is away in the next two weeks.</p> : (
        <ul className="space-y-3" aria-label="Away in the next two weeks">
          {away.slice(0, 8).map((a) => (
            <li key={`${a.employee_id}-${a.start}-${a.what}`} className="flex items-center gap-3 text-sm">
              <Avatar name={a.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block truncate text-xs text-muted">{a.what} · {a.start === a.end ? shortDay(a.start) : `${shortDay(a.start)} – ${shortDay(a.end)}`} · {plural(Number(a.days), 'day')}</span>
              </span>
              {a.status === 'pending' ? <Badge tone="warning">Waiting for approval</Badge> : a.start <= today ? <Badge tone="primary">Away now</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Upcoming = { key: string; icon: string; name: string; on: string; text: string; href: string; urgent?: boolean };

export function TeamComingUpCard({ team, birthdays, base, today }: {
  team: Team; birthdays: Array<{ employee_id: string; name: string; next_birthday: string }>; base: string; today: string;
}) {
  const items: Upcoming[] = [
    ...team.events.map((e): Upcoming => {
      const profile = `${base}/employees/${e.employee_id}`;
      switch (e.kind) {
        case 'anniversary': return { key: `a-${e.employee_id}`, icon: '🎉', name: e.name, on: e.on, text: `${plural(Number(e.detail), 'year')} at work`, href: profile };
        case 'probation': return e.on < today
          ? { key: `p-${e.employee_id}`, icon: '📝', name: e.name, on: e.on, text: 'Probation ended: confirm or extend', href: `${profile}?tab=work`, urgent: true }
          : { key: `p-${e.employee_id}`, icon: '📝', name: e.name, on: e.on, text: 'Probation ends', href: `${profile}?tab=work` };
        case 'last_day': return { key: `l-${e.employee_id}`, icon: '👋', name: e.name, on: e.on, text: e.detail === 'submitted' ? 'Resigned: waiting for approval' : 'Last working day', href: `${base}/separations` };
        default: return { key: `j-${e.employee_id}`, icon: '🆕', name: e.name, on: e.on, text: e.detail ? `Joins as ${e.detail}` : 'Joins', href: profile };
      }
    }),
    ...birthdays.map((b) => ({ key: `b-${b.employee_id}`, icon: '🎂', name: b.name, on: b.next_birthday, text: 'Birthday', href: `${base}/employees/${b.employee_id}` })),
  ].sort((a, b) => a.on.localeCompare(b.on) || a.name.localeCompare(b.name));
  return (
    <Card title="📌 Coming up in your team" meta="next 30 days">
      {items.length === 0 ? <p className="text-sm text-muted">Nothing coming up in the next 30 days.</p> : (
        <ul className="space-y-2.5" aria-label="Coming up in your team">
          {items.slice(0, 8).map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex items-center gap-3 text-sm hover:text-primary">
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-subtle">{i.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.name}</span>
                  <span className={cn('block truncate text-xs', i.urgent ? 'font-medium text-danger' : 'text-muted')}>{i.text}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{i.on === today ? 'Today' : shortDay(i.on)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TeamReviewsCard({ reviews, base }: { reviews: Team['reviews']; base: string }) {
  return (
    <Card title="🏆 Team reviews" action={<CardLink href={`${base}/performance`}>Performance →</CardLink>}>
      <ul className="space-y-4" aria-label="Team reviews">
        {reviews.map((r) => {
          const total = r.not_started + r.to_rate + r.done;
          return (
            <li key={r.cycle} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{r.cycle}</span>
                <span className="text-xs text-muted">{r.done} of {total} rated</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${total ? (r.done / total) * 100 : 0}%` }} />
              </div>
              <p className={cn('mt-1.5 text-xs', r.to_rate ? 'font-medium text-warning' : 'text-muted')}>
                {r.to_rate ? `${plural(r.to_rate, 'self review')} in: yours to rate${r.manager_due ? ` by ${shortDay(r.manager_due)}` : ''}` : 'Nothing waiting for your rating'}
                {r.not_started ? ` · ${plural(r.not_started, 'self review')} not started` : ''}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function TeamMonthCard({ members, base, monthStart }: { members: TeamMember[]; base: string; monthStart: string }) {
  return (
    <Card title={`📅 Team this month — ${monthName(monthStart)}`} action={<CardLink href={`${base}/attendance?tab=logs&view=calendar`}>Month calendar →</CardLink>} flush>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">My team this month</caption>
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="px-5 py-2">Name</th><th>Present</th><th>Late</th><th>Leave</th><th className="pr-5">Absent</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {members.slice(0, SHOWN).map((m) => (
              <tr key={m.id}>
                <td className="py-2 pl-5 pr-2"><Link href={`${base}/employees/${m.id}?tab=attendance`} className="font-medium hover:text-primary">{m.name}</Link></td>
                <td className="tabular-nums">{num(m.month.present)}<span className="text-muted"> / {m.month.expected}</span></td>
                <td className={cn('tabular-nums', m.month.late ? 'font-medium text-warning' : 'text-muted')}>{m.month.late}</td>
                <td className="tabular-nums text-muted">{num(Number(m.month.leave))}</td>
                <td className={cn('pr-5 tabular-nums', m.month.absent ? 'font-medium text-danger' : 'text-muted')}>{m.month.absent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 pt-2 text-xs text-muted">Present out of working days so far (weekly offs and holidays aside).</p>
    </Card>
  );
}

/** Someone with reports but without the Reporting manager role can't read their team: say why, and who can fix it. */
export function TeamRoleHint({ reports }: { reports: number }) {
  return (
    <section aria-label="Your team" className="rounded-2xl border border-warning/40 bg-warning-soft/40 px-4 py-3.5 text-sm">
      <p className="font-medium">{plural(reports, 'person reports', 'people report')} to you</p>
      <p className="mt-0.5 text-muted">
        Your account doesn’t have the Reporting manager role, so you can’t see their attendance or approve their requests here.
        Ask HR to give you the role in Settings › Users &amp; roles.
      </p>
    </section>
  );
}

export function ApprovalsCard({ slug, base, tz, total, items }: {
  slug: string; base: string; tz: string; total: number; items: Awaited<ReturnType<typeof myWork>>['approvalItems'];
}) {
  return (
    <Card title="✅ Waiting for your approval" action={<CardLink href={`${base}/inbox`}>{total > items.length ? `All ${total} in Inbox →` : 'Inbox →'}</CardLink>} flush>
      <ApprovalsPanel
        action={decideApprovalAction.bind(null, slug)}
        items={items.map((a) => ({
          id: a.id, summary: a.summary, href: a.link ? `${base}${a.link}` : null, stepLabel: a.step_label,
          meta: `${humanize(a.subject_type)} · from ${a.requested_by_name} · ${formatDateTime(a.created_at, tz)}`,
          onBehalfOf: a.via === 'delegation' ? (a.on_behalf_of_name ?? 'a colleague') : null, escalated: a.escalated,
        }))}
      />
    </Card>
  );
}

export function HrDesk({ hr, base, today, can }: { hr: NonNullable<Desks['hr']>; base: string; today: string; can: { letters: boolean; assets: boolean } }) {
  const MOVE = { joining: ['🆕', 'Joins'], probation: ['📝', 'Probation ends'], last_day: ['👋', 'Last working day'] } as const;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="🧭 People operations" action={<CardLink href={`${base}/employees?tab=lifecycle`}>Lifecycle →</CardLink>}>
        <ul className="-mx-2 space-y-0.5" aria-label="People operations">
          <TodoRow label="Joining soon" count={hr.joining} href={`${base}/employees?tab=people&status=pre_joining`} tone="primary" note={`${hr.joined_this_month} joined this month`} />
          <TodoRow label="Probation ending in 30 days" count={hr.probation_due} href={`${base}/employees?tab=lifecycle`} />
          <TodoRow label="Probation ended, not confirmed" count={hr.probation_overdue} href={`${base}/employees?tab=lifecycle`} tone="danger" />
          <TodoRow label="Resignations to decide" count={hr.exits_to_decide} href={`${base}/separations`} />
          <TodoRow label="Serving notice" count={hr.leaving} href={`${base}/separations`} tone="primary" />
          <TodoRow label="Onboarding in progress" count={hr.onboarding} href={`${base}/onboarding`} tone="primary" />
          <TodoRow label="Leave requests waiting" count={hr.leave_pending} href={`${base}/leave?tab=approvals`} />
          <TodoRow label="Attendance and WFH requests waiting" count={hr.attendance_pending} href={`${base}/attendance?tab=approvals`} />
          {can.letters && <TodoRow label="Letter requests" count={hr.letters_pending} href={`${base}/letters?tab=requests`} />}
          {can.assets && <TodoRow label="Asset requests" count={hr.assets_pending} href={`${base}/assets?tab=requests`} />}
          <TodoRow label="No reporting manager" count={hr.no_manager} href={`${base}/employees?tab=orgchart`} tone="muted" note="The head of the organization is one" />
        </ul>
      </Card>
      <Card title="🗓️ Joining, confirming and leaving" meta="next 30 days">
        {hr.moves.length === 0 ? <p className="text-sm text-muted">No joiners, probation ends or last days in the next 30 days.</p> : (
          <ul className="space-y-2.5" aria-label="Joining, confirming and leaving">
            {hr.moves.map((m) => (
              <li key={`${m.kind}-${m.employee_id}`}>
                <Link href={m.kind === 'last_day' ? `${base}/separations` : `${base}/employees/${m.employee_id}`} className="flex items-center gap-3 text-sm hover:text-primary">
                  <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-subtle">{MOVE[m.kind][0]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.name}</span>
                    <span className={cn('block truncate text-xs', m.kind === 'probation' && m.on < today ? 'font-medium text-danger' : 'text-muted')}>
                      {m.kind === 'probation' && m.on < today ? 'Probation ended: confirm or extend' : MOVE[m.kind][1]}{m.kind === 'last_day' && m.status === 'submitted' ? ' · resignation not decided' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{m.on === today ? 'Today' : shortDay(m.on)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const RUN_STEPS = [['none', 'Not started'], ['draft', 'Draft'], ['computed', 'Computed'], ['approved', 'Approved'], ['locked', 'Locked']] as const;

export function PayrollDesk({ p, base, filings }: { p: NonNullable<Desks['payroll']>; base: string; filings: { next: Obligation[]; overdue: number } | null }) {
  const at = RUN_STEPS.findIndex(([k]) => k === (p.run?.status ?? 'none'));
  return (
    <Card title={`💰 Payroll · ${monthName(p.period)}`} action={<CardLink href={p.run ? `${base}/payroll/${p.run.id}` : `${base}/payroll?tab=run`}>{p.run ? 'Open the run →' : 'Start the run →'}</CardLink>}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Payroll run">
        {RUN_STEPS.map(([k, label], i) => (
          <li key={k} className="flex items-center gap-2" aria-current={i === at ? 'step' : undefined}>
            <span className={cn('rounded-full px-2.5 py-1 font-medium', i === at ? 'bg-primary text-primary-fg' : i < at ? 'bg-success-soft text-success' : 'bg-subtle text-muted')}>{label}</span>
            {i < RUN_STEPS.length - 1 && <span aria-hidden="true" className="text-muted">›</span>}
          </li>
        ))}
      </ol>
      {p.run && <p className="mt-2 text-xs text-muted">{plural(p.run.employee_count, 'employee')} · net {inr(Number(p.run.total_net ?? 0))}</p>}
      <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
        <ul className="-mx-2 space-y-0.5" aria-label="Before the run">
          <TodoRow label="Leave requests not decided" count={p.leave_pending} href={`${base}/leave?tab=approvals`} note="in this pay period" />
          <TodoRow label="Attendance requests not decided" count={p.attendance_pending} href={`${base}/attendance?tab=approvals`} note="in this pay period" />
          <TodoRow label="Salary revisions to sign off" count={p.revisions_pending} href={`${base}/payroll?tab=people&view=revisions`} />
          <TodoRow label="Tax declarations to review" count={p.declarations_to_review} href={`${base}/payroll?tab=declarations`} />
          <TodoRow label="People with no salary" count={p.no_salary} href={`${base}/payroll?tab=people`} tone="danger" />
        </ul>
        <ul className="-mx-2 space-y-0.5" aria-label="In this pay period">
          <TodoRow label="Joiners" count={p.joiners} href={`${base}/employees?tab=people&flag=new`} tone="primary" />
          <TodoRow label="Leavers" count={p.leavers} href={`${base}/separations`} tone="primary" />
          <TodoRow label="Loan EMIs to deduct" count={p.emis.count} href={`${base}/loans?tab=tracker`} tone="primary" note={p.emis.count ? inr(Number(p.emis.amount)) : undefined} />
          <TodoRow label="Loans to approve or pay out" count={p.loans_to_decide} href={`${base}/loans?tab=approvals`} />
        </ul>
      </div>
      {filings && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium">Filings due in the next 15 days</h3>
            <CardLink href={`${base}/statutory?tab=calendar`}>Calendar →</CardLink>
          </div>
          {filings.overdue > 0 && <p className="mt-1 text-xs font-medium text-danger">{plural(filings.overdue, 'filing')} overdue</p>}
          {filings.next.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing due.</p> : (
            <ul className="mt-2 space-y-1.5 text-sm" aria-label="Filings due">
              {filings.next.slice(0, 4).map((o) => (
                <li key={`${o.form.id}-${o.periodStart}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{o.form.name} <span className="text-muted">· {o.label}</span></span>
                  <span className="shrink-0 text-xs text-muted">{shortDay(o.due)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

export function FinanceDesk({ f, base, can }: { f: NonNullable<Desks['finance']>; base: string; can: { payroll: boolean; expenses: boolean; vendors: boolean } }) {
  return (
    <Card title="🏦 Money going out">
      {can.payroll && f.runs_to_approve.length > 0 && (
        <ul className="mb-3 space-y-2" aria-label="Payroll runs to approve">
          {f.runs_to_approve.map((r) => (
            <li key={r.id}>
              <Link href={`${base}/payroll/${r.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft/40 px-3 py-2 text-sm hover:border-warning">
                <span><span className="font-medium">{monthName(r.period_month)} payroll</span> <span className="text-muted">· {plural(r.employee_count, 'employee')} · net {inr(Number(r.total_net ?? 0))}</span></span>
                <span className="shrink-0 text-xs font-medium text-warning">Approve →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ul className="-mx-2 space-y-0.5" aria-label="Money going out">
        {can.payroll && f.runs_to_approve.length === 0 && <TodoRow label="Payroll runs to approve" count={0} href={`${base}/payroll`} />}
        {can.expenses && <TodoRow label="Expense claims to reimburse" count={f.claims_to_pay.count} href={`${base}/expenses?tab=reimbursement`} note={f.claims_to_pay.count ? inr(Number(f.claims_to_pay.amount)) : undefined} />}
        {can.vendors && <>
          <TodoRow label="Vendor invoices to approve" count={f.invoices_to_approve.count} href={`${base}/vendors?tab=payments`} note={f.invoices_to_approve.count ? inr(Number(f.invoices_to_approve.amount)) : undefined} />
          <TodoRow label="Vendor invoices to pay" count={f.invoices_to_pay.count} href={`${base}/vendors?tab=payments`} note={f.invoices_to_pay.count ? inr(Number(f.invoices_to_pay.amount)) : undefined} />
          <TodoRow label="Vendor invoices past their due date" count={f.invoices_overdue} href={`${base}/vendors?tab=payments`} tone="danger" />
        </>}
        {can.payroll && <TodoRow label="Final settlements to approve" count={f.settlements} href={`${base}/separations`} />}
      </ul>
    </Card>
  );
}

const STAGES = [['applied', 'Applied'], ['screening', 'Screening'], ['interview', 'Interview'], ['offer', 'Offer']] as const;

export function HiringDesk({ h, base, tz, today }: { h: NonNullable<Desks['hiring']>; base: string; tz: string; today: string }) {
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const when = (iso: string) => `${day(iso) === today ? 'Today' : new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso))}, ${clock(tz)(iso)}`;
  return (
    <Card title="🧲 Hiring" meta={`${plural(h.open_jobs, 'open job')} · ${plural(h.openings, 'opening')}`}>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Candidates by stage">
        {STAGES.map(([k, label]) => (
          <li key={k}>
            <Link href={`${base}/recruitment?tab=pipeline`} className="block rounded-xl border border-line px-3 py-2 hover:border-line-strong">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
              <span className="text-xl font-bold tabular-nums">{h.stages[k]}</span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium">Interviews this week</h3>
            <CardLink href={`${base}/recruitment/interviews`}>All →</CardLink>
          </div>
          {h.interviews.length === 0 ? <p className="mt-2 text-sm text-muted">No interviews scheduled.</p> : (
            <ul className="mt-2 space-y-2 text-sm" aria-label="Interviews this week">
              {h.interviews.map((i) => (
                <li key={i.id}>
                  <p className="truncate font-medium">{i.candidate} <span className="font-normal text-muted">· {i.job}</span></p>
                  <p className="text-xs text-muted">{when(i.at)} · {i.round}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ul className="-mx-2 space-y-0.5" aria-label="Offers">
          <TodoRow label="Interviews today" count={h.interviews_today} href={`${base}/recruitment/interviews`} tone="primary" />
          <TodoRow label="Offers to approve" count={h.offers_to_approve} href={`${base}/recruitment?tab=pipeline`} />
          <TodoRow label="Approved offers to send" count={h.offers_to_send} href={`${base}/recruitment?tab=pipeline`} />
          <TodoRow label="Offers waiting for an answer" count={h.offers_out} href={`${base}/recruitment?tab=pipeline`} tone="primary" />
          <TodoRow label="Hired this month" count={h.hired_this_month} href={`${base}/recruitment?tab=insights`} tone="primary" />
        </ul>
      </div>
    </Card>
  );
}

export function AuditDesk({ a, base, tz }: { a: NonNullable<Desks['audit']>; base: string; tz: string }) {
  return (
    <Card title="🛡️ Audit log" action={<CardLink href={`${base}/audit`}>{a.today ? `${plural(a.today, 'change')} today →` : 'Audit log →'}</CardLink>}>
      {a.recent.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
        <ul className="space-y-2.5 text-sm" aria-label="Latest changes">
          {a.recent.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate"><span className="font-medium">{e.actor}</span> <span className="text-muted">· {humanize(e.action)} {humanize(e.entity).toLowerCase()}</span></span>
              <span className="shrink-0 text-xs text-muted">{formatDateTime(e.at, tz)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DevicesDesk({ devices, base, now }: { devices: NonNullable<Desks['devices']>; base: string; now: Date }) {
  const ago = (iso: string) => {
    const m = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
    return m < 60 ? `${m} min ago` : m < 60 * 48 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  return (
    <Card title="📟 Attendance devices" action={<CardLink href={`${base}/attendance?tab=devices`}>Devices →</CardLink>}>
      <ul className="space-y-2.5 text-sm" aria-label="Attendance devices">
        {devices.map((d) => {
          const silent = d.active && (!d.last_punch || now.getTime() - Date.parse(d.last_punch) > 24 * 3600_000);
          return (
            <li key={d.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0"><span className="block truncate font-medium">{d.name}</span><span className="block truncate text-xs text-muted">{d.serial} · {plural(d.today, 'punch', 'punches')} today</span></span>
              {!d.active ? <Badge>Switched off</Badge>
                : silent ? <Badge tone="warning">{d.last_punch ? `Silent since ${ago(d.last_punch)}` : 'No punches yet'}</Badge>
                  : <Badge tone="success">Last punch {ago(d.last_punch!)}</Badge>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
