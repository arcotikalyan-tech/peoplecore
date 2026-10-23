import Link from 'next/link';
import { SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate, humanize } from '@/lib/format';
import { getMyMonth, getRegularizations } from '@/server/attendance';
import { attendanceRequests, myRule } from '@/server/attendance-ops';
import { punchesOn } from '@/server/profile';
import { Empty, Fields, Panel, type ProfileProps } from './shared';
import { WeekGrid } from './workweek';

const STATUS: Record<string, { label: string; cls: string }> = {
  present: { label: 'P', cls: 'bg-success/20 text-success' },
  half_day: { label: 'HD', cls: 'bg-warning/25 text-warning' },
  absent: { label: 'A', cls: 'bg-danger/20 text-danger' },
  on_leave: { label: 'L', cls: 'bg-info/20 text-info' },
  weekly_off: { label: 'WO', cls: 'bg-subtle text-muted' },
  holiday: { label: 'H', cls: 'bg-accent/20 text-accent' },
  not_marked: { label: '—', cls: 'bg-subtle text-muted' },
};
const shiftMonth = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const shiftDay = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hm = (mins: number) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;

/** Attendance: calendar, daily logs (punches), the rule that applies, and requests. */
export async function AttendanceTab(p: ProfileProps) {
  const { ctx, id, sp, today, href, base, isSelf, slug } = p;
  const view = ['calendar', 'logs', 'rule', 'requests'].includes(sp.view ?? '') ? sp.view! : 'calendar';
  const tabs = [{ key: 'calendar', label: '📅 Calendar' }, { key: 'logs', label: '📊 Logs' }, { key: 'rule', label: '📐 My Rule' }, { key: 'requests', label: '📩 My Requests' }];
  const path = href('attendance').split('?')[0]!;
  const nav = <SubTabs base={path} extra={{ tab: 'attendance' }} tabs={tabs} current={view} label="Attendance sections" />;
  const tz = ctx.org.timezone;
  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');

  if (view === 'calendar') {
    const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') && sp.month! <= today.slice(0, 7) ? sp.month! : today.slice(0, 7);
    const days = await getMyMonth(id, `${month}-01`).catch(() => [] as Awaited<ReturnType<typeof getMyMonth>>);
    const byDate = new Map(days.map((d) => [d.work_date, d]));
    const first = new Date(`${month}-01T00:00:00Z`);
    const lead = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const totals = days.reduce((a, d) => { a[d.status] = (a[d.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
    return (
      <>
        {nav}
        <Panel title={new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}
          actions={<span className="flex gap-2 text-sm">
            <Link className="rounded-lg px-2 py-1 hover:bg-subtle" href={href('attendance', { view: 'calendar', month: shiftMonth(month, -1) })}>‹ Previous</Link>
            {month < today.slice(0, 7) && <Link className="rounded-lg px-2 py-1 hover:bg-subtle" href={href('attendance', { view: 'calendar', month: shiftMonth(month, 1) })}>Next ›</Link>}
          </span>}>
          <div className="px-5 py-4">
            <ol className="grid grid-cols-7 gap-1 text-center text-xs" aria-label="Attendance calendar">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <li key={d} className="py-1 font-semibold text-muted" aria-hidden="true">{d}</li>)}
              {Array.from({ length: lead }, (_, i) => <li key={`x${i}`} aria-hidden="true" />)}
              {Array.from({ length: count }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                const d = byDate.get(date);
                const s = d ? STATUS[d.status] : undefined;
                return (
                  <li key={date} aria-label={`${formatDate(date)}: ${d ? humanize(d.status) : date > today ? 'upcoming' : 'no record'}`}>
                    <Link href={href('attendance', { view: 'logs', date })} className={`block rounded-lg border border-line py-2 ${date === today ? 'ring-2 ring-primary' : ''}`}>
                      <span className="block font-semibold">{i + 1}</span>
                      <span className={`mx-auto mt-1 block w-fit rounded px-1.5 text-[10px] font-semibold ${s?.cls ?? 'text-transparent'}`}>{s?.label ?? '·'}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
            <ul className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
              {Object.entries(STATUS).map(([k, s]) => <li key={k} className="flex items-center gap-1"><span className={`rounded px-1.5 font-semibold ${s.cls}`}>{s.label}</span>{humanize(k)} {totals[k] ? `(${totals[k]})` : ''}</li>)}
            </ul>
          </div>
        </Panel>
      </>
    );
  }

  if (view === 'logs') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= today ? sp.date! : today;
    const local = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
    const punches = (await punchesOn(ctx.org.id, id, date)).filter((x) => local(x.punched_at) === date);
    const day = (await getMyMonth(id, `${date.slice(0, 7)}-01`).catch(() => [] as Awaited<ReturnType<typeof getMyMonth>>)).find((d) => d.work_date === date);
    return (
      <>
        {nav}
        <Panel title={`📅 Daily Log · ${formatDate(date)}`} actions={<span className="flex gap-2 text-sm">
          <Link className="rounded-lg px-2 py-1 hover:bg-subtle" href={href('attendance', { view: 'logs', date: shiftDay(date, -1) })}>‹ Previous</Link>
          {date < today && <Link className="rounded-lg px-2 py-1 hover:bg-subtle" href={href('attendance', { view: 'logs', date: shiftDay(date, 1) })}>Next ›</Link>}
        </span>}>
          <Fields items={[
            { label: '↓ Clock in', value: time(punches[0]?.punched_at ?? day?.first_in ?? null) },
            { label: '↑ Clock out', value: punches.length > 1 ? time(punches.at(-1)!.punched_at) : time(day?.last_out ?? null) },
            { label: '⏱ Work duration', value: day?.worked_minutes ? hm(day.worked_minutes) : '—' },
            { label: 'Status', value: day ? humanize(day.status) : '—' },
            { label: 'Late by', value: day?.late_minutes ? `${day.late_minutes} min` : '—' },
            { label: 'Regularized', value: day?.is_regularized ? 'Yes' : 'No' },
          ]} />
          {punches.length === 0 ? <Empty icon="🕘" title="No attendance record for this date" /> : (
            <div className="overflow-x-auto px-5 pb-3">
              <table className="w-full text-sm" aria-label="Punches">
                <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="py-2">SI No</th><th>Time</th><th>Type</th><th>Location</th><th>Photo</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {punches.map((x, i) => (
                    <tr key={x.id}><td className="py-2">{i + 1}</td><td>{time(x.punched_at)}</td><td>{i % 2 === 0 ? 'In' : 'Out'} · {humanize(x.method)}</td>
                      <td>{x.latitude !== null && x.longitude !== null ? `${Number(x.latitude).toFixed(4)}, ${Number(x.longitude).toFixed(4)}` : '—'}</td>
                      <td className="py-1">{x.selfie_path ? (
                        <a href={`/app/${slug}/attendance/selfie/${x.id}`} target="_blank" rel="noreferrer" aria-label={`Check-in photo at ${time(x.punched_at)}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link behind a permission check */}
                          <img src={`/app/${slug}/attendance/selfie/${x.id}`} alt={`Check-in photo at ${time(x.punched_at)}`} className="size-10 rounded-md object-cover" loading="lazy" />
                        </a>) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </>
    );
  }

  if (view === 'rule') {
    const { shift, week } = await myRule(ctx.org.id, id, today);
    return (
      <>
        {nav}
        <p className="mb-4 rounded-xl border border-line bg-subtle/60 px-4 py-3 text-sm">🔒 Read-only view. The attendance rule is set by HR. To request a change, raise a ticket in Helpdesk.</p>
        <div className="space-y-5">
          <Panel title="My Attendance Rule">
            <Fields items={[
              { label: 'Shift', value: shift ? `${shift.name} (${shift.code})` : null },
              { label: 'In time → Out time', value: shift ? `${shift.start_time.slice(0, 5)} to ${shift.end_time.slice(0, 5)}` : null },
              { label: 'Break', value: shift ? `${shift.break_minutes} min` : null },
              { label: 'Grace period', value: shift ? `${shift.grace_minutes} min` : null },
              { label: 'Full day', value: shift ? hm(shift.full_day_minutes) : null },
              { label: 'Half day', value: shift ? hm(shift.half_day_minutes) : null },
            ]} />
          </Panel>
          {week && <Panel title={`Work Week · ${week.name}`}><WeekGrid pattern={week.pattern} /></Panel>}
        </div>
      </>
    );
  }

  const [requests, regularizations] = await Promise.all([attendanceRequests(ctx.org.id, { employeeId: id }), getRegularizations(ctx.org.id, id)]);
  const tone = (s: string) => (s === 'approved' ? 'success' : s === 'pending' ? 'warning' : s === 'rejected' ? 'danger' : 'neutral') as 'success';
  const rows = [
    ...requests.map((r) => ({ id: r.id, kind: r.kind === 'wfh' ? 'Work from home' : 'On duty', dates: r.start_date === r.end_date ? formatDate(r.start_date) : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`, reason: r.reason, status: r.status, at: r.created_at })),
    ...regularizations.map((r) => ({ id: r.id, kind: 'Regularization', dates: formatDate(r.work_date), reason: r.reason, status: r.status, at: r.created_at })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      {nav}
      <Panel title="My Requests" actions={isSelf ? <Link className="text-sm text-primary hover:underline" href={`${base}/attendance`}>+ New request</Link> : undefined}>
        {rows.length === 0 ? <Empty icon="📩" title="No requests" /> : (
          <ul className="divide-y divide-line" aria-label="Attendance requests">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span><span className="font-medium">{r.kind}</span> · {r.dates}{r.reason && <span className="block text-xs text-muted">{r.reason}</span>}</span>
                <Badge tone={tone(r.status)}>{humanize(r.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
