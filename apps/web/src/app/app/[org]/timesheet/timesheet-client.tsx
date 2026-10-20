'use client';

import { useActionState, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Counted = ActionState & { n?: number };
type Opt = { value: string; label: string };

function useCounted(action: Action) {
  const [state, formAction] = useActionState<Counted, FormData>(async (prev, fd) => ({ ...(await action(prev, fd)), n: (prev.n ?? 0) + 1 }), initialActionState);
  return { state, formAction, n: state.n ?? 0, v: state.ok ? {} : (state.values ?? {}), e: state.fieldErrors ?? {} };
}

const checkbox = 'size-4 rounded border-line-strong accent-primary';
const pill = 'flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-sm';

export interface ProjectOpt { id: string; label: string; internal: boolean; tasks: Array<{ id: string; name: string; billable: boolean }> }

function ProjectTask({ projects, prefix, v, e, onBillable }: {
  projects: ProjectOpt[]; prefix: string; v: Record<string, string>; e: Record<string, string>; onBillable?: (b: boolean) => void;
}) {
  const [project, setProject] = useState(v.projectId ?? projects[0]?.id ?? '');
  const tasks = useMemo(() => projects.find((p) => p.id === project)?.tasks ?? [], [projects, project]);
  return (
    <>
      <SelectField idPrefix={prefix} name="projectId" label="Project" required value={project} error={e.projectId}
        onChange={(ev) => { setProject(ev.target.value); const p = projects.find((x) => x.id === ev.target.value); if (p?.internal) onBillable?.(false); }}
        options={projects.map((p) => ({ value: p.id, label: p.label }))} placeholder="Choose a project…" />
      <SelectField idPrefix={prefix} name="taskId" label="Task" defaultValue={v.taskId ?? ''} key={project}
        onChange={(ev) => { const t = tasks.find((x) => x.id === ev.target.value); if (t) onBillable?.(t.billable); }}
        options={[{ value: '', label: tasks.length ? 'No task' : 'No tasks in this project' }, ...tasks.map((t) => ({ value: t.id, label: t.name }))]} />
    </>
  );
}

/** Add an entry: start–end or total hours (as the settings allow), billable by default per the settings. */
export function EntryForm({ action, projects, date, methods, defaultBillable, people }: {
  action: Action; projects: ProjectOpt[]; date: string; methods: string[]; defaultBillable: boolean; people?: Opt[];
}) {
  const { state, formAction, n, v, e } = useCounted(action);
  const modes = methods.filter((m) => m === 'start_end' || m === 'total');
  const [mode, setMode] = useState(v.mode ?? modes[0] ?? 'total');
  const [billable, setBillable] = useState(v.billable ? v.billable === 'on' : defaultBillable);
  if (projects.length === 0) return <p className="text-sm text-muted">You aren’t on any project yet. An admin adds people to projects under Workspace › Projects.</p>;
  return (
    <form action={formAction} noValidate aria-label="Add entry" className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="mode" value={mode} />
      <div key={n} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
        <ProjectTask projects={projects} prefix="log" v={v} e={e} onBillable={setBillable} />
        <TextField idPrefix="log" name="date" label="Date" type="date" required defaultValue={v.date ?? date} error={e.date} />
        {people && <SelectField idPrefix="log" name="employeeId" label="For" defaultValue={v.employeeId ?? ''} options={[{ value: '', label: 'Myself' }, ...people]} />}
        {mode === 'start_end' ? (
          <>
            <TextField idPrefix="log" name="start" label="Start" type="time" required defaultValue={v.start ?? ''} error={e.start} />
            <TextField idPrefix="log" name="end" label="End" type="time" required defaultValue={v.end ?? ''} error={e.end} />
          </>
        ) : (
          <TextField idPrefix="log" name="duration" label="Hours" required placeholder="1:30" inputMode="decimal" defaultValue={v.duration ?? ''} error={e.duration} />
        )}
        <TextField idPrefix="log" name="description" label="Description" className="sm:col-span-2 lg:col-span-3" placeholder="What did you work on?" defaultValue={v.description ?? ''} error={e.description} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {modes.length > 1 && (
          <div role="radiogroup" aria-label="Entry method" className="inline-flex rounded-lg border border-line p-0.5 text-xs">
            {modes.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={`rounded-md px-2.5 py-1 ${mode === m ? 'bg-subtle font-medium text-fg' : 'text-muted'}`}>{m === 'start_end' ? 'Start–End' : 'Total hours'}</button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="billable" checked={billable} onChange={(ev) => setBillable(ev.target.checked)} className={checkbox} />Billable</label>
        <SubmitButton size="sm">Add entry</SubmitButton>
      </div>
    </form>
  );
}

function elapsed(from: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(from)) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The live timer: start one on a project, or see the running one ticking with Stop / Discard. */
export function TimerBar({ start, stop, projects, running }: {
  start: Action; stop: Action; projects: ProjectOpt[]; running: { label: string; description: string | null; started_at: string } | null;
}) {
  const s1 = useCounted(start);
  const [s2, stopAction] = useActionState(stop, initialActionState);
  const [now, setNow] = useState(running ? elapsed(running.started_at) : '0:00:00');
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(elapsed(running.started_at)), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (running) return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary-soft px-4 py-3">
      <span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
      <span className="font-mono text-lg tabular-nums" aria-live="off">{now}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{running.label}{running.description ? ` · ${running.description}` : ''}</span>
      <form action={stopAction} className="flex gap-2"><FormMessage state={s2} />
        <SubmitButton size="sm" pendingLabel="Stopping…">■ Stop</SubmitButton>
        <button name="discard" value="1" className="rounded-md px-2 text-xs text-muted hover:text-danger">Discard</button>
      </form>
    </div>
  );
  if (projects.length === 0) return null;
  return (
    <form action={s1.formAction} noValidate aria-label="Start timer" className="space-y-2">
      <FormMessage state={s1.state} />
      <div key={s1.n} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <ProjectTask projects={projects} prefix="timer" v={s1.v} e={s1.e} />
        <TextField idPrefix="timer" name="description" label="Working on" placeholder="Optional" defaultValue={s1.v.description ?? ''} />
        <div className="flex items-center gap-3 pb-1">
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="billable" defaultChecked className={checkbox} />Billable</label>
          <SubmitButton size="sm" variant="secondary">▶ Start</SubmitButton>
        </div>
      </div>
    </form>
  );
}

/** A small one-button form (delete, copy last week, invoice status…). */
export function MiniForm({ action, hidden, label, variant = 'ghost', confirm, children }: {
  action: Action; hidden: Record<string, string>; label: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; confirm?: string; children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={label} className="inline" onSubmit={(ev) => { if (confirm && !window.confirm(confirm)) ev.preventDefault(); }}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton size="sm" variant={variant} pendingLabel="…">{children}</SubmitButton>
      {!state.ok && state.message && <p role="alert" className="mt-1 max-w-xs text-xs text-danger">{state.message}</p>}
    </form>
  );
}

export interface ApprovalRow { id: string; who: string; project: string; date: string; time: string; duration: string; billable: boolean; status: string; description: string | null; canDecide: boolean }

/** Pending logs with select-all, bulk approve and reject with a reason. */
export function ApprovalTable({ action, rows, reasonRequired }: { action: Action; rows: ApprovalRow[]; reasonRequired: boolean }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const decidable = rows.filter((r) => r.canDecide);
  const all = decidable.length > 0 && decidable.every((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (rows.length === 0) return <p className="px-5 py-8 text-center text-sm text-muted">No logs waiting for a decision. All caught up 🎉</p>;
  return (
    <form action={formAction} aria-label="Approve time logs">
      <div className="flex flex-wrap items-end gap-3 px-5 pb-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(decidable.map((r) => r.id)))} className={checkbox} />Select all</label>
        <label className="text-xs text-muted">Reason (for rejecting){reasonRequired ? ' *' : ''}
          <input name="reason" className="mt-1 block h-9 w-64 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg" placeholder="Shown to the employee" />
        </label>
        <SubmitButton size="sm" variant="danger" name="decision" value="reject">✕ Reject</SubmitButton>
        <SubmitButton size="sm" name="decision" value="approve">✓ Bulk approve</SubmitButton>
        <span className="text-xs text-muted">{picked.size} selected</span>
      </div>
      <div className="px-5"><FormMessage state={state} /></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">Logs awaiting approval</caption>
          <thead><tr className="text-xs uppercase tracking-wide text-muted">{['', 'Employee', 'Project / task', 'Date', 'Time', 'Duration', 'Status'].map((h, i) => <th key={i} scope="col" className="border-b border-line bg-subtle/60 px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="border-b border-line px-4 py-3">{r.canDecide && <input type="checkbox" name="entryId" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.who} ${r.date}`} className={checkbox} />}</td>
                <td className="border-b border-line px-4 py-3 font-medium">{r.who}</td>
                <td className="border-b border-line px-4 py-3">{r.project}{r.description && <p className="text-xs text-muted">{r.description}</p>}</td>
                <td className="whitespace-nowrap border-b border-line px-4 py-3">{r.date}</td>
                <td className="whitespace-nowrap border-b border-line px-4 py-3 text-muted">{r.time}</td>
                <td className="whitespace-nowrap border-b border-line px-4 py-3 tabular-nums">{r.duration}{r.billable ? <span className="ml-1 text-xs text-success">· billable</span> : null}</td>
                <td className="border-b border-line px-4 py-3 text-xs">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}

export function AdjustForm({ action, entryId, hours, billable, description }: { action: Action; entryId: string; hours: string; billable: boolean; description: string | null }) {
  const { state, formAction, v, e } = useCounted(action);
  return (
    <details><summary className="cursor-pointer text-xs text-primary">Edit</summary>
      <form action={formAction} noValidate aria-label="Edit entry" className="mt-2 grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto_auto] sm:items-end">
        <FormMessage state={state} />
        <input type="hidden" name="entryId" value={entryId} />
        <TextField idPrefix={`adj-${entryId}`} name="hours" label="Hours" defaultValue={v.hours ?? hours} error={e.hours} />
        <TextField idPrefix={`adj-${entryId}`} name="description" label="Description" defaultValue={v.description ?? description ?? ''} />
        <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="billable" defaultChecked={billable} className={checkbox} />Billable</label>
        <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
      </form>
    </details>
  );
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export function AddMembersForm({ action, people }: { action: Action; people: Opt[] }) {
  const { state, formAction, n } = useCounted(action);
  const [q, setQ] = useState('');
  const shown = people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()));
  if (people.length === 0) return <p className="text-sm text-muted">Everyone in the directory is already a member.</p>;
  return (
    <form action={formAction} aria-label="Add from directory" className="space-y-3">
      <FormMessage state={state} />
      <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search the directory" aria-label="Search the directory" className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm" />
      <div key={n} className="scroll-thin flex max-h-56 flex-wrap gap-2 overflow-y-auto">
        {shown.map((p) => <label key={p.value} className={pill}><input type="checkbox" name="employeeId" value={p.value} className={checkbox} />{p.label}</label>)}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <TextField idPrefix="mem" name="rate" label="Default rate / hour (₹)" inputMode="decimal" className="w-48" />
        <SubmitButton size="sm">＋ Add from directory</SubmitButton>
      </div>
    </form>
  );
}

export function MemberForm({ action, employeeId, rate, active }: { action: Action; employeeId: string; rate: number | null; active: boolean }) {
  const { state, formAction } = useCounted(action);
  return (
    <form action={formAction} aria-label="Member" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input name="rate" defaultValue={rate ?? ''} inputMode="decimal" aria-label="Rate per hour" placeholder="Rate" className="h-8 w-24 rounded-md border border-line-strong bg-surface px-2 text-sm" />
      <select name="active" defaultValue={String(active)} aria-label="Seat" className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm"><option value="true">Active seat</option><option value="false">Inactive</option></select>
      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
      {state.message && <span className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}

export function ClientForm({ action, client }: {
  action: Action;
  client?: { id: string; name: string; organisation: string | null; email: string | null; country: string; currency: string; gstin: string | null; finance_poc: string | null; rate: number | null };
}) {
  const { state, formAction, n, v, e } = useCounted(action);
  const p = `cl-${client?.id ?? 'new'}`;
  return (
    <form action={formAction} noValidate aria-label={client ? `Client ${client.name}` : 'Add client'} className="space-y-3">
      <FormMessage state={state} />
      {client && <input type="hidden" name="clientId" value={client.id} />}
      <div key={client ? 0 : n} className="grid gap-3 sm:grid-cols-3">
        <TextField idPrefix={p} name="name" label="Client" required defaultValue={v.name ?? client?.name ?? ''} error={e.name} />
        <TextField idPrefix={p} name="organisation" label="Organisation (legal name)" defaultValue={v.organisation ?? client?.organisation ?? ''} />
        <TextField idPrefix={p} name="email" label="Email" type="email" defaultValue={v.email ?? client?.email ?? ''} error={e.email} />
        <TextField idPrefix={p} name="country" label="Country" maxLength={2} defaultValue={v.country ?? client?.country ?? 'IN'} error={e.country} />
        <TextField idPrefix={p} name="currency" label="Currency" maxLength={3} defaultValue={v.currency ?? client?.currency ?? 'INR'} error={e.currency} />
        <TextField idPrefix={p} name="gstin" label="GSTIN" defaultValue={v.gstin ?? client?.gstin ?? ''} error={e.gstin} />
        <TextField idPrefix={p} name="financePoc" label="Finance contact" defaultValue={v.financePoc ?? client?.finance_poc ?? ''} />
        <TextField idPrefix={p} name="rate" label="Client rate / hour" inputMode="decimal" defaultValue={v.rate ?? (client?.rate ?? '').toString()} error={e.rate} />
      </div>
      <SubmitButton size="sm" variant={client ? 'secondary' : 'primary'}>{client ? 'Save client' : '＋ Add client'}</SubmitButton>
    </form>
  );
}

export function ProjectForm({ action, project, clients, people, members }: {
  action: Action; clients: Opt[]; people: Opt[]; members?: string[];
  project?: { id: string; name: string; client_id: string | null; kind: string; budget_type: string; budget_amount: number | null; manager_employee_id: string | null; rate: number | null; status: string };
}) {
  const { state, formAction, n, v, e } = useCounted(action);
  const [kind, setKind] = useState(v.kind ?? project?.kind ?? 'external');
  const [budget, setBudget] = useState(v.budgetType ?? project?.budget_type ?? 'none');
  const p = `pr-${project?.id ?? 'new'}`;
  const chosen = new Set(members ?? []);
  return (
    <form action={formAction} noValidate aria-label={project ? `Project ${project.name}` : 'Create project'} className="space-y-3">
      <FormMessage state={state} />
      {project && <input type="hidden" name="projectId" value={project.id} />}
      <div key={project ? 0 : n} className="grid gap-3 sm:grid-cols-3">
        <TextField idPrefix={p} name="name" label="Project name" required defaultValue={v.name ?? project?.name ?? ''} error={e.name} />
        <SelectField idPrefix={p} name="kind" label="Type" value={kind} onChange={(ev) => setKind(ev.target.value)} options={[{ value: 'external', label: 'External' }, { value: 'internal', label: 'Internal' }]} />
        {kind === 'external'
          ? <SelectField idPrefix={p} name="clientId" label="Client" required defaultValue={v.clientId ?? project?.client_id ?? ''} options={clients} placeholder={clients.length ? 'Choose a client…' : 'Add a client first'} error={e.clientId} />
          : <p className="self-end pb-2 text-sm text-muted">Internal — no client, never billable.</p>}
        <SelectField idPrefix={p} name="budgetType" label="Budget type" value={budget} onChange={(ev) => setBudget(ev.target.value)} options={[{ value: 'hours', label: 'Hours' }, { value: 'fees', label: 'Fees' }, { value: 'none', label: 'None' }]} />
        {budget !== 'none' && <TextField idPrefix={p} name="budgetAmount" label={budget === 'hours' ? 'Budget (hours)' : 'Budget (fees)'} inputMode="decimal" defaultValue={v.budgetAmount ?? (project?.budget_amount ?? '').toString()} error={e.budgetAmount} />}
        <SelectField idPrefix={p} name="managerId" label="Project manager" defaultValue={v.managerId ?? project?.manager_employee_id ?? ''} options={[{ value: '', label: 'None' }, ...people]} />
        <TextField idPrefix={p} name="rate" label="Project rate / hour" inputMode="decimal" defaultValue={v.rate ?? (project?.rate ?? '').toString()} error={e.rate} />
        {project && <SelectField idPrefix={p} name="status" label="Status" defaultValue={project.status} options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' }]} />}
      </div>
      <fieldset><legend className="mb-1 text-xs font-medium text-muted">Members ＋</legend>
        {people.length === 0 ? <p className="text-sm text-muted">No workspace members yet. Add them under Workspace › Members first.</p> : (
          <div className="flex flex-wrap gap-2">{people.map((m) => <label key={m.value} className={pill}><input type="checkbox" name="memberId" value={m.value} defaultChecked={chosen.has(m.value)} className={checkbox} />{m.label}</label>)}</div>
        )}
      </fieldset>
      <SubmitButton size="sm" variant={project ? 'secondary' : 'primary'}>{project ? 'Save project' : 'Create project'}</SubmitButton>
    </form>
  );
}

export function TaskForm({ action, projects, task }: { action: Action; projects: Opt[]; task?: { id: string; project_id: string; name: string; billable: boolean; rate: number | null } }) {
  const { state, formAction, n, v, e } = useCounted(action);
  const p = `tk-${task?.id ?? 'new'}`;
  return (
    <form action={formAction} noValidate aria-label={task ? `Task ${task.name}` : 'Add task'} className="space-y-3">
      <FormMessage state={state} />
      {task && <input type="hidden" name="taskId" value={task.id} />}
      <div key={task ? 0 : n} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto]">
        <SelectField idPrefix={p} name="projectId" label="Project" required defaultValue={v.projectId ?? task?.project_id ?? ''} options={projects} placeholder="Choose a project…" error={e.projectId} />
        <TextField idPrefix={p} name="name" label="Task" required defaultValue={v.name ?? task?.name ?? ''} error={e.name} />
        <TextField idPrefix={p} name="rate" label="Task rate / hour" inputMode="decimal" defaultValue={v.rate ?? (task?.rate ?? '').toString()} error={e.rate} />
        <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="billable" defaultChecked={task?.billable ?? true} className={checkbox} />Billable</label>
      </div>
      <div className="flex gap-2">
        <SubmitButton size="sm" variant={task ? 'secondary' : 'primary'}>{task ? 'Save task' : '＋ Add task'}</SubmitButton>
        {task && <button name="archive" value="1" className="text-xs text-muted hover:text-danger">Archive</button>}
      </div>
    </form>
  );
}

export function InvoiceForm({ action, clients, projects, from, to }: { action: Action; clients: Opt[]; projects: Opt[]; from: string; to: string }) {
  const { state, formAction, n, v, e } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="Generate invoice" className="space-y-3">
      <FormMessage state={state} />
      <div key={n} className="grid gap-3 sm:grid-cols-4">
        <SelectField idPrefix="inv" name="clientId" label="Client" required defaultValue={v.clientId ?? ''} options={clients} placeholder="Choose a client…" error={e.clientId} />
        <SelectField idPrefix="inv" name="projectId" label="Project" defaultValue={v.projectId ?? ''} options={[{ value: '', label: 'All of the client’s projects' }, ...projects]} />
        <TextField idPrefix="inv" name="from" label="From" type="date" required defaultValue={v.from ?? from} error={e.from} />
        <TextField idPrefix="inv" name="to" label="To" type="date" required defaultValue={v.to ?? to} error={e.to} />
      </div>
      <SubmitButton size="sm">＋ Generate invoice</SubmitButton>
    </form>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

function Choice({ name, value, label, checked, type = 'checkbox' }: { name: string; value: string; label: string; checked: boolean; type?: 'checkbox' | 'radio' }) {
  return <label className={pill}><input type={type} name={name} value={value} defaultChecked={checked} className={checkbox} />{label}</label>;
}
function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-4 sm:grid-cols-[16rem_minmax(0,1fr)]">
      <div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted">{hint}</p></div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export interface SettingsValues {
  methods: string[]; timer_edit: string[]; capture_location: boolean; max_billable: string; max_billable_hours: number; restrict_days: string[]; period: string;
  overlap: string; rounding: number; lock_before: string | null; auto_lock: boolean; default_billable: boolean; daily_target_minutes: number;
  creators: string[]; approval_flow: string; approver_can_edit: boolean; rejection_reason_required: boolean; remind_submit: boolean; remind_missing: boolean;
  restrict_networks: boolean; allowed_ips: string[];
}

export function LogSettingsForm({ action, s }: { action: Action; s: SettingsValues }) {
  const { state, formAction } = useCounted(action);
  const radio = (name: string, value: string, label: string, current: string) => <Choice type="radio" name={name} value={value} label={label} checked={current === value} />;
  return (
    <form action={formAction} aria-label="Time log settings">
      <FormMessage state={state} />
      <Row title="Log time using" hint="Entry methods employees can use.">
        <Choice name="methods" value="total" label="Total hours" checked={s.methods.includes('total')} />
        <Choice name="methods" value="start_end" label="Start & End time" checked={s.methods.includes('start_end')} />
        <Choice name="methods" value="timer" label="Timer" checked={s.methods.includes('timer')} />
      </Row>
      <Row title="Timer edit permission" hint="Who may edit a timer entry.">
        {(['self', 'manager', 'admin'] as const).map((k) => <Choice key={k} name="timerEdit" value={k} label={{ self: 'Self', manager: 'Reporting Manager', admin: 'Admin' }[k]} checked={s.timer_edit.includes(k)} />)}
      </Row>
      <Row title="Record where a log was created" hint="Keeps the network address on each entry.">{radio('captureLocation', 'true', 'Yes', String(s.capture_location))}{radio('captureLocation', 'false', 'No', String(s.capture_location))}</Row>
      <Row title="Maximum billable log hours" hint="Cap billable time.">
        {radio('maxBillable', 'day', 'Per day', s.max_billable)}{radio('maxBillable', 'week', 'Per week', s.max_billable)}{radio('maxBillable', 'none', 'None', s.max_billable)}
        <label className="flex items-center gap-1.5 text-sm">Hours <input name="maxBillableHours" defaultValue={s.max_billable_hours} inputMode="decimal" className="h-8 w-20 rounded-md border border-line-strong bg-surface px-2" /></label>
      </Row>
      <Row title="Restrict time log(s) for" hint="Block entries on these days.">
        {(['future', 'past', 'weekend', 'holidays', 'leave'] as const).map((k) => <Choice key={k} name="restrict" value={k} label={{ future: 'Future', past: 'Past periods', weekend: 'Weekly offs', holidays: 'Holidays', leave: 'Leave' }[k]} checked={s.restrict_days.includes(k)} />)}
      </Row>
      <Row title="Allowed period for timesheet" hint="With “Past periods” blocked, only the current day, week or month can be logged.">{radio('period', 'days', 'Days', s.period)}{radio('period', 'weeks', 'Weeks', s.period)}{radio('period', 'months', 'Months', s.period)}</Row>
      <Row title="Time entry overlap" hint="When two entries overlap.">{radio('overlap', 'allow', 'Allow', s.overlap)}{radio('overlap', 'warn', 'Warn but allow', s.overlap)}{radio('overlap', 'restrict', 'Restrict', s.overlap)}</Row>
      <Row title="Time rounding" hint="Round durations for billing hygiene.">{radio('rounding', '15', 'Nearest 15 min', String(s.rounding))}{radio('rounding', '6', '6 min', String(s.rounding))}{radio('rounding', '0', 'Off', String(s.rounding))}</Row>
      <Row title="Timesheet lock" hint="Freeze entries before a date; lock entries once approved.">
        <label className="flex items-center gap-1.5 text-sm">Lock before <input type="date" name="lockBefore" defaultValue={s.lock_before ?? ''} className="h-8 rounded-md border border-line-strong bg-surface px-2" /></label>
        <label className={pill}><input type="checkbox" name="autoLock" defaultChecked={s.auto_lock} className={checkbox} />Auto-lock on approval</label>
      </Row>
      <Row title="Default billing status" hint="Applied to new logs.">{radio('defaultBillable', 'true', 'Billable', String(s.default_billable))}{radio('defaultBillable', 'false', 'Non-billable', String(s.default_billable))}</Row>
      <Row title="Daily target" hint="Used by the missing-hours reminder and utilisation.">
        <label className="flex items-center gap-1.5 text-sm"><input name="dailyTarget" defaultValue={s.daily_target_minutes / 60} inputMode="decimal" className="h-8 w-20 rounded-md border border-line-strong bg-surface px-2" /> hours</label>
      </Row>
      <div className="pt-4"><SubmitButton size="sm">Save changes</SubmitButton></div>
    </form>
  );
}

export function PermissionSettingsForm({ action, s }: { action: Action; s: SettingsValues }) {
  const { state, formAction } = useCounted(action);
  return (
    <form action={formAction} aria-label="Permission settings">
      <FormMessage state={state} />
      <Row title="Creator" hint="Who can create time logs.">
        {(['self', 'manager', 'admin'] as const).map((k) => <Choice key={k} name="creators" value={k} label={{ self: 'Self', manager: 'Manager', admin: 'Admin' }[k]} checked={s.creators.includes(k)} />)}
      </Row>
      <Row title="Approval flow" hint="How submitted logs route.">
        <Choice type="radio" name="approvalFlow" value="manager_then_admin" label="Manager → then Admin" checked={s.approval_flow === 'manager_then_admin'} />
        <Choice type="radio" name="approvalFlow" value="manager_or_admin" label="Manager or Admin" checked={s.approval_flow === 'manager_or_admin'} />
      </Row>
      <Row title="Approver can edit during approval" hint="Correct hours before approving."><Choice name="approverCanEdit" value="on" label="Allowed" checked={s.approver_can_edit} /></Row>
      <Row title="Rejection requires reason" hint="Force a note the employee sees."><Choice name="reasonRequired" value="on" label="Required" checked={s.rejection_reason_required} /></Row>
      <Row title="🔔 Weekly reminder" hint="Fridays at 4 pm: members short of the week’s target."><Choice name="remindSubmit" value="on" label="Every Fri 4:00 PM" checked={s.remind_submit} /></Row>
      <Row title="🔔 Missing-hours reminder" hint="Working days at 6 pm: members under the daily target."><Choice name="remindMissing" value="on" label="Daily 6:00 PM" checked={s.remind_missing} /></Row>
      <div className="pt-4"><SubmitButton size="sm">Save changes</SubmitButton></div>
    </form>
  );
}

export function IntegrationSettingsForm({ action, s }: { action: Action; s: SettingsValues }) {
  const { state, formAction, v } = useCounted(action);
  return (
    <form action={formAction} aria-label="Attendance integration">
      <FormMessage state={state} />
      <Row title="Restrict time logging to allowed networks" hint="Applies to Timesheet only. With no addresses listed, every network is allowed.">
        <Choice name="restrictNetworks" value="on" label="Restrict" checked={s.restrict_networks} />
      </Row>
      <Row title="Allowed IP addresses" hint="One per line or separated by commas (IPv4 or IPv6).">
        <textarea name="ips" rows={4} defaultValue={v.ips ?? s.allowed_ips.join('\n')} aria-label="Allowed IP addresses" className="w-full max-w-md rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm" />
      </Row>
      <div className="pt-4"><SubmitButton size="sm">Save changes</SubmitButton></div>
    </form>
  );
}
