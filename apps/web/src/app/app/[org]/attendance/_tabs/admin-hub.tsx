import Link from 'next/link';
import { AlertTriangle, CalendarX2, Clock3, MapPin, Palmtree, UsersRound } from 'lucide-react';
import { addDays } from '@peoplecore/shared';
import { Avatar } from '@/components/ui/avatar';
import { BarChart, Ring, Sparkline } from '@/components/ui/charts';
import { cn } from '@/components/ui/cn';
import type { OrgContext } from '@/server/context';
import { daySummary, peopleDay, pendingOvertimeCount, structureNames } from '@/server/attendance-ops';
import { createClient } from '@/server/supabase';
import { allRows } from '@/server/all-rows';

const STATUS_FILTERS = [
  ['all', 'All status'], ['present', 'Present'], ['late', 'Late'], ['wfh', 'Work from home'], ['on_leave', 'On leave'], ['absent', 'Absent'], ['not_marked', 'Not marked'],
] as const;

const STATUS_TEXT: Record<string, [string, string]> = {
  present: ['Present', 'bg-success'], half_day: ['Half day', 'bg-warning'], on_duty: ['On duty', 'bg-info'], wfh: ['Work from home', 'bg-accent'],
  on_leave: ['On leave', 'bg-info'], absent: ['Absent', 'bg-danger'], weekly_off: ['Weekly off', 'bg-line-strong'], holiday: ['Holiday', 'bg-line-strong'],
  not_marked: ['Not marked', 'bg-danger'],
};

/**
 * The attendance command centre (as Kredily's Hub): a live strip with presence and anomaly gauges, five figures
 * with 7-day trends, the live team pulse (search and status), clock-in density, prioritised signals and the
 * presence map by office and remote.
 */
