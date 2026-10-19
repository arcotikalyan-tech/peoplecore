import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { CATEGORIES, REPORT_BY_KEY, REPORTS, SCHEDULE_PERIODS, type ReportInfo } from '@/lib/report-catalog';
import { getOrgContext } from '@/server/context';
import { myFiles } from '@/server/profile';
import { canRun, defaultParams, resolvePeriod } from '@/server/reports';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import { createScheduleAction, deleteScheduleAction, deleteTemplateAction, saveTemplateAction } from './actions';
import { AgainButton, DeleteForm, ReportPanel, type PanelDefaults } from './reports-client';

export const metadata: Metadata = { title: 'Reports' };

type Search = Record<string, string | undefined>;

const paramText = (info: ReportInfo | undefined, p: Record<string, unknown>) => {
  if (!info) return '';
  const fy = (y: unknown) => `FY ${y}-${String((Number(y) + 1) % 100).padStart(2, '0')}`;
  if (info.param === 'range' && p.from) return `${formatDate(String(p.from))} – ${formatDate(String(p.to))}`;
  if (info.param === 'month' && p.month) return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${p.month}-01T00:00:00Z`));
  if (info.param === 'year' && p.year) return info.key === 'leave_balance' ? `Leave year ${p.year}` : fy(p.year);
  if (info.param === 'quarter' && p.year) return `Q${p.quarter} ${fy(p.year)}`;
  if (info.param === 'asof' && p.asof) return `As of ${formatDate(String(p.asof))}`;
  return 'Latest data';
};

/**
 * Reports (Kredily's report library): 36 reports in 8 categories, each with its parameters and filters, exported
 * as Excel or CSV and recorded; recently generated files; a custom report builder with saved templates; and
 * scheduled reminders. Only reports the viewer may run are listed, and every report reads through RLS.
 */
export default async function ReportsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const visible = REPORTS.filter((r) => canRun(ctx, r.access));
  if (visible.length === 0) notFound();
  const base = `/app/${slug}/reports`;
  const today = todayIn(ctx.org.timezone);
  const supabase = await createClient();

  const q = (sp.q ?? '').trim().toLowerCase();
  const scheduled = sp.view === 'scheduled';
  const fromSchedule = sp.schedule && /^[0-9a-f-]{36}$/.test(sp.schedule)
    ? (await supabase.from('report_schedules').select('id, report_key, params').eq('id', sp.schedule).maybeSingle()).data : null;
  const selected = REPORT_BY_KEY.get(fromSchedule?.report_key ?? sp.report ?? '');
  const report = selected && canRun(ctx, selected.access) ? selected : undefined;
  const categoryKey = report?.category ?? (CATEGORIES.some((c) => c.key === sp.cat) ? sp.cat! : visible[0]!.category);
  const inCategory = q ? visible.filter((r) => `${r.title} ${r.description}`.toLowerCase().includes(q)) : visible.filter((r) => r.category === categoryKey);
  const active = report ?? (q ? undefined : inCategory[0]);
  const href = (extra: Search) => `${base}?${new URLSearchParams(Object.entries(extra).filter((e): e is [string, string] => !!e[1])).toString()}`;

  const [structure, files, templates, schedules] = await Promise.all([
    getStructure(ctx.org.id),
    myFiles(ctx.org.id).then((rows) => rows.filter((r) => r.entity_type === 'report').slice(0, 8)).catch(() => []),
    supabase.from('report_templates').select('id, name, shared, created_by').eq('organization_id', ctx.org.id).order('name'),
    supabase.from('report_schedules').select('id, report_key, params, frequency, next_run_on, last_run_at').eq('organization_id', ctx.org.id).order('next_run_on'),
  ]);

  let defaults: PanelDefaults | null = null;
  if (active) {
    const d = defaultParams(active, today);
    const sch = fromSchedule?.report_key === active.key ? (fromSchedule.params as Record<string, string>) : null;
    const resolved = sch ? resolvePeriod(active.param, sch.period ?? '', today, active) : {};
    const m = { ...d, ...resolved };
    defaults = { from: m.from, to: m.to, month: m.month, year: m.year, quarter: m.quarter, asof: m.asof, department: sch?.department ?? '', location: sch?.location ?? '', template: sch?.template ?? '' };
  }
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 5 }, (_, i) => thisYear - i);
  const personal = ctx.can('employee.personal.read', 'org') || ctx.can('employee.personal.read', 'team');

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted">{visible.length} reports across {new Set(visible.map((r) => r.category)).size} categories</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" action={base} role="search"><input name="q" defaultValue={sp.q} placeholder="Search all reports…" aria-label="Search all reports"
            className="h-10 w-64 rounded-xl border border-line bg-surface px-3 text-sm" /></form>
          <Link href={scheduled ? base : href({ view: 'scheduled' })} className={`rounded-xl border px-3 py-2 text-sm font-medium ${scheduled ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface'}`}>
            ⏰ Scheduled{schedules.data?.length ? ` (${schedules.data.length})` : ''}</Link>
        </div>
      </header>

      {scheduled ? (
        <section aria-label="Scheduled reports" className="lift-soft rounded-2xl border border-line bg-surface">
          <h2 className="px-5 pt-4 text-sm font-bold uppercase tracking-wide">Scheduled reports</h2>
          <p className="px-5 text-sm text-muted">Each schedule sends you an inbox reminder; opening it generates the report with the latest data and your current access.</p>
          {(schedules.data ?? []).length === 0 ? <p className="px-5 py-6 text-sm text-muted">No schedules yet. Open a report and choose “Schedule this report”.</p> : (
            <ul className="divide-y divide-line" aria-label="Schedules">
              {schedules.data!.map((s) => {
                const info = REPORT_BY_KEY.get(s.report_key);
                const p = s.params as Record<string, string>;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span><span className="font-medium">{info?.title ?? s.report_key}</span>
                      <span className="block text-xs text-muted">{s.frequency === 'weekly' ? 'Every Monday' : '1st of every month'} · {SCHEDULE_PERIODS[info?.param ?? 'none'].find((x) => x.key === p.period)?.label ?? 'Latest data'} · next {formatDate(s.next_run_on)}</span></span>
                    <span className="flex items-center gap-2">
                      <Link className="text-primary hover:underline" href={href({ report: s.report_key, schedule: s.id })}>Open</Link>
                      <DeleteForm action={deleteScheduleAction.bind(null, slug)} field="scheduleId" id={s.id} label={`Remove schedule for ${info?.title ?? s.report_key}`} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,300px)_minmax(0,1fr)]">
          <nav aria-label="Report categories">
            <ul className="space-y-1">
              {CATEGORIES.filter((c) => visible.some((r) => r.category === c.key)).map((c) => {
                const on = !q && c.key === categoryKey;
                return (
                  <li key={c.key}>
                    <Link href={href({ cat: c.key })} aria-current={on ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${on ? 'lift-soft border border-line bg-surface text-primary' : 'text-fg hover:bg-subtle'}`}>
                      <span aria-hidden="true">{c.icon}</span><span className="flex-1">{c.label}</span>
                      <span className="rounded-full bg-subtle px-2 text-xs tabular-nums text-muted">{visible.filter((r) => r.category === c.key).length}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section aria-label="Reports in this category">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
              {q ? `Search · ${inCategory.length} report${inCategory.length === 1 ? '' : 's'}` : `${CATEGORIES.find((c) => c.key === categoryKey)?.label} · ${inCategory.length} reports`}</h2>
            {inCategory.length === 0 ? <p className="text-sm text-muted">No reports match.</p> : (
              <ul className="space-y-2" aria-label="Report list">
                {inCategory.map((r) => (
                  <li key={r.key}>
                    <Link href={href({ report: r.key })} aria-current={active?.key === r.key ? 'true' : undefined}
                      className={`block rounded-2xl border p-3 ${active?.key === r.key ? 'lift-soft border-line bg-surface' : 'border-transparent hover:bg-subtle'}`}>
                      <span className="block text-sm font-semibold">{r.title}</span>
                      <span className="block text-xs text-muted">{r.description}</span>
                      <span className="mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-muted">
                        <span className="rounded bg-subtle px-1.5 py-0.5">{{ range: 'Date range', month: 'Month', year: r.key === 'leave_balance' ? 'Leave year' : 'Financial year', quarter: 'Quarter', asof: 'As-of date', none: 'No params' }[r.param]}</span>
                        <span className="rounded border border-line px-1.5 py-0.5">{r.format.toUpperCase()}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-5">
            {active && defaults ? (
              <section aria-label={active.title} className="lift-soft rounded-2xl border border-line bg-surface p-5">
                <div className="mb-4 flex items-start gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-primary text-lg text-primary-fg" aria-hidden="true">{CATEGORIES.find((c) => c.key === active.category)?.icon}</span>
                  <div>
                    <h2 className="text-lg font-semibold">{active.title}</h2>
                    <p className="text-sm text-muted">{active.description}</p>
                    {fromSchedule && <p className="mt-1 text-xs text-primary">From your schedule: parameters set for today.</p>}
                  </div>
                </div>
                {active.explore && <p className="mb-4 text-sm"><Link className="text-primary hover:underline" href={`/app/${slug}${active.explore}`}>Open in Workforce Intelligence →</Link></p>}
                <ReportPanel key={`${active.key}:${fromSchedule?.id ?? ''}`} exportUrl={`${base}/export`} report={active} defaults={defaults}
                  departments={structure.departments.map((d) => ({ value: d.id, label: d.name }))} locations={structure.locations.map((l) => ({ value: l.id, label: l.name }))}
                  templates={(templates.data ?? []).map((t) => ({ id: t.id, name: t.name, shared: t.shared }))} ownTemplates={(templates.data ?? []).filter((t) => t.created_by === ctx.user.id).map((t) => t.id)}
                  personal={personal} years={years} schedule={createScheduleAction.bind(null, slug)} saveTemplate={saveTemplateAction.bind(null, slug)} deleteTemplate={deleteTemplateAction.bind(null, slug)} />
              </section>
            ) : <p className="text-sm text-muted">Choose a report.</p>}

            <section aria-label="Recently generated" className="lift-soft rounded-2xl border border-line bg-surface">
              <h2 className="px-5 pt-4 text-xs font-bold uppercase tracking-wider text-muted">Recently generated</h2>
              {files.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing yet. Files you generate appear here.</p> : (
                <ul className="divide-y divide-line" aria-label="Recent exports">
                  {files.map((f, i) => {
                    const m = (f.metadata ?? {}) as { report?: string; params?: Record<string, unknown>; row_count?: number };
                    const info = REPORT_BY_KEY.get(m.report ?? '');
                    const qs = new URLSearchParams({ report: m.report ?? '' });
                    for (const [k, v] of Object.entries(m.params ?? {})) { if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x))); else if (v !== null && v !== undefined) qs.set(k, String(v)); }
                    return (
                      <li key={`${f.occurred_at}${i}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                        <span><span className="font-medium">{info?.title ?? 'Report'}</span>
                          <span className="block text-xs text-muted">{paramText(info, m.params ?? {})} · {m.row_count ?? 0} rows · {formatDateTime(f.occurred_at, ctx.org.timezone)}</span></span>
                        {info && canRun(ctx, info.access) && <AgainButton url={`${base}/export?${qs.toString()}`} title={info.title} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
