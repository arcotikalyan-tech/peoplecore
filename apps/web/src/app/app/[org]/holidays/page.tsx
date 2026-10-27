import type { Metadata } from 'next';
import Link from 'next/link';
import { monthCells, todayIn } from '@peoplecore/shared';
import { HubTabs, Panel, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { employeeNames } from '@/server/employees';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import { viewModeFor } from '@/server/view';
import { addHolidayAction, chooseOptionalAction, copyYearAction, deleteCalendarAction, importHolidaysAction, removeHolidayAction, saveCalendarAction } from './actions';
import { CalendarForm, HolidayForm, ImportHolidaysForm, SmallAction } from './holidays-client';
import { requireModule } from '@/server/modules';
import { allRows } from '@/server/all-rows';

export const metadata: Metadata = { title: 'Holidays' };

type Search = Record<string, string | undefined>;
type Event = { date: string; label: string; kind: 'holiday' | 'optional' | 'leave' | 'pending' | 'wfh' | 'on_duty'; title?: string };
const KIND: Record<Event['kind'], { label: string; cls: string }> = {
  holiday: { label: 'Holiday', cls: 'bg-danger-soft text-danger' },
  optional: { label: 'Optional holiday', cls: 'bg-warning-soft text-warning' },
  leave: { label: 'Leave', cls: 'bg-primary-soft text-primary' },
  pending: { label: 'Pending leave', cls: 'border border-dashed border-primary/50 text-primary' },
  wfh: { label: 'WFH', cls: 'bg-info-soft text-info' },
  on_duty: { label: 'On duty', cls: 'bg-success-soft text-success' },
};
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5));
const dow = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();
const monthEnd = (ym: string) => iso(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)));
const shiftMonth = (ym: string, n: number) => iso(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1))).slice(0, 7);

/**
 * Holidays (Kredily's Holiday): a calendar (month or year) with holidays, approved and pending leave, WFH and
 * on-duty days; the holiday list with optional holidays to choose; and, for HR, calendar rules per location.
 */
export default async function HolidaysPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'holidays');
  const base = `/app/${slug}/holidays`;
  const today = todayIn(ctx.org.timezone);
  const admin = ctx.can('leave.manage', 'org') && (await viewModeFor(ctx)) === 'admin';
  const supabase = await createClient();
  const [calendars, structure, mine] = await Promise.all([
    supabase.from('holiday_calendars').select('id, name, location_id, weekly_offs, optional_limit').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
    getStructure(ctx.org.id),
    supabase.rpc('my_holiday_calendar', { p_org: ctx.org.id }).then((r) => r.data as string | null),
  ]);
  calendars.sort((a, b) => (a.location_id ? 1 : 0) - (b.location_id ? 1 : 0) || a.name.localeCompare(b.name));
  const calendar = (admin && calendars.find((c) => c.id === sp.cal)) || calendars.find((c) => c.id === mine) || calendars.find((c) => !c.location_id) || calendars[0];
  const tabs = [{ key: 'calendar', label: '✦ Calendar' }, { key: 'list', label: 'Holiday List' }, ...(admin ? [{ key: 'rules', label: 'Calendar Rules' }] : [])];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'calendar';
  const extra = admin && calendar ? { cal: calendar.id } : undefined;

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Holidays</h1>
          <p className="mt-1 text-sm text-muted">{calendar ? `${calendar.name} · weekly offs ${calendar.weekly_offs.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') || 'none'}` : 'No holiday calendar yet.'}</p>
        </div>
        {admin && calendars.length > 1 && (
          <form method="get" action={base} className="flex items-center gap-2" aria-label="Choose calendar">
            <input type="hidden" name="tab" value={tab} />
            <select name="cal" defaultValue={calendar?.id} aria-label="Calendar" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
              {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="h-9 rounded-lg border border-line px-3 text-sm">Show</button>
          </form>
        )}
      </header>
      <HubTabs base={base} label="Holiday sections" tabs={tabs} current={tab} extra={extra} />
      {!calendar ? <Panel title="Holidays"><p className="text-sm text-muted">No holiday calendar is set up yet.</p></Panel> : (
        <>
          {tab === 'calendar' && <CalendarTab slug={slug} base={base} sp={sp} today={today} calendar={calendar} extra={extra} />}
          {tab === 'list' && <ListTab slug={slug} base={base} sp={sp} today={today} calendar={calendar} admin={admin} mine={calendar.id === mine} extra={extra} />}
          {tab === 'rules' && admin && (
            <RulesTab slug={slug} calendars={calendars} locations={structure.locations.map((l) => ({ id: l.id, name: l.name }))} />
          )}
        </>
      )}
    </>
  );
}

