'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { BUILDER_COLUMNS, BUILDER_GROUPS, SCHEDULE_PERIODS, type ReportInfo } from '@/lib/report-catalog';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
interface Option { value: string; label: string }
export interface PanelDefaults { from: string; to: string; month: string; year: string; quarter: string; asof: string; department: string; location: string; template: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const label = 'mb-1 block text-xs font-medium text-muted';
const control = 'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm';

/** Downloads the export (or follows its link); a problem is shown instead of navigating away. */
async function download(url: string): Promise<string | null> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await res.json()) as { message?: string; link?: string };
    if (body.link) { window.location.assign(body.link); return null; }
    return body.message ?? 'The report could not be generated.';
  }
  if (!res.ok) return 'The report could not be generated.';
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'report.xlsx';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return null;
}

export function ReportPanel({ exportUrl, report, defaults, departments, locations, templates, personal, years, schedule, saveTemplate, ownTemplates, deleteTemplate }: {
  exportUrl: string;
  report: ReportInfo;
  defaults: PanelDefaults;
  departments: Option[];
  locations: Option[];
  templates: Array<{ id: string; name: string; shared: boolean }>;
  ownTemplates: string[];
  personal: boolean;
  years: number[];
  schedule: Action;
  saveTemplate: Action;
  deleteTemplate: Action;
}) {
  const [v, setV] = useState(defaults);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [columns, setColumns] = useState<string[]>(['code', 'name', 'department', 'designation', 'doj']);
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof PanelDefaults) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const fyLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

  const query = () => {
    const q = new URLSearchParams({ report: report.key, format });
    if (report.param === 'range') { q.set('from', v.from); q.set('to', v.to); }
    if (report.param === 'month') q.set('month', v.month);
    if (report.param === 'year' || report.param === 'quarter') q.set('year', v.year);
    if (report.param === 'quarter') q.set('quarter', v.quarter);
    if (report.param === 'asof') q.set('asof', v.asof);
    if (report.filters && v.department) q.set('department', v.department);
    if (report.filters && v.location) q.set('location', v.location);
    if (report.key === 'saved_templates' && v.template) q.set('template', v.template);
    if (report.key === 'custom_builder') { for (const c of columns) q.append('columns', c); if (group) q.set('group', group); }
    return `${exportUrl}?${q.toString()}`;
  };
  const generate = async () => {
    setBusy(true); setProblem(null); setDone(false);
    try { const p = await download(query()); setProblem(p); setDone(!p); } catch { setProblem('The report could not be generated. Check your connection and try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <section aria-label="Parameters">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Parameters</h3>
        {report.param === 'none' && report.key !== 'custom_builder' && report.key !== 'saved_templates' && <p className="text-sm text-muted">No parameters needed — uses the current data.</p>}
        {report.param === 'range' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={label}>From</span><input type="date" className={control} value={v.from} onChange={set('from')} aria-label="From" /></label>
            <label><span className={label}>To</span><input type="date" className={control} value={v.to} onChange={set('to')} aria-label="To" /></label>
          </div>
        )}
        {report.param === 'month' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={label}>Year</span>
              <select className={control} aria-label="Year" value={v.month.slice(0, 4)} onChange={(e) => setV((x) => ({ ...x, month: `${e.target.value}-${x.month.slice(5, 7)}` }))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select></label>
            <label><span className={label}>Month</span>
              <select className={control} aria-label="Month" value={v.month.slice(5, 7)} onChange={(e) => setV((x) => ({ ...x, month: `${x.month.slice(0, 4)}-${e.target.value}` }))}>
                {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
              </select></label>
          </div>
        )}
        {(report.param === 'year' || report.param === 'quarter') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={label}>{report.key === 'leave_balance' ? 'Leave year' : 'Financial year'}</span>
              <select className={control} aria-label={report.key === 'leave_balance' ? 'Leave year' : 'Financial year'} value={v.year} onChange={set('year')}>
                {years.map((y) => <option key={y} value={y}>{report.key === 'leave_balance' ? y : `FY ${fyLabel(y)}`}</option>)}
              </select></label>
            {report.param === 'quarter' && (
              <label><span className={label}>Quarter</span>
                <select className={control} aria-label="Quarter" value={v.quarter} onChange={set('quarter')}>
                  {['Q1 (Apr–Jun)', 'Q2 (Jul–Sep)', 'Q3 (Oct–Dec)', 'Q4 (Jan–Mar)'].map((q, i) => <option key={q} value={i + 1}>{q}</option>)}
                </select></label>
            )}
          </div>
        )}
        {report.param === 'asof' && (
          <label className="block max-w-xs"><span className={label}>As of</span><input type="date" className={control} value={v.asof} onChange={set('asof')} aria-label="As of" /></label>
        )}
        {report.key === 'saved_templates' && (
          templates.length === 0 ? <p className="text-sm text-muted">No saved templates yet. Build one in Custom Report Builder and save it.</p> : (
            <fieldset className="space-y-1">
              <legend className={label}>Template</legend>
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="tpl" checked={v.template === t.id} onChange={() => setV((x) => ({ ...x, template: t.id }))} className="accent-primary" />
                    {t.name}{t.shared && <span className="text-xs text-muted">· shared</span>}</label>
                  {ownTemplates.includes(t.id) && <DeleteForm action={deleteTemplate} field="templateId" id={t.id} label={`Delete template ${t.name}`} />}
                </div>
              ))}
            </fieldset>
          )
        )}
        {report.key === 'custom_builder' && (
          <div className="space-y-3">
            <fieldset>
              <legend className={label}>Columns ({columns.length})</legend>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {BUILDER_COLUMNS.filter((c) => personal || !c.personal).map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" checked={columns.includes(c.key)}
                      onChange={() => setColumns((cs) => (cs.includes(c.key) ? cs.filter((x) => x !== c.key) : [...cs, c.key]))} />{c.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block max-w-xs"><span className={label}>Group by</span>
              <select className={control} aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">No grouping</option>
                {BUILDER_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select></label>
          </div>
        )}
      </section>

      {report.filters && (
        <section aria-label="Filters" className="grid gap-3 sm:grid-cols-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted sm:col-span-2">Filters (optional)</h3>
          <label><span className={label}>Department</span>
            <select className={control} aria-label="Department" value={v.department} onChange={set('department')}>
              <option value="">All departments</option>{departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select></label>
          <label><span className={label}>Location</span>
            <select className={control} aria-label="Location" value={v.location} onChange={set('location')}>
              <option value="">All locations</option>{locations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select></label>
        </section>
      )}

      <section aria-label="Format">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Format</h3>
        {report.format === 'xlsx' ? (
          <div className="inline-flex gap-1 rounded-xl border border-line p-1" role="radiogroup" aria-label="File format">
            {(['xlsx', 'csv'] as const).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => setFormat(f)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${format === f ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg'}`}>{f === 'xlsx' ? 'Excel' : 'CSV'}</button>
            ))}
          </div>
        ) : <p className="text-sm text-muted">{report.format === 'txt' ? 'EPFO text file (upload as is to the unified portal).' : 'CSV working for the return utility.'}</p>}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={generate} disabled={busy || (report.key === 'saved_templates' && !v.template) || (report.key === 'custom_builder' && columns.length === 0)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-60">
          {busy ? 'Generating…' : '⬇ Generate & export'}
        </button>
        {done && <span role="status" className="text-sm text-success">Downloaded.</span>}
        {problem && <p role="alert" className="w-full rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p>}
      </div>

      {report.key === 'custom_builder' && <SaveTemplateForm action={saveTemplate} columns={columns} group={group} />}
      <ScheduleForm action={schedule} report={report} department={v.department} location={v.location} template={v.template} />
    </div>
  );
}

function SaveTemplateForm({ action, columns, group }: { action: Action; columns: string[]; group: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Save as template" className="space-y-2 rounded-xl border border-line p-3">
      <FormMessage state={state} />
      {columns.map((c) => <input key={c} type="hidden" name="columns" value={c} />)}
      <input type="hidden" name="group" value={group} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1"><span className={label}>Save these columns as a template</span>
          <input name="templateName" aria-label="Template name" placeholder="e.g. Monthly headcount" className={control} defaultValue={state.ok ? '' : state.values?.templateName} /></label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="shared" className="size-4 accent-primary" />Share with my organization</label>
        <SubmitButton size="sm">Save template</SubmitButton>
      </div>
      {state.fieldErrors?.templateName && <p className="text-xs text-danger">{state.fieldErrors.templateName}</p>}
    </form>
  );
}

function ScheduleForm({ action, report, department, location, template }: { action: Action; report: ReportInfo; department: string; location: string; template: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-primary hover:underline">⏰ Schedule this report</button>;
  return (
    <form action={formAction} aria-label="Schedule report" className="space-y-2 rounded-xl border border-line p-3">
      <FormMessage state={state} />
      <input type="hidden" name="report" value={report.key} />
      <input type="hidden" name="department" value={department} />
      <input type="hidden" name="location" value={location} />
      <input type="hidden" name="template" value={template} />
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label><span className={label}>Remind me</span>
          <select name="frequency" aria-label="Frequency" className={control} defaultValue="monthly"><option value="monthly">Monthly (1st)</option><option value="weekly">Weekly (Monday)</option></select></label>
        <label><span className={label}>For</span>
          <select name="period" aria-label="Period" className={control}>{SCHEDULE_PERIODS[report.param].map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
        <SubmitButton size="sm">Schedule</SubmitButton>
      </div>
      <p className="text-xs text-muted">You get an inbox reminder with the report ready to generate with the latest data. Nothing is generated or sent in the background.</p>
    </form>
  );
}

export function DeleteForm({ action, field, id, label: aria }: { action: Action; field: string; id: string; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name={field} value={id} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant="ghost" pendingLabel="Removing…" aria-label={aria}>Remove</SubmitButton>
    </form>
  );
}

/** "Get again" for a recent export: same report, same parameters, latest data. */
export function AgainButton({ url, title }: { url: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {problem && <span role="alert" className="text-xs text-danger">{problem}</span>}
      <button type="button" disabled={busy} aria-label={`Get ${title} again`} className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
        onClick={async () => { setBusy(true); setProblem(await download(url).catch(() => 'Failed.')); setBusy(false); }}>{busy ? '…' : '☁ Get again'}</button>
    </span>
  );
}
