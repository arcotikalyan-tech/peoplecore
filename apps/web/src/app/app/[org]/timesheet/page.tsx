import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { HubHeader, HubTabs, Panel, StatCard, SubTabs } from '@/components/ui/hub';
import { Alert, Badge } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { requireModule } from '@/server/modules';
import {
  hours, money, myReports, myTimer, tsEntries, tsInvoices, tsPending, tsPeople, tsSettings, tsWorkspace,
  type Entry, type Person, type Project, type TsSettings,
} from '@/server/timesheet';
import { viewModeFor } from '@/server/view';
import {
  addMembersAction, adjustEntryAction, copyLastWeekAction, decideAction, deleteEntryAction, generateInvoiceAction, invoiceStatusAction, logTimeAction,
  saveClientAction, saveIntegrationSettingsAction, saveLogSettingsAction, savePermissionSettingsAction, saveProjectAction, saveTaskAction, startTimerAction,
  stopTimerAction, updateMemberAction,
} from './actions';
import {
  AddMembersForm, AdjustForm, ApprovalTable, ClientForm, EntryForm, IntegrationSettingsForm, InvoiceForm, LogSettingsForm, MemberForm, MiniForm,
  PermissionSettingsForm, ProjectForm, TaskForm, TimerBar, type ApprovalRow, type ProjectOpt,
} from './timesheet-client';

export const metadata: Metadata = { title: 'Timesheet' };

type Search = Record<string, string | undefined>;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const btn = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-subtle';
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monday = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const nice = (d: string) => `${new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}, ${Number(d.slice(8, 10))} ${SHORT[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const short = (d: string) => `${Number(d.slice(8, 10))} ${SHORT[Number(d.slice(5, 7)) - 1]}`;
const hm = (t: string | null) => (t ? t.slice(0, 5) : '');
const STATUS: Record<Entry['status'], { tone: 'warning' | 'primary' | 'success' | 'danger'; label: string }> = {
  pending: { tone: 'warning', label: 'Pending' }, manager_approved: { tone: 'primary', label: 'Manager approved' }, approved: { tone: 'success', label: 'Approved' }, rejected: { tone: 'danger', label: 'Rejected' },
};

/**
 * Timesheet (Kredily's Timesheet). Admins (timesheet.manage): dashboard, time tracker, approvals, workspace (members,
 * clients, projects, tasks), finance (billable rollup and invoices), reports and settings. Members log their own time;
 * managers approve their reports' logs.
 */
export default async function TimesheetPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'timesheet');
  const base = `/app/${slug}/timesheet`;
  const today = todayIn(ctx.org.timezone);
  const isAdmin = ctx.can('timesheet.manage', 'org') && (await viewModeFor(ctx)) === 'admin';
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const [settings, ws, people, reports] = await Promise.all([tsSettings(ctx.org.id), tsWorkspace(ctx.org.id), tsPeople(ctx.org.id), myReports(ctx.org.id, me?.id ?? null)]);

  const tabs = isAdmin
    ? [{ key: 'dashboard', label: 'Dashboard' }, { key: 'tracker', label: 'Time Tracker' }, { key: 'approvals', label: 'Approvals' }, { key: 'workspace', label: 'Workspace' },
       { key: 'finance', label: 'Finance' }, { key: 'reports', label: 'Reports' }, { key: 'settings', label: 'Settings' }]
    : [{ key: 'tracker', label: 'Time Tracker' }, ...(reports.length ? [{ key: 'approvals', label: 'Approvals' }] : []), { key: 'reports', label: 'My Reports' }];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : tabs[0]!.key;
  const p: Props = { slug, base, today, sp, settings, ws, people, isAdmin, meId: me?.id ?? null, reports, orgId: ctx.org.id };

  return (
    <>
      <HubHeader title="Timesheet" subtitle={isAdmin ? 'Time logged against projects and tasks, approvals, utilisation and client billing.' : 'Log your time against projects and tasks; your manager approves it.'}
        actions={<Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}?tab=tracker`}>＋ Log time</Link>} />
      <HubTabs base={base} label="Timesheet sections" tabs={tabs} current={tab} />
      {tab === 'dashboard' && <Dashboard {...p} />}
      {tab === 'tracker' && <Tracker {...p} />}
      {tab === 'approvals' && <Approvals {...p} />}
      {tab === 'workspace' && <Workspace {...p} />}
      {tab === 'finance' && <Finance {...p} />}
      {tab === 'reports' && <Reports {...p} />}
      {tab === 'settings' && <Settings {...p} />}
    </>
  );
}

interface Props {
  slug: string; base: string; today: string; sp: Search; settings: TsSettings; ws: Awaited<ReturnType<typeof tsWorkspace>>;
  people: Map<string, Person>; isAdmin: boolean; meId: string | null; reports: string[]; orgId: string;
}

