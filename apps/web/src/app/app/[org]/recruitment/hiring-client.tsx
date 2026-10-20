'use client';

import { useActionState, useMemo, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Counted = ActionState & { n?: number };
type Opt = { value: string; label: string };

function useCounted(action: Action) {
  const [state, formAction] = useActionState<Counted, FormData>(async (prev, fd) => ({ ...(await action(prev, fd)), n: (prev.n ?? 0) + 1 }), initialActionState);
  return { state, formAction, n: state.n ?? 0, v: state.ok ? {} : (state.values ?? {}), e: state.fieldErrors ?? {} };
}
const checkbox = 'size-4 rounded border-line-strong accent-primary';

export function PlanForm({ action, departments, month }: { action: Action; departments: Opt[]; month: string }) {
  const { state, formAction, n, v, e } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="New hiring plan" className="space-y-3">
      <FormMessage state={state} />
      <div key={n} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField idPrefix="plan" name="name" label="Plan name" required placeholder="FY27 Q1 hiring" defaultValue={v.name ?? ''} error={e.name} />
          <SelectField idPrefix="plan" name="periodKind" label="Period" defaultValue={v.periodKind ?? 'quarter'} options={[{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]} />
          <TextField idPrefix="plan" name="periodStart" label="Starting month" type="month" required defaultValue={v.periodStart ?? month} error={e.periodStart} />
        </div>
        <fieldset><legend className="mb-1 text-xs font-medium text-muted">Headcount by department</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((d) => (
              <label key={d.value} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">{d.label}
                <input name={`hc_${d.value}`} inputMode="numeric" defaultValue={v[`hc_${d.value}`] ?? ''} placeholder="0" aria-label={`Headcount for ${d.label}`} className="h-8 w-16 rounded-md border border-line-strong bg-surface px-2 text-right" />
              </label>
            ))}
          </div>
        </fieldset>
        <TextField idPrefix="plan" name="note" label="Note" defaultValue={v.note ?? ''} />
      </div>
      <SubmitButton size="sm">＋ New plan</SubmitButton>
    </form>
  );
}

export function PoolForm({ action }: { action: Action }) {
  const { state, formAction, n, v, e } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="New pool" className="space-y-3">
      <FormMessage state={state} />
      <div key={n} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <TextField idPrefix="pool" name="name" label="Pool name" required placeholder="Silver medallists" defaultValue={v.name ?? ''} error={e.name} />
        <TextField idPrefix="pool" name="description" label="What it’s for" defaultValue={v.description ?? ''} />
      </div>
      <SubmitButton size="sm">＋ New pool</SubmitButton>
    </form>
  );
}

