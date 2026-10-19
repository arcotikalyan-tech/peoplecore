import type { Metadata } from 'next';
import Link from 'next/link';
import {
  FORM_CLASSES, hasCalendar, isStateCode, jurisdictionName, obligationsDue, obligationsForPeriod, REGIMES, STAT_FORMS, STATES,
  todayIn, type FormClass, type Obligation, type Regime, type ScopeFacts, type StatForm, type StateCode,
} from '@peoplecore/shared';
import { HubHeader, HubTabs, Panel, StatCard } from '@/components/ui/hub';
import { Alert, Badge } from '@/components/ui/surface';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { REPORT_BY_KEY } from '@/lib/report-catalog';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { requireModule } from '@/server/modules';
import { alerts, evaluations, scopeOf, statutoryFacts, statutoryFilings, type Filing, type StatutoryFacts } from '@/server/statutory';
import { createClient } from '@/server/supabase';
import { viewModeFor } from '@/server/view';
import { recordFilingAction, reopenFilingAction, saveRegistrationAction, saveScopeAction } from './actions';
import { FilingForm, RegistrationForm, ReopenForm, ScopeForm } from './statutory-client';

export const metadata: Metadata = { title: 'Compliance' };

type Search = Record<string, string | undefined>;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const btn = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-subtle';
const dayMonth = (d: string) => `${d.slice(8, 10)} ${SHORT[Number(d.slice(5, 7)) - 1]}`;
const fullDate = (d: string) => `${dayMonth(d)} ${d.slice(0, 4)}`;
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const shiftMonth = (ym: string, by: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const lastOfMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * Compliance (Kredily's statutory engine). Applicability is evaluated live from headcount by state, payroll switches,
 * company codes and the scope settings; due dates come from each form's rule. Filings, registrations and proofs are
 * recorded by statutory.manage holders. Employees see their own statutory details.
 */
export default async function StatutoryPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'statutory');
  const base = `/app/${slug}/statutory`;
  const today = todayIn(ctx.org.timezone);
  const manages = ctx.can('statutory.manage', 'org') && (await viewModeFor(ctx)) === 'admin';
  if (!manages) return <MyStatutory slug={slug} orgId={ctx.org.id} userId={ctx.user.id} />;

  const [facts, filings] = await Promise.all([statutoryFacts(ctx.org.id), statutoryFilings(ctx.org.id)]);
  const real = scopeOf(facts);
  const sim = /^\d{1,6}$/.test(sp.sim ?? '') ? Number(sp.sim) : null;
  // Simulating a headcount scales every establishment in proportion, so state thresholds move too.
  const scope: ScopeFacts = sim === null ? real : {
    ...real, headcount: sim,
    byState: Object.fromEntries(Object.entries(real.byState).map(([k, n]) => [k, real.headcount ? Math.max(1, Math.round((n * sim) / real.headcount)) : 0])),
  };
  const evals = evaluations(scope, today);
  const forms = evals.filter((e) => e.applies).map((e) => e.form);
  const ids = new Set(forms.map((f) => f.id));
  const filingOf = new Map(filings.map((x) => [`${x.form_id}|${x.period_start}`, x]));
  const states = [...new Set(facts.establishments.filter((e) => e.headcount > 0 && isStateCode(e.state)).map((e) => e.state as StateCode))].sort();

  const tabs = [
    { key: 'overview', label: 'Overview' }, { key: 'calendar', label: 'Calendar' }, { key: 'documents', label: 'Documents' },
    { key: 'library', label: 'Library', count: STAT_FORMS.length }, { key: 'regime', label: 'Regime Map' }, { key: 'engine', label: 'Engine Console' },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'overview';
  const p: Props = { slug, base, today, sp, facts, scope, evals, forms, ids, filings, filingOf, states, sim };

  return (
    <>
      <HubHeader title="Compliance" badge="Statutory engine"
        subtitle="Registers, returns, registrations, challans, wage slips and notices — central and state, Labour Codes and continuing laws — with due dates worked out from your headcount, establishments and payroll."
        actions={<><Link className={btn} href={`${base}?tab=calendar`}>Open calendar</Link><Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}?tab=documents`}>This period’s documents</Link></>} />
      <HubTabs base={base} label="Compliance sections" tabs={tabs} current={tab} extra={sim === null ? undefined : { sim: String(sim) }} />
      {sim !== null && (
        <div className="mb-4"><Alert tone="info" title={`Simulating ${sim} employee${sim === 1 ? '' : 's'}`}>Nothing is saved. <Link className="text-primary underline" href={`${base}?tab=${tab}`}>Stop simulating</Link></Alert></div>
      )}
      {tab === 'overview' && <Overview {...p} />}
      {tab === 'calendar' && <Calendar {...p} />}
      {tab === 'documents' && <Documents {...p} />}
      {tab === 'library' && <Library {...p} />}
      {tab === 'regime' && <RegimeMap {...p} />}
      {tab === 'engine' && <Engine {...p} />}
    </>
  );
}

interface Props {
  slug: string; base: string; today: string; sp: Search; facts: StatutoryFacts; scope: ScopeFacts;
  evals: ReturnType<typeof evaluations>; forms: StatForm[]; ids: Set<string>; filings: Filing[]; filingOf: Map<string, Filing>;
  states: StateCode[]; sim: number | null;
}

type Status = 'filed' | 'not_applicable' | 'overdue' | 'upcoming' | 'blocked' | 'ready';
function statusOf(o: Obligation, p: Props, forDocuments = false): { status: Status; filing?: Filing } {
  const filing = p.filingOf.get(`${o.form.id}|${o.periodStart}`);
  if (filing) return { status: filing.status, filing };
  if (forDocuments && o.form.payroll && !p.facts.locked_months.includes(o.periodEnd.slice(0, 7))) return { status: 'blocked' };
  if (o.due < p.today) return { status: 'overdue' };
  return { status: forDocuments && o.form.render ? 'ready' : 'upcoming' };
}
const STATUS_BADGE: Record<Status, { tone: 'success' | 'neutral' | 'danger' | 'primary' | 'warning'; label: string }> = {
  filed: { tone: 'success', label: 'Filed' }, not_applicable: { tone: 'neutral', label: 'Not applicable' }, overdue: { tone: 'danger', label: 'Overdue' },
  upcoming: { tone: 'primary', label: 'Upcoming' }, blocked: { tone: 'warning', label: 'Needs locked payroll' }, ready: { tone: 'primary', label: 'Ready to render' },
};

function renderHref(p: Props, o: Obligation): string | null {
  const r = o.form.render;
  if (!r) return null;
  const app = `/app/${p.slug}`;
  if ('page' in r) return { payslips: `${app}/payroll?tab=run`, tax: `${app}/payroll?tab=declarations`, letters: `${app}/letters`, holidays: `${app}/holidays?tab=list` }[r.page];
  const q = /^Q(\d)/.exec(o.label)?.[1];
  const params = new URLSearchParams({ report: r.report, month: o.periodEnd.slice(0, 7), from: o.periodStart, to: o.periodEnd, year: o.periodStart.slice(0, 4) });
  if (q) params.set('quarter', q);
  return `${app}/reports?${params.toString()}`;
}

function FormCell({ form }: { form: StatForm }) {
  return (
    <div className="min-w-0">
      <p className="font-medium">{form.form} · {form.name}</p>
      <p className="text-xs text-muted">{form.id} · {form.act}</p>
    </div>
  );
}

function ObligationRows({ list, p, documents }: { list: Obligation[]; p: Props; documents?: boolean }) {
  return list.map((o) => {
    const { status, filing } = statusOf(o, p, documents);
    const href = renderHref(p, o);
    const badge = STATUS_BADGE[status];
    return (
      <tr key={`${o.form.id}|${o.periodStart}`}>
        <Td className="whitespace-nowrap tabular-nums">{o.due.slice(0, 4) === p.today.slice(0, 4) ? dayMonth(o.due) : fullDate(o.due)}</Td>
        <Td><FormCell form={o.form} /></Td>
        <Td className="whitespace-nowrap">{o.label}</Td>
        <Td className="whitespace-nowrap">{jurisdictionName(o.form.jurisdiction)}</Td>
        <Td><Badge tone={badge.tone}>{badge.label}</Badge>{filing?.filed_on && <p className="mt-1 text-xs text-muted">{fullDate(filing.filed_on)}{filing.reference ? ` · ${filing.reference}` : ''}</p>}</Td>
        <Td className="w-36 whitespace-nowrap text-right">
          <div className="flex flex-col items-end gap-1">
            {href && status !== 'blocked' && <Link className="text-xs font-medium text-primary hover:underline" href={href}>Render →</Link>}
            {filing?.proof_name && <a className="text-xs text-primary hover:underline" href={`${p.base}/proof/${filing.id}`}>⬇ {filing.proof_name}</a>}
            {filing ? <ReopenForm action={reopenFilingAction.bind(null, p.slug)} filingId={filing.id} label={`${o.form.form} ${o.label}`} />
              : <FilingForm action={recordFilingAction.bind(null, p.slug)} today={p.today}
                  period={{ formId: o.form.id, form: o.form.form, periodStart: o.periodStart, periodEnd: o.periodEnd, dueOn: o.due, label: o.label }} />}
          </div>
        </Td>
      </tr>
    );
  });
}

function ObligationTable({ list, p, caption, documents, empty }: { list: Obligation[]; p: Props; caption: string; documents?: boolean; empty: string }) {
  if (list.length === 0) return <p className="px-5 py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <Table caption={caption}>
      <thead><tr><Th>Due</Th><Th>Artifact</Th><Th>Period</Th><Th>Jurisdiction</Th><Th>Status</Th><Th className="text-right"><span className="sr-only">Actions</span></Th></tr></thead>
      <tbody><ObligationRows list={list} p={p} documents={documents} /></tbody>
    </Table>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

function Overview(p: Props) {
  const next30 = obligationsDue(p.forms, p.today, addDays(p.today, 30)).filter((o) => !p.filingOf.has(`${o.form.id}|${o.periodStart}`));
  const overdue = obligationsDue(p.forms, addDays(p.today, -90), addDays(p.today, -1)).filter((o) => !p.filingOf.has(`${o.form.id}|${o.periodStart}`));
  const renderable = p.forms.filter((f) => f.render).length;
  const coverage = p.forms.length ? Math.round((renderable / p.forms.length) * 100) : 0;
  const byClass = (Object.keys(FORM_CLASSES) as FormClass[]).map((c) => [c, p.forms.filter((f) => f.cls === c).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const fyStart = `${Number(p.today.slice(5, 7)) >= 4 ? p.today.slice(0, 4) : Number(p.today.slice(0, 4)) - 1}-04-01`;
  const filedFy = p.filings.filter((f) => f.status === 'filed' && (f.filed_on ?? '') >= fyStart).length;
  const issues = alerts(p.facts, p.scope, p.ids);
  const establishments = p.facts.establishments.filter((e) => e.headcount > 0);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Compliance health · {monthName(p.today.slice(0, 7))}: <span className="font-medium text-fg">{p.forms.length} applicable obligations</span> across {establishments.length || 'no'} establishment{establishments.length === 1 ? '' : 's'} · your universe: Central{p.states.length ? ` + ${p.states.join(', ')}` : ''} · {renderable} renderable from PeopleCore data.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Applicable to you" value={p.forms.length} note={`of ${STAT_FORMS.length} tracked`} tone="primary" href={`${p.base}?tab=library&scope=mine`} />
        <StatCard label="Renderable now" value={renderable} note={`${coverage}% coverage`} tone="accent" />
        <StatCard label="Due next 30 days" value={next30.length} note={next30[0] ? `next: ${next30[0].form.form}` : 'nothing due'} tone="info" href={`${p.base}?tab=calendar`} />
        <StatCard label="Overdue" value={overdue.length} note={overdue.length ? `last 90 days · oldest ${fullDate(overdue[0]!.due)}` : 'all clear in the last 90 days'} tone={overdue.length ? 'danger' : 'success'} />
        <StatCard label="Establishments" value={establishments.length} note={`${p.scope.headcount} employees in scope · ${filedFy} filed this FY`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Due next" meta="30 days" flush action={<Link className="text-xs text-primary" href={`${p.base}?tab=calendar`}>Full calendar →</Link>}>
            <ObligationTable list={next30.slice(0, 10)} p={p} caption="Due in the next 30 days" empty="Nothing due in the next 30 days." />
          </Panel>
          {overdue.length > 0 && (
            <Panel title="Overdue" meta={`${overdue.length} in the last 90 days`} flush>
              <ObligationTable list={overdue.slice(0, 10)} p={p} caption="Overdue obligations" empty="" />
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          <Panel title="Alerts">
            {issues.length === 0 ? <p className="text-sm text-muted">✅ No data-quality alerts — scope is complete.</p> : (
              <ul className="space-y-2 text-sm">{issues.map((a) => <li key={a.text} className={a.tone === 'danger' ? 'text-danger' : 'text-warning'}>⚠ <span className="text-fg">{a.text}</span></li>)}</ul>
            )}
          </Panel>
          <Panel title="Applicable to you · by class">
            <ul className="space-y-1.5 text-sm">{byClass.map(([c, n]) => <li key={c} className="flex justify-between"><span>{FORM_CLASSES[c]}</span><span className="font-semibold tabular-nums">{n}</span></li>)}</ul>
          </Panel>
          <Panel title="Your establishments" action={<Link className="text-xs text-primary" href={`${p.base}?tab=regime`}>Open regime map →</Link>}>
            {establishments.length === 0 ? <p className="text-sm text-muted">No employees at a location with a state yet. Set work locations (with their state) in Company Profile.</p> : (
              <ul className="space-y-1.5 text-sm">{establishments.map((e) => <li key={e.id} className="flex justify-between gap-2"><span>🏢 {e.name}</span><span className="text-muted">{isStateCode(e.state) ? STATES[e.state].name : '—'} · {e.headcount}</span></li>)}</ul>
            )}
          </Panel>
        </div>
      </div>
      <Verify />
    </div>
  );
}

function Verify() {
  return <Alert tone="warning" title="Verify before filing">PeopleCore works out obligations and fills documents from your payroll and attendance against a catalogue compiled from published sources; low-confidence rows are marked. Have a qualified compliance expert check the data and the completed form before you file it with any authority.</Alert>;
}

// ─── Calendar ────────────────────────────────────────────────────────────────

function Calendar(p: Props) {
  const month = /^\d{4}-\d{2}$/.test(p.sp.m ?? '') ? p.sp.m! : p.today.slice(0, 7);
  const list = obligationsDue(p.forms.filter(hasCalendar), `${month}-01`, lastOfMonth(month));
  const st = list.map((o) => statusOf(o, p).status);
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const days = Number(lastOfMonth(month).slice(8, 10));
  const byDay = new Map<number, Status[]>();
  list.forEach((o, i) => { const d = Number(o.due.slice(8, 10)); byDay.set(d, [...(byDay.get(d) ?? []), st[i]!]); });
  const nav = (m: string) => `${p.base}?${new URLSearchParams({ tab: 'calendar', m, ...(p.sim === null ? {} : { sim: String(p.sim) }) }).toString()}`;
  const dot: Record<Status, string> = { filed: 'bg-success', not_applicable: 'bg-line-strong', overdue: 'bg-danger', upcoming: 'bg-info', blocked: 'bg-warning', ready: 'bg-info' };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link className={btn} href={nav(shiftMonth(month, -1))} aria-label="Previous month">‹</Link>
          <h2 className="min-w-40 text-center text-lg font-semibold">{monthName(month)}</h2>
          <Link className={btn} href={nav(shiftMonth(month, 1))} aria-label="Next month">›</Link>
        </div>
        <p className="text-sm text-muted">{list.length} obligations · {st.filter((s) => s === 'upcoming').length} upcoming · {st.filter((s) => s === 'overdue').length} overdue · {st.filter((s) => s === 'filed').length} filed</p>
        <form className="flex items-end gap-2" action={p.base}>
          <input type="hidden" name="tab" value="calendar" /><input type="hidden" name="m" value={month} />
          <label className="text-xs text-muted">Simulate headcount<input name="sim" inputMode="numeric" defaultValue={p.sim ?? ''} placeholder={String(p.facts.headcount)} className="mt-1 block h-9 w-28 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg" /></label>
          <button className="h-9 rounded-md border border-line bg-surface px-3 text-sm hover:bg-subtle">Simulate scope</button>
        </form>
      </div>
      <Panel title={`Obligations · ${monthName(month)}`} flush>
        <ObligationTable list={list} p={p} caption={`Obligations due in ${monthName(month)}`} empty="Nothing falls due this month." />
      </Panel>
      <Panel title="Month grid">
        <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`Due dates in ${monthName(month)}`}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1 font-semibold text-muted">{d}</div>)}
          {Array.from({ length: first }, (_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1;
            const marks = byDay.get(d) ?? [];
            const isToday = `${month}-${String(d).padStart(2, '0')}` === p.today;
            return (
              <div key={d} className={`min-h-14 rounded-lg border p-1 ${isToday ? 'border-primary' : 'border-line'} ${marks.length ? 'bg-subtle' : ''}`}>
                <p className="text-left tabular-nums">{d}</p>
                <div className="mt-1 flex flex-wrap gap-0.5">{marks.map((s, j) => <span key={j} className={`size-2 rounded-full ${dot[s]}`} title={STATUS_BADGE[s].label} />)}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
          <span><span className="mr-1 inline-block size-2 rounded-full bg-info" />upcoming</span>
          <span><span className="mr-1 inline-block size-2 rounded-full bg-danger" />overdue</span>
          <span><span className="mr-1 inline-block size-2 rounded-full bg-success" />filed</span>
        </p>
      </Panel>
      <p className="text-xs text-muted">📅 Obligations switch on and off as headcount, establishments and payroll settings change — applicability is re-evaluated on every visit.</p>
    </div>
  );
}

// ─── Documents ───────────────────────────────────────────────────────────────

function Documents(p: Props) {
  const defaultMonth = shiftMonth(p.today.slice(0, 7), -1);
  const month = /^\d{4}-\d{2}$/.test(p.sp.period ?? '') ? p.sp.period! : defaultMonth;
  const list = obligationsForPeriod(p.forms.filter(hasCalendar), month);
  const st = list.map((o) => statusOf(o, p, true).status);
  const registers = p.forms.filter((f) => f.due.kind === 'continuous' && f.render);
  const nav = (m: string) => `${p.base}?tab=documents&period=${m}`;
  const locked = p.facts.locked_months.includes(month);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link className={btn} href={nav(shiftMonth(month, -1))}>‹ Prev</Link>
          <h2 className="min-w-40 text-center text-lg font-semibold">{monthName(month)} <span className="text-sm font-normal text-muted">· wage period</span></h2>
          <Link className={btn} href={nav(shiftMonth(month, 1))}>Next ›</Link>
        </div>
        <p className="text-sm text-muted">{st.filter((s) => s === 'filed').length} filed · {st.filter((s) => s === 'ready').length} ready · {st.filter((s) => s === 'blocked').length} blocked · {st.filter((s) => s === 'upcoming' || s === 'overdue').length} pending</p>
      </div>
      {!locked && <Alert tone="warning" title="No locked payroll for this wage period">Documents built from payroll (ECR, ESI, PT, TDS, wage registers) can be rendered once the {monthName(month)} run is locked in Payroll.</Alert>}
      <Panel title="Generated artifacts" meta="retention: 5 years · audit trail on" flush>
        <ObligationTable list={list} p={p} documents caption={`Statutory documents for ${monthName(month)}`} empty="No periodic documents end in this wage period." />
      </Panel>
      {registers.length > 0 && (
        <Panel title="Registers kept continuously" meta="render for any period">
          <ul className="divide-y divide-line text-sm">
            {registers.map((f) => {
              const href = renderHref(p, { form: f, periodStart: `${month}-01`, periodEnd: lastOfMonth(month), due: lastOfMonth(month), label: monthName(month) });
              return <li key={f.id} className="flex items-center justify-between gap-3 py-2"><FormCell form={f} />{href && <Link className="shrink-0 text-xs font-medium text-primary hover:underline" href={href}>Render {SHORT[Number(month.slice(5, 7)) - 1]} →</Link>}</li>;
            })}
          </ul>
        </Panel>
      )}
      <Verify />
    </div>
  );
}

// ─── Library ─────────────────────────────────────────────────────────────────

function Library(p: Props) {
  const mine = p.sp.scope === 'mine';
  const q = (p.sp.q ?? '').trim().toLowerCase();
  const cls = p.sp.cls && p.sp.cls in FORM_CLASSES ? (p.sp.cls as FormClass) : null;
  const jur = p.sp.j === 'IN' || isStateCode(p.sp.j) ? p.sp.j! : null;
  const rows = p.evals.filter((e) => (!mine || e.applies) && (!cls || e.form.cls === cls) && (!jur || e.form.jurisdiction === jur)
    && (!q || `${e.form.id} ${e.form.name} ${e.form.form} ${e.form.act}`.toLowerCase().includes(q)));
  const size = 25;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Number(p.sp.page) || 1));
  const href = (extra: Search) => `${p.base}?${new URLSearchParams(Object.entries({ tab: 'library', scope: p.sp.scope, q: p.sp.q, cls: p.sp.cls, j: p.sp.j, ...extra }).filter((e): e is [string, string] => !!e[1])).toString()}`;
  const conf = { high: p.evals.filter((e) => e.form.confidence === 'high').length, low: p.evals.filter((e) => e.form.confidence === 'low').length };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Applies to you" value={p.forms.length} note="from your establishments" tone="primary" href={href({ scope: 'mine', page: '' })} />
        <StatCard label="Full library" value={STAT_FORMS.length} note={`Central + ${Object.keys(STATES).length} states and UTs`} href={href({ scope: '', page: '' })} />
        <StatCard label="High confidence" value={conf.high} note="well-established forms and dates" tone="success" />
        <StatCard label="To verify" value={conf.low} note="placeholders and uncertain due dates" tone="warning" />
      </div>
      <Panel title="Compliance master repository" flush action={<a className="text-xs text-primary" href={`${p.base}/library${mine ? '?scope=mine' : ''}`} download>⬇ Export</a>}>
        <form className="flex flex-wrap items-end gap-2 px-5 pb-3" action={p.base}>
          <input type="hidden" name="tab" value="library" />
          <select name="scope" defaultValue={p.sp.scope ?? ''} aria-label="Scope" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm"><option value="mine">Applicable to you · {p.forms.length}</option><option value="">Full library · {STAT_FORMS.length}</option></select>
          <input name="q" defaultValue={p.sp.q ?? ''} placeholder="Search form, act or ID" aria-label="Search" className="h-9 w-56 rounded-md border border-line-strong bg-surface px-2 text-sm" />
          <select name="cls" defaultValue={cls ?? ''} aria-label="Class" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm"><option value="">All classes</option>{(Object.keys(FORM_CLASSES) as FormClass[]).map((c) => <option key={c} value={c}>{FORM_CLASSES[c]}</option>)}</select>
          <select name="j" defaultValue={jur ?? ''} aria-label="Jurisdiction" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm"><option value="">All jurisdictions</option><option value="IN">Central</option>{(Object.keys(STATES) as StateCode[]).map((c) => <option key={c} value={c}>{STATES[c].name}</option>)}</select>
          <button className="h-9 rounded-md border border-line bg-surface px-3 text-sm hover:bg-subtle">Filter</button>
        </form>
        <Table caption="Statutory forms">
          <thead><tr><Th>ID</Th><Th>Artifact</Th><Th>Class</Th><Th>Jurisdiction</Th><Th>Regime</Th><Th>Frequency</Th><Th>Due / trigger</Th><Th>Data source</Th><Th>Confidence</Th><Th>For you</Th></tr></thead>
          <tbody>
            {rows.slice((page - 1) * size, page * size).map(({ form: f, applies }) => (
              <tr key={f.id}>
                <Td className="whitespace-nowrap font-mono text-xs">{f.id}</Td>
                <Td><p className="font-medium">{f.name}</p><p className="text-xs text-muted">{f.form} · {f.act}</p></Td>
                <Td className="whitespace-nowrap">{FORM_CLASSES[f.cls]}</Td>
                <Td className="whitespace-nowrap">{jurisdictionName(f.jurisdiction)}</Td>
                <Td className="whitespace-nowrap">{REGIMES[f.regime]}</Td>
                <Td className="whitespace-nowrap">{f.frequency}</Td>
                <Td className="min-w-48 text-xs">{f.trigger}</Td>
                <Td className="whitespace-nowrap text-xs">{f.source}{f.render ? <span className="ml-1 text-success" title="PeopleCore can render this">●</span> : null}</Td>
                <Td><Badge tone={f.confidence === 'high' ? 'success' : f.confidence === 'medium' ? 'primary' : 'warning'}>{f.confidence === 'low' ? 'Low · verify' : f.confidence === 'high' ? 'High' : 'Medium'}</Badge></Td>
                <Td>{applies ? <Badge tone="success">Applies</Badge> : <span className="text-xs text-muted">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted">No forms match.</p>}
        <Pagination page={page} pageCount={pages} total={rows.length} hrefFor={(n) => href({ page: String(n) })} />
      </Panel>
      <Verify />
    </div>
  );
}

// ─── Regime map ──────────────────────────────────────────────────────────────

function RegimeMap(p: Props) {
  const all = p.sp.all === '1';
  const jurisdictions: Array<'IN' | StateCode> = ['IN', ...(all ? (Object.keys(STATES) as StateCode[]) : p.states)];
  const mix = (j: 'IN' | StateCode) => {
    const fs = STAT_FORMS.filter((f) => f.jurisdiction === j);
    const counts = (Object.keys(REGIMES) as Regime[]).map((r) => [r, fs.filter((f) => f.regime === r).length] as const).filter(([, n]) => n > 0);
    return { total: fs.length, applicable: fs.filter((f) => p.ids.has(f.id)).length, text: counts.map(([r, n]) => `${REGIMES[r]} (${n})`).join(' · ') };
  };
  const operating = new Set(p.states);
  const pt = p.states.filter((s) => STATES[s].pt);
  const lwf = p.states.filter((s) => STATES[s].lwf);
  const neither = p.states.filter((s) => !STATES[s].pt && !STATES[s].lwf);
  return (
    <div className="space-y-5">
      <Alert tone="info" title="Dual-regime engine">The Labour Codes took effect on 21 November 2025. Code forms and the continuing central and state laws sit side by side with their own effective dates; where a state hasn’t notified its rules yet, the legacy registers continue.</Alert>
      <Panel title="Jurisdictions · artifacts and regime mix" meta="as of today" flush
        action={<Link className="text-xs text-primary" href={`${p.base}?tab=regime${all ? '' : '&all=1'}`}>{all ? 'Only where you operate' : 'All states and UTs →'}</Link>}>
        <Table caption="Jurisdictions">
          <thead><tr><Th>Jurisdiction</Th><Th>Regime mix</Th><Th>PT</Th><Th>LWF</Th><Th className="text-right">Artifacts</Th><Th className="text-right">Apply to you</Th></tr></thead>
          <tbody>
            {jurisdictions.map((j) => {
              const m = mix(j);
              return (
                <tr key={j}>
                  <Td><p className="font-medium">{jurisdictionName(j)}</p>{j !== 'IN' && operating.has(j) && <p className="text-xs text-success">● you operate here</p>}{j !== 'IN' && !STATES[j].detailed && <p className="text-xs text-muted">placeholder · verify</p>}</Td>
                  <Td className="text-xs">{m.text}</Td>
                  <Td>{j === 'IN' ? '—' : STATES[j].pt ? '✓' : '—'}</Td>
                  <Td>{j === 'IN' ? '—' : STATES[j].lwf ? '✓' : '—'}</Td>
                  <Td className="text-right tabular-nums">{m.total}</Td>
                  <Td className="text-right tabular-nums"><Link className="text-primary hover:underline" href={`${p.base}?tab=library&scope=mine&j=${j}`}>{m.applicable}</Link></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-3">
        <StatCard label="💼 Professional tax levied" value={pt.length ? pt.join(', ') : '—'} note={pt.map((s) => STATES[s].name).join(', ') || 'none of your states'} />
        <StatCard label="🤝 Labour welfare fund operative" value={lwf.length ? lwf.join(', ') : '—'} note={lwf.map((s) => STATES[s].name).join(', ') || 'none of your states'} />
        <StatCard label="🚫 Neither PT nor LWF" value={neither.length ? neither.join(', ') : '—'} note={neither.map((s) => STATES[s].name).join(', ') || '—'} />
      </div>
      <Panel title="Your establishments" meta={`${p.facts.headcount} employees in scope${p.facts.unmapped ? ` · ${p.facts.unmapped} not mapped to an establishment with a state` : ''}`}>
        {p.facts.establishments.length === 0 ? <p className="text-sm text-muted">No locations yet. Add work locations, with their state, in Company Profile.</p> : (
          <ul className="divide-y divide-line">
            {p.facts.establishments.map((e) => (
              <li key={e.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">🏢 {e.name}{e.city ? <span className="font-normal text-muted"> · {e.city}</span> : null}</span>
                    <span className="text-muted">{isStateCode(e.state) ? STATES[e.state].name : 'No state set'} · {e.headcount} employee{e.headcount === 1 ? '' : 's'} · <span className="text-primary">Registrations</span></span>
                  </summary>
                  <div className="mt-3"><RegistrationForm action={saveRegistrationAction.bind(null, p.slug)} est={e} /></div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="text-xs text-muted">🗺 States without a detailed pack are tracked as placeholders with PT and LWF pre-mapped — they become applicable when you open an establishment there.</p>
    </div>
  );
}

// ─── Engine console ──────────────────────────────────────────────────────────

function Engine(p: Props) {
  const show = p.sp.show === 'all' ? 'all' : p.sp.show === 'no' ? 'no' : 'yes';
  const relevant = p.evals.filter((e) => e.form.jurisdiction === 'IN' || p.states.includes(e.form.jurisdiction as StateCode));
  const rows = relevant.filter((e) => show === 'all' || (show === 'yes' ? e.applies : !e.applies));
  const renderers = new Map<string, StatForm[]>();
  for (const f of STAT_FORMS) if (f.render) {
    const key = 'report' in f.render ? `Reports › ${REPORT_BY_KEY.get(f.render.report)?.title ?? f.render.report}` : `Page › ${{ payslips: 'Payroll run (payslips)', tax: 'Tax declarations', letters: 'Letters', holidays: 'Holidays' }[f.render.page]}`;
    renderers.set(key, [...(renderers.get(key) ?? []), f]);
  }
  const f = p.facts;
  const ready: Array<[string, boolean, string]> = [
    ['Company PAN', f.company.pan, 'Company Profile › Statutory'], ['Company TAN', f.company.tan, 'needed for TDS returns'],
    ['PF establishment code', f.company.pf_code, f.settings.pf ? 'PF switched on in payroll' : 'PF switched off'],
    ['ESI employer code', f.company.esi_code, f.settings.esi ? 'ESI switched on in payroll' : 'ESI switched off'],
    ['UAN for PF members', f.pf_missing_uan === 0, `${f.pf_members - f.pf_missing_uan} of ${f.pf_members}`],
    ['ESIC number for ESI members', f.esi_missing_number === 0, `${f.esi_members - f.esi_missing_number} of ${f.esi_members}`],
    ['PAN for employees', f.missing_pan === 0, `${f.headcount - f.missing_pan} of ${f.headcount}`],
    ['Employees mapped to an establishment', f.unmapped === 0, `${f.headcount - f.unmapped} of ${f.headcount}`],
  ];
  return (
    <div className="space-y-5">
      <Alert tone="info" title="Forms are data, not code">Every artifact is an entry in the catalogue — law, jurisdiction, class, frequency, due rule, thresholds and the report that renders it. The engine evaluates applicability and due dates from your data on every visit; a regulatory change is a catalogue revision.</Alert>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Scope">
          <ScopeForm action={saveScopeAction.bind(null, p.slug)} contractLabour={f.scope.contract_labour} factory={f.scope.factory} />
          <p className="mt-4 text-xs text-muted">PF, ESI and PT follow the switches in <Link className="text-primary" href={`/app/${p.slug}/payroll?tab=settings`}>Payroll › Settings</Link>: PF {f.settings.pf ? 'on' : 'off'} · ESI {f.settings.esi ? 'on' : 'off'} · PT {f.settings.pt ? 'on' : 'off'}.</p>
        </Panel>
        <Panel title="Data readiness" className="lg:col-span-2">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {ready.map(([label, ok, note]) => <li key={label} className="flex items-start gap-2"><span aria-hidden="true">{ok ? '✅' : '⚠️'}</span><span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{note}</span></span></li>)}
          </ul>
        </Panel>
      </div>
      <Panel title="Applicability trace" meta={`${rows.length} forms · Central${p.states.length ? ` + ${p.states.join(', ')}` : ''}`} flush
        action={<div className="flex gap-3 text-xs">{(['yes', 'no', 'all'] as const).map((k) => <Link key={k} className={k === show ? 'font-semibold text-fg' : 'text-primary'} href={`${p.base}?tab=engine&show=${k}${p.sim === null ? '' : `&sim=${p.sim}`}`}>{{ yes: 'Applies', no: 'Doesn’t apply', all: 'All' }[k]}</Link>)}</div>}>
        <Table caption="Applicability trace">
          <thead><tr><Th>Form</Th><Th>Result</Th><Th>Why</Th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.form.id}>
                <Td><FormCell form={e.form} /></Td>
                <Td>{e.applies ? <Badge tone="success">Applies</Badge> : <Badge>Doesn’t apply</Badge>}</Td>
                <Td><ul className="space-y-0.5 text-xs">{e.reasons.map((r) => <li key={r} className={r.startsWith('✗') ? 'text-muted' : ''}>{r}</li>)}</ul></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel title="Renderers" meta="what PeopleCore produces each artifact with">
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          {[...renderers.entries()].map(([k, fs]) => <li key={k}><p className="font-medium">🧩 {k}</p><p className="text-xs text-muted">{[...new Set(fs.map((x) => x.form))].join(' · ')}</p></li>)}
        </ul>
      </Panel>
      <Verify />
    </div>
  );
}

// ─── Employee view ───────────────────────────────────────────────────────────

async function MyStatutory({ slug, orgId, userId }: { slug: string; orgId: string; userId: string }) {
  const me = await getMyEmployee(orgId, userId);
  const supabase = await createClient();
  const [ids, profile] = me ? await Promise.all([
    supabase.rpc('employee_identity_summary', { p_employee: me.id }).maybeSingle().then((r) => r.data),
    supabase.from('employee_statutory_profiles').select('pf_applicable, esi_applicable, pt_state').eq('employee_id', me.id).maybeSingle().then((r) => r.data),
  ]) : [null, null];
  const app = `/app/${slug}`;
  const item = (label: string, value: string | null | undefined, note?: string) => (
    <div className="rounded-xl border border-line bg-surface p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p><p className="mt-2 font-mono text-lg">{value ?? '—'}</p>{note && <p className="mt-1 text-xs text-muted">{note}</p>}</div>
  );
  return (
    <>
      <HubHeader title="My Statutory" subtitle="Your provident fund, ESI, professional tax and income-tax details, and the statutory documents issued to you." />
      {!me ? <Alert tone="info" title="No employee record">Your account isn’t linked to an employee record in this organization.</Alert> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {item('PF · UAN', ids?.uan, profile?.pf_applicable === false ? 'PF not applicable to you' : 'Provident fund member')}
            {item('ESI · ESIC number', ids?.esic_number, profile?.esi_applicable ? 'Covered by ESI' : 'ESI decided each month by your wage')}
            {item('Professional tax', profile?.pt_state && isStateCode(profile.pt_state) ? STATES[profile.pt_state].name : null, 'State where your PT is deducted')}
            {item('Income tax · PAN', ids?.pan, 'TDS on salary is deducted against this PAN')}
          </div>
          <Panel title="Documents issued to you">
            <ul className="divide-y divide-line text-sm">
              <li className="flex items-center justify-between gap-3 py-2"><span><span className="font-medium">Wage slips</span> <span className="text-muted">· Form V, every pay period</span></span><Link className="text-primary" href={`${app}/payslips?tab=payslips`}>Open →</Link></li>
              <li className="flex items-center justify-between gap-3 py-2"><span><span className="font-medium">Form 16</span> <span className="text-muted">· salary TDS certificate, by 15 June</span></span><Link className="text-primary" href={`${app}/payslips?tab=tax`}>Tax Center →</Link></li>
              <li className="flex items-center justify-between gap-3 py-2"><span><span className="font-medium">Form 12BB</span> <span className="text-muted">· your investment declaration</span></span><Link className="text-primary" href={`${app}/payslips?tab=tax`}>Declare →</Link></li>
              <li className="flex items-center justify-between gap-3 py-2"><span><span className="font-medium">Appointment and other letters</span></span><Link className="text-primary" href={`${app}/letters`}>Letters →</Link></li>
            </ul>
          </Panel>
          <p className="text-xs text-muted">Numbers are masked. If one is missing or wrong, ask HR to update your identity details.</p>
        </div>
      )}
    </>
  );
}
