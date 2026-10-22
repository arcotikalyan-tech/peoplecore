import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import {
  addMonths, APPLICATION_STAGE_LABELS, CANDIDATE_SOURCE_LABELS, CANDIDATE_SOURCES, monthCells, MOVABLE_STAGES, RECOMMENDATION_LABELS, REQUISITION_STATUS_LABELS,
  todayIn, type ApplicationStage, type CandidateSource,
} from '@peoplecore/shared';
import { HubHeader, HubTabs, Panel, StatCard, SubTabs } from '@/components/ui/hub';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { publicOriginFromHeaders } from '@/lib/public-origin';
import { requirePermission } from '@/server/context';
import { colleagueNames, colleagueOptions } from '@/server/engagement';
import { employeeNames, managerOptions } from '@/server/employees';
import {
  emailTemplates, fillTemplate, hiringData, hiringInterviewsAndOffers, hiringPlans, recruitingActivity, recruitingSettings, recruitingSpend, recruitingTeam,
  talentPools, TEMPLATE_VARIABLES, type HiringApplication, type HiringJob,
} from '@/server/hiring';
import { requireModule } from '@/server/modules';
import { candidateRetention, listRequisitions, type InterviewView } from '@/server/recruitment';
import { getStructure, structureOptions } from '@/server/structure';
import { createRequisitionAction, moveApplicationAction, saveCandidateRetentionAction } from './actions';
import {
  addSpendAction, addToPoolAction, createPlanAction, createPoolAction, deletePlanAction, deletePoolAction, deleteSpendAction, deleteTemplateAction,
  removeFromPoolAction, saveAutomationsAction, saveTemplateAction,
} from './hiring-actions';
import { AddToPoolForm, AutomationsForm, MoveCard, OneButton, PlanForm, PoolForm, SpendForm, TemplateForm } from './hiring-client';
import { CandidateRetentionForm, RequisitionForm } from './recruitment-forms';

export const metadata: Metadata = { title: 'Hiring' };

type Search = Record<string, string | undefined>;
const DAY = 86_400_000;
const ACTIVE: ApplicationStage[] = ['applied', 'screening', 'interview', 'offer'];
const ORDER: ApplicationStage[] = ['applied', 'screening', 'interview', 'offer', 'hired'];
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const days = (from: string, to: number = Date.now()) => Math.max(0, Math.floor((to - Date.parse(from)) / DAY));
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '0%');
const btn = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-subtle';

/**
 * Hiring OS (Kredily's Hiring OS) for people who read recruitment org-wide: hub, recruitment (jobs, candidates, hiring
 * plan), pipeline (board, interviews, feedback, scorecards, offers, approvals), outreach (talent pools, job board,
 * email templates), insights (analytics, activity) and settings (team, automations). Hiring managers with team scope
 * see the jobs in their reporting line. Per-candidate work (offers, interviews, hiring) stays on the job's page.
 */
export default async function RecruitmentPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, 'recruitment.read');
  await requireModule(ctx.org.id, 'recruitment');
  if (!ctx.can('recruitment.read', 'org')) return <TeamJobs slug={slug} orgId={ctx.org.id} />;

  const canManage = ctx.can('recruitment.manage', 'org');
  const base = `/app/${slug}/recruitment`;
  const today = todayIn(ctx.org.timezone);
  const [data, structure, settings] = await Promise.all([hiringData(ctx.org.id), getStructure(ctx.org.id), recruitingSettings(ctx.org.id)]);
  const tabs = [
    { key: 'hub', label: '✦ Hub' }, { key: 'recruitment', label: 'Recruitment' }, { key: 'pipeline', label: 'Pipeline' },
    { key: 'outreach', label: 'Outreach' }, { key: 'insights', label: 'Insights' }, { key: 'settings', label: 'Settings' },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const p: Props = {
    slug, base, sp, today, tz: ctx.org.timezone, canManage, canDirectory: ctx.can('employee.read', 'org'), orgId: ctx.org.id, orgName: ctx.org.name, data, settings, structure,
    jobOf: new Map(data.jobs.map((j) => [j.id, j])), dept: new Map(structure.departments.map((d) => [d.id, d.name])),
  };
  return (
    <>
      <HubHeader title="Hiring OS" badge="ATS" subtitle="Pipeline · candidates · interviews · offers"
        actions={<>
          <a className={btn} href={`${base}/export`} download>⬇ Export</a>
          {canManage && <Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}?tab=recruitment&view=jobs#new-job`}>＋ New Job</Link>}
        </>} />
      <HubTabs base={base} label="Hiring sections" tabs={tabs} current={tab} />
      {tab === 'hub' && <Hub {...p} />}
      {tab === 'recruitment' && <Recruitment {...p} />}
      {tab === 'pipeline' && <Pipeline {...p} />}
      {tab === 'outreach' && <Outreach {...p} />}
      {tab === 'insights' && <Insights {...p} />}
      {tab === 'settings' && <Settings {...p} />}
    </>
  );
}

interface Props {
  slug: string; base: string; sp: Search; today: string; tz: string; canManage: boolean; canDirectory: boolean; orgId: string; orgName: string;
  data: Awaited<ReturnType<typeof hiringData>>; settings: Awaited<ReturnType<typeof recruitingSettings>>; structure: Awaited<ReturnType<typeof getStructure>>;
  jobOf: Map<string, HiringJob>; dept: Map<string, string>;
}
const jobTitle = (p: Props, id: string) => p.jobOf.get(id)?.title ?? 'Job';
const stageBadge = (s: ApplicationStage) => <Badge tone={s === 'hired' ? 'success' : s === 'rejected' || s === 'withdrawn' ? 'neutral' : s === 'offer' ? 'warning' : 'primary'}>{APPLICATION_STAGE_LABELS[s]}</Badge>;

// ─── Hub ─────────────────────────────────────────────────────────────────────

