'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { MERGE_TAGS, renderLetter, tagsIn, unknownTags, type TagGroup } from '@/lib/letters';
import { LetterPaper, type Letterhead } from './letter-view';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
const GROUPS: Array<'All' | TagGroup> = ['All', 'Employee', 'Salary', 'Dates', 'Address', 'Company'];

/** Merge tags to click into the letter at the cursor. */
function TagPicker({ onPick, sample }: { onPick: (tag: string) => void; sample: Record<string, string> }) {
  const [group, setGroup] = useState<'All' | TagGroup>('All');
  const [q, setQ] = useState('');
  const tags = MERGE_TAGS.filter((t) => (group === 'All' || t.group === group) && (!q || t.tag.includes(q.toLowerCase()) || t.label.toLowerCase().includes(q.toLowerCase())));
  return (
    <section aria-label="Merge tags reference" className="flex min-h-0 flex-col rounded-2xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-wider">Merge tags reference</h3>
        <p className="text-[11px] text-muted">Click to insert · sample from the selected employee</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {GROUPS.map((g) => (
            <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${group === g ? 'bg-primary text-primary-fg' : 'bg-subtle text-muted hover:text-fg'}`}>{g}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags…" aria-label="Search merge tags"
          className="mt-2 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs" />
      </header>
      <ul className="scroll-thin max-h-[420px] divide-y divide-line overflow-y-auto">
        {tags.map((t) => (
          <li key={t.tag}>
            <button type="button" onClick={() => onPick(t.tag)} className="w-full px-4 py-2 text-left hover:bg-subtle" aria-label={`Insert ${t.tag}`}>
              <code className="text-xs font-semibold text-primary">{`{{ ${t.tag} }}`}</code>
              <span className="block truncate text-[11px] text-muted">{t.label}{sample[t.tag] ? ` · ${sample[t.tag]}` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useBody(initial: string) {
  const [body, setBody] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (tag: string) => {
    const el = ref.current;
    const token = `{{ ${tag} }}`;
    if (!el) { setBody((b) => b + token); return; }
    const [s, e] = [el.selectionStart, el.selectionEnd];
    const next = body.slice(0, s) + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };
  return { body, setBody, ref, insert };
}

function BodyEditor({ body, setBody, refEl }: { body: string; setBody: (v: string) => void; refEl: React.RefObject<HTMLTextAreaElement | null> }) {
  const bad = unknownTags(body);
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="letter-body" className="text-sm font-medium">Template editor</label>
        <span className={`text-xs font-semibold ${bad.length ? 'text-danger' : 'text-success'}`} role="status">
          {bad.length ? `Unknown tags: ${bad.join(', ')}` : 'All tags valid'}
        </span>
      </div>
      <textarea id="letter-body" ref={refEl} name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={22}
        className="mt-1 w-full rounded-xl border border-line bg-bg p-3 font-mono text-[13px] leading-relaxed" spellCheck />
      <p className="mt-1 text-xs text-muted">Blank lines start a new paragraph. Put <code>{'{{ authorized signatory signature }}'}</code> on its own line where the signature goes.</p>
    </div>
  );
}

/** Settings › Letter Setup: edit a template (or create a letter type) with merge tags and a live preview. */
export function TemplateEditor({ action, template, signatories, sample, head, archive }: {
  action: Action;
  template: { id?: string; letter_type: string; name: string; body: string; signatory_id: string | null; self_serve: boolean };
  signatories: Array<{ id: string; name: string; designation: string; address: string | null }>;
  sample: Record<string, string>;
  head: Letterhead;
  archive?: Action;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const { body, setBody, ref, insert } = useBody(state.values?.body ?? template.body);
  const [sigId, setSigId] = useState(template.signatory_id ?? '');
  const sig = signatories.find((s) => s.id === sigId);
  const values = { ...sample, ...(sig ? { 'authorized signatory name': sig.name, 'authorized signatory designation': sig.designation, 'authorized signatory address': sig.address ?? '' } : {}) };
  const e = state.fieldErrors ?? {};
  return (
    <div className="space-y-4">
      <form action={formAction} noValidate aria-label="Letter template" className="space-y-4">
        <FormMessage state={state} />
        <input type="hidden" name="templateId" value={template.id ?? ''} />
        <div className="grid gap-4 sm:grid-cols-4">
          <TextField idPrefix="tpl" name="letterType" label="Letter type" required defaultValue={state.values?.letterType ?? template.letter_type} error={e.letterType} />
          <TextField idPrefix="tpl" name="name" label="Template name" required defaultValue={state.values?.name ?? template.name} error={e.name} />
          <SelectField idPrefix="tpl" name="signatoryId" label="Authorized signatory" value={sigId} onChange={(ev) => setSigId(ev.target.value)}
            options={signatories.map((s) => ({ value: s.id, label: `${s.name} · ${s.designation}` }))} placeholder="Signature not assigned" />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="selfServe" defaultChecked={template.self_serve} className="size-4 accent-primary" />
            Employees can request it
          </label>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <BodyEditor body={body} setBody={setBody} refEl={ref} />
          <TagPicker onPick={insert} sample={values} />
        </div>
        <div className="flex flex-wrap justify-end gap-2"><SubmitButton>{template.id ? 'Save template' : 'Create letter'}</SubmitButton></div>
      </form>
      {template.id && archive && <ArchiveTemplate action={archive} id={template.id} />}
      <section aria-label="Preview">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">👁 Live preview</h3>
        <div className="overflow-x-auto rounded-2xl bg-subtle p-4"><LetterPaper body={renderLetter(body, values)} head={head} compact /></div>
      </section>
    </div>
  );
}

function ArchiveTemplate({ action, id }: { action: Action; id: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="templateId" value={id} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton variant="ghost" size="sm" pendingLabel="Archiving…">Archive this template</SubmitButton>
    </form>
  );
}

/** Generate › step 1: choose the letter and the people (one letter each). A GET form: step 2 is its own URL. */
export function PickForm({ base, templates, people, current }: {
  base: string;
  templates: Array<{ id: string; letter_type: string; name: string }>;
  people: Array<{ id: string; code: string; name: string; status: string }>;
  current: { template?: string; employees: string[] };
}) {
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set(current.employees));
  const types = [...new Set(templates.map((t) => t.letter_type))];
  const [type, setType] = useState(templates.find((t) => t.id === current.template)?.letter_type ?? '');
  const list = useMemo(() => people.filter((p) => !q || `${p.name} ${p.code}`.toLowerCase().includes(q.toLowerCase())), [people, q]);
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <form method="get" action={base} aria-label="Generate a letter" className="space-y-4">
      <input type="hidden" name="tab" value="generate" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField idPrefix="gen" name="type" label="Letter Type" value={type} onChange={(e) => setType(e.target.value)} options={types.map((t) => ({ value: t, label: t }))} placeholder="Select…" />
        <SelectField idPrefix="gen" name="template" label="Template" key={type} defaultValue={templates.find((t) => t.letter_type === type && t.id === current.template)?.id ?? templates.find((t) => t.letter_type === type)?.id ?? ''}
          options={templates.filter((t) => t.letter_type === type).map((t) => ({ value: t.id, label: t.name }))} placeholder="Select…" />
      </div>
      <fieldset className="rounded-2xl border border-line">
        <legend className="ml-3 px-1 text-sm font-medium">👥 Select employees <span className="text-muted">({chosen.size} selected)</span></legend>
        <div className="px-4 pt-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID…" aria-label="Search employees"
          className="h-9 w-full rounded-lg border border-line bg-bg px-3 text-sm" /></div>
        <ul className="scroll-thin grid max-h-72 gap-1 overflow-y-auto p-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <li key={p.id}>
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${chosen.has(p.id) ? 'bg-primary-soft' : 'hover:bg-subtle'}`}>
                <input type="checkbox" name="employees" value={p.id} checked={chosen.has(p.id)} onChange={() => toggle(p.id)} className="size-4 accent-primary" />
                <span className="truncate">{p.name}</span><span className="ml-auto text-xs text-muted">{p.code}{p.status === 'exited' ? ' · exited' : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="flex justify-end"><button type="submit" disabled={!type || chosen.size === 0}
        className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-50">Continue →</button></div>
    </form>
  );
}

/** Generate › step 2: edit the letter for this batch, fill what the records don't have, preview, generate drafts. */
export function GenerateForm({ action, templateId, requestId, employees, body: initial, sample, sampleName, head }: {
  action: Action; templateId: string; requestId?: string; employees: string[]; body: string;
  sample: Record<string, string>; sampleName: string; head: Letterhead;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const { body, setBody, ref, insert } = useBody(state.values?.body ?? initial);
  const [fills, setFills] = useState<Record<string, string>>({});
  const missing = tagsIn(body).filter((t) => t !== 'authorized signatory signature' && !sample[t]);
  const values = { ...sample, ...fills };
  return (
    <form action={formAction} noValidate aria-label="Letter details" className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="templateId" value={templateId} />
      {requestId && <input type="hidden" name="requestId" value={requestId} />}
      {employees.map((id) => <input key={id} type="hidden" name="employee" value={id} />)}
      {missing.length > 0 && (
        <fieldset className="rounded-2xl border border-line p-4">
          <legend className="px-1 text-sm font-medium">✍ Fill in ({employees.length > 1 ? 'applies to every letter in this batch' : 'not in the records'})</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {missing.map((t) => (
              <TextField key={t} idPrefix="fill" name={`fill:${t}`} label={t.replace(/^./, (c) => c.toUpperCase())}
                value={fills[t] ?? ''} onChange={(e) => setFills((f) => ({ ...f, [t]: e.target.value }))} />
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <BodyEditor body={body} setBody={setBody} refEl={ref} />
        <TagPicker onPick={insert} sample={values} />
      </div>
      <section aria-label="Preview">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">👁 Preview · {sampleName}{employees.length > 1 ? ` (1 of ${employees.length})` : ''}</h3>
        <div className="overflow-x-auto rounded-2xl bg-subtle p-4"><LetterPaper body={renderLetter(body, values)} head={head} compact /></div>
      </section>
      <div className="flex justify-end"><SubmitButton pendingLabel="Generating…">Generate {employees.length} letter{employees.length === 1 ? '' : 's'}</SubmitButton></div>
    </form>
  );
}

export function ReleaseForm({ action, ids, label = 'Release' }: { action: Action; ids: string[]; label?: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      {ids.map((id) => <input key={id} type="hidden" name="letterId" value={id} />)}
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" pendingLabel="Releasing…">{label}</SubmitButton>
    </form>
  );
}

export function LetterStatusForm({ action, id, op, label }: { action: Action; id: string; op: 'cancel' | 'delete'; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="letterId" value={id} />
      <input type="hidden" name="op" value={op} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant="ghost" pendingLabel="Saving…">{label}</SubmitButton>
    </form>
  );
}

/** Employee: ask HR for a self-serve letter. */
export function RequestForm({ action, templates }: { action: Action; templates: Array<{ id: string; letter_type: string }> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} noValidate aria-label="Request a letter" className="space-y-3 px-5 py-4">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <SelectField idPrefix="req" name="templateId" label="Letter" required options={templates.map((t) => ({ value: t.id, label: t.letter_type }))}
          placeholder="Choose…" defaultValue={state.ok ? '' : state.values?.templateId} error={state.fieldErrors?.templateId} />
        <TextField idPrefix="req" name="reason" label="Reason" placeholder="Bank account, visa…" defaultValue={state.ok ? '' : state.values?.reason} />
        <SubmitButton pendingLabel="Sending…">Request</SubmitButton>
      </div>
    </form>
  );
}

export function CloseRequestForm({ action, id, status, label }: { action: Action; id: string; status: 'rejected' | 'withdrawn'; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [open, setOpen] = useState(false);
  if (status === 'rejected' && !open) return <button type="button" onClick={() => setOpen(true)} className="rounded-md px-2 py-1 text-sm text-danger hover:bg-subtle">{label}</button>;
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="requestId" value={id} />
      <input type="hidden" name="status" value={status} />
      {status === 'rejected' && <input name="note" aria-label="Reason for declining" placeholder="Reason (shown to the employee)" className="h-8 rounded-lg border border-line bg-bg px-2 text-xs" />}
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant="ghost" pendingLabel="Saving…">{status === 'rejected' ? 'Confirm decline' : label}</SubmitButton>
    </form>
  );
}

export function SignatoryForm({ action, signatory }: { action: Action; signatory?: { id: string; name: string; designation: string; address: string | null } }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label={signatory ? `Edit ${signatory.name}` : 'Add signatory'} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="signatoryId" value={signatory?.id ?? ''} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField idPrefix={`sig${signatory?.id ?? ''}`} name="name" label="Name" required defaultValue={v.name ?? signatory?.name} error={e.name} />
        <TextField idPrefix={`sig${signatory?.id ?? ''}`} name="designation" label="Designation" required defaultValue={v.designation ?? signatory?.designation} error={e.designation} />
        <TextAreaField idPrefix={`sig${signatory?.id ?? ''}`} name="address" label="Address" rows={2} className="sm:col-span-2" defaultValue={v.address ?? signatory?.address ?? ''} error={e.address} />
        <TextField idPrefix={`sig${signatory?.id ?? ''}`} name="signature" label="Signature image" type="file" accept="image/png,image/jpeg"
          hint="PNG or JPEG on a white or transparent background, up to 1 MB." error={e.signature} className="sm:col-span-2 [&_input]:h-auto [&_input]:py-2" />
      </div>
      <div className="flex justify-end"><SubmitButton>{signatory ? 'Save signatory' : '＋ Add Signatory'}</SubmitButton></div>
    </form>
  );
}

export function RemoveSignatoryForm({ action, id, name }: { action: Action; id: string; name: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="signatoryId" value={id} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant="ghost" pendingLabel="Removing…" aria-label={`Remove ${name}`}>Remove</SubmitButton>
    </form>
  );
}

export function LetterheadForm({ action, head }: { action: Action; head: Letterhead }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [h, setH] = useState(head.headerStyle);
  const [f, setF] = useState(head.footerStyle);
  const e = state.fieldErrors ?? {};
  const choice = (name: string, value: string, current: string, set: (v: string) => void, title: string, note: string) => (
    <label className={`flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 text-sm ${current === value ? 'border-primary ring-2 ring-primary/30' : 'border-line'}`}>
      <span className="flex items-center gap-2"><input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value)} className="accent-primary" /><span className="font-semibold">{title}</span></span>
      <span className="text-xs text-muted">{note}</span>
    </label>
  );
  return (
    <form action={formAction} noValidate aria-label="Letter Head" className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        {choice('headerStyle', 'custom', h, setH, '＋ Upload Header', 'Recommended 2480 × 350 px')}
        {choice('headerStyle', 'classic', h, setH, 'Classic header', 'Company name on a coloured rule')}
        {choice('headerStyle', 'none', h, setH, 'No header', 'For pre-printed stationery')}
      </div>
      {h === 'custom' && <TextField idPrefix="lh" name="header" label="Header image" type="file" accept="image/png,image/jpeg" error={e.header} hint={head.headerUrl ? 'Leave empty to keep the current image.' : undefined} className="[&_input]:h-auto [&_input]:py-2" />}
      <div className="grid gap-3 sm:grid-cols-3">
        {choice('footerStyle', 'custom', f, setF, '＋ Upload Footer', 'Recommended 2480 × 350 px')}
        {choice('footerStyle', 'band', f, setF, 'Footer band', 'A coloured band with the company name')}
        {choice('footerStyle', 'none', f, setF, 'No footer', '')}
      </div>
      {f === 'custom' && <TextField idPrefix="lh" name="footer" label="Footer image" type="file" accept="image/png,image/jpeg" error={e.footer} hint={head.footerUrl ? 'Leave empty to keep the current image.' : undefined} className="[&_input]:h-auto [&_input]:py-2" />}
      <div className="flex justify-end"><SubmitButton>Save letterhead</SubmitButton></div>
      <section aria-label="Letterhead preview">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Preview</h3>
        <div className="rounded-2xl bg-subtle p-4"><LetterPaper compact head={{ ...head, headerStyle: h, footerStyle: f }}
          body={'Sample paragraph rendered on this letterhead.\n\nEvery released letter carries your header and footer exactly as shown.'} /></div>
      </section>
    </form>
  );
}