export function AddToPoolForm({ action, pools, candidates }: { action: Action; pools: Opt[]; candidates: Opt[] }) {
  const { state, formAction, n } = useCounted(action);
  const [q, setQ] = useState('');
  const shown = candidates.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  if (pools.length === 0) return <p className="text-sm text-muted">Create a pool first.</p>;
  return (
    <form action={formAction} aria-label="Add candidates to a pool" className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField idPrefix="atp" name="poolId" label="Pool" options={pools} />
        <TextField idPrefix="atp" name="q" label="Find candidates" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Name, email or job" />
      </div>
      <div key={n} className="scroll-thin flex max-h-56 flex-wrap gap-2 overflow-y-auto">
        {shown.map((c) => <label key={c.value} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-sm"><input type="checkbox" name="candidateId" value={c.value} className={checkbox} />{c.label}</label>)}
        {shown.length === 0 && <p className="text-sm text-muted">No candidates match.</p>}
      </div>
      <SubmitButton size="sm" variant="secondary">Add to pool</SubmitButton>
    </form>
  );
}

const KINDS: Opt[] = [
  { value: 'application_received', label: 'Application received' }, { value: 'interview_invite', label: 'Interview invitation' },
  { value: 'rejection', label: 'Rejection' }, { value: 'offer', label: 'Offer' }, { value: 'follow_up', label: 'Follow-up' }, { value: 'custom', label: 'Custom' },
];
const fill = (t: string, vars: Record<string, string>) => t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);

/** Edit a template with a live preview filled with sample values. */
export function TemplateForm({ action, template, sample, variables }: {
  action: Action; template?: { id: string; name: string; kind: string; subject: string; body: string }; sample: Record<string, string>; variables: readonly string[];
}) {
  const { state, formAction, n, v, e } = useCounted(action);
  const [subject, setSubject] = useState(v.subject ?? template?.subject ?? '');
  const [body, setBody] = useState(v.body ?? template?.body ?? '');
  const preview = useMemo(() => ({ subject: fill(subject, sample), body: fill(body, sample) }), [subject, body, sample]);
  const p = `tpl-${template?.id ?? 'new'}`;
  return (
    <form action={formAction} noValidate aria-label={template ? `Template ${template.name}` : 'New template'} className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <FormMessage state={state} />
        {template && <input type="hidden" name="templateId" value={template.id} />}
        <div key={template ? 0 : n} className="grid gap-3 sm:grid-cols-2">
          <TextField idPrefix={p} name="name" label="Template name" required defaultValue={v.name ?? template?.name ?? ''} error={e.name} />
          <SelectField idPrefix={p} name="kind" label="Used for" defaultValue={v.kind ?? template?.kind ?? 'custom'} options={KINDS} />
        </div>
        <TextField idPrefix={p} name="subject" label="Subject" required value={subject} onChange={(ev) => setSubject(ev.target.value)} error={e.subject} />
        <TextAreaField idPrefix={p} name="body" label="Message" required rows={8} value={body} onChange={(ev) => setBody(ev.target.value)} error={e.body} />
        <p className="text-xs text-muted">Variables: {variables.map((x) => `{{${x}}}`).join(' · ')}</p>
        <SubmitButton size="sm" variant={template ? 'secondary' : 'primary'}>{template ? 'Save template' : '＋ Add template'}</SubmitButton>
      </div>
      <div className="rounded-lg border border-line bg-subtle p-4 text-sm" aria-label="Preview">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Preview</p>
        <p className="mt-2 font-medium">{preview.subject || '—'}</p>
        <p className="mt-2 whitespace-pre-wrap text-muted">{preview.body || '—'}</p>
      </div>
    </form>
  );
}

export function SpendForm({ action, sources, month }: { action: Action; sources: Opt[]; month: string }) {
  const { state, formAction, n, v, e } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="Add spend" className="space-y-3">
      <FormMessage state={state} />
      <div key={n} className="grid gap-3 sm:grid-cols-4">
        <SelectField idPrefix="spend" name="source" label="Source" defaultValue={v.source ?? 'job_board'} options={sources} />
        <TextField idPrefix="spend" name="month" label="Month" type="month" required defaultValue={v.month ?? month} error={e.month} />
        <TextField idPrefix="spend" name="amount" label="Amount (₹)" required inputMode="decimal" defaultValue={v.amount ?? ''} error={e.amount} />
        <TextField idPrefix="spend" name="note" label="Note" placeholder="e.g. Naukri plan" defaultValue={v.note ?? ''} />
      </div>
      <SubmitButton size="sm" variant="secondary">＋ Add spend</SubmitButton>
    </form>
  );
}

export function AutomationsForm({ action, stallDays, notify }: { action: Action; stallDays: number; notify: boolean }) {
  const { state, formAction, v } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="Automations" className="space-y-3">
      <FormMessage state={state} />
      <label className="flex items-center gap-2 text-sm">A candidate is <span className="font-medium">stalled</span> after
        <input name="stallDays" inputMode="numeric" defaultValue={v.stallDays ?? stallDays} aria-label="Stalled after (days)" className="h-8 w-16 rounded-md border border-line-strong bg-surface px-2 text-right" /> days in one stage
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" defaultChecked={notify} className={checkbox} />Notify the hiring manager of every new applicant</label>
      <p className="text-xs text-muted">A requisition closes on its own once every opening is filled. Offers follow the offer approval chain set in Workflows.</p>
      <SubmitButton size="sm" variant="secondary">Save automations</SubmitButton>
    </form>
  );
}

/** A one-button form (delete, remove). */
export function OneButton({ action, hidden, label, children, confirm }: { action: Action; hidden: Record<string, string>; label: string; children: string; confirm?: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={label} className="inline" onSubmit={(ev) => { if (confirm && !window.confirm(confirm)) ev.preventDefault(); }}>
      {Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      <SubmitButton size="sm" variant="ghost" pendingLabel="…">{children}</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="ml-1 text-xs text-danger">{state.message}</span>}
    </form>
  );
}

/** Move a candidate from the board (the job page has offers, interviews and hiring). */
export function MoveCard({ action, applicationId, stage, stages, name }: { action: Action; applicationId: string; stage: string; stages: Opt[]; name: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={`Move ${name}`} className="mt-2 flex items-center gap-1">
      <input type="hidden" name="applicationId" value={applicationId} />
      <select name="stage" defaultValue={stage} aria-label="Stage" className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-1 text-xs">
        {stages.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <SubmitButton size="sm" variant="ghost" pendingLabel="…">Move</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="text-[10px] text-danger">{state.message}</span>}
    </form>
  );
}
