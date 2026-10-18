import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { BarChart } from '@/components/ui/charts';
import { cn } from '@/components/ui/cn';
import { Panel, StatCard } from '@/components/ui/hub';
import type { OrgContext } from '@/server/context';
import { daySummary, peopleDay, pendingOvertimeCount, structureNames } from '@/server/attendance-ops';
import { createClient } from '@/server/supabase';
import { StatusChip } from './status';

const PULSE_FILTERS = [
  ['all', 'All'], ['present', 'Present'], ['late', 'Late'], ['wfh', 'WFH'], ['on_leave', 'On leave'], ['absent', 'Absent'], ['not_marked', 'Not marked'],
] as const;

/** Admin hub: today across the people the viewer may see. */
export async function AdminHub({ ctx, orgBase, base, today, pulse }: { ctx: OrgContext; orgBase: string; base: string; today: string; pulse: string }) {
  const orgId = ctx.org.id;
  const supabase = await createClient();
  const count = (r: { count: number | null }) => r.count ?? 0;
  const [summary, people, names, anomalies, regs, requests, overtime] = await Promise.all([
    daySummary(orgId, today),
    peopleDay(orgId, today, { page: 1 }),
    structureNames(orgId),
    supabase.from('anomaly_flags').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'open'),
    supabase.from('regularization_requests').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
    supabase.from('attendance_requests').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
    pendingOvertimeCount(orgId),
  ]);
  const by = summary?.byStatus ?? {};
  const present = (by.present ?? 0) + (by.half_day ?? 0) + (by.on_duty ?? 0);
  const wfh = by.wfh ?? 0;
  const onLeave = by.on_leave ?? 0;
  const absent = by.absent ?? 0;
  const headcount = people.total;
  const notMarked = Math.max(0, headcount - present - wfh - onLeave - absent - (by.weekly_off ?? 0) - (by.holiday ?? 0));
  const pct = headcount ? Math.round(((present + wfh) / headcount) * 100) : 0;
  const now = new Intl.DateTimeFormat('en-IN', { timeZone: ctx.org.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date());
  const locName = new Map(names.locations.map((l) => [l.id, l.name]));

  const pulseRows = people.rows.filter((p) => {
    if (pulse === 'all') return true;
    if (pulse === 'late') return p.late > 0;
    if (pulse === 'present') return p.status === 'present' || p.status === 'half_day' || p.status === 'on_duty';
    if (pulse === 'not_marked') return !p.status || p.status === 'not_marked';
    return p.status === pulse;
  });
  const hoursData = Array.from({ length: 15 }, (_, i) => i + 6).map((h) => ({ label: `${h}`, value: summary?.byHour[String(h)] ?? 0 }));

  const signals = [
    { label: 'Anomalies to review', value: count(anomalies), href: `${base}?tab=approvals`, tone: 'text-danger' },
    { label: 'Regularizations waiting', value: count(regs), href: `${base}?tab=approvals`, tone: 'text-warning' },
    { label: 'WFH and on-duty requests', value: count(requests), href: `${base}?tab=approvals`, tone: 'text-ai' },
    { label: 'Overtime to approve', value: overtime, href: `${base}?tab=logs&view=overtime`, tone: 'text-info' },
  ];

  return (
    <div className="space-y-5">
      <section aria-label="Live" className="flex flex-wrap items-center gap-6 rounded-xl border border-primary/25 bg-gradient-to-r from-primary-soft via-surface to-surface px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-success" /></span>
            Live · today
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight">{present} present · {absent} absent · {onLeave} on leave{wfh ? ` · ${wfh} WFH` : ''}</p>
          <p className="text-sm text-muted">{count(anomalies)} anomal{count(anomalies) === 1 ? 'y' : 'ies'} waiting for review</p>
        </div>
        <p className="text-3xl font-semibold tabular-nums tracking-tight">{now}</p>
        <div className="flex gap-6 text-center">
          <div><p className="text-xl font-semibold tabular-nums">{pct}%</p><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Presence</p></div>
          <div><p className="text-xl font-semibold tabular-nums">{summary?.late ?? 0}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Late</p></div>
        </div>
      </section>

      <section aria-label="Today’s figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Present" value={present} note="checked in" tone="success" href={`${base}?tab=hub&pulse=present`} />
        <StatCard label="Late" value={summary?.late ?? 0} note="after the grace time" tone="warning" href={`${base}?tab=hub&pulse=late`} />
        <StatCard label="Work from home" value={wfh} note="approved today" tone="accent" href={`${base}?tab=hub&pulse=wfh`} />
        <StatCard label="On leave" value={onLeave} note="approved leave" tone="info" href={`${base}?tab=hub&pulse=on_leave`} />
        <StatCard label="Absent" value={absent} note="no record" tone="danger" href={`${base}?tab=hub&pulse=absent`} />
        <StatCard label="Not marked" value={notMarked} note="no punch yet" href={`${base}?tab=hub&pulse=not_marked`} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Team pulse" meta={`${people.rows.length < headcount ? `first ${people.rows.length} of ` : ''}${headcount} people`}
          action={<Link href={`${base}?tab=logs`} className="text-sm font-medium text-primary hover:underline">Daily log</Link>}>
          <nav aria-label="Filter the team pulse" className="mb-3 flex flex-wrap gap-1.5">
            {PULSE_FILTERS.map(([k, l]) => (
              <Link key={k} href={`${base}?tab=hub&pulse=${k}`} aria-current={pulse === k ? 'true' : undefined}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', pulse === k ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:text-fg')}>{l}</Link>
            ))}
          </nav>
          {pulseRows.length === 0 ? <p className="py-6 text-center text-sm text-muted">No one here.</p> : (
            <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Team pulse">
              {pulseRows.slice(0, 30).map((p) => (
                <li key={p.id}>
                  <Link href={`${orgBase}/employees/${p.id}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 hover:border-line-strong">
                    <Avatar name={p.name} size="sm" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.name}</span><span className="text-xs text-muted">{p.code}{p.late ? ` · ${p.late} min late` : ''}</span></span>
                    <StatusChip status={p.status} code />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Needs action">
            <ul className="space-y-2" aria-label="Needs action">
              {signals.map((s) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm hover:border-line-strong">
                    <span>{s.label}</span><span className={cn('text-lg font-semibold tabular-nums', s.value ? s.tone : 'text-muted')}>{s.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Check-ins by hour" meta="today">
            <BarChart label="First check-ins by hour today" data={hoursData} height={120} empty="No check-ins yet today." />
          </Panel>
          {summary && summary.byLocation.length > 0 && (
            <Panel title="Presence by location">
              <ul className="space-y-3" aria-label="Presence by location">
                {summary.byLocation.map((l) => (
                  <li key={l.locationId ?? 'none'}>
                    <div className="flex justify-between text-sm"><span>{l.locationId ? locName.get(l.locationId) ?? 'Location' : 'No location'}</span><span className="tabular-nums text-muted">{l.present} / {l.total}</span></div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-success" style={{ width: `${l.total ? (l.present / l.total) * 100 : 0}%` }} /></div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
