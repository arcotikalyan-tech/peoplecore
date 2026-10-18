import Link from 'next/link';
import { addDays, leaveHealth, MONTH_NAMES, type LeaveStatus } from '@peoplecore/shared';
import { BarChart } from '@/components/ui/charts';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Panel, StatCard } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import { getBalances, getRequests } from '@/server/leave';
import {
  getBalanceSheet, getEncashments, getLeaveSettings, getRules, holidaysBetween, leaveCycle, leaveEmployees, teamCalendar, upcomingHolidays,
} from '@/server/leave-ops';
import { applyLeaveAction, cancelLeaveAction, donateLeaveAction, encashLeaveAction } from '../actions';
import { ApplyLeaveForm, CancelLeave, DonateForm, EncashForm, PrintButton } from '../leave-forms';
import { AccrualLedger } from './admin';
import { CategoryIcon, dateRange, num, ruleSentences, STATUS_TONE, statusLabel } from './common';

type Me = { id: string; first_name: string };
type Ctx = { ctx: OrgContext; slug: string; base: string; me: Me; today: string };

async function myData(orgId: string, me: Me, today: string) {
  const settings = await getLeaveSettings(orgId);
  const cycle = leaveCycle(today, settings.year_start_month);
  const [sheet, { rules }, balances] = await Promise.all([getBalanceSheet(orgId, cycle.start, me.id), getRules(orgId, today), getBalances(me.id)]);
  const mine = rules.filter((r) => r.is_active && sheet.some((s) => s.leave_type_id === r.id && (s.applies || s.balance !== 0)))
    .map((r) => ({ rule: r, s: sheet.find((x) => x.leave_type_id === r.id)!, b: balances.find((b) => b.leave_type_id === r.id) }));
  return { settings, cycle, mine };
}

// ─── Hub ────────────────────────────────────────────────────────────────────