async function Hub(p: Props) {
  const apps = p.data.applications;
  const { interviews, offers } = await hiringInterviewsAndOffers(p.orgId, apps.filter((a) => ACTIVE.includes(a.stage) || a.stage === 'hired').map((a) => a.id));
  const now = new Date().getTime();
  const active = apps.filter((a) => ACTIVE.includes(a.stage));
  const stalled = active.filter((a) => days(a.stageChangedAt) >= p.settings.stall_days);
  const upcoming = interviews.filter((i) => i.status === 'scheduled' && Date.parse(i.scheduledAt) >= now);
  const toSchedule = active.filter((a) => a.stage === 'interview' && !interviews.some((i) => i.applicationId === a.id && i.status === 'scheduled' && Date.parse(i.scheduledAt) >= now));
  const pendingOffers = [...offers.values()].filter((o) => o.status === 'pending_approval' || o.status === 'approved' || o.status === 'sent');
  const scorecardsDue = interviews.filter((i) => Date.parse(i.scheduledAt) < now && i.status !== 'cancelled').flatMap((i) => i.panel.filter((x) => !x.recommendation)).length;
  const funnel = ORDER.map((s) => ({ s, n: apps.filter((a) => ORDER.indexOf(a.stage) >= ORDER.indexOf(s) || (s === 'applied' && (a.stage === 'rejected' || a.stage === 'withdrawn'))).length }));
  const sources = CANDIDATE_SOURCES.map((s) => ({ s, n: apps.filter((a) => a.candidate.source === s).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const queue: Array<[string, number, string]> = [
    ['New to review', apps.filter((a) => a.stage === 'applied').length, `${p.base}?tab=recruitment&view=candidates&stage=applied`],
    [`Stalled · ${p.settings.stall_days}+ days`, stalled.length, `${p.base}?tab=recruitment&view=candidates&stalled=1`],
    ['To schedule', toSchedule.length, `${p.base}?tab=pipeline&view=board`],
    ['Offers pending', pendingOffers.length, `${p.base}?tab=pipeline&view=offers`],
    ['Scorecards due', scorecardsDue, `${p.base}?tab=pipeline&view=scorecards`],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="💼 Active jobs" value={p.data.jobs.filter((j) => j.status === 'open').length} href={`${p.base}?tab=recruitment&view=jobs`} tone="primary" />
        <StatCard label="👥 Candidates" value={new Set(apps.map((a) => a.candidate.id)).size} note={`${active.length} in progress`} href={`${p.base}?tab=recruitment&view=candidates`} />
        <StatCard label="📅 Interviews" value={upcoming.length} note="upcoming" href={`${p.base}?tab=pipeline&view=interviews`} tone="info" />
        <StatCard label="📨 Pending offers" value={pendingOffers.length} href={`${p.base}?tab=pipeline&view=offers`} tone="warning" />
        <StatCard label="🎯 Hired" value={apps.filter((a) => a.stage === 'hired').length} tone="success" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Needs action" meta="your queue right now">
          <ul className="space-y-2 text-sm">{queue.map(([label, n, href]) => (
            <li key={label}><Link href={href} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 hover:bg-subtle"><span>{label}</span><span className={`font-semibold tabular-nums ${n ? 'text-warning' : 'text-muted'}`}>{n}</span></Link></li>
          ))}</ul>
        </Panel>
        <Panel title="Pipeline funnel">
          <ul className="space-y-2">{funnel.map(({ s, n }) => (
            <li key={s}><div className="flex justify-between text-sm"><span>{APPLICATION_STAGE_LABELS[s]}</span><span className="tabular-nums text-muted">{n}</span></div>
              <div className="mt-1 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-primary" style={{ width: `${funnel[0]!.n ? (n / funnel[0]!.n) * 100 : 0}%` }} /></div></li>
          ))}</ul>
        </Panel>
        <Panel title="Sources">
          {sources.length === 0 ? <p className="text-sm text-muted">No candidates yet.</p> : (
            <ul className="space-y-1.5 text-sm">{sources.map(({ s, n }) => <li key={s} className="flex justify-between"><span>{CANDIDATE_SOURCE_LABELS[s as CandidateSource]}</span><span className="tabular-nums">{n} · {pct(n, apps.length)}</span></li>)}</ul>
          )}
        </Panel>
      </div>
      <Panel title="Upcoming interviews" flush action={<Link className="text-xs text-primary" href={`${p.base}/interviews`}>My interviews →</Link>}>
        {upcoming.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No interviews scheduled.</p> : (
          <Table caption="Upcoming interviews">
            <thead><tr><Th>When</Th><Th>Candidate</Th><Th>Job</Th><Th>Round</Th><Th>Mode</Th></tr></thead>
            <tbody>{upcoming.slice(0, 8).map((i) => {
              const a = apps.find((x) => x.id === i.applicationId);
              return <tr key={i.id}><Td className="whitespace-nowrap">{formatDate(i.scheduledAt)}</Td><Td className="font-medium">{a?.candidate.name}</Td><Td>{a ? <Link className="text-primary hover:underline" href={`${p.base}/${a.requisitionId}`}>{jobTitle(p, a.requisitionId)}</Link> : '—'}</Td><Td>{i.round}</Td><Td className="capitalize">{i.mode.replace('_', ' ')}</Td></tr>;
            })}</tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

// ─── Recruitment ─────────────────────────────────────────────────────────────

async function Recruitment(p: Props) {
  const view = ['jobs', 'candidates', 'plan'].includes(p.sp.view ?? '') ? p.sp.view! : 'jobs';
  return (
    <div className="space-y-5">
      <SubTabs base={p.base} extra={{ tab: 'recruitment' }} label="Recruitment" current={view} tabs={[
        { key: 'jobs', label: 'Jobs', count: p.data.jobs.filter((j) => j.status === 'open').length }, { key: 'candidates', label: 'Candidates', count: p.data.applications.length },
        { key: 'plan', label: 'Hiring Plan' },
      ]} />
      {view === 'jobs' && <Jobs {...p} />}
      {view === 'candidates' && <Candidates {...p} />}
      {view === 'plan' && <Plans {...p} />}
    </div>
  );
}

async function Jobs(p: Props) {
  const [requisitions, managers] = await Promise.all([
    listRequisitions(p.orgId),
    // Without directory access (recruiters), pick from the minimal colleague directory.
    !p.canManage ? Promise.resolve([]) : p.canDirectory ? managerOptions(p.orgId) : colleagueOptions(p.orgId),
  ]);
  const names = new Map([...(await colleagueNames(p.orgId)), ...(await employeeNames(p.orgId, requisitions.map((r) => r.hiring_manager_employee_id).filter((x): x is string => !!x)))]);
  return (
    <>
      <Panel title="Job requisitions" meta={`${requisitions.length} position${requisitions.length === 1 ? '' : 's'}`} flush>
        <Table caption="Requisitions">
          <thead><tr><Th>Code</Th><Th>Title</Th><Th>Department</Th><Th>Hiring manager</Th><Th>Openings</Th><Th>In pipeline</Th><Th>Status</Th><Th>Careers page</Th><Th>Opened</Th></tr></thead>
          <tbody>
            {requisitions.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-muted">No requisitions yet.</td></tr>}
            {requisitions.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td className="font-medium"><Link className="text-primary hover:underline" href={`${p.base}/${r.id}`}>{r.title}</Link></Td>
                <Td className="text-muted">{r.department_id ? (p.dept.get(r.department_id) ?? 'Archived') : '—'}</Td>
                <Td className="text-muted">{r.hiring_manager_employee_id ? (names.get(r.hiring_manager_employee_id) ?? '—') : '—'}</Td>
                <Td className="tabular-nums">{r.hired}/{r.openings} filled</Td>
                <Td className="tabular-nums">{r.active}</Td>
                <Td><Badge tone={r.status === 'open' ? 'success' : 'neutral'}>{REQUISITION_STATUS_LABELS[r.status]}</Badge></Td>
                <Td>{p.jobOf.get(r.id)?.is_published ? <Badge tone="success">Published</Badge> : <span className="text-xs text-muted">—</span>}</Td>
                <Td className="text-muted">{formatDate(r.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      {p.canManage && (
        <div id="new-job"><Card><CardHeader title="New requisition" /><RequisitionForm action={createRequisitionAction.bind(null, p.slug)} options={{ ...structureOptions(p.structure), managers }} /></Card></div>
      )}
    </>
  );
}

function Candidates(p: Props) {
  const q = (p.sp.q ?? '').trim().toLowerCase();
  const stage = (APPLICATION_STAGE_LABELS as Record<string, string>)[p.sp.stage ?? ''] ? (p.sp.stage as ApplicationStage) : null;
  const source = CANDIDATE_SOURCES.includes(p.sp.source as CandidateSource) ? (p.sp.source as CandidateSource) : null;
  const job = p.jobOf.has(p.sp.job ?? '') ? p.sp.job! : null;
  const stalled = p.sp.stalled === '1';
  const rows = p.data.applications.filter((a) => (!stage || a.stage === stage) && (!source || a.candidate.source === source) && (!job || a.requisitionId === job)
    && (!stalled || (ACTIVE.includes(a.stage) && days(a.stageChangedAt) >= p.settings.stall_days))
    && (!q || `${a.candidate.name} ${a.candidate.email ?? ''} ${a.candidate.company ?? ''} ${jobTitle(p, a.requisitionId)}`.toLowerCase().includes(q)));
  const size = 25;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Number(p.sp.page) || 1));
  const href = (extra: Search) => `${p.base}?${new URLSearchParams(Object.entries({ tab: 'recruitment', view: 'candidates', q: p.sp.q, stage: p.sp.stage, source: p.sp.source, job: p.sp.job, stalled: p.sp.stalled, ...extra }).filter((e): e is [string, string] => !!e[1])).toString()}`;
  const sel = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm';
  return (
    <Panel title="Candidates" meta={`${new Set(p.data.applications.map((a) => a.candidate.id)).size} total`} flush
      action={<a className="text-xs text-primary" href={`${p.base}/export`} download>⬇ Export</a>}>
      <form className="flex flex-wrap items-end gap-2 px-5 pb-3" action={p.base}>
        <input type="hidden" name="tab" value="recruitment" /><input type="hidden" name="view" value="candidates" />
        <input name="q" defaultValue={p.sp.q ?? ''} placeholder="Search name, email, company or job" aria-label="Search candidates" className={`${sel} w-64`} />
        <select name="job" defaultValue={job ?? ''} aria-label="Job" className={sel}><option value="">All jobs</option>{p.data.jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
        <select name="stage" defaultValue={stage ?? ''} aria-label="Stage" className={sel}><option value="">All stages</option>{Object.entries(APPLICATION_STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="source" defaultValue={source ?? ''} aria-label="Source" className={sel}><option value="">All sources</option>{CANDIDATE_SOURCES.map((s) => <option key={s} value={s}>{CANDIDATE_SOURCE_LABELS[s]}</option>)}</select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="stalled" value="1" defaultChecked={stalled} className="size-4 accent-primary" />Stalled only</label>
        <button className="h-9 rounded-md border border-line bg-surface px-3 text-sm hover:bg-subtle">Filter</button>
      </form>
      <Table caption="Candidates">
        <thead><tr><Th>Candidate</Th><Th>Job</Th><Th>Stage</Th><Th>Stage age</Th><Th>Source</Th><Th>Company</Th><Th>Applied</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted">No candidates match your filters.</td></tr>}
          {rows.slice((page - 1) * size, page * size).map((a) => {
            const age = days(a.stageChangedAt);
            return (
              <tr key={a.id}>
                <Td><p className="font-medium">{a.candidate.name}</p><p className="text-xs text-muted">{a.candidate.email ?? a.candidate.phone ?? ''}</p></Td>
                <Td><Link className="text-primary hover:underline" href={`${p.base}/${a.requisitionId}`}>{jobTitle(p, a.requisitionId)}</Link></Td>
                <Td>{stageBadge(a.stage)}</Td>
                <Td className={`tabular-nums ${ACTIVE.includes(a.stage) && age >= p.settings.stall_days ? 'text-warning' : 'text-muted'}`}>{age}d</Td>
                <Td>{CANDIDATE_SOURCE_LABELS[a.candidate.source as CandidateSource]}</Td>
                <Td className="text-muted">{a.candidate.company ?? '—'}</Td>
                <Td className="text-muted">{formatDate(a.createdAt)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination page={page} pageCount={pages} total={rows.length} hrefFor={(n) => href({ page: String(n) })} />
    </Panel>
  );
}

async function Plans(p: Props) {
  const plans = await hiringPlans(p.orgId);
  const end = (start: string, kind: string) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + (kind === 'month' ? 1 : kind === 'quarter' ? 3 : 12));
    return d.toISOString().slice(0, 10);
  };
  return (
    <>
      <p className="text-sm text-muted">Plan headcount by department for a month, quarter or year; progress counts jobs opened and people hired in the period.</p>
      {plans.length === 0 && <Panel title="Hiring plans"><p className="text-sm text-muted">No hiring plans yet — create one to plan headcount by department.</p></Panel>}
      {plans.map((plan) => {
        const to = end(plan.period_start, plan.period_kind);
        const inPeriod = (iso: string) => iso.slice(0, 10) >= plan.period_start && iso.slice(0, 10) < to;
        const total = plan.lines.reduce((s, l) => s + l.headcount, 0);
        return (
          <Panel key={plan.id} title={plan.name} meta={`${plan.period_kind} from ${formatDate(plan.period_start)} · ${total} planned`}
            action={p.canManage ? <OneButton action={deletePlanAction.bind(null, p.slug)} hidden={{ planId: plan.id }} label={`Delete ${plan.name}`} confirm={`Delete ${plan.name}?`}>Delete</OneButton> : undefined} flush>
            <Table caption={`Plan ${plan.name}`}>
              <thead><tr><Th>Department</Th><Th className="text-right">Planned</Th><Th className="text-right">Openings raised</Th><Th className="text-right">Hired</Th><Th>Progress</Th></tr></thead>
              <tbody>{plan.lines.map((l) => {
                const jobs = p.data.jobs.filter((j) => j.department_id === l.department_id && inPeriod(j.created_at));
                const raised = jobs.reduce((s, j) => s + j.openings, 0);
                const hired = p.data.applications.filter((a) => a.stage === 'hired' && p.jobOf.get(a.requisitionId)?.department_id === l.department_id && inPeriod(a.stageChangedAt)).length;
                const pc = Math.min(100, Math.round((hired / l.headcount) * 100));
                return (
                  <tr key={l.id}><Td className="font-medium">{p.dept.get(l.department_id) ?? 'Archived'}</Td><Td className="text-right tabular-nums">{l.headcount}</Td><Td className="text-right tabular-nums">{raised}</Td><Td className="text-right tabular-nums">{hired}</Td>
                    <Td><div className="h-2 w-40 rounded-full bg-subtle"><div className="h-2 rounded-full bg-success" style={{ width: `${pc}%` }} /></div><span className="text-xs text-muted">{pc}%</span></Td></tr>
                );
              })}</tbody>
            </Table>
          </Panel>
        );
      })}
      {p.canManage && <Panel title="＋ New plan"><PlanForm action={createPlanAction.bind(null, p.slug)} month={p.today.slice(0, 7)} departments={p.structure.departments.map((d) => ({ value: d.id, label: d.name }))} /></Panel>}
    </>
  );
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

async function Pipeline(p: Props) {
  const view = ['board', 'interviews', 'feedback', 'scorecards', 'offers', 'approvals'].includes(p.sp.view ?? '') ? p.sp.view! : 'board';
  const apps = p.data.applications;
  const { interviews, offers } = await hiringInterviewsAndOffers(p.orgId, apps.map((a) => a.id));
  const appOf = new Map(apps.map((a) => [a.id, a]));
  const panelNames = await employeeNames(p.orgId, interviews.flatMap((i) => i.panel.map((x) => x.employeeId))).then((m) => m).catch(() => new Map<string, string>());
  const colleagues = await colleagueNames(p.orgId);
  const nameOf = (id: string) => panelNames.get(id) ?? colleagues.get(id) ?? 'Panelist';
  const now = new Date().getTime();
  const job = p.jobOf.has(p.sp.job ?? '') ? p.sp.job! : null;
  const source = CANDIDATE_SOURCES.includes(p.sp.source as CandidateSource) ? (p.sp.source as CandidateSource) : null;
  const offerRows = [...offers.entries()].map(([appId, o]) => ({ a: appOf.get(appId)!, o })).filter((r) => r.a);
  const stages = MOVABLE_STAGES.map((s) => ({ value: s, label: APPLICATION_STAGE_LABELS[s] }));
  const sel = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm';
  return (
    <div className="space-y-5">
      <SubTabs base={p.base} extra={{ tab: 'pipeline' }} label="Pipeline" current={view} tabs={[
        { key: 'board', label: 'Pipeline' }, { key: 'interviews', label: 'Interviews', count: interviews.filter((i) => i.status === 'scheduled' && Date.parse(i.scheduledAt) >= now).length },
        { key: 'feedback', label: 'Feedback' }, { key: 'scorecards', label: 'Scorecards' },
        { key: 'offers', label: 'Offers', count: offerRows.length }, { key: 'approvals', label: 'Approvals', count: offerRows.filter((r) => r.o.status === 'pending_approval').length },
      ]} />
      {view === 'board' && (
        <>
          <form className="flex flex-wrap items-end gap-2" action={p.base}>
            <input type="hidden" name="tab" value="pipeline" /><input type="hidden" name="view" value="board" />
            <select name="job" defaultValue={job ?? ''} aria-label="Job" className={sel}><option value="">All jobs</option>{p.data.jobs.filter((j) => j.status !== 'closed').map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
            <select name="source" defaultValue={source ?? ''} aria-label="Source" className={sel}><option value="">All sources</option>{CANDIDATE_SOURCES.map((s) => <option key={s} value={s}>{CANDIDATE_SOURCE_LABELS[s]}</option>)}</select>
            <button className="h-9 rounded-md border border-line bg-surface px-3 text-sm hover:bg-subtle">Apply</button>
          </form>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Candidate pipeline">
            {ORDER.map((s) => {
              const col = apps.filter((a) => a.stage === s && (!job || a.requisitionId === job) && (!source || a.candidate.source === source));
              return (
                <section key={s} aria-label={APPLICATION_STAGE_LABELS[s]} className="rounded-xl border border-line bg-surface p-3">
                  <h3 className="mb-2 flex justify-between text-sm font-semibold">{APPLICATION_STAGE_LABELS[s]}<span className="tabular-nums text-muted">{col.length}</span></h3>
                  {col.length === 0 && <p className="py-4 text-center text-xs text-muted">—</p>}
                  <ul className="space-y-2">{col.slice(0, 50).map((a) => (
                    <li key={a.id} className="rounded-lg border border-line bg-raised p-2 text-sm">
                      <Link href={`${p.base}/${a.requisitionId}`} className="font-medium hover:underline">{a.candidate.name}</Link>
                      <p className="truncate text-xs text-muted">{jobTitle(p, a.requisitionId)} · {days(a.stageChangedAt)}d</p>
                      {p.canManage && s !== 'hired' && <MoveCard action={moveApplicationAction.bind(null, p.slug)} applicationId={a.id} stage={a.stage} stages={stages} name={a.candidate.name} />}
                    </li>
                  ))}</ul>
                </section>
              );
            })}
          </div>
          <p className="text-xs text-muted">Offers, interviews and hiring are done on each job’s page (click a candidate).</p>
        </>
      )}
      {view === 'interviews' && p.sp.show === 'calendar' && <InterviewCalendar p={p} interviews={interviews} appOf={appOf} nameOf={nameOf} now={now} />}
      {view === 'interviews' && p.sp.show !== 'calendar' && (
        <Panel title="Interviews" flush action={<span className="flex gap-3 text-xs">
          <Link className="text-primary" href={`${p.base}?tab=pipeline&view=interviews&show=calendar`}>🗓 Calendar view</Link>
          <Link className="text-primary" href={`${p.base}/interviews`}>My interviews →</Link>
        </span>}>
          {interviews.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No interviews yet.</p> : (
            <Table caption="Interviews">
              <thead><tr><Th>When</Th><Th>Candidate</Th><Th>Job</Th><Th>Round</Th><Th>Panel</Th><Th>Status</Th></tr></thead>
              <tbody>{[...interviews].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).map((i) => {
                const a = appOf.get(i.applicationId);
                return (
                  <tr key={i.id}><Td className="whitespace-nowrap">{formatDate(i.scheduledAt)}</Td><Td className="font-medium">{a?.candidate.name ?? '—'}</Td>
                    <Td>{a ? <Link className="text-primary hover:underline" href={`${p.base}/${a.requisitionId}`}>{jobTitle(p, a.requisitionId)}</Link> : '—'}</Td><Td>{i.round}</Td>
                    <Td className="text-xs">{i.panel.map((x) => nameOf(x.employeeId)).join(', ')}</Td>
                    <Td><Badge tone={i.status === 'completed' ? 'success' : i.status === 'cancelled' ? 'neutral' : Date.parse(i.scheduledAt) < now ? 'warning' : 'primary'}>{i.status === 'scheduled' && Date.parse(i.scheduledAt) < now ? 'Awaiting feedback' : i.status}</Badge></Td></tr>
                );
              })}</tbody>
            </Table>
          )}
        </Panel>
      )}
      {view === 'feedback' && (
        <Panel title="Feedback" meta="recommendations submitted by panelists" flush>
          {(() => {
            const rows = interviews.flatMap((i) => i.panel.filter((x) => x.recommendation).map((x) => ({ i, x })));
            return rows.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No feedback yet.</p> : (
              <Table caption="Feedback">
                <thead><tr><Th>Candidate</Th><Th>Job</Th><Th>Round</Th><Th>Panelist</Th><Th>Recommendation</Th></tr></thead>
                <tbody>{rows.map(({ i, x }) => {
                  const a = appOf.get(i.applicationId);
                  const r = x.recommendation as keyof typeof RECOMMENDATION_LABELS;
                  return <tr key={`${i.id}${x.employeeId}`}><Td className="font-medium">{a?.candidate.name}</Td><Td>{a ? jobTitle(p, a.requisitionId) : '—'}</Td><Td>{i.round}</Td><Td>{nameOf(x.employeeId)}</Td>
                    <Td><Badge tone={r === 'strong_yes' || r === 'yes' ? 'success' : 'danger'}>{RECOMMENDATION_LABELS[r]}</Badge></Td></tr>;
                })}</tbody>
              </Table>
            );
          })()}
        </Panel>
      )}
      {view === 'scorecards' && (
        <Panel title="Scorecards due" meta="interviews held without every panelist’s scorecard" flush>
          {(() => {
            const due = interviews.filter((i) => Date.parse(i.scheduledAt) < now && i.status !== 'cancelled').flatMap((i) => i.panel.filter((x) => !x.recommendation).map((x) => ({ i, x })));
            return due.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">Every scorecard is in.</p> : (
              <Table caption="Scorecards due">
                <thead><tr><Th>Panelist</Th><Th>Candidate</Th><Th>Round</Th><Th>Interviewed</Th><Th>Waiting</Th></tr></thead>
                <tbody>{due.map(({ i, x }) => {
                  const a = appOf.get(i.applicationId);
                  return <tr key={`${i.id}${x.employeeId}`}><Td className="font-medium">{nameOf(x.employeeId)}</Td><Td>{a?.candidate.name}</Td><Td>{i.round}</Td><Td>{formatDate(i.scheduledAt)}</Td><Td className="tabular-nums text-warning">{days(i.scheduledAt)}d</Td></tr>;
                })}</tbody>
              </Table>
            );
          })()}
        </Panel>
      )}
      {(view === 'offers' || view === 'approvals') && (
        <Panel title={view === 'offers' ? 'Offers' : 'Offers awaiting approval'} flush action={view === 'approvals' ? <Link className="text-xs text-primary" href={`/app/${p.slug}/inbox`}>Decide in the inbox →</Link> : undefined}>
          {(() => {
            const rows = view === 'offers' ? offerRows : offerRows.filter((r) => r.o.status === 'pending_approval');
            return rows.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">{view === 'offers' ? 'No offers yet.' : 'Nothing awaiting approval.'}</p> : (
              <Table caption="Offers">
                <thead><tr><Th>Candidate</Th><Th>Job</Th><Th className="text-right">Annual CTC</Th><Th>Joining</Th><Th>Expires</Th><Th>Status</Th></tr></thead>
                <tbody>{rows.map(({ a, o }) => (
                  <tr key={o.id}><Td className="font-medium"><Link className="hover:underline" href={`${p.base}/${a.requisitionId}`}>{a.candidate.name}</Link></Td><Td>{jobTitle(p, a.requisitionId)}</Td>
                    <Td className="text-right tabular-nums">{inr(o.annualCtc)}</Td><Td>{formatDate(o.joiningDate)}</Td><Td>{formatDate(o.expiresOn)}</Td>
                    <Td><Badge tone={o.status === 'accepted' ? 'success' : o.status === 'declined' || o.status === 'withdrawn' ? 'danger' : o.status === 'pending_approval' ? 'warning' : 'primary'}>{o.status.replace('_', ' ')}</Badge></Td></tr>
                ))}</tbody>
              </Table>
            );
          })()}
        </Panel>
      )}
    </div>
  );
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Kredily's interview calendar: a month of interviews by day (organization time), each linked to its job. */
function InterviewCalendar({ p, interviews, appOf, nameOf, now }: {
  p: Props; interviews: InterviewView[]; appOf: Map<string, HiringApplication>; nameOf: (id: string) => string; now: number;
}) {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(p.sp.month ?? '') ? p.sp.month! : p.today.slice(0, 7);
  const href = (m: string) => `${p.base}?tab=pipeline&view=interviews&show=calendar&month=${m}`;
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: p.tz, hour: 'numeric', minute: '2-digit' });
  const title = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const byDay = new Map<string, InterviewView[]>();
  for (const i of [...interviews].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    const day = todayIn(p.tz, new Date(i.scheduledAt));
    if (day.startsWith(month)) byDay.set(day, [...(byDay.get(day) ?? []), i]);
  }
  const cells = monthCells(month);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const count = [...byDay.values()].reduce((n, l) => n + l.length, 0);
  const nav = 'rounded-md border border-line px-2 py-1 hover:bg-subtle';
  return (
    <Panel title={`Interviews · ${title}`} meta={`${count} interview${count === 1 ? '' : 's'}`} flush action={
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <Link className={nav} href={href(addMonths(`${month}-01`, -1).slice(0, 7))} aria-label="Previous month">‹</Link>
        <Link className={nav} href={href(p.today.slice(0, 7))}>Today</Link>
        <Link className={nav} href={href(addMonths(`${month}-01`, 1).slice(0, 7))} aria-label="Next month">›</Link>
        <Link className="text-primary" href={`${p.base}?tab=pipeline&view=interviews`}>☰ List view</Link>
      </span>
    }>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-sm" aria-label="Interview calendar">
          <thead><tr>{WEEK.map((d) => <th key={d} className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">{d}</th>)}</tr></thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((d, i) => (
                  <td key={d ?? `pad-${w}-${i}`} className={`h-24 border border-line p-1.5 align-top ${d ? '' : 'bg-subtle/50'}`} aria-label={d ? formatDate(d) : undefined}>
                    {d && (
                      <>
                        <span className={`inline-grid size-6 place-items-center rounded-full text-xs tabular-nums ${d === p.today ? 'bg-primary font-semibold text-primary-fg' : 'text-muted'}`}>{Number(d.slice(8))}</span>
                        <ul className="mt-1 space-y-1">
                          {(byDay.get(d) ?? []).map((iv) => {
                            const a = appOf.get(iv.applicationId);
                            const tone = iv.status === 'cancelled' ? 'border-line text-muted line-through' : iv.status === 'completed' ? 'border-success/40 bg-success/10'
                              : Date.parse(iv.scheduledAt) < now ? 'border-warning/40 bg-warning/10' : 'border-primary/30 bg-primary-soft';
                            const label = `${time.format(new Date(iv.scheduledAt))} · ${a?.candidate.name ?? 'Candidate'} · ${iv.round}`;
                            return (
                              <li key={iv.id}>
                                <Link href={a ? `${p.base}/${a.requisitionId}` : p.base} title={`${label}${a ? ` · ${jobTitle(p, a.requisitionId)}` : ''} · ${iv.panel.map((x) => nameOf(x.employeeId)).join(', ')}`}
                                  className={`block truncate rounded border px-1.5 py-0.5 text-xs ${tone}`}>{label}</Link>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ─── Outreach ────────────────────────────────────────────────────────────────

async function Outreach(p: Props) {
  const view = ['pools', 'board', 'templates'].includes(p.sp.view ?? '') ? p.sp.view! : 'pools';
  return (
    <div className="space-y-5">
      <SubTabs base={p.base} extra={{ tab: 'outreach' }} label="Outreach" current={view} tabs={[{ key: 'pools', label: 'Talent Pools' }, { key: 'board', label: 'Job Board' }, { key: 'templates', label: 'Email Templates' }]} />
      {view === 'pools' && <Pools {...p} />}
      {view === 'board' && <JobBoard {...p} />}
      {view === 'templates' && <Templates {...p} />}
    </div>
  );
}

async function Pools(p: Props) {
  const pools = await talentPools(p.orgId);
  const byCandidate = new Map<string, HiringApplication>();
  for (const a of p.data.applications) if (!byCandidate.has(a.candidate.id)) byCandidate.set(a.candidate.id, a);
  return (
    <>
      {pools.length === 0 && <Panel title="Talent pools"><p className="text-sm text-muted">No pools yet — create one to group candidates for nurture and re-engagement.</p></Panel>}
      {pools.map((pool) => (
        <Panel key={pool.id} title={pool.name} meta={`${pool.members.length} candidate${pool.members.length === 1 ? '' : 's'}${pool.description ? ` · ${pool.description}` : ''}`} flush
          action={p.canManage ? <OneButton action={deletePoolAction.bind(null, p.slug)} hidden={{ poolId: pool.id }} label={`Delete ${pool.name}`} confirm={`Delete ${pool.name}? The candidates stay.`}>Delete pool</OneButton> : undefined}>
          {pool.members.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No candidates in this pool.</p> : (
            <Table caption={`Pool ${pool.name}`}>
              <thead><tr><Th>Candidate</Th><Th>Last job</Th><Th>Stage</Th><Th>Source</Th><Th>Added</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>{pool.members.map((m) => {
                const a = byCandidate.get(m.candidate_id);
                return (
                  <tr key={m.candidate_id}><Td className="font-medium">{a?.candidate.name ?? 'Candidate'}<p className="text-xs text-muted">{a?.candidate.email ?? ''}</p></Td>
                    <Td>{a ? jobTitle(p, a.requisitionId) : '—'}</Td><Td>{a ? stageBadge(a.stage) : '—'}</Td><Td>{a ? CANDIDATE_SOURCE_LABELS[a.candidate.source as CandidateSource] : '—'}</Td><Td className="text-muted">{formatDate(m.added_at)}</Td>
                    <Td className="text-right">{p.canManage && <OneButton action={removeFromPoolAction.bind(null, p.slug)} hidden={{ poolId: pool.id, candidateId: m.candidate_id }} label={`Remove ${a?.candidate.name ?? 'candidate'}`}>Remove</OneButton>}</Td></tr>
                );
              })}</tbody>
            </Table>
          )}
        </Panel>
      ))}
      {p.canManage && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="＋ New pool"><PoolForm action={createPoolAction.bind(null, p.slug)} /></Panel>
          <Panel title="Add candidates to a pool"><AddToPoolForm action={addToPoolAction.bind(null, p.slug)} pools={pools.map((x) => ({ value: x.id, label: x.name }))}
            candidates={[...byCandidate.values()].map((a) => ({ value: a.candidate.id, label: `${a.candidate.name} · ${jobTitle(p, a.requisitionId)}` }))} /></Panel>
        </div>
      )}
    </>
  );
}

async function JobBoard(p: Props) {
  const published = p.data.jobs.filter((j) => j.is_published && j.status === 'open');
  const careers = `/careers/${p.slug}`;
  const feed = `${publicOriginFromHeaders(await headers()) ?? ''}${careers}/jobs.xml`;
  const boards: Array<[string, string]> = [
    ['Google for Jobs', 'Automatic. Every job page carries Google’s job-posting data, so your jobs can show in Google’s job search once the careers page is indexed.'],
    ['Indeed', 'Give Indeed the feed address from your Indeed employer account (or ask Indeed’s support team to schedule the feed).'],
    ['LinkedIn', 'LinkedIn imports job feeds only through its job-posting partners and paid job slots. Ask your LinkedIn account team to set up the feed, or post jobs there with the link to apply.'],
    ['Naukri', 'Naukri.com posts jobs through a Naukri recruiter account. Ask your Naukri account manager whether they can read the feed, or post jobs there with the link to apply.'],
  ];
  return (
    <>
      <Panel title="Job boards" meta="each board needs an employer or partner account" action={<a className="text-xs text-primary" href={`${careers}/jobs.xml`} target="_blank" rel="noreferrer">Open the feed ↗</a>}>
        <p className="text-sm text-muted">Published jobs are also available as a feed in Indeed’s XML format, which most job boards and aggregators read. Give a board this address once and it picks up new and closed jobs by itself.</p>
        <p className="mt-2 break-all rounded-lg bg-subtle px-3 py-2 font-mono text-sm" aria-label="Job feed address">{feed}</p>
        <ul className="mt-4 space-y-2 text-sm" aria-label="Job boards">
          {boards.map(([name, how]) => <li key={name}><span className="font-medium">{name}</span> <span className="text-muted">· {how}</span></li>)}
        </ul>
      </Panel>
      <Panel title="Your careers page" action={<Link className="text-xs text-primary" href={careers} target="_blank">Open careers page ↗</Link>}>
        <p className="text-sm text-muted">Open jobs you publish appear on your public careers page, where candidates apply directly (source: careers site, with consent). Share the page or a job’s link on job boards and social media.</p>
        <p className="mt-2 font-mono text-sm">{careers}</p>
      </Panel>
      <Panel title="Published jobs" meta={`${published.length} live`} flush>
        {published.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No job is published. Publish one from its page (“Show on careers page”).</p> : (
          <Table caption="Published jobs">
            <thead><tr><Th>Job</Th><Th>Department</Th><Th className="text-right">Applicants</Th><Th className="text-right">From careers page</Th><Th>Link</Th></tr></thead>
            <tbody>{published.map((j) => {
              const apps = p.data.applications.filter((a) => a.requisitionId === j.id);
              return <tr key={j.id}><Td className="font-medium"><Link className="text-primary hover:underline" href={`${p.base}/${j.id}`}>{j.title}</Link></Td><Td>{j.department_id ? p.dept.get(j.department_id) ?? '—' : '—'}</Td>
                <Td className="text-right tabular-nums">{apps.length}</Td><Td className="text-right tabular-nums">{apps.filter((a) => a.candidate.source === 'careers_site').length}</Td>
                <Td><Link className="font-mono text-xs text-primary" href={`${careers}/${j.id}`} target="_blank">{`${careers}/${j.id.slice(0, 8)}…`}</Link></Td></tr>;
            })}</tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}

async function Templates(p: Props) {
  const templates = await emailTemplates(p.orgId);
  const sample = { candidate_name: 'Asha Rao', candidate_first_name: 'Asha', job_title: p.data.jobs[0]?.title ?? 'Software Engineer', company: p.orgName, recruiter_name: 'The hiring team', interview_time: '24 Oct, 11:00 am' };
  return (
    <>
      <p className="text-sm text-muted">Reusable messages with variables. “Compose” opens your email app with the message filled in for a candidate.</p>
      {templates.map((t) => (
        <Panel key={t.id} title={t.name} meta={t.kind.replace('_', ' ')}
          action={<div className="flex items-center gap-2">
            <a className="text-xs text-primary" href={`mailto:?subject=${encodeURIComponent(fillTemplate(t.subject, sample))}&body=${encodeURIComponent(fillTemplate(t.body, sample))}`}>Compose ✉</a>
            {p.canManage && <OneButton action={deleteTemplateAction.bind(null, p.slug)} hidden={{ templateId: t.id }} label={`Delete ${t.name}`} confirm={`Delete ${t.name}?`}>Delete</OneButton>}
          </div>}>
          {p.canManage ? <details><summary className="cursor-pointer text-sm text-primary">Edit</summary><div className="mt-3"><TemplateForm action={saveTemplateAction.bind(null, p.slug)} template={t} sample={sample} variables={TEMPLATE_VARIABLES} /></div></details>
            : <p className="whitespace-pre-wrap text-sm text-muted">{t.body}</p>}
        </Panel>
      ))}
      {p.canManage && <Panel title="＋ New template"><TemplateForm action={saveTemplateAction.bind(null, p.slug)} sample={sample} variables={TEMPLATE_VARIABLES} /></Panel>}
    </>
  );
}

// ─── Insights ────────────────────────────────────────────────────────────────

async function Insights(p: Props) {
  const view = p.sp.view === 'activity' ? 'activity' : 'analytics';
  const apps = p.data.applications;
  return (
    <div className="space-y-5">
      <SubTabs base={p.base} extra={{ tab: 'insights' }} label="Insights" current={view} tabs={[{ key: 'analytics', label: 'Analytics' }, { key: 'activity', label: 'Activity Log' }]} />
      {view === 'analytics' ? <Analytics p={p} apps={apps} /> : <Activity p={p} />}
    </div>
  );
}

async function Analytics({ p, apps }: { p: Props; apps: HiringApplication[] }) {
  const [{ interviews, offers }, spend] = await Promise.all([hiringInterviewsAndOffers(p.orgId, apps.map((a) => a.id)), recruitingSpend(p.orgId)]);
  const hired = apps.filter((a) => a.stage === 'hired');
  const decided = apps.filter((a) => ['hired', 'rejected', 'withdrawn'].includes(a.stage));
  const offerList = [...offers.values()];
  const sent = offerList.filter((o) => ['sent', 'accepted', 'declined'].includes(o.status));
  const accepted = offerList.filter((o) => o.status === 'accepted');
  const declined = offerList.filter((o) => o.status === 'declined');
  const tth = hired.map((a) => days(a.createdAt, Date.parse(a.stageChangedAt)));
  const done = interviews.filter((i) => i.status === 'completed' || (i.status === 'scheduled' && Date.parse(i.scheduledAt) < new Date().getTime()));
  const recs = interviews.flatMap((i) => i.panel.map((x) => x.recommendation).filter((r): r is string => !!r));
  const funnel = ORDER.map((s) => ({ s, n: apps.filter((a) => ORDER.indexOf(a.stage) >= ORDER.indexOf(s)).length + (s === 'applied' ? apps.filter((a) => a.stage === 'rejected' || a.stage === 'withdrawn').length : 0) }));
  const bySource = CANDIDATE_SOURCES.map((s) => {
    const all = apps.filter((a) => a.candidate.source === s);
    const h = all.filter((a) => a.stage === 'hired').length;
    const cost = spend.filter((x) => x.source === s).reduce((t, x) => t + x.amount, 0);
    return { s, all: all.length, hired: h, cost };
  }).filter((x) => x.all > 0 || x.cost > 0);
  const byRole = [...new Set(hired.map((a) => a.requisitionId))].map((id) => {
    const h = hired.filter((a) => a.requisitionId === id);
    return { id, title: jobTitle(p, id), n: h.length, avg: Math.round(h.reduce((t, a) => t + days(a.createdAt, Date.parse(a.stageChangedAt)), 0) / h.length) };
  });
  const recruiters = [...new Set(apps.map((a) => a.createdBy).filter((x): x is string => !!x))];
  const team = await recruitingTeam(p.orgId);
  const recruiterName = (uid: string) => team.find((t) => t.user_id === uid)?.name ?? 'Former member';
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="🎯 Hire rate" value={pct(hired.length, decided.length)} note="of decided candidates" tone="success" />
        <StatCard label="📈 Offer accept" value={pct(accepted.length, sent.length)} note={`${accepted.length} of ${sent.length} sent`} tone="primary" />
        <StatCard label="⏱️ Avg time to hire" value={`${tth.length ? Math.round(tth.reduce((a, b) => a + b, 0) / tth.length) : 0}d`} note="application → hired" />
        <StatCard label="✅ Total hired" value={hired.length} />
        <StatCard label="🗣️ Interviews done" value={done.length} note={`${interviews.filter((i) => i.status === 'cancelled').length} cancelled`} />
        <StatCard label="📨 Offers sent" value={sent.length} />
        <StatCard label="✅ Interview pass rate" value={pct(recs.filter((r) => r === 'yes' || r === 'strong_yes').length, recs.length)} note="positive recommendations" tone="accent" />
        <StatCard label="🚫 Cancelled interviews" value={pct(interviews.filter((i) => i.status === 'cancelled').length, interviews.length)} />
        <StatCard label="🙅 Offers declined" value={declined.length} />
        <StatCard label="📮 In progress" value={apps.filter((a) => ACTIVE.includes(a.stage)).length} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Pipeline conversion">
          <ul className="space-y-2">{funnel.map(({ s, n }, i) => (
            <li key={s}><div className="flex justify-between text-sm"><span>{APPLICATION_STAGE_LABELS[s]}</span><span className="tabular-nums text-muted">{n}{i > 0 ? ` · ${pct(n, funnel[i - 1]!.n)}` : ''}</span></div>
              <div className="mt-1 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-primary" style={{ width: `${funnel[0]!.n ? (n / funnel[0]!.n) * 100 : 0}%` }} /></div></li>
          ))}</ul>
        </Panel>
        <Panel title="Source effectiveness">
          {bySource.length === 0 ? <p className="text-sm text-muted">No data yet.</p> : (
            <ul className="space-y-1.5 text-sm">{bySource.map((x) => <li key={x.s} className="flex justify-between"><span>{CANDIDATE_SOURCE_LABELS[x.s]}</span><span className="tabular-nums text-muted">{x.all} candidates · {x.hired} hired · {pct(x.hired, x.all)}</span></li>)}</ul>
          )}
        </Panel>
        <Panel title="Time to hire by role">
          {byRole.length === 0 ? <p className="text-sm text-muted">No data yet.</p> : (
            <ul className="space-y-1.5 text-sm">{byRole.map((r) => <li key={r.id} className="flex justify-between"><span>{r.title}</span><span className="tabular-nums text-muted">{r.n} hired · {r.avg}d average</span></li>)}</ul>
          )}
        </Panel>
        <Panel title="Recruiter performance" flush>
          {recruiters.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No recruiter activity yet.</p> : (
            <Table caption="Recruiter performance">
              <thead><tr><Th>Recruiter</Th><Th className="text-right">Candidates</Th><Th className="text-right">Hired</Th><Th className="text-right">Hire rate</Th></tr></thead>
              <tbody>{recruiters.map((uid) => {
                const mine = apps.filter((a) => a.createdBy === uid);
                const h = mine.filter((a) => a.stage === 'hired').length;
                return <tr key={uid}><Td>{recruiterName(uid)}</Td><Td className="text-right tabular-nums">{mine.length}</Td><Td className="text-right tabular-nums">{h}</Td><Td className="text-right tabular-nums">{pct(h, mine.length)}</Td></tr>;
              })}</tbody>
            </Table>
          )}
          <p className="px-5 py-2 text-xs text-muted">Candidates are credited to whoever added them; careers-page applicants have no recruiter.</p>
        </Panel>
      </div>
      <Panel title="Cost per hire by source" meta={`overall ${hired.length ? inr(spend.reduce((t, x) => t + x.amount, 0) / hired.length) : '—'}`} flush>
        <Table caption="Cost per hire">
          <thead><tr><Th>Source</Th><Th className="text-right">Hires</Th><Th className="text-right">Spend</Th><Th className="text-right">Cost / hire</Th></tr></thead>
          <tbody>
            {bySource.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-sm text-muted">Record recruiting spend below to see cost per hire.</td></tr>}
            {bySource.map((x) => <tr key={x.s}><Td>{CANDIDATE_SOURCE_LABELS[x.s]}</Td><Td className="text-right tabular-nums">{x.hired}</Td><Td className="text-right tabular-nums">{x.cost ? inr(x.cost) : '—'}</Td><Td className="text-right tabular-nums">{x.hired && x.cost ? inr(x.cost / x.hired) : '—'}</Td></tr>)}
          </tbody>
        </Table>
        {p.canManage && <div className="border-t border-line px-5 py-4"><SpendForm action={addSpendAction.bind(null, p.slug)} month={p.today.slice(0, 7)} sources={CANDIDATE_SOURCES.map((s) => ({ value: s, label: CANDIDATE_SOURCE_LABELS[s] }))} /></div>}
        {spend.length > 0 && (
          <ul className="divide-y divide-line border-t border-line px-5 text-sm">{spend.slice(0, 20).map((x) => (
            <li key={x.id} className="flex items-center justify-between py-2"><span>{CANDIDATE_SOURCE_LABELS[x.source as CandidateSource]} · {x.month.slice(0, 7)}{x.note ? ` · ${x.note}` : ''}</span>
              <span className="flex items-center gap-2 tabular-nums">{inr(x.amount)}{p.canManage && <OneButton action={deleteSpendAction.bind(null, p.slug)} hidden={{ spendId: x.id }} label="Remove spend">Remove</OneButton>}</span></li>
          ))}</ul>
        )}
      </Panel>
      <p className="text-xs text-muted">Kredily’s AI briefings and auto-pilot screening are skipped, as agreed.</p>
    </>
  );
}

async function Activity({ p }: { p: Props }) {
  const rows = await recruitingActivity(p.orgId, 200);
  const label: Record<string, string> = {
    job_requisitions: 'Job', candidates: 'Candidate', applications: 'Application', interviews: 'Interview', offers: 'Offer', offer_versions: 'Offer terms',
    scorecards: 'Scorecard', hiring_plans: 'Hiring plan', talent_pools: 'Talent pool', talent_pool_members: 'Pool member', recruiting_email_templates: 'Template', recruiting_spend: 'Spend',
  };
  return (
    <Panel title="Activity log" meta="latest 200" flush>
      {rows.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No activity yet.</p> : (
        <Table caption="Recruitment activity">
          <thead><tr><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Subject</Th><Th>Change</Th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const stage = (r.changes as { stage?: { new?: string } } | null)?.stage?.new;
            return (
              <tr key={i}><Td className="whitespace-nowrap text-muted">{formatDate(r.occurred_at)}</Td><Td>{r.actor}</Td><Td>{label[r.entity_type] ?? r.entity_type} {r.action === 'insert' ? 'added' : r.action === 'delete' ? 'removed' : 'updated'}</Td>
                <Td>{r.subject}</Td><Td className="text-xs text-muted">{stage ? `→ ${APPLICATION_STAGE_LABELS[stage as ApplicationStage] ?? stage}` : ''}</Td></tr>
            );
          })}</tbody>
        </Table>
      )}
    </Panel>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function Settings(p: Props) {
  const view = p.sp.view === 'automations' ? 'automations' : 'team';
  const [team, retention] = await Promise.all([recruitingTeam(p.orgId), p.canManage ? candidateRetention(p.orgId) : Promise.resolve(null)]);
  return (
    <div className="space-y-5">
      <SubTabs base={p.base} extra={{ tab: 'settings' }} label="Settings" current={view} tabs={[{ key: 'team', label: 'Team' }, { key: 'automations', label: 'Approvals & Automations' }]} />
      {view === 'team' && (
        <Panel title="Team" meta={`${team.length} members · straight from your directory and roles`} flush action={<Link className="text-xs text-primary" href={`/app/${p.slug}/members`}>Change roles in Members →</Link>}>
          <Table caption="Recruitment team">
            <thead><tr><Th>Member</Th><Th>Email</Th><Th>Roles</Th><Th>ATS access</Th></tr></thead>
            <tbody>{team.map((t) => <tr key={t.user_id}><Td className="font-medium">{t.name}</Td><Td className="text-muted">{t.email}</Td><Td>{t.roles.join(', ')}</Td><Td><Badge tone={t.access.startsWith('Manage') ? 'success' : 'neutral'}>{t.access}</Badge></Td></tr>)}</tbody>
          </Table>
        </Panel>
      )}
      {view === 'automations' && (
        <>
          <Panel title="Approvals">
            <p className="text-sm text-muted">Offers go through the offer approval chain (Workflows › Approvals); approvers decide in their inbox. A recruiter can’t approve their own offer.</p>
            <Link className="mt-2 inline-block text-sm text-primary" href={`/app/${p.slug}/workflows`}>Open approval chains →</Link>
          </Panel>
          {p.canManage && <Panel title="Automations"><AutomationsForm action={saveAutomationsAction.bind(null, p.slug)} stallDays={p.settings.stall_days} notify={p.settings.notify_hiring_manager} /></Panel>}
          {retention && (
            <Card>
              <CardHeader title="Keeping candidate records" description="Candidates with no open application are erased this many days after their consent or last application activity. Hired candidates are kept as employees." />
              <CandidateRetentionForm action={saveCandidateRetentionAction.bind(null, p.slug)} days={retention.days} />
              <div className="border-t border-line px-5 py-3">
                <h3 className="text-sm font-medium">Due for erasure in the next 30 days</h3>
                {retention.due.length === 0 ? <p className="mt-1 text-sm text-muted">No candidates are due.</p> : (
                  <ul className="mt-2 divide-y divide-line text-sm" aria-label="Candidates due for erasure">
                    {retention.due.map((c) => <li key={c.candidate_id} className="flex justify-between py-2"><span>{c.name}<span className="block text-xs text-muted">Last activity {formatDate(c.last_activity_at)}</span></span><span className="tabular-nums text-muted">Erased {formatDate(c.erase_after)}</span></li>)}
                  </ul>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Hiring managers (team scope) ────────────────────────────────────────────

async function TeamJobs({ slug, orgId }: { slug: string; orgId: string }) {
  const [requisitions, structure] = await Promise.all([listRequisitions(orgId), getStructure(orgId)]);
  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  return (
    <>
      <PageHeader title="Recruitment" description="Requisitions where you or someone in your reporting line is the hiring manager." />
      <Card>
        <CardHeader title="Requisitions" description={`${requisitions.filter((r) => r.status === 'open').length} open`} />
        <Table caption="Requisitions">
          <thead><tr><Th>Code</Th><Th>Title</Th><Th>Department</Th><Th>Openings</Th><Th>In pipeline</Th><Th>Status</Th><Th>Opened</Th></tr></thead>
          <tbody>
            {requisitions.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted">No requisitions yet.</td></tr>}
            {requisitions.map((r) => (
              <tr key={r.id}><Td className="font-mono text-xs">{r.code}</Td><Td className="font-medium"><Link className="text-primary hover:underline" href={`/app/${slug}/recruitment/${r.id}`}>{r.title}</Link></Td>
                <Td className="text-muted">{r.department_id ? (dept.get(r.department_id) ?? 'Archived') : '—'}</Td><Td className="tabular-nums">{r.hired}/{r.openings} filled</Td><Td className="tabular-nums">{r.active}</Td>
                <Td><Badge tone={r.status === 'open' ? 'success' : 'neutral'}>{REQUISITION_STATUS_LABELS[r.status]}</Badge></Td><Td className="text-muted">{formatDate(r.created_at)}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