const projectLabel = (p: Props, projectId: string, taskId?: string | null) => {
  const pr = p.ws.projects.find((x) => x.id === projectId);
  const client = pr?.client_id ? p.ws.clients.find((c) => c.id === pr.client_id)?.name : null;
  const task = taskId ? p.ws.tasks.find((t) => t.id === taskId)?.name : null;
  return `${client ? `${client} · ` : ''}${pr?.name ?? 'Project'}${task ? ` · ${task}` : ''}`;
};
const personName = (p: Props, id: string) => p.people.get(id)?.name ?? 'Former employee';

/** Budget use: hours (all non-rejected time) or fees (billable time at the entry's rate). */
function burn(project: Project, entries: Entry[]) {
  const mine = entries.filter((e) => e.project_id === project.id && e.status !== 'rejected');
  const used = project.budget_type === 'hours' ? mine.reduce((s, e) => s + e.minutes, 0) / 60
    : mine.filter((e) => e.billable).reduce((s, e) => s + (e.minutes / 60) * (e.rate ?? 0), 0);
  return { used, pct: project.budget_amount ? Math.round((used / project.budget_amount) * 100) : 0 };
}

function BurnList({ p, entries }: { p: Props; entries: Entry[] }) {
  const budgeted = p.ws.projects.filter((x) => x.budget_type !== 'none' && x.status === 'active');
  if (budgeted.length === 0) return <p className="text-sm text-muted">No active project has a budget.</p>;
  return (
    <ul className="space-y-3">
      {budgeted.map((pr) => {
        const b = burn(pr, entries);
        const currency = p.ws.clients.find((c) => c.id === pr.client_id)?.currency ?? 'INR';
        return (
          <li key={pr.id}>
            <div className="flex justify-between text-sm"><span className="font-medium">{pr.name}</span>
              <span className="text-muted">{pr.budget_type === 'hours' ? `${b.used.toFixed(1)} / ${pr.budget_amount} h` : `${money(b.used, currency)} / ${money(pr.budget_amount ?? 0, currency)}`} · {b.pct}%</span></div>
            <div className="mt-1 h-2 rounded-full bg-subtle"><div className={`h-2 rounded-full ${b.pct >= 90 ? 'bg-danger' : b.pct >= 75 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(100, b.pct)}%` }} /></div>
            {b.pct >= 90 && <p className="mt-1 text-xs text-danger">⚠ {pr.name} is at {b.pct}% of its {pr.budget_type === 'hours' ? 'hours' : 'fee'} budget — review before logging more {pr.budget_type === 'fees' ? 'billable ' : ''}time.</p>}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

async function Dashboard(p: Props) {
  const week = monday(p.today);
  const [recent, pending] = await Promise.all([tsEntries(p.orgId, { from: addDays(p.today, -365), to: p.today }), tsPending(p.orgId)]);
  const thisWeek = recent.filter((e) => e.work_date >= week && e.status !== 'rejected').reduce((s, e) => s + e.minutes, 0);
  const last30 = recent.filter((e) => e.work_date >= addDays(p.today, -30) && e.status !== 'rejected');
  const total = last30.reduce((s, e) => s + e.minutes, 0);
  const billable = last30.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  const seats = p.ws.members.filter((m) => m.active).length;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Hours this week" value={hours(thisWeek)} note="across the organization" tone="primary" />
        <StatCard label="Pending approvals" value={pending.length} note="awaiting review" tone={pending.length ? 'warning' : 'success'} href={`${p.base}?tab=approvals`} />
        <StatCard label="Utilisation" value={`${total ? Math.round((billable / total) * 100) : 0}%`} note="billable / total, last 30 days" tone="accent" />
        <StatCard label="Active members" value={seats} note="timesheet workspace" href={`${p.base}?tab=workspace&view=members`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="⏳ Pending approvals" className="lg:col-span-2" flush action={<Link className="text-xs text-primary" href={`${p.base}?tab=approvals`}>Review all →</Link>}>
          {pending.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">All caught up 🎉</p> : (
            <Table caption="Pending approvals">
              <thead><tr><Th>Employee</Th><Th>Project</Th><Th>Date</Th><Th>Hours</Th><Th>Status</Th></tr></thead>
              <tbody>{pending.slice(0, 6).map((e) => (
                <tr key={e.id}><Td className="font-medium">{personName(p, e.employee_id)}</Td><Td>{projectLabel(p, e.project_id, e.task_id)}</Td><Td>{short(e.work_date)}</Td><Td className="tabular-nums">{hours(e.minutes)}</Td><Td><Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge></Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Panel>
        <Panel title="🔥 Project burn"><BurnList p={p} entries={recent} /></Panel>
      </div>
    </div>
  );
}

// ─── Time tracker ────────────────────────────────────────────────────────────

async function Tracker(p: Props) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.sp.date ?? '') ? p.sp.date! : p.today;
  const week = monday(date);
  const member = p.meId ? p.ws.members.find((m) => m.employee_id === p.meId && m.active) : undefined;
  const [entries, timer] = await Promise.all([p.meId ? tsEntries(p.orgId, { from: week, to: addDays(week, 6), employeeId: p.meId }) : Promise.resolve([]), myTimer(p.orgId)]);
  const myProjects = new Set(p.ws.projectMembers.filter((m) => m.employee_id === p.meId).map((m) => m.project_id));
  const projectOpts = (filter: (pr: Project) => boolean): ProjectOpt[] => p.ws.projects.filter((pr) => pr.status === 'active' && filter(pr)).map((pr) => ({
    id: pr.id, label: projectLabel(p, pr.id), internal: pr.kind === 'internal',
    tasks: p.ws.tasks.filter((t) => t.project_id === pr.id && !t.archived_at).map((t) => ({ id: t.id, name: t.name, billable: t.billable })),
  }));
  const mine = projectOpts((pr) => myProjects.has(pr.id));
  const canLogForOthers = (p.isAdmin && p.settings.creators.includes('admin')) || (p.reports.length > 0 && p.settings.creators.includes('manager'));
  const forPeople = canLogForOthers ? p.ws.members.filter((m) => m.active && m.employee_id !== p.meId && (p.isAdmin || p.reports.includes(m.employee_id)))
    .map((m) => ({ value: m.employee_id, label: personName(p, m.employee_id) })) : [];
  const day = entries.filter((e) => e.work_date === date);
  const nav = (d: string) => `${p.base}?tab=tracker&date=${d}`;
  const s = p.settings;
  const running = timer ? { label: projectLabel(p, timer.project_id, timer.task_id), description: timer.description, started_at: timer.started_at } : null;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{s.methods.includes('start_end') ? 'Start–End is the default' : 'Enter total hours'}{s.methods.includes('timer') ? '; use ▶ to time entries live.' : '.'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Link className={btn} href={nav(addDays(date, -1))} aria-label="Previous day">‹</Link>
        <h2 className="min-w-48 text-center text-lg font-semibold">{nice(date)}</h2>
        <Link className={btn} href={nav(addDays(date, 1))} aria-label="Next day">›</Link>
        {date !== p.today && <Link className="text-sm text-primary" href={nav(p.today)}>Today</Link>}
      </div>
      {!member && (
        <Alert tone="warning" title="🔒 You are not a member of this timesheet workspace">Time entries can only be logged by workspace members. {p.isAdmin ? 'Add yourself' : 'Ask an admin to add you'} under Workspace › Members › ＋ Add from directory.</Alert>
      )}
      {member && s.methods.includes('timer') && <TimerBar start={startTimerAction.bind(null, p.slug)} stop={stopTimerAction.bind(null, p.slug)} projects={mine} running={running} />}
      {(member || forPeople.length > 0) && (
        <Panel title="Add entry" action={member ? <MiniForm action={copyLastWeekAction.bind(null, p.slug)} hidden={{ weekStart: week }} label="Copy last week" variant="ghost">⧉ Copy last week</MiniForm> : undefined}>
          <EntryForm action={logTimeAction.bind(null, p.slug)} date={date} methods={s.methods} defaultBillable={s.default_billable}
            projects={member ? mine : projectOpts(() => true)} people={forPeople.length ? forPeople : undefined} />
          <p className="mt-3 text-xs text-muted">Rounding: {s.rounding ? `nearest ${s.rounding} min` : 'off'} · Overlap: {s.overlap} · {s.max_billable === 'none' ? 'no billable cap' : `billable cap ${s.max_billable_hours} h per ${s.max_billable}`}{s.lock_before ? ` · locked before ${short(s.lock_before)}` : ''}</p>
        </Panel>
      )}
      <Panel title="This week" meta={`Total: ${hours(entries.filter((e) => e.status !== 'rejected').reduce((a, e) => a + e.minutes, 0))}`}>
        <div className="grid grid-cols-7 gap-2 text-center">
          {DAYS.map((d, i) => {
            const dd = addDays(week, i);
            const mins = entries.filter((e) => e.work_date === dd && e.status !== 'rejected').reduce((a, e) => a + e.minutes, 0);
            return (
              <Link key={d} href={nav(dd)} aria-current={dd === date ? 'date' : undefined}
                className={`rounded-lg border px-1 py-2 text-xs ${dd === date ? 'border-primary bg-primary-soft' : 'border-line hover:bg-subtle'}`}>
                <p className="font-semibold uppercase text-muted">{d} {Number(dd.slice(8, 10))}</p>
                <p className="mt-1 tabular-nums">{mins ? hours(mins) : '—'}</p>
              </Link>
            );
          })}
        </div>
      </Panel>
      <Panel title="Day’s logs" flush>
        {day.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">No time logs yet for this day. {member ? 'Add your first entry above.' : ''}</p> : (
          <Table caption="Day’s logs">
            <thead><tr><Th>Project / task</Th><Th>Description</Th><Th>Time</Th><Th>Duration</Th><Th>Billing</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>{day.map((e) => (
              <tr key={e.id}>
                <Td className="font-medium">{projectLabel(p, e.project_id, e.task_id)}</Td>
                <Td className="text-muted">{e.description ?? '—'}{e.status === 'rejected' && e.reject_reason && <p className="text-xs text-danger">Rejected: {e.reject_reason}</p>}</Td>
                <Td className="whitespace-nowrap text-muted">{e.start_time ? `${hm(e.start_time)}–${hm(e.end_time)}` : '—'}</Td>
                <Td className="tabular-nums">{hours(e.minutes)}</Td>
                <Td>{e.billable ? <Badge tone="success">Billable</Badge> : <Badge>Non-billable</Badge>}</Td>
                <Td><Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge></Td>
                <Td className="text-right">{(e.status === 'pending' || e.status === 'rejected') && <MiniForm action={deleteEntryAction.bind(null, p.slug)} hidden={{ entryId: e.id }} label="Delete entry" confirm="Delete this entry?">Delete</MiniForm>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

// ─── Approvals ───────────────────────────────────────────────────────────────

async function Approvals(p: Props) {
  const pending = await tsPending(p.orgId);
  const recent = await tsEntries(p.orgId, { from: addDays(p.today, -30), to: p.today, status: ['approved', 'rejected'], limit: 50 });
  const canDecide = (e: Entry) => e.employee_id !== p.meId && (p.isAdmin ? true : p.reports.includes(e.employee_id) && (e.status === 'pending' || p.settings.approval_flow === 'manager_or_admin'));
  const rows: ApprovalRow[] = pending.map((e) => ({
    id: e.id, who: personName(p, e.employee_id), project: projectLabel(p, e.project_id, e.task_id), date: short(e.work_date),
    time: e.start_time ? `${hm(e.start_time)}–${hm(e.end_time)}` : '—', duration: hours(e.minutes), billable: e.billable, status: STATUS[e.status].label,
    description: e.description, canDecide: canDecide(e),
  }));
  const editable = p.settings.approver_can_edit ? pending.filter(canDecide) : [];
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Review and approve time logs{p.isAdmin ? ' across the organization' : ' from your team'}. {p.settings.approval_flow === 'manager_then_admin' ? 'Logs go to the reporting manager, then an admin.' : 'The reporting manager or an admin approves.'}{p.settings.auto_lock ? ' Approved logs lock automatically.' : ''}</p>
      <Panel title="Pending & recent logs" flush>
        <ApprovalTable action={decideAction.bind(null, p.slug)} rows={rows} reasonRequired={p.settings.rejection_reason_required} />
      </Panel>
      {editable.length > 0 && (
        <Panel title="Correct before approving" meta="approvers may edit hours, billing and the description">
          <ul className="divide-y divide-line">{editable.slice(0, 30).map((e) => (
            <li key={e.id} className="py-2 text-sm"><span className="font-medium">{personName(p, e.employee_id)}</span> · {projectLabel(p, e.project_id, e.task_id)} · {short(e.work_date)} · {hours(e.minutes)}
              <AdjustForm action={adjustEntryAction.bind(null, p.slug)} entryId={e.id} hours={`${Math.floor(e.minutes / 60)}:${String(e.minutes % 60).padStart(2, '0')}`} billable={e.billable} description={e.description} />
            </li>
          ))}</ul>
        </Panel>
      )}
      <Panel title="Decided in the last 30 days" flush>
        {recent.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">Nothing decided yet.</p> : (
          <Table caption="Recent decisions">
            <thead><tr><Th>Employee</Th><Th>Project</Th><Th>Date</Th><Th>Hours</Th><Th>Status</Th></tr></thead>
            <tbody>{recent.map((e) => (
              <tr key={e.id}><Td>{personName(p, e.employee_id)}</Td><Td>{projectLabel(p, e.project_id, e.task_id)}</Td><Td>{short(e.work_date)}</Td><Td className="tabular-nums">{hours(e.minutes)}</Td>
                <Td><Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>{e.reject_reason && <p className="text-xs text-muted">{e.reject_reason}</p>}</Td></tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

// ─── Workspace ───────────────────────────────────────────────────────────────

function Workspace(p: Props) {
  const view = ['members', 'clients', 'projects', 'tasks'].includes(p.sp.view ?? '') ? p.sp.view! : 'projects';
  const seats = p.ws.members.filter((m) => m.active).length;
  const memberIds = new Set(p.ws.members.map((m) => m.employee_id));
  const memberOpts = p.ws.members.filter((m) => m.active).map((m) => ({ value: m.employee_id, label: personName(p, m.employee_id) }));
  const clientOpts = p.ws.clients.filter((c) => !c.archived_at).map((c) => ({ value: c.id, label: c.name }));
  const projectOpts = p.ws.projects.filter((x) => x.status !== 'archived').map((x) => ({ value: x.id, label: projectLabel(p, x.id) }));
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Members, clients, projects and tasks. 🎟 {seats} active member{seats === 1 ? '' : 's'}.</p>
      <SubTabs base={p.base} extra={{ tab: 'workspace' }} label="Workspace" current={view} tabs={[
        { key: 'members', label: 'Members', count: seats }, { key: 'clients', label: 'Clients', count: p.ws.clients.length },
        { key: 'projects', label: 'Projects', count: p.ws.projects.length }, { key: 'tasks', label: 'Tasks', count: p.ws.tasks.filter((t) => !t.archived_at).length },
      ]} />
      {view === 'members' && (
        <>
          <Panel title="＋ Add from directory"><AddMembersForm action={addMembersAction.bind(null, p.slug)} people={[...p.people.values()].filter((x) => !memberIds.has(x.id)).map((x) => ({ value: x.id, label: `${x.name} · ${x.code}` }))} /></Panel>
          <Panel title="Members" meta={`${seats} active`} flush>
            {p.ws.members.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No members yet.</p> : (
              <Table caption="Members">
                <thead><tr><Th>Name</Th><Th>Designation</Th><Th>Email</Th><Th>Department</Th><Th>Rate / h · seat</Th></tr></thead>
                <tbody>{p.ws.members.map((m) => {
                  const x = p.people.get(m.employee_id);
                  return (
                    <tr key={m.employee_id}><Td className="font-medium">{x?.name ?? 'Former employee'}</Td><Td>{x?.designation ?? '—'}</Td><Td className="text-muted">{x?.email ?? '—'}</Td><Td>{x?.department ?? '—'}</Td>
                      <Td><MemberForm action={updateMemberAction.bind(null, p.slug)} employeeId={m.employee_id} rate={m.rate} active={m.active} /></Td></tr>
                  );
                })}</tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
      {view === 'clients' && (
        <>
          <Panel title="＋ Add client"><ClientForm action={saveClientAction.bind(null, p.slug)} /></Panel>
          {p.ws.clients.map((c) => (
            <Panel key={c.id} title={c.name} meta={`${c.currency} · ${c.country}${c.gstin ? ` · GST ${c.gstin}` : ''}`}>
              <details><summary className="cursor-pointer text-sm text-primary">Edit {c.name}</summary><div className="mt-3"><ClientForm action={saveClientAction.bind(null, p.slug)} client={c} /></div></details>
            </Panel>
          ))}
        </>
      )}
      {view === 'projects' && (
        <>
          <Panel title="＋ Create project"><ProjectForm action={saveProjectAction.bind(null, p.slug)} clients={clientOpts} people={memberOpts} /></Panel>
          <Panel title="Projects" flush>
            {p.ws.projects.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No projects.</p> : (
              <Table caption="Projects">
                <thead><tr><Th>Project</Th><Th>Client</Th><Th>Manager</Th><Th>Type</Th><Th>Budget</Th><Th>Members</Th><Th>Status</Th></tr></thead>
                <tbody>{p.ws.projects.map((x) => {
                  const members = p.ws.projectMembers.filter((m) => m.project_id === x.id).map((m) => m.employee_id);
                  return (
                    <tr key={x.id}>
                      <Td><details><summary className="cursor-pointer font-medium">{x.name}</summary><div className="mt-3 min-w-[36rem]"><ProjectForm action={saveProjectAction.bind(null, p.slug)} project={x} clients={clientOpts} people={memberOpts} members={members} /></div></details></Td>
                      <Td>{x.client_id ? p.ws.clients.find((c) => c.id === x.client_id)?.name : 'Internal'}</Td>
                      <Td>{x.manager_employee_id ? personName(p, x.manager_employee_id) : '—'}</Td>
                      <Td className="capitalize">{x.kind}</Td>
                      <Td>{x.budget_type === 'none' ? '—' : x.budget_type === 'hours' ? `${x.budget_amount} h` : money(x.budget_amount ?? 0, p.ws.clients.find((c) => c.id === x.client_id)?.currency ?? 'INR')}</Td>
                      <Td className="tabular-nums">{members.length}</Td>
                      <Td><Badge tone={x.status === 'active' ? 'success' : 'neutral'}>{x.status}</Badge></Td>
                    </tr>
                  );
                })}</tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
      {view === 'tasks' && (
        <>
          <Panel title="＋ Add task"><TaskForm action={saveTaskAction.bind(null, p.slug)} projects={projectOpts} /></Panel>
          <Panel title="Tasks by project">
            {p.ws.tasks.filter((t) => !t.archived_at).length === 0 ? <p className="text-sm text-muted">No tasks.</p> : (
              <ul className="divide-y divide-line">{p.ws.tasks.filter((t) => !t.archived_at).map((t) => (
                <li key={t.id} className="py-2"><details><summary className="flex cursor-pointer flex-wrap justify-between gap-2 text-sm"><span><span className="font-medium">{t.name}</span> <span className="text-muted">· {projectLabel(p, t.project_id)}</span></span>
                  <span className="text-muted">{t.billable ? 'Billable' : 'Non-billable'}{t.rate !== null ? ` · ${t.rate}/h` : ''}</span></summary>
                  <div className="mt-3"><TaskForm action={saveTaskAction.bind(null, p.slug)} projects={projectOpts} task={t} /></div></details></li>
              ))}</ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

// ─── Finance ─────────────────────────────────────────────────────────────────

async function Finance(p: Props) {
  const [entries, invoices] = await Promise.all([tsEntries(p.orgId, { from: '2000-01-01', to: p.today, status: ['approved'] }), tsInvoices(p.orgId)]);
  const unbilled = entries.filter((e) => e.billable && !e.invoice_id);
  const byCurrency = new Map<string, number>();
  for (const e of unbilled) byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + (e.minutes / 60) * (e.rate ?? 0));
  const [mainCurrency, mainAmount] = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['INR', 0];
  const rollup = p.ws.projects.map((x) => {
    const es = unbilled.filter((e) => e.project_id === x.id);
    return { x, minutes: es.reduce((s, e) => s + e.minutes, 0), amount: es.reduce((s, e) => s + (e.minutes / 60) * (e.rate ?? 0), 0), currency: es[0]?.currency ?? p.ws.clients.find((c) => c.id === x.client_id)?.currency ?? 'INR' };
  }).filter((r) => r.minutes > 0);
  const monthStart = `${p.today.slice(0, 7)}-01`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Billable hours roll up by project and client. Rate = task → project → client → member default, fixed on each log’s date, in the client’s currency.</p>
        <a className={btn} href={`${p.base}/export?kind=rollup`} download>↓ Export</a>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Billable (approved) · ${mainCurrency}`} value={money(mainAmount, mainCurrency)} note="ready to invoice" tone="success" />
        <StatCard label="Unbilled hours" value={hours(unbilled.reduce((s, e) => s + e.minutes, 0))} note="approved and billable" tone="primary" />
        <StatCard label="Currencies" value={byCurrency.size} note={[...byCurrency.keys()].join(' · ') || '—'} />
        <StatCard label="Draft invoices" value={invoices.filter((i) => i.status === 'draft').length} note="awaiting send" tone="warning" />
      </div>
      <Panel title="Billable rollup by project" flush>
        {rollup.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No approved billable time waiting to be invoiced.</p> : (
          <Table caption="Billable rollup">
            <thead><tr><Th>Project</Th><Th>Client</Th><Th>Currency</Th><Th className="text-right">Billable hrs</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>{rollup.map((r) => (
              <tr key={r.x.id}><Td className="font-medium">{r.x.name}</Td><Td>{p.ws.clients.find((c) => c.id === r.x.client_id)?.name ?? '—'}</Td><Td>{r.currency}</Td><Td className="text-right tabular-nums">{hours(r.minutes)}</Td><Td className="text-right tabular-nums">{money(r.amount, r.currency)}</Td></tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
      <Panel title="＋ Generate invoice">
        <InvoiceForm action={generateInvoiceAction.bind(null, p.slug)} from={monthStart} to={p.today}
          clients={p.ws.clients.filter((c) => !c.archived_at).map((c) => ({ value: c.id, label: `${c.name} (${c.currency})` }))}
          projects={p.ws.projects.filter((x) => x.kind === 'external').map((x) => ({ value: x.id, label: projectLabel(p, x.id) }))} />
        <p className="mt-2 text-xs text-muted">Rate history is kept — past invoices keep the rate in force on each log’s date. Voiding an invoice releases its time to be invoiced again.</p>
      </Panel>
      <Panel title="Invoices" flush>
        {invoices.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No invoices yet.</p> : (
          <Table caption="Invoices">
            <thead><tr><Th>Number</Th><Th>Client</Th><Th>Project</Th><Th>Period</Th><Th className="text-right">Total</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>{invoices.map((i) => (
              <tr key={i.id}>
                <Td><Link className="font-medium text-primary hover:underline" href={`${p.base}/invoices/${i.id}`}>{i.number}</Link></Td>
                <Td>{p.ws.clients.find((c) => c.id === i.client_id)?.name}</Td>
                <Td>{i.project_id ? p.ws.projects.find((x) => x.id === i.project_id)?.name : 'All projects'}</Td>
                <Td className="whitespace-nowrap">{short(i.period_from)} – {short(i.period_to)} {i.period_to.slice(0, 4)}</Td>
                <Td className="text-right tabular-nums">{money(i.total, i.currency)}</Td>
                <Td><Badge tone={i.status === 'paid' ? 'success' : i.status === 'void' ? 'neutral' : i.status === 'sent' ? 'primary' : 'warning'}>{i.status}</Badge></Td>
                <Td className="whitespace-nowrap text-right">
                  {i.status === 'draft' && <MiniForm action={invoiceStatusAction.bind(null, p.slug)} hidden={{ invoiceId: i.id, status: 'sent' }} label={`Mark ${i.number} sent`}>Mark sent</MiniForm>}
                  {(i.status === 'draft' || i.status === 'sent') && <MiniForm action={invoiceStatusAction.bind(null, p.slug)} hidden={{ invoiceId: i.id, status: 'paid' }} label={`Mark ${i.number} paid`}>Mark paid</MiniForm>}
                  {(i.status === 'draft' || i.status === 'sent') && <MiniForm action={invoiceStatusAction.bind(null, p.slug)} hidden={{ invoiceId: i.id, status: 'void' }} label={`Void ${i.number}`} confirm={`Void ${i.number}? Its time can be invoiced again.`}>Void</MiniForm>}
                </Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

// ─── Reports ─────────────────────────────────────────────────────────────────

async function Reports(p: Props) {
  const view = ['summary', 'detailed', 'weekly'].includes(p.sp.view ?? '') ? p.sp.view! : 'summary';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.sp.from ?? '') ? p.sp.from! : addDays(p.today, -30);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(p.sp.to ?? '') ? p.sp.to! : p.today;
  const scope = p.isAdmin ? undefined : p.meId ?? '00000000-0000-0000-0000-000000000000';
  const employee = p.isAdmin && p.people.has(p.sp.emp ?? '') ? p.sp.emp : scope;
  const project = p.ws.projects.some((x) => x.id === p.sp.project) ? p.sp.project : undefined;
  const entries = (await tsEntries(p.orgId, { from: view === 'weekly' ? monday(to) : from, to: view === 'weekly' ? addDays(monday(to), 6) : to, employeeId: employee, projectId: project }))
    .filter((e) => e.status !== 'rejected');
  const qs = (extra: Search) => `${p.base}?${new URLSearchParams(Object.entries({ tab: 'reports', view, from, to, emp: p.sp.emp, project: p.sp.project, ...extra }).filter((e): e is [string, string] => !!e[1])).toString()}`;
  const filters = (
    <form className="flex flex-wrap items-end gap-2" action={p.base}>
      <input type="hidden" name="tab" value="reports" /><input type="hidden" name="view" value={view} />
      {view !== 'weekly' && <label className="text-xs text-muted">From<input type="date" name="from" defaultValue={from} className="mt-1 block h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg" /></label>}
      <label className="text-xs text-muted">{view === 'weekly' ? 'Week of' : 'To'}<input type="date" name="to" defaultValue={to} className="mt-1 block h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg" /></label>
      {p.isAdmin && <label className="text-xs text-muted">Member<select name="emp" defaultValue={p.sp.emp ?? ''} className="mt-1 block h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg"><option value="">Everyone</option>{p.ws.members.map((m) => <option key={m.employee_id} value={m.employee_id}>{personName(p, m.employee_id)}</option>)}</select></label>}
      <label className="text-xs text-muted">Project<select name="project" defaultValue={p.sp.project ?? ''} className="mt-1 block h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg"><option value="">All projects</option>{p.ws.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <button className="h-9 rounded-md border border-line bg-surface px-3 text-sm hover:bg-subtle">Apply</button>
    </form>
  );
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  const people = [...new Set(entries.map((e) => e.employee_id))];
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  const decided = entries.filter((e) => e.decided_at);
  const sla = decided.length ? decided.reduce((s, e) => s + (Date.parse(e.decided_at!) - Date.parse(e.created_at)), 0) / decided.length / 3600000 : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SubTabs base={p.base} extra={{ tab: 'reports', from, to }} label="Report views" current={view} tabs={[{ key: 'summary', label: 'Summary' }, { key: 'detailed', label: 'Detailed' }, { key: 'weekly', label: 'Weekly' }]} />
        <a className={btn} href={`${p.base}/export?${new URLSearchParams({ kind: 'detailed', from: view === 'weekly' ? monday(to) : from, to: view === 'weekly' ? addDays(monday(to), 6) : to, ...(employee ? { emp: employee } : {}), ...(project ? { project } : {}) }).toString()}`} download>⬇ Export</a>
      </div>
      {filters}
      {view === 'summary' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Utilisation" value={`${total ? Math.round((billable / total) * 100) : 0}%`} note="billable / total" tone="accent" />
            <StatCard label="Total logged" value={hours(total)} note={`${short(from)} – ${short(to)}`} tone="primary" />
            <StatCard label="Avg / person / day" value={people.length ? hours(Math.round(total / people.length / days)) : '—'} note={`across ${people.length} ${people.length === 1 ? 'person' : 'people'}`} />
            <StatCard label="Approval SLA" value={sla === null ? '—' : sla < 24 ? `${sla.toFixed(1)} h` : `${(sla / 24).toFixed(1)} d`} note="average time to decide" />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Utilisation by member">
              {people.length === 0 ? <p className="text-sm text-muted">No logged time in this period.</p> : (
                <ul className="space-y-3">{people.map((id) => {
                  const mine = entries.filter((e) => e.employee_id === id);
                  const t = mine.reduce((s, e) => s + e.minutes, 0);
                  const b = mine.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
                  const pct = t ? Math.round((b / t) * 100) : 0;
                  return (
                    <li key={id}><div className="flex justify-between text-sm"><span className="font-medium">{personName(p, id)}</span><span className="text-muted">{hours(t)} · {pct}% billable</span></div>
                      <div className="mt-1 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div></li>
                  );
                })}</ul>
              )}
            </Panel>
            <Panel title="Project burn vs budget"><BurnList p={p} entries={entries} /></Panel>
          </div>
        </>
      )}
      {view === 'detailed' && (
        <Panel title="Detailed log" meta={`${entries.length} entries · ${hours(total)}`} flush>
          {entries.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No logged time in this period.</p> : (
            <Table caption="Detailed time log">
              <thead><tr><Th>Date</Th><Th>Member</Th><Th>Project / task</Th><Th>Description</Th><Th>Time</Th><Th className="text-right">Duration</Th><Th>Billing</Th><Th>Status</Th></tr></thead>
              <tbody>{entries.slice(0, 500).map((e) => (
                <tr key={e.id}><Td className="whitespace-nowrap">{short(e.work_date)}</Td><Td>{personName(p, e.employee_id)}</Td><Td>{projectLabel(p, e.project_id, e.task_id)}</Td><Td className="text-muted">{e.description ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-muted">{e.start_time ? `${hm(e.start_time)}–${hm(e.end_time)}` : '—'}</Td><Td className="text-right tabular-nums">{hours(e.minutes)}</Td>
                  <Td>{e.billable ? 'Billable' : 'Non-billable'}</Td><Td><Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge></Td></tr>
              ))}</tbody>
            </Table>
          )}
          {entries.length > 500 && <p className="px-5 py-3 text-xs text-muted">Showing the first 500 — export for all of them.</p>}
        </Panel>
      )}
      {view === 'weekly' && (() => {
        const wk = monday(to);
        const who = p.isAdmin ? [...new Set([...p.ws.members.filter((m) => m.active).map((m) => m.employee_id), ...people])] : people.length ? people : (p.meId ? [p.meId] : []);
        return (
          <Panel title={`Week of ${short(wk)} ${wk.slice(0, 4)}`} flush action={<div className="flex gap-2 text-xs"><Link className="text-primary" href={qs({ to: addDays(wk, -7) })}>‹ Previous</Link><Link className="text-primary" href={qs({ to: addDays(wk, 7) })}>Next ›</Link></div>}>
            <Table caption="Weekly hours">
              <thead><tr><Th>Member</Th>{DAYS.map((d, i) => <Th key={d} className="text-right">{d} {Number(addDays(wk, i).slice(8, 10))}</Th>)}<Th className="text-right">Total</Th></tr></thead>
              <tbody>{who.map((id) => {
                const per = DAYS.map((_, i) => entries.filter((e) => e.employee_id === id && e.work_date === addDays(wk, i)).reduce((s, e) => s + e.minutes, 0));
                const sum = per.reduce((a, b) => a + b, 0);
                return <tr key={id}><Td className="font-medium">{personName(p, id)}</Td>{per.map((m, i) => <Td key={i} className={`text-right tabular-nums ${m && m < p.settings.daily_target_minutes && i < 5 ? 'text-warning' : ''}`}>{m ? hours(m) : '—'}</Td>)}<Td className="text-right font-semibold tabular-nums">{hours(sum)}</Td></tr>;
              })}</tbody>
            </Table>
          </Panel>
        );
      })()}
    </div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

function Settings(p: Props) {
  const view = ['log', 'permissions', 'integration'].includes(p.sp.view ?? '') ? p.sp.view! : 'log';
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Set up time-logging methods, permissions, locking, reminders and entry rules.</p>
      <SubTabs base={p.base} extra={{ tab: 'settings' }} label="Settings" current={view} tabs={[{ key: 'log', label: 'Time Log Settings' }, { key: 'permissions', label: 'Permission Settings' }, { key: 'integration', label: 'Attendance Integration' }]} />
      <Panel title={{ log: 'Time Log Settings', permissions: 'Permission Settings', integration: 'Attendance Integration' }[view]!}>
        {view === 'log' && <LogSettingsForm action={saveLogSettingsAction.bind(null, p.slug)} s={p.settings} />}
        {view === 'permissions' && <PermissionSettingsForm action={savePermissionSettingsAction.bind(null, p.slug)} s={p.settings} />}
        {view === 'integration' && <IntegrationSettingsForm action={saveIntegrationSettingsAction.bind(null, p.slug)} s={p.settings} />}
      </Panel>
    </div>
  );
}