type Calendar = { id: string; name: string; location_id: string | null; weekly_offs: number[]; optional_limit: number };

async function CalendarTab({ slug, base, sp, today, calendar, extra }: { slug: string; base: string; sp: Search; today: string; calendar: Calendar; extra?: Record<string, string> }) {
  const ctx = await getOrgContext(slug);
  const view = sp.view === 'year' ? 'year' : 'month';
  const ym = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : today.slice(0, 7);
  const year = ym.slice(0, 4);
  const from = view === 'year' ? `${year}-01-01` : `${ym}-01`;
  const to = view === 'year' ? `${year}-12-31` : monthEnd(ym);
  const hide = new Set((sp.hide ?? '').split(',').filter(Boolean));
  const supabase = await createClient();
  const [holidays, leaves, requests, types] = await Promise.all([
    supabase.from('holidays').select('holiday_date, name, is_optional').eq('calendar_id', calendar.id).gte('holiday_date', from).lte('holiday_date', to).then((r) => r.data ?? []),
    allRows((a, b) => supabase.from('leave_requests').select('employee_id, leave_type_id, start_date, end_date, status').eq('organization_id', ctx.org.id)
      .in('status', ['approved', 'pending']).lte('start_date', to).gte('end_date', from).order('id').range(a, b)).then((r) => r.data ?? []),
    allRows((a, b) => supabase.from('attendance_requests').select('employee_id, kind, start_date, end_date, status').eq('organization_id', ctx.org.id)
      .in('status', ['approved', 'pending']).lte('start_date', to).gte('end_date', from).order('id').range(a, b)).then((r) => r.data ?? []),
    supabase.from('leave_types').select('id, name').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
  ]);
  const names = await employeeNames(ctx.org.id, [...leaves, ...requests].map((l) => l.employee_id));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const events: Event[] = holidays.map((h) => ({ date: h.holiday_date, label: h.name, kind: h.is_optional ? 'optional' : 'holiday' }));
  const spread = (start: string, end: string, make: (d: string) => Event) => {
    for (let d = start < from ? from : start; d <= end && d <= to; d = addDays(d, 1)) events.push(make(d));
  };
  for (const l of leaves) {
    const who = names.get(l.employee_id) ?? 'Someone';
    spread(l.start_date, l.end_date, (d) => ({ date: d, label: who, kind: l.status === 'approved' ? 'leave' : 'pending', title: `${who} · ${typeName.get(l.leave_type_id) ?? 'Leave'}${l.status === 'pending' ? ' (pending)' : ''}` }));
  }
  for (const r of requests) {
    const who = names.get(r.employee_id) ?? 'Someone';
    spread(r.start_date, r.end_date, (d) => ({ date: d, label: who, kind: r.kind === 'wfh' ? 'wfh' : 'on_duty', title: `${who} · ${r.kind === 'wfh' ? 'Work from home' : 'On duty'}${r.status === 'pending' ? ' (pending)' : ''}` }));
  }
  const shown = events.filter((e) => !hide.has(e.kind));
  const byDay = new Map<string, Event[]>();
  for (const e of shown) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const href = (q: Record<string, string | undefined>) => `${base}?${new URLSearchParams(Object.entries({ ...extra, tab: 'calendar', view, month: ym, hide: [...hide].join(','), ...q }).filter((e): e is [string, string] => !!e[1])).toString()}`;
  const toggle = (k: string) => { const h = new Set(hide); if (h.has(k)) h.delete(k); else h.add(k); return [...h].join(','); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Period" className="flex flex-wrap items-center gap-2 text-sm">
          <Link className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-subtle" href={href({ month: view === 'year' ? `${Number(year) - 1}-01` : shiftMonth(ym, -1) })}>‹ Prev</Link>
          <span className="min-w-36 text-center font-semibold">{view === 'year' ? year : `${MONTHS[Number(ym.slice(5)) - 1]} ${year}`}</span>
          <Link className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-subtle" href={href({ month: view === 'year' ? `${Number(year) + 1}-01` : shiftMonth(ym, 1) })}>Next ›</Link>
          <Link className="text-primary hover:underline" href={href({ month: today.slice(0, 7) })}>Today</Link>
        </nav>
        <SubTabs base={base} label="Calendar view" param="view" current={view} extra={{ ...extra, tab: 'calendar', month: ym }} tabs={[{ key: 'month', label: 'Month' }, { key: 'year', label: 'Year' }]} />
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Show on calendar">
        {(Object.keys(KIND) as Event['kind'][]).map((k) => (
          <li key={k}><Link href={href({ hide: toggle(k) || undefined })} aria-pressed={!hide.has(k)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${hide.has(k) ? 'border-line text-muted line-through' : 'border-line-strong'}`}>
            <span className={`size-2.5 rounded-full ${KIND[k].cls}`} aria-hidden />{KIND[k].label} · {events.filter((e) => e.kind === k).length}</Link></li>
        ))}
      </ul>
      {view === 'month' ? (
        <MonthGrid ym={ym} today={today} offs={calendar.weekly_offs} byDay={byDay} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {MONTHS.map((m, i) => {
            const mm = `${year}-${String(i + 1).padStart(2, '0')}`;
            return (
              <Link key={m} href={href({ view: 'month', month: mm })} className="block rounded-xl border border-line bg-surface p-3 hover:border-primary">
                <p className="mb-2 text-sm font-semibold">{m}</p>
                <MiniMonth ym={mm} today={today} offs={calendar.weekly_offs} byDay={byDay} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonthGrid({ ym, today, offs, byDay }: { ym: string; today: string; offs: number[]; byDay: Map<string, Event[]> }) {
  const cells = monthCells(ym);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] table-fixed border-collapse text-sm" aria-label="Month calendar">
        <thead><tr>{WEEK.map((d) => <th key={d} className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">{d}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: cells.length / 7 }, (_, w) => (
            <tr key={w}>
              {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
                const evs = d ? byDay.get(d) ?? [] : [];
                const off = d ? offs.includes(dow(d)) : false;
                return (
                  <td key={i} className={`h-28 border border-line p-1.5 align-top ${!d ? 'bg-subtle/40' : off ? 'bg-subtle' : 'bg-surface'}`}>
                    {d && (
                      <>
                        <p className={`mb-1 text-xs font-semibold ${d === today ? 'inline-grid size-6 place-items-center rounded-full bg-primary text-primary-fg' : 'text-muted'}`}>{Number(d.slice(8))}</p>
                        <ul className="space-y-0.5" aria-label={formatDate(d)}>
                          {evs.slice(0, 3).map((e, j) => <li key={j} title={e.title ?? e.label} className={`truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND[e.kind].cls}`}>{e.label}</li>)}
                          {evs.length > 3 && <li className="text-[11px] text-muted" title={evs.slice(3).map((e) => e.title ?? e.label).join('\n')}>+{evs.length - 3} more</li>}
                        </ul>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniMonth({ ym, today, offs, byDay }: { ym: string; today: string; offs: number[]; byDay: Map<string, Event[]> }) {
  const cells = monthCells(ym);
  return (
    <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
      {WEEK.map((d) => <span key={d} className="text-muted">{d[0]}</span>)}
      {cells.map((d, i) => {
        const evs = d ? byDay.get(d) ?? [] : [];
        const hol = evs.find((e) => e.kind === 'holiday' || e.kind === 'optional');
        return (
          <span key={i} title={evs.map((e) => e.title ?? e.label).join('\n') || undefined}
            className={`rounded py-0.5 tabular-nums ${!d ? '' : d === today ? 'bg-primary text-primary-fg' : hol ? KIND[hol.kind].cls : evs.length ? 'bg-primary-soft' : offs.includes(dow(d)) ? 'text-muted' : ''}`}>
            {d ? Number(d.slice(8)) : ''}
          </span>
        );
      })}
    </div>
  );
}

async function ListTab({ slug, base, sp, today, calendar, admin, mine, extra }: { slug: string; base: string; sp: Search; today: string; calendar: Calendar; admin: boolean; mine: boolean; extra?: Record<string, string> }) {
  const ctx = await getOrgContext(slug);
  const year = /^\d{4}$/.test(sp.year ?? '') ? sp.year! : today.slice(0, 4);
  const supabase = await createClient();
  const [holidays, choices] = await Promise.all([
    supabase.from('holidays').select('id, holiday_date, name, is_optional, description').eq('calendar_id', calendar.id)
      .gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`).order('holiday_date').then((r) => r.data ?? []),
    supabase.from('optional_holiday_choices').select('holiday_id, employee_id').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
  ]);
  const me = (await supabase.from('employees').select('id').eq('organization_id', ctx.org.id).eq('user_id', ctx.user.id).maybeSingle()).data;
  const chosen = new Set(choices.filter((c) => c.employee_id === me?.id).map((c) => c.holiday_id));
  const taken = holidays.filter((h) => chosen.has(h.id)).length;
  const optional = holidays.filter((h) => h.is_optional).length;
  const yearHref = (y: number) => `${base}?${new URLSearchParams({ ...extra, tab: 'list', year: String(y) }).toString()}`;
  const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title={`Holiday List · ${year}`} meta={`${holidays.length - optional} public · ${optional} optional`} flush
        action={<nav aria-label="Year" className="flex items-center gap-2 text-sm"><Link className="rounded-lg border border-line px-2 py-1" href={yearHref(Number(year) - 1)}>‹ {Number(year) - 1}</Link><Link className="rounded-lg border border-line px-2 py-1" href={yearHref(Number(year) + 1)}>{Number(year) + 1} ›</Link></nav>}>
        {mine && optional > 0 && <p className="px-5 pb-2 text-sm text-muted">You’ve chosen {taken} of {calendar.optional_limit} optional holiday{calendar.optional_limit === 1 ? '' : 's'} for {year}.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Holidays">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Date</th><th className="px-3">Day</th><th className="px-3">Holiday</th><th className="px-3">Type</th><th className="px-3" /></tr></thead>
            <tbody className="divide-y divide-line">
              {holidays.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-muted">No holidays for {year} yet.</td></tr>}
              {holidays.map((h) => (
                <tr key={h.id} className={h.holiday_date < today ? 'text-muted' : ''}>
                  <td className="px-5 py-2 tabular-nums">{formatDate(h.holiday_date)}</td>
                  <td className="px-3">{dayName(h.holiday_date)}</td>
                  <td className="px-3"><span className="font-medium">{h.name}</span>{h.description && <span className="block text-xs text-muted">{h.description}</span>}</td>
                  <td className="px-3">{h.is_optional ? <Badge tone="warning">Optional{admin ? ` · ${choices.filter((c) => c.holiday_id === h.id).length} chose` : ''}</Badge> : <Badge tone="danger">Public</Badge>}</td>
                  <td className="px-3 text-right">
                    <span className="inline-flex items-center gap-2">
                      {mine && h.is_optional && h.holiday_date > today && (
                        <SmallAction action={chooseOptionalAction.bind(null, slug)} fields={{ holidayId: h.id, choose: chosen.has(h.id) ? 'no' : 'yes' }}
                          label={chosen.has(h.id) ? '✓ Taking · Drop' : 'Take this day'} aria={`${chosen.has(h.id) ? 'Drop' : 'Take'} ${h.name}`} variant={chosen.has(h.id) ? 'ghost' : 'secondary'} />
                      )}
                      {admin && <SmallAction action={removeHolidayAction.bind(null, slug)} fields={{ holidayId: h.id }} label="Remove" aria={`Remove ${h.name}`} />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {admin && (
        <div className="space-y-5">
          <Panel title="Add holiday"><HolidayForm action={addHolidayAction.bind(null, slug)} calendarId={calendar.id} year={year} /></Panel>
          <Panel title="Import or copy">
            <div className="space-y-3">
              <ImportHolidaysForm action={importHolidaysAction.bind(null, slug)} calendarId={calendar.id} exportHref={`${base}/export?cal=${calendar.id}&year=${year}`} />
              <SmallAction action={copyYearAction.bind(null, slug)} fields={{ calendarId: calendar.id, year }} label={`Copy ${year} to ${Number(year) + 1}`} aria="Copy holidays to next year" variant="secondary" />
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

async function RulesTab({ slug, calendars, locations }: { slug: string; calendars: Calendar[]; locations: Array<{ id: string; name: string }> }) {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const emps = (await supabase.from('employees').select('location_id').eq('organization_id', ctx.org.id).neq('status', 'exited')).data ?? [];
  const own = new Set(calendars.filter((c) => c.location_id).map((c) => c.location_id));
  const follows = (c: Calendar) => emps.filter((e) => (c.location_id ? e.location_id === c.location_id : !own.has(e.location_id))).length;
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const free = locations.filter((l) => !own.has(l.id));
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Calendars" meta="Each location can have its own holidays and weekly offs; everyone else follows the default.">
        <ul className="divide-y divide-line" aria-label="Calendars">
          {calendars.map((c) => (
            <li key={c.id} className="space-y-3 py-4">
              <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><span className="font-semibold">{c.name}</span> · {c.location_id ? locName.get(c.location_id) ?? 'Location' : 'Default'} · {follows(c)} employee{follows(c) === 1 ? '' : 's'}</span>
                {c.location_id && <SmallAction action={deleteCalendarAction.bind(null, slug)} fields={{ calendarId: c.id }} label="Remove" aria={`Remove calendar ${c.name}`} />}
              </p>
              <CalendarForm action={saveCalendarAction.bind(null, slug)} calendar={c} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Add a calendar for a location">
        {free.length === 0 ? <p className="text-sm text-muted">Every location already has its own calendar.</p>
          : <CalendarForm action={saveCalendarAction.bind(null, slug)} locations={free.map((l) => ({ value: l.id, label: l.name }))} />}
      </Panel>
    </div>
  );
}