export async function AdminHub({ ctx, orgBase, base, today, pulse, q }: { ctx: OrgContext; orgBase: string; base: string; today: string; pulse: string; q: string }) {
  const orgId = ctx.org.id;
  const supabase = await createClient();
  const count = (r: { count: number | null }) => r.count ?? 0;
  const weekAgo = addDays(today, -6);
  const [summary, people, names, anomalies, regs, requests, overtime, week, weekFlags, pendingRegs] = await Promise.all([
    daySummary(orgId, today),
    peopleDay(orgId, today, { page: 1, q: q || undefined }),
    structureNames(orgId),
    supabase.from('anomaly_flags').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'open'),
    supabase.from('regularization_requests').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
    supabase.from('attendance_requests').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
    pendingOvertimeCount(orgId),
    allRows((a, b) => supabase.from('attendance_days').select('work_date, status, late_minutes').eq('organization_id', orgId).gte('work_date', weekAgo).lte('work_date', today).order('employee_id').order('work_date').range(a, b)),
    allRows((a, b) => supabase.from('anomaly_flags').select('created_at').eq('organization_id', orgId).gte('created_at', `${weekAgo}T00:00:00Z`).order('id').range(a, b)),
    supabase.from('regularization_requests').select('id, employee_id, work_date, reason, created_at').eq('organization_id', orgId).eq('status', 'pending').order('created_at').limit(5),
  ]);
  const by = summary?.byStatus ?? {};
  const present = (by.present ?? 0) + (by.half_day ?? 0) + (by.on_duty ?? 0) + (by.wfh ?? 0);
  const wfh = by.wfh ?? 0;
  const onLeave = by.on_leave ?? 0;
  const headcount = people.total;
  const off = (by.weekly_off ?? 0) + (by.holiday ?? 0);
  const absent = Math.max(0, headcount - present - onLeave - off);
  const presencePct = headcount - off > 0 ? (present / (headcount - off)) * 100 : 0;
  const anomalyPct = present ? (count(anomalies) / present) * 100 : 0;
  const tz = ctx.org.timezone;
  const now = new Date();
  const clock = new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(now).toUpperCase();
  const dateLine = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const tzShort = new Intl.DateTimeFormat('en-IN', { timeZone: tz, timeZoneName: 'short' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  const locName = new Map(names.locations.map((l) => [l.id, l.name]));
  const nameOf = new Map(people.rows.map((p) => [p.id, p.name]));

  // Last 7 days for the figure trends.
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekAgo, i));
  const wk = week.data ?? [];
  const series = (f: (r: (typeof wk)[number]) => boolean) => days.map((d) => wk.filter((r) => r.work_date === d && f(r)).length);
  const atWork = (s: string) => ['present', 'half_day', 'on_duty', 'wfh'].includes(s);
  const flagSeries = days.map((d) => (weekFlags.data ?? []).filter((f) => f.created_at.slice(0, 10) === d).length);

  const status = (p: (typeof people.rows)[number]) => (p.status ?? 'not_marked');
  const pulseRows = people.rows.filter((p) => {
    if (pulse === 'all') return true;
    if (pulse === 'late') return p.late > 0;
    if (pulse === 'present') return ['present', 'half_day', 'on_duty'].includes(status(p));
    if (pulse === 'absent') return ['absent', 'not_marked'].includes(status(p)) && !p.punches;
    return status(p) === pulse;
  });
  const hoursData = Array.from({ length: 15 }, (_, i) => i + 6).map((h) => ({ label: `${h}`, value: summary?.byHour[String(h)] ?? 0 }));
  const totalCheckins = hoursData.reduce((s, h) => s + h.value, 0);

  const signals = [
    { label: 'Anomalies to review', value: count(anomalies), href: `${base}?tab=approvals`, tone: 'text-danger' },
    { label: 'Regularisations waiting', value: count(regs), href: `${base}?tab=approvals`, tone: 'text-warning' },
    { label: 'WFH and on-duty requests', value: count(requests), href: `${base}?tab=approvals`, tone: 'text-accent' },
    { label: 'Overtime to approve', value: overtime, href: `${base}?tab=logs&view=overtime`, tone: 'text-info' },
  ].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);

  const offices = (summary?.byLocation ?? []).filter((l) => l.locationId);

  return (
    <div className="space-y-5">
      <section aria-label="Live" className="grid items-center gap-6 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary-soft via-surface to-primary-soft/60 px-6 py-5 lg:grid-cols-[1fr_auto_auto]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-success" /></span>
            Live · updated just now
          </p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight">{present} present · {absent} absent · {onLeave} on leave{wfh ? ` · ${wfh} WFH` : ''}</p>
          <p className="mt-1 text-sm text-muted">{count(anomalies)} anomal{count(anomalies) === 1 ? 'y' : 'ies'} pending review</p>
        </div>
        <div className="text-center lg:text-left">
          <p className="text-4xl font-bold tabular-nums tracking-tight">{clock}</p>
          <p className="mt-1 text-xs font-medium text-muted">{dateLine} · {tzShort}</p>
        </div>
        <div className="flex justify-center gap-5">
          <Ring pct={presencePct} label="Presence" tone="success" />
          <Ring pct={anomalyPct} label="Anomaly" tone="danger" />
        </div>
      </section>

      <section aria-label="Today’s figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Figure label="Present today" value={present} note="Clocked in" icon={<UsersRound className="size-4" />} tone="success" href={`${base}?tab=hub&pulse=present`} trend={series((r) => atWork(r.status))} />
        <Figure label="Late today" value={summary?.late ?? 0} note="Late arrivals" icon={<Clock3 className="size-4" />} tone="danger" href={`${base}?tab=hub&pulse=late`} trend={series((r) => atWork(r.status) && r.late_minutes > 0)} />
        <Figure label="On leave" value={onLeave} note="Today" icon={<Palmtree className="size-4" />} tone="accent" href={`${base}?tab=hub&pulse=on_leave`} trend={series((r) => r.status === 'on_leave')} />
        <Figure label="Absent" value={absent} note="No record today" icon={<CalendarX2 className="size-4" />} tone="warning" href={`${base}?tab=hub&pulse=absent`} trend={series((r) => r.status === 'absent')} />
        <Figure label="Anomalies" value={count(anomalies)} note="need review" icon={<AlertTriangle className="size-4" />} tone="info" href={`${base}?tab=approvals`} trend={flagSeries} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-label="Live team pulse" className="lift-soft rounded-2xl border border-line bg-surface p-5">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><span className="size-2.5 rounded-full bg-success" aria-hidden="true" />Live Team Pulse
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Real-time</span></h2>
            <Link href={`${base}?tab=logs`} className="text-sm font-medium text-primary hover:underline">Daily log →</Link>
          </header>
          <form method="get" action={base} className="mb-4 flex flex-wrap gap-2" aria-label="Filter the team pulse">
            <input type="hidden" name="tab" value="hub" />
            <input type="search" name="q" defaultValue={q} placeholder="Search team…" aria-label="Search team"
              className="h-9 min-w-48 flex-1 rounded-lg border border-line bg-subtle/50 px-3 text-sm" />
            <select name="pulse" defaultValue={pulse} aria-label="Status" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
              {STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="h-9 rounded-lg border border-line px-3 text-sm hover:border-line-strong">Apply</button>
          </form>
          {pulseRows.length === 0 ? <p className="py-6 text-center text-sm text-muted">No one here.</p> : (
            <ul className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Team pulse">
              {pulseRows.slice(0, 30).map((p) => {
                const s = status(p);
                const [text, dot] = STATUS_TEXT[s] ?? ['Not marked', 'bg-danger'];
                const label = p.late > 0 && ['present', 'half_day', 'on_duty'].includes(s) ? `Late · ${p.late} min` : (!p.status || s === 'not_marked') && !p.punches ? 'Absent' : text;
                return (
                  <li key={p.id}>
                    <Link href={`${orgBase}/employees/${p.id}`} className="lift flex items-center gap-3 rounded-xl border border-line bg-subtle/30 px-3 py-2.5">
                      <span className="relative">
                        <Avatar name={p.name} />
                        <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface', (!p.status || s === 'not_marked') && !p.punches ? 'bg-danger' : dot)} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.name}</span><span className="text-xs text-muted">{label}</span></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {people.rows.length < headcount && <p className="mt-3 text-xs text-muted">Showing the first {people.rows.length} of {headcount}. Use search or the daily log for everyone.</p>}
        </section>

        <section aria-label="Clock-in density" className="lift-soft rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-4 text-[15px] font-semibold">📊 Clock-In Density · Today</h2>
          {totalCheckins === 0 ? <p className="py-6 text-center text-sm text-muted">No clock-ins recorded yet today.</p>
            : <BarChart label="First check-ins by hour today" data={hoursData} height={170} />}
        </section>
      </div>

      <section aria-label="Active signals" className="lift-soft rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">⚡ Active Signals
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Auto-prioritised</span></h2>
        {signals.length === 0 && (pendingRegs.data ?? []).length === 0 ? <p className="py-3 text-center text-sm text-muted">No pending regularisation requests.</p> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ul className="space-y-2" aria-label="Signals">
              {signals.map((s) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-sm hover:border-line-strong">
                    <span>{s.label}</span><span className={cn('text-lg font-semibold tabular-nums', s.tone)}>{s.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {(pendingRegs.data ?? []).length > 0 && (
              <ul className="space-y-2" aria-label="Oldest regularisations">
                {(pendingRegs.data ?? []).map((r) => (
                  <li key={r.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                    <span className="font-medium">{nameOf.get(r.employee_id) ?? 'Employee'}</span> <span className="text-muted">· {r.work_date} · {r.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section aria-label="Live presence map" className="lift-soft rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold">📍 Live Presence Map
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Geofenced</span></h2>
        <div className="relative h-64 overflow-hidden rounded-xl border border-line bg-primary-soft/40" aria-hidden="true"
          style={{ backgroundImage: 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)', backgroundSize: '64px 64px' }}>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 size-full opacity-60"><path d="M5 25 C 30 5, 55 5, 75 22 S 95 24, 98 24" fill="none" stroke="var(--primary)" strokeWidth="0.3" strokeDasharray="1.2 1.2" /></svg>
          {(offices.length ? offices : [{ locationId: null, present: 0, total: 0 }]).slice(0, 6).map((l, i, all) => (
            <span key={l.locationId ?? 'none'} className="absolute flex items-center gap-2" style={{ left: `${15 + (70 / Math.max(1, all.length)) * i + 70 / Math.max(1, all.length) / 2 - 6}%`, top: `${40 + (i % 2) * 18}%` }}>
              <span className="relative grid size-5 place-items-center rounded-full bg-primary/25"><span className="size-2.5 rounded-full bg-primary" /></span>
              <span className="whitespace-nowrap rounded-lg bg-surface px-2.5 py-1 text-xs font-semibold shadow">{l.locationId ? locName.get(l.locationId) ?? 'Office' : 'Registered office'} · {l.present} present</span>
            </span>
          ))}
        </div>
        <ul className="mt-4 grid gap-3 md:grid-cols-2" aria-label="Presence by location">
          {offices.map((l) => (
            <li key={l.locationId} className="rounded-xl border border-line p-4">
              <p className="flex items-center justify-between font-semibold"><span className="flex items-center gap-2"><MapPin className="size-4 text-primary" aria-hidden="true" />{locName.get(l.locationId!) ?? 'Office'}</span><span className="size-2 rounded-full bg-success" aria-hidden="true" /></p>
              <p className="text-xs text-muted">{l.total} assigned · today</p>
              <p className="mt-3 flex items-center justify-between text-sm"><span>Presence</span><span className="text-xl font-bold tabular-nums text-primary">{l.present}</span></p>
            </li>
          ))}
          <li className="rounded-xl border border-line p-4">
            <p className="flex items-center justify-between font-semibold">Remote · WFH<span className="size-2 rounded-full bg-info" aria-hidden="true" /></p>
            <p className="text-xs text-muted">Distributed · {(summary?.byLocation ?? []).filter((l) => !l.locationId).reduce((s, l) => s + l.total, 0)} without an office</p>
            <p className="mt-3 flex items-center justify-between text-sm"><span>Active</span><span className="text-xl font-bold tabular-nums text-primary">{wfh}</span></p>
          </li>
        </ul>
      </section>
    </div>
  );
}

const TONES = {
  success: ['text-success', 'bg-success-soft text-success', 'from-success-soft/50'], danger: ['text-danger', 'bg-danger-soft text-danger', 'from-danger-soft/50'],
  accent: ['text-accent', 'bg-accent-soft text-accent', 'from-accent-soft/50'], warning: ['text-warning', 'bg-warning-soft text-warning', 'from-warning-soft/50'],
  info: ['text-info', 'bg-info-soft text-info', 'from-info-soft/50'],
} as const;

function Figure({ label, value, note, icon, tone, href, trend }: {
  label: string; value: number; note: string; icon: React.ReactNode; tone: keyof typeof TONES; href: string; trend: number[];
}) {
  const [text, chip, grad] = TONES[tone];
  return (
    <Link href={href} className={cn('lift block rounded-2xl border border-line bg-gradient-to-br to-surface p-4', grad)}>
      <p className="flex items-start justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{label}
        <span className={cn('grid size-7 place-items-center rounded-lg', chip)} aria-hidden="true">{icon}</span></p>
      <p className={cn('text-[26px] font-bold leading-none tabular-nums', text)}>{value}</p>
      <p className={cn('mt-1.5 text-xs', tone === 'danger' ? 'text-danger' : 'text-muted')}>{note}</p>
      <Sparkline values={trend} tone={tone} className="mt-3" />
    </Link>
  );
}