export async function MyHub({ ctx, slug, base, me, today, action }: Ctx & { action: string }) {
  const { settings, cycle, mine } = await myData(ctx.org.id, me, today);
  const [requests, holidays, emps] = await Promise.all([
    getRequests(ctx.org.id, { employeeId: me.id }), upcomingHolidays(ctx.org.id, today, 5),
    settings.donation_enabled && action === 'donate' ? leaveEmployees(ctx.org.id) : Promise.resolve(null),
  ]);
  const paid = mine.filter((m) => !m.rule.allow_negative);
  const left = paid.reduce((s, m) => s + m.s.balance - m.s.pending, 0);
  const available = paid.reduce((s, m) => s + m.s.carried + m.s.credited, 0);
  const annual = paid.reduce((s, m) => s + (m.rule.policy?.annual_days ?? 0), 0);
  const carried = paid.reduce((s, m) => s + m.s.carried, 0);
  const pct = available > 0 ? Math.max(0, Math.min(1, left / available)) : 0;
  const taken = requests.filter((r) => r.status === 'approved' && r.start_date <= today);
  const last = taken.map((r) => r.end_date).sort().at(-1) ?? null;
  const usedShare = available > 0 ? paid.reduce((s, m) => s + m.s.applied, 0) / available : 0;
  const yearShare = (Date.parse(today) - Date.parse(cycle.start)) / (Date.parse(cycle.end) - Date.parse(cycle.start) + 86_400_000);
  const health = leaveHealth({ daysSinceLastBreak: last ? Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000) : null, usedShare, yearShare });
  const upcoming = requests.filter((r) => (r.status === 'approved' || r.status === 'pending') && r.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 4);
  const typeName = new Map(mine.map((m) => [m.rule.id, m.rule.name]));
  const compOff = mine.find((m) => m.rule.category === 'comp_off');
  const encashable = mine.filter((m) => m.rule.encashable && m.s.balance - m.s.pending > 0);
  const R = 52;
  const C = 2 * Math.PI * R;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <section aria-label="Days left" className="grid gap-5 rounded-xl border border-line bg-surface p-5 md:grid-cols-[180px_1fr]">
          <figure className="relative mx-auto size-40" aria-label={`${num(left)} days left of ${num(available)} available`}>
            <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
              <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-subtle" />
              {pct > 0 && <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-primary" strokeDasharray={`${C * pct} ${C}`} />}
            </svg>
            <figcaption className="absolute inset-0 grid place-content-center text-center">
              <span className="text-3xl font-semibold tabular-nums">{num(left)}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Days left</span>
              <span className="text-[11px] text-muted">of {num(available)} available</span>
              <span className="text-[10px] text-muted">{num(annual)} annual + {num(carried)} carried</span>
            </figcaption>
          </figure>
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Balances">
            {mine.map(({ rule, s }) => {
              const l = s.balance - s.pending;
              const tot = s.carried + s.credited;
              return (
                <li key={rule.id} className="rounded-xl border border-line p-3">
                  <p className="flex items-center justify-between gap-2 text-sm font-medium">{rule.name}<span className="rounded bg-subtle px-1.5 text-[10px] font-semibold text-muted">{rule.short_name ?? rule.code}</span></p>
                  {rule.allow_negative ? (
                    <p className="mt-1 text-sm"><span className="text-xl font-semibold tabular-nums">{num(s.applied)}</span> <span className="text-xs text-muted">taken · no balance needed</span></p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm"><span className="text-xl font-semibold tabular-nums">{num(l)}</span> <span className="text-xs text-muted">left · of {num(tot)} available</span></p>
                      <p className="text-[11px] text-muted">{num(s.credited)} credited + {num(s.carried)} carried forward{s.pending ? ` · ${num(s.pending)} pending` : ''}</p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-primary" style={{ width: `${tot > 0 ? Math.max(0, Math.min(100, (l / tot) * 100)) : 0}%` }} /></div>
                    </>
                  )}
                </li>
              );
            })}
            {mine.length === 0 && <li className="text-sm text-muted">No leave rules apply to you yet. Ask HR.</li>}
          </ul>
        </section>

        <Panel title="Smart actions">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Smart actions">
            <li><a href="#apply" className="block h-full rounded-xl border border-line p-3 hover:border-line-strong"><span className="text-sm font-medium">Apply leave</span><span className="block text-xs text-muted">Dates, type and reason</span></a></li>
            <li><Link href={`${base}?tab=calendar`} className="block h-full rounded-xl border border-line p-3 hover:border-line-strong"><span className="text-sm font-medium">Plan a break</span><span className="block text-xs text-muted">Calendar with team overlay</span></Link></li>
            <li><a href="#apply" className="block h-full rounded-xl border border-line p-3 hover:border-line-strong"><span className="text-sm font-medium">Use comp-off</span><span className="block text-xs text-muted">{compOff ? `${num(compOff.s.balance - compOff.s.pending)} day available` : 'None earned yet'}</span></a></li>
            <li><Link href={`${base}?tab=hub&do=encash#encash`} className="block h-full rounded-xl border border-line p-3 hover:border-line-strong"><span className="text-sm font-medium">Encash leave</span><span className="block text-xs text-muted">{encashable.length ? `Convert unused ${encashable.map((m) => m.rule.short_name ?? m.rule.code).join(', ')}` : 'Nothing to encash'}</span></Link></li>
            {settings.donation_enabled && <li><Link href={`${base}?tab=hub&do=donate#donate`} className="block h-full rounded-xl border border-line p-3 hover:border-line-strong"><span className="text-sm font-medium">Donate leave</span><span className="block text-xs text-muted">Give days to a colleague</span></Link></li>}
          </ul>
        </Panel>

        {action === 'encash' && (
          <Panel title="Encash leave" meta="HR approves; it’s paid with payroll" className="scroll-mt-20">
            <div id="encash"><EncashForm action={encashLeaveAction.bind(null, slug)} types={encashable.map((m) => ({ value: m.rule.id, label: `${m.rule.name} — ${num(m.s.balance - m.s.pending)} days available` }))} /></div>
          </Panel>
        )}
        {action === 'donate' && emps && (
          <Panel title="Donate leave" className="scroll-mt-20">
            <div id="donate"><DonateForm action={donateLeaveAction.bind(null, slug)}
              types={paid.filter((m) => m.rule.is_paid && m.s.balance - m.s.pending > 0).map((m) => ({ value: m.rule.id, label: `${m.rule.name} — ${num(m.s.balance - m.s.pending)} available` }))}
              colleagues={emps.list.filter((e) => e.id !== me.id).map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }))} /></div>
          </Panel>
        )}

        <Panel title="Apply for myself" className="scroll-mt-20">
          <div id="apply">
            <ApplyLeaveForm action={applyLeaveAction.bind(null, slug)} today={today}
              types={mine.map(({ rule, s }) => ({ value: rule.id, label: rule.allow_negative ? rule.name : `${rule.name} — ${num(s.balance - s.pending)} days remaining` }))} />
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <section aria-label="Leave health" className="flex items-center gap-4 rounded-xl border border-success/30 bg-success/10 p-5">
          <span className="grid size-16 shrink-0 place-items-center rounded-full border-4 border-success/40 text-xl font-semibold tabular-nums">{health.score}</span>
          <div className="text-sm">
            <p className="font-semibold">Leave health · {health.label}</p>
            <p className="text-muted">You’ve taken <span className="font-medium text-fg">{num(taken.reduce((s, r) => s + r.days, 0))} days</span> this cycle. Aim for one break every 8 weeks to stay refreshed.</p>
            <p className="mt-1 text-xs text-muted">Last break · {last ? formatDate(last) : 'None yet'}</p>
          </div>
        </section>
        <Panel title="Upcoming time-off" action={<Link href={`${base}?tab=calendar`} className="text-sm text-primary hover:underline">Calendar →</Link>} flush>
          {upcoming.length === 0 ? <p className="px-5 py-3 text-sm text-muted">Nothing booked.</p> : (
            <ul className="divide-y divide-line text-sm" aria-label="Upcoming time-off">
              {upcoming.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <span>{typeName.get(r.leave_type_id) ?? 'Leave'} <span className="text-muted">· {dateRange(r)}</span></span>
                  <Badge tone={STATUS_TONE[r.status as LeaveStatus]}>{statusLabel(r.status as LeaveStatus)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Holidays · upcoming" flush>
          {holidays.length === 0 ? <p className="px-5 py-3 text-sm text-muted">No holidays scheduled.</p> : (
            <ul className="divide-y divide-line text-sm" aria-label="Upcoming holidays">
              {holidays.map((h) => (
                <li key={h.id} className="flex justify-between px-5 py-2.5"><span>{h.name}{h.is_optional && <span className="text-muted"> (optional)</span>}</span><span className="text-muted">{formatDate(h.holiday_date)}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ─── Calendar ───────────────────────────────────────────────────────────────

export async function MyCalendar({ ctx, base, me, today, month, who }: Ctx & { month: string; who: string }) {
  const first = `${month.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const last = `${month.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
  const [mineReq, team, holidays] = await Promise.all([
    getRequests(ctx.org.id, { employeeId: me.id, from: first, to: last }), teamCalendar(ctx.org.id, first, last), holidaysBetween(ctx.org.id, first, last),
  ]);
  const showMine = who !== 'team';
  const showTeam = who !== 'mine';
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [...Array<null>(offset).fill(null), ...Array.from({ length: lastDay }, (_, i) => `${month.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`)];
  const prev = addDays(first, -1).slice(0, 7);
  const next = addDays(last, 1).slice(0, 7);
  const href = (m: string, w = who) => `${base}?${new URLSearchParams({ tab: 'calendar', month: m, who: w })}`;
  return (
    <Panel title={new Date(`${first}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
      action={
        <span className="flex flex-wrap items-center gap-2">
          <Link href={href(prev)} className={buttonClass('ghost', 'sm')} aria-label="Previous month">◀</Link>
          <Link href={href(today.slice(0, 7))} className={buttonClass('ghost', 'sm')}>Today</Link>
          <Link href={href(next)} className={buttonClass('ghost', 'sm')} aria-label="Next month">▶</Link>
          {(['both', 'mine', 'team'] as const).map((w) => (
            <Link key={w} href={href(month.slice(0, 7), w)} aria-current={(who || 'both') === w ? 'page' : undefined}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs', (who || 'both') === w ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}>
              {w === 'both' ? 'Mine + Team' : w === 'mine' ? 'Mine only' : 'Team only'}
            </Link>
          ))}
          <a href={`${base}?tab=hub#apply`} className={buttonClass('primary', 'sm')}>+ Apply</a>
        </span>
      }>
      <ul className="mb-3 flex gap-4 text-xs text-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />My leave</li>
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-info" />Team leave</li>
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" />Holiday</li>
      </ul>
      <div className="grid grid-cols-7 gap-1.5 text-xs" role="grid" aria-label="Leave calendar">
        {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => <div key={d} role="columnheader" className="pb-1 text-center font-medium text-muted">{d}</div>)}
        {cells.map((d, i) => {
          const hol = d ? holidays.filter((h) => h.holiday_date === d) : [];
          const own = d && showMine ? mineReq.filter((r) => (r.status === 'approved' || r.status === 'pending') && r.start_date <= d && r.end_date >= d) : [];
          const others = d && showTeam ? team.filter((r) => r.start_date <= d && r.end_date >= d) : [];
          return (
            <div key={d ?? `pad-${i}`} role="gridcell" aria-label={d ? `${d}${hol.length ? `, holiday ${hol.map((h) => h.name).join(', ')}` : ''}${own.length ? ', my leave' : ''}${others.length ? `, ${others.length} on team leave` : ''}` : undefined}
              className={cn('min-h-20 rounded-lg border p-1.5', d ? 'border-line bg-subtle/30' : 'border-transparent', d === today && 'border-primary')}>
              {d && (
                <>
                  <p className={cn('font-semibold', d === today && 'text-primary')}>{Number(d.slice(8))}</p>
                  {hol.map((h) => <p key={h.id} className="mt-0.5 truncate rounded bg-success/15 px-1 text-[10px] text-success">{h.name}</p>)}
                  {own.map((r) => <p key={r.id} className={cn('mt-0.5 truncate rounded px-1 text-[10px]', r.status === 'pending' ? 'bg-warning/15 text-warning' : 'bg-primary-soft text-primary')}>Me{r.status === 'pending' ? ' (pending)' : ''}</p>)}
                  {others.slice(0, 2).map((r) => <p key={`${r.employee_id}${r.start_date}`} className="mt-0.5 truncate rounded bg-info/15 px-1 text-[10px] text-info">{r.name.split(' ')[0]}</p>)}
                  {others.length > 2 && <p className="text-[10px] text-muted">+{others.length - 2} more</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── Requests ───────────────────────────────────────────────────────────────

export async function MyRequests({ ctx, slug, base, me, today, status, type }: Ctx & { status: string; type: string }) {
  const [requests, { rules }, encashments] = await Promise.all([getRequests(ctx.org.id, { employeeId: me.id }), getRules(ctx.org.id, today), getEncashments(ctx.org.id, me.id)]);
  const typeName = new Map(rules.map((r) => [r.id, r.name]));
  const rows = requests.filter((r) => (!status || r.status === status) && (!type || r.leave_type_id === type));
  return (
    <div className="space-y-5">
      <form method="get" action={base} aria-label="Filter requests" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="requests" />
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">Type</span>
          <select name="type" defaultValue={type} className="h-9 rounded-lg border border-line bg-surface px-2"><option value="">All</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">Status</span>
          <select name="status" defaultValue={status} className="h-9 rounded-lg border border-line bg-surface px-2"><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label>
        <button className={buttonClass('secondary', 'sm', 'h-9')}>Filter</button>
        <a href={`${base}/export?kind=mine`} className={buttonClass('secondary', 'sm', 'ml-auto h-9')}>⬇ Export</a>
      </form>
      <Panel title="Your requests" meta={`${rows.length}`} flush>
        <Table caption="Your leave requests">
          <thead><tr><Th>Type</Th><Th>Start date</Th><Th>End date</Th><Th>Days</Th><Th>Reason</Th><Th>Status</Th><Th><span className="sr-only">Action</span></Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>{typeName.get(r.leave_type_id)}</Td>
                <Td className="whitespace-nowrap">{formatDate(r.start_date)}{r.half_day_start ? ' (pm)' : ''}</Td>
                <Td className="whitespace-nowrap">{formatDate(r.end_date)}{r.half_day_end ? ' (am)' : ''}</Td>
                <Td className="tabular-nums">{num(r.days)}</Td>
                <Td className="max-w-xs truncate text-muted">{r.reason ?? '—'}</Td>
                <Td><Badge tone={STATUS_TONE[r.status as LeaveStatus]}>{statusLabel(r.status as LeaveStatus)}</Badge></Td>
                <Td className="text-right">
                  {(r.status === 'pending' || (r.status === 'approved' && r.start_date > today)) && (
                    <CancelLeave action={cancelLeaveAction.bind(null, slug)} requestId={r.id} label={`${typeName.get(r.leave_type_id)} ${dateRange(r)}`} />
                  )}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td className="py-8 text-center text-muted">No requests yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>
      {encashments.length > 0 && (
        <Panel title="Encashment requests" flush>
          <Table caption="Your encashment requests">
            <thead><tr><Th>Type</Th><Th>Days</Th><Th>Requested</Th><Th>Status</Th></tr></thead>
            <tbody>
              {encashments.map((e) => (
                <tr key={e.id}><Td>{typeName.get(e.leave_type_id)}</Td><Td className="tabular-nums">{num(e.days)}</Td><Td>{formatDate(e.created_at.slice(0, 10))}</Td>
                  <Td><Badge tone={STATUS_TONE[e.status as LeaveStatus]}>{statusLabel(e.status as LeaveStatus)}</Badge></Td></tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
  );
}

// ─── Rules, balances, accrual history, insights ─────────────────────────────

export async function MyRules({ ctx, me, today }: Ctx) {
  const { mine } = await myData(ctx.org.id, me, today);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">My leave rules — plain English</h2>
          <p className="text-sm text-muted">The leave rules assigned to you and what each one gives you. No HR jargon.</p>
        </div>
        <PrintButton />
      </div>
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
        <span className="mr-2 rounded bg-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">Read-only</span>
        You’re entitled to <span className="font-semibold">{mine.length} leave rule{mine.length === 1 ? '' : 's'}</span>: {mine.map((m) => m.rule.name).join(', ') || 'none yet'}.
      </p>
      <ul className="grid gap-4 lg:grid-cols-2" aria-label="Your leave rules">
        {mine.map(({ rule }) => (
          <li key={rule.id} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center gap-3"><CategoryIcon category={rule.category} />
              <div><h3 className="font-semibold">{rule.name}</h3><p className="text-xs text-muted">{rule.policy && rule.policy.effective_from > '2000-01-01' ? `Effective ${formatDate(rule.policy.effective_from)}` : 'In effect'}</p></div></div>
            {rule.description && <p className="mt-3 text-sm text-muted">{rule.description}</p>}
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{ruleSentences(rule).map((s) => <li key={s}>{s}</li>)}</ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function MyBalances({ ctx, me, today }: Ctx) {
  const { mine, cycle } = await myData(ctx.org.id, me, today);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">My leave balances</h2>
        <p className="text-sm text-muted">Current available balance across every leave type you’re enrolled in — entitlement, used and remaining for the {cycle.label} cycle.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Your balances">
        {mine.map(({ rule, s }) => (
          <li key={rule.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-3"><CategoryIcon category={rule.category} size="sm" /><span className="font-medium">{rule.name}</span></div>
            <p className="mt-2 text-xs text-muted">Accrued {num(s.credited)} this cycle</p>
            <p className="mt-1"><span className="text-2xl font-semibold tabular-nums">{num(rule.allow_negative ? s.applied : s.balance - s.pending)}</span>
              <span className="text-sm text-muted"> {rule.allow_negative ? 'days taken' : `/ ${num(s.carried + s.credited)} days left`}</span></p>
            <p className="text-xs text-muted">Used {num(s.applied)} · {num(s.carried)} carry-forward{s.penalty ? ` · ${num(s.penalty)} penalty` : ''}{s.pending ? ` · ${num(s.pending)} pending` : ''}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function MyAccruals({ ctx, me, today }: Ctx) {
  const settings = await getLeaveSettings(ctx.org.id);
  const cycle = leaveCycle(today, settings.year_start_month);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Accrual history · all leave types</h2>
        <p className="text-sm text-muted">Month-by-month ledger — credited, applied, penalty deductions and closing balance.</p>
      </div>
      <AccrualLedger orgId={ctx.org.id} employeeId={me.id} today={today} cycleStart={cycle.start} label={cycle.label} />
    </div>
  );
}

export async function MyInsights({ ctx, me, today }: Ctx) {
  const { mine, cycle } = await myData(ctx.org.id, me, today);
  const requests = await getRequests(ctx.org.id, { employeeId: me.id, from: cycle.start, to: cycle.end });
  const approved = requests.filter((r) => r.status === 'approved');
  const m0 = Number(cycle.start.slice(5, 7)) - 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = new Date(Date.UTC(Number(cycle.start.slice(0, 4)), m0 + i, 1)).toISOString().slice(0, 7);
    return { label: MONTH_NAMES[(m0 + i) % 12]!.slice(0, 3).toUpperCase(), value: approved.filter((r) => r.start_date.slice(0, 7) === key).reduce((s, r) => s + r.days, 0) };
  });
  const total = approved.reduce((s, r) => s + r.days, 0);
  const longest = approved.reduce((m, r) => Math.max(m, r.days), 0);
  return (
    <div className="space-y-5">
      <section aria-label="This cycle" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Days taken" value={num(total)} note={`${cycle.label} cycle`} tone="primary" />
        <StatCard label="Requests" value={requests.length} note={`${requests.filter((r) => r.status === 'pending').length} pending`} tone="warning" />
        <StatCard label="Longest break" value={`${num(longest)}d`} note="approved" tone="success" />
        <StatCard label="Leave types" value={mine.length} note="assigned to you" tone="info" />
      </section>
      <Panel title="When do I take leave?" meta="approved days by start month">
        <BarChart label="Approved leave days per month" data={months} format={num} empty="No leave history recorded to generate trends." />
      </Panel>
      <Panel title="My pattern by type">
        <ul className="space-y-3" aria-label="Pattern by type">
          {mine.map(({ rule, s }) => {
            const of = rule.allow_negative ? null : s.carried + s.credited;
            return (
              <li key={rule.id} className="grid grid-cols-[140px_1fr_70px] items-center gap-3 text-sm">
                <span className="truncate">{rule.name}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-subtle"><span className="block h-full bg-primary" style={{ width: `${of ? Math.min(100, (s.applied / of) * 100) : 0}%` }} /></span>
                <span className="text-right tabular-nums text-muted">{num(s.applied)}/{of === null ? '—' : num(of)}</span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
