'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { formatDate } from '@/lib/format';
import { CD_KINDS, endorsementEstimate, INSURERS } from '@/lib/insurance';
import type { ReconcileState } from './actions';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type NoInput = (prev: ActionState) => Promise<ActionState>;

export interface Policy {
  insurer: string | null; policy_number: string | null; valid_from: string | null; valid_to: string | null;
  maternity_normal: number | null; maternity_csection: number | null; room_rent_normal_pct: number | null; room_rent_icu_pct: number | null;
  cover_type: string; sum_insured: number | null; sum_insured_type: string; ambulance_per_incident: number | null; claim_process: string | null;
  wellness: boolean; e_consultation: boolean; health_checkup: boolean; pre_existing_covered: boolean; waiting_period_waived: boolean;
  exclusions_waived: boolean; pre_post_hospitalisation: boolean; hidden_fields: string[];
}

const BENEFITS = [
  ['wellness', 'Wellness'], ['e_consultation', 'E-consultation'], ['health_checkup', 'Health check-up'], ['pre_existing_covered', 'Pre-existing diseases covered'],
  ['waiting_period_waived', '30-day waiting period waived'], ['exclusions_waived', '1-year and 2-year exclusions waived'],
  ['pre_post_hospitalisation', 'Pre and post hospitalisation (30 and 60 days) covered'],
] as const;

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const control = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm';

function Field({ label, hint, hide, hidden, children }: { label: string; hint?: string; hide?: string; hidden?: string[]; children: ReactNode }) {
  const key = hide ?? '';
  const isHidden = hide ? (key === 'maternity' ? hidden?.includes('maternity_normal') : key === 'room_rent' ? hidden?.includes('room_rent_normal_pct') : hidden?.includes(key)) : false;
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
        {hide && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" name="show" value={key} defaultChecked={!isHidden} className="size-4 rounded border-line-strong accent-primary" />Show to employee
          </label>
        )}
      </div>
      {children}
    </div>
  );
}

/** Policy details in three steps (Kredily's layout); "Show to employee" per field; an employee preview. */
export function PolicyForm({ action, policy }: { action: Action; policy: Policy | null }) {
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const shown = new Set(fd.getAll('show').map(String));
    for (const k of ['insurer', 'policy_number', 'valid_from', 'maternity', 'room_rent', 'cover_type', 'sum_insured', 'sum_insured_type']) if (!shown.has(k)) fd.append('hide', k);
    return action(prev, fd);
  }, initialActionState);
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState(false);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const p = policy;
  const hidden = p?.hidden_fields ?? [];
  const steps = [[1, 'Policy Details', 'Insurer, number, validity'], [2, 'Key Benefits', 'Cover, sum insured, room rent'], [3, 'Additional Benefits', 'Waivers, wellness, claim']] as const;
  const pct = Array.from({ length: 10 }, (_, i) => i + 1);
  return (
    <form action={formAction} noValidate aria-label="Policy" className="space-y-4">
      <FormMessage state={state} />
      <ol className="grid gap-2 sm:grid-cols-3" aria-label="Steps">
        {steps.map(([n, title, note]) => (
          <li key={n}><button type="button" onClick={() => setStep(n)} aria-current={step === n ? 'step' : undefined}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${step === n ? 'border-primary bg-primary-soft' : 'border-line'}`}>
            <span className={`grid size-7 place-items-center rounded-full text-sm font-semibold ${step === n ? 'bg-primary text-primary-fg' : 'bg-subtle'}`}>{n}</span>
            <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted">{note}</span></span>
          </button></li>
        ))}
      </ol>
      <div className="flex justify-end"><button type="button" onClick={() => setPreview((x) => !x)} className="text-sm text-primary hover:underline">{preview ? 'Hide employee preview' : 'Employee preview'}</button></div>
      {preview && <div className="rounded-xl border border-dashed border-primary/40 p-4"><MyCover policy={p ? Object.fromEntries(Object.entries(p).filter(([k]) => !hidden.includes(k))) as Partial<Policy> : {}} members={[]} preview /></div>}

      <div className={step === 1 ? 'grid gap-3' : 'hidden'}>
        <Field label="Insurer name" hide="insurer" hidden={hidden}>
          <select name="insurer" aria-label="Insurer name" defaultValue={v.insurer ?? p?.insurer ?? ''} className={control}>
            <option value="">Choose the insurer…</option>
            {[...new Set([...(p?.insurer && !INSURERS.includes(p.insurer) ? [p.insurer] : []), ...INSURERS])].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Policy number" hide="policy_number" hidden={hidden}>
          <input name="policyNumber" aria-label="Policy number" defaultValue={v.policyNumber ?? p?.policy_number ?? ''} className={control} />
        </Field>
        <Field label="Policy validity" hint="Start and end date of the group policy period." hide="valid_from" hidden={hidden}>
          <div className="flex items-center gap-2">
            <input type="date" name="validFrom" aria-label="Valid from" defaultValue={v.validFrom ?? p?.valid_from ?? ''} className={control} />
            <span aria-hidden>→</span>
            <input type="date" name="validTo" aria-label="Valid to" defaultValue={v.validTo ?? p?.valid_to ?? ''} className={control} />
          </div>
          {e.validTo && <p className="mt-1 text-xs text-danger">{e.validTo}</p>}
        </Field>
      </div>

      <div className={step === 2 ? 'grid gap-3 sm:grid-cols-2' : 'hidden'}>
        <Field label="Maternity" hint="Cover limit for normal delivery and C-section." hide="maternity" hidden={hidden}>
          <div className="grid grid-cols-2 gap-2">
            {(['maternityNormal', 'maternityCsection'] as const).map((k, i) => (
              <select key={k} name={k} aria-label={i ? 'C-section' : 'Normal delivery'} defaultValue={v[k] ?? String((i ? p?.maternity_csection : p?.maternity_normal) ?? '')} className={control}>
                <option value="">Not set</option>{[25000, 35000, 50000, 75000, 100000].map((a) => <option key={a} value={a}>{inr.format(a)}</option>)}
              </select>
            ))}
          </div>
        </Field>
        <Field label="Room rent" hint="Hospital room category — normal (standard room) and ICU, as % of sum insured." hide="room_rent" hidden={hidden}>
          <div className="grid grid-cols-2 gap-2">
            {(['roomNormal', 'roomIcu'] as const).map((k, i) => (
              <select key={k} name={k} aria-label={i ? 'ICU' : 'Normal room'} defaultValue={v[k] ?? String((i ? p?.room_rent_icu_pct : p?.room_rent_normal_pct) ?? '')} className={control}>
                <option value="">Not set</option>{pct.map((n) => <option key={n} value={n}>{n}%</option>)}
              </select>
            ))}
          </div>
        </Field>
        <Field label="Cover type" hint="Who is covered: employee, spouse and children (ESC), and parents too (ESCP)." hide="cover_type" hidden={hidden}>
          <select name="coverType" aria-label="Cover type" defaultValue={v.coverType ?? p?.cover_type ?? 'ESC'} className={control}><option value="ESC">ESC</option><option value="ESCP">ESCP</option></select>
        </Field>
        <Field label="Sum insured" hint="Maximum amount the insurer will pay for covered expenses." hide="sum_insured" hidden={hidden}>
          <input name="sumInsured" aria-label="Sum insured (₹)" inputMode="numeric" defaultValue={v.sumInsured ?? (p?.sum_insured != null ? String(p.sum_insured) : '')} className={control} />
          {e.sumInsured && <p className="mt-1 text-xs text-danger">{e.sumInsured}</p>}
        </Field>
        <Field label="Sum insured type" hint="Flat (same for all) or graded (varies by grade; set per employee)." hide="sum_insured_type" hidden={hidden}>
          <select name="sumInsuredType" aria-label="Sum insured type" defaultValue={v.sumInsuredType ?? p?.sum_insured_type ?? 'fixed'} className={control}><option value="fixed">Fixed</option><option value="grade">Grade based</option></select>
        </Field>
      </div>

      <div className={step === 3 ? 'grid gap-3 sm:grid-cols-2' : 'hidden'}>
        <p className="text-xs text-muted sm:col-span-2">These benefits are visible to employees by default.</p>
        {BENEFITS.map(([k, label]) => (
          <Field key={k} label={label}>
            <select name={k} aria-label={label} defaultValue={v[k] ?? (p ? (p[k] ? 'yes' : 'no') : 'yes')} className={control}><option value="yes">Yes</option><option value="no">No</option></select>
          </Field>
        ))}
        <Field label="Ambulance charges per incident">
          <select name="ambulance" aria-label="Ambulance charges per incident" defaultValue={v.ambulance ?? String(p?.ambulance_per_incident ?? '')} className={control}>
            <option value="">Not set</option>{Array.from({ length: 10 }, (_, i) => (i + 1) * 1000).map((a) => <option key={a} value={a}>{inr.format(a)}</option>)}
          </select>
        </Field>
        <Field label="Claim process" hint="How to claim: the TPA, helpline and steps.">
          <textarea name="claimProcess" aria-label="Claim process" rows={3} defaultValue={v.claimProcess ?? p?.claim_process ?? ''} className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex gap-2">
          {step > 1 && <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border border-line px-3 py-2 text-sm">← Back</button>}
          {step < 3 && <button type="button" onClick={() => setStep(step + 1)} className="rounded-lg border border-line px-3 py-2 text-sm">Next →</button>}
        </span>
        <SubmitButton>Save policy</SubmitButton>
      </div>
    </form>
  );
}

const yes = (b: unknown) => (b ? 'Yes' : 'No');
/** What an employee sees: the policy fields HR shows, and who is insured. */
export function MyCover({ policy, members, preview }: { policy: Partial<Policy>; members: Array<{ name: string; relationship: string; dateOfBirth: string | null; sumInsured: number | null }>; preview?: boolean }) {
  const rows: Array<[string, string]> = [];
  const add = (k: keyof Policy, label: string, f: (x: never) => string) => { if (policy[k] !== undefined && policy[k] !== null) rows.push([label, f(policy[k] as never)]); };
  add('insurer', 'Insurer', (x: string) => x);
  add('policy_number', 'Policy number', (x: string) => x);
  if (policy.valid_from && policy.valid_to) rows.push(['Validity', `${policy.valid_from} → ${policy.valid_to}`]);
  add('sum_insured', 'Sum insured', (x: number) => inr.format(Number(x)));
  add('cover_type', 'Cover', (x: string) => (x === 'ESCP' ? 'You, spouse, children and parents' : 'You, spouse and children'));
  add('maternity_normal', 'Maternity (normal)', (x: number) => inr.format(Number(x)));
  add('maternity_csection', 'Maternity (C-section)', (x: number) => inr.format(Number(x)));
  add('room_rent_normal_pct', 'Room rent (normal)', (x: number) => `${x}% of sum insured`);
  add('room_rent_icu_pct', 'Room rent (ICU)', (x: number) => `${x}% of sum insured`);
  for (const [k, label] of BENEFITS) add(k, label, yes);
  add('ambulance_per_incident', 'Ambulance per incident', (x: number) => inr.format(Number(x)));
  return (
    <div className="space-y-4">
      {preview && <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Employee preview</p>}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" aria-label="Policy">
        {rows.length === 0 && <p className="text-muted">No details yet.</p>}
        {rows.map(([k, val]) => <div key={k} className="flex justify-between gap-3 border-b border-line py-1.5"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{val}</dd></div>)}
      </dl>
      {policy.claim_process && <div className="rounded-xl bg-subtle p-3 text-sm"><p className="font-medium">How to claim</p><p className="mt-1 whitespace-pre-line text-muted">{policy.claim_process}</p></div>}
      {!preview && (
        <table className="w-full text-sm" aria-label="Insured members">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="py-2">Member</th><th>Relationship</th><th>Date of birth</th><th className="text-right">Sum insured</th></tr></thead>
          <tbody className="divide-y divide-line">
            {members.map((m) => <tr key={`${m.name}-${m.relationship}`}><td className="py-2 font-medium">{m.name}</td><td className="capitalize">{m.relationship}</td><td>{m.dateOfBirth ?? '—'}</td><td className="text-right tabular-nums">{m.sumInsured ? inr.format(m.sumInsured) : '—'}</td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function CoverageForm({ action, employeeId, name, covered, sumInsured }: { action: Action; employeeId: string; name: string; covered: boolean | null; sumInsured: number | null }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={`Coverage for ${name}`} className="flex items-center gap-1.5">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="covered" value={covered ? 'no' : 'yes'} />
      {covered && <input type="hidden" name="sumInsured" value={sumInsured ?? ''} />}
      <SubmitButton size="sm" variant={covered ? 'ghost' : 'secondary'} pendingLabel="…">{covered ? 'Remove' : 'Cover'}</SubmitButton>
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

export function SumInsuredForm({ action, employeeId, name, sumInsured }: { action: Action; employeeId: string; name: string; sumInsured: number | null }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={`Sum insured for ${name}`} className="flex items-center gap-1">
      <input type="hidden" name="employeeId" value={employeeId} /><input type="hidden" name="covered" value="yes" />
      <input name="sumInsured" aria-label={`Sum insured for ${name}`} inputMode="numeric" defaultValue={sumInsured ?? ''} placeholder="Policy" className="h-8 w-24 rounded-md border border-line bg-surface px-2 text-sm tabular-nums" />
      <SubmitButton size="sm" variant="ghost" pendingLabel="…">Set</SubmitButton>
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

export function ButtonAction({ action, label, aria, pending = '…', variant = 'primary' }: { action: NoInput; label: string; aria: string; pending?: string; variant?: 'primary' | 'secondary' }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={aria} className="inline-flex flex-wrap items-center gap-2">
      <SubmitButton size="sm" variant={variant} pendingLabel={pending}>{label}</SubmitButton>
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}

export function UploadForm({ action, label, hint, templateHref }: { action: Action; label: string; hint: string; templateHref?: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={label} className="space-y-2 rounded-xl border border-dashed border-line p-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm"><span className="mb-1 block text-xs font-medium text-muted">{label} (CSV) — {hint}</span>
          <input type="file" name="file" accept=".csv,text/csv" aria-label={`${label} file`} className="block w-full text-sm" /></label>
        {templateHref && <a href={templateHref} className="text-sm text-primary hover:underline" download>⬇ Current list</a>}
        <SubmitButton size="sm" pendingLabel="Reading…">⬆ Upload</SubmitButton>
      </div>
    </form>
  );
}

export function ReconcileForm({ action }: { action: (prev: ReconcileState, fd: FormData) => Promise<ReconcileState> }) {
  const [state, formAction] = useActionState(action, initialActionState as ReconcileState);
  const r = state.result;
  const list = (title: string, rows: string[][], tone: string) => (
    <div>
      <p className={`text-sm font-semibold ${tone}`}>{title} · {rows.length}</p>
      {rows.length > 0 && <ul className="mt-1 space-y-0.5 text-sm" aria-label={title}>{rows.map((x, i) => <li key={i}>{x[0]} · {x[1]}{x[2] ? ` (${x[2]})` : ''}</li>)}</ul>}
    </div>
  );
  return (
    <div className="space-y-4">
      <form action={formAction} aria-label="Reconcile with insurer" className="space-y-2 rounded-xl border border-dashed border-line p-3">
        {state.message && <p role={state.ok ? 'status' : 'alert'} className={`text-sm ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</p>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-48 flex-1 text-sm"><span className="mb-1 block text-xs font-medium text-muted">Insurer’s member list (CSV with employee_code, member_name, relationship)</span>
            <input type="file" name="file" accept=".csv,text/csv" aria-label="Insurer member list" className="block w-full text-sm" /></label>
          <SubmitButton size="sm" pendingLabel="Comparing…">Compare</SubmitButton>
        </div>
      </form>
      {r && <div className="grid gap-4 sm:grid-cols-2">{list('Missing at the insurer', r.missing, 'text-warning')}{list('Only at the insurer', r.extra, 'text-danger')}</div>}
    </div>
  );
}

export interface PickRow {
  key: string; change: string; member: string; employee: string; code: string; relationship: string; reason: string;
  dob: string | null; gender: string | null; sumInsured: number | null; effective: string | null;
}

/**
 * The CD endorsement as HR sends it (Kredily's "Selected for this endorsement"): every pending addition and deletion,
 * all chosen at first. Export and "Lock & mark synced" use the choice; what's left out stays pending for next time.
 */
export function EndorsementPicker({ rows, action, exportHref, children }: { rows: PickRow[]; action: Action; exportHref: string; children?: ReactNode }) {
  const [picked, setPicked] = useState(() => new Set(rows.map((r) => r.key)));
  const [state, formAction] = useActionState(action, initialActionState);
  const additions = rows.filter((r) => r.change === 'addition');
  const deletions = rows.filter((r) => r.change === 'deletion');
  const chosen = (list: PickRow[]) => list.filter((r) => picked.has(r.key)).length;
  const set = (keys: string[], on: boolean) => setPicked((prev) => {
    const next = new Set(prev);
    for (const k of keys) if (on) next.add(k); else next.delete(k);
    return next;
  });
  const left = rows.filter((r) => !picked.has(r.key)).map((r) => r.key);
  const href = left.length === 0 ? exportHref : left.length <= picked.size ? `${exportHref}&skip=${left.join(',')}` : `${exportHref}&only=${[...picked].join(',')}`;
  const button = 'rounded-lg border border-line px-3 py-1.5 text-sm';
  const table = (list: PickRow[], label: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={label}>
        <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th className="w-10 px-5 py-2"><input type="checkbox" aria-label={`Choose all ${label.toLowerCase()}`} disabled={list.length === 0} checked={list.length > 0 && list.every((r) => picked.has(r.key))}
              onChange={(e) => set(list.map((r) => r.key), e.target.checked)} className="size-4 rounded border-line-strong accent-primary" /></th>
            <th className="px-3 py-2 font-semibold">Member</th><th className="px-3 py-2 font-semibold">Employee</th><th className="px-3 py-2 font-semibold">Relationship</th>
            <th className="px-3 py-2 font-semibold">Reason</th><th className="px-3 py-2 font-semibold">Date of birth</th><th className="px-3 py-2 font-semibold">Gender</th>
            <th className="px-3 py-2 text-right font-semibold">Sum insured</th><th className="px-3 py-2 font-semibold">Effective</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {list.length === 0 && <tr><td colSpan={9} className="px-5 py-6 text-center text-muted">{label === 'Additions' ? 'No additions pending.' : 'No deletions pending — all synced.'}</td></tr>}
          {list.map((r) => (
            <tr key={r.key} className={picked.has(r.key) ? undefined : 'text-muted'}>
              <td className="px-5 py-2"><input type="checkbox" checked={picked.has(r.key)} onChange={(e) => set([r.key], e.target.checked)} aria-label={`Include ${r.member} (${r.relationship})`} className="size-4 rounded border-line-strong accent-primary" /></td>
              <td className="px-3 py-2 font-medium">{r.member}</td><td className="px-3">{r.employee} <span className="text-xs text-muted">{r.code}</span></td>
              <td className="px-3 capitalize">{r.relationship}</td><td className="px-3"><span className="rounded-full bg-subtle px-2 py-0.5 text-xs">{r.reason}</span></td>
              <td className="px-3">{r.dob ? formatDate(r.dob) : '—'}</td><td className="px-3 capitalize">{r.gender?.replace('_', '-') ?? '—'}</td>
              <td className="px-3 text-right tabular-nums">{r.sumInsured ? inr.format(r.sumInsured) : '—'}</td><td className="px-3">{r.effective ? formatDate(r.effective) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-5">
      <section className="lift-soft rounded-xl border border-line bg-surface" aria-label="CD endorsement">
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
          <h2 className="text-sm font-semibold">CD endorsement<span className="ml-2 font-normal text-muted">{rows.length} pending change{rows.length === 1 ? '' : 's'}</span></h2>
          <span className="flex flex-wrap items-center gap-2">
            {picked.size > 0 ? <a className={`${button} hover:bg-subtle`} href={href} download>⬇ Export endorsement</a> : <span className={`${button} text-muted`} aria-disabled="true">⬇ Export endorsement</span>}
            <form action={formAction} aria-label="Lock endorsement" className="inline-flex flex-wrap items-center gap-2">
              <input type="hidden" name="key" value={[...picked].join(',')} />
              <SubmitButton size="sm" pendingLabel="Locking…" disabled={picked.size === 0}>Lock & mark synced</SubmitButton>
              {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
            </form>
          </span>
        </header>
        <div className="space-y-3 px-5 pb-5 pt-3">
          {children}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-sm">
              <p aria-live="polite">Selected for this endorsement: <strong>{chosen(additions)}</strong> of {additions.length} additions · <strong>{chosen(deletions)}</strong> of {deletions.length} deletions</p>
              <span className="flex gap-3">
                <button type="button" onClick={() => set(rows.map((r) => r.key), true)} className="font-medium text-primary hover:underline">Select all</button>
                <button type="button" onClick={() => set(rows.map((r) => r.key), false)} className="font-medium text-primary hover:underline">Clear</button>
              </span>
            </div>
          )}
        </div>
      </section>
      <section className="lift-soft rounded-xl border border-line bg-surface" aria-label={`Additions · ${additions.length}`}>
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
          <h2 className="text-sm font-semibold">＋ Additions · {additions.length}</h2><p className="text-xs text-muted">new joiners, newborns, marriages, dependants added — from employee records</p>
        </header>
        <div className="pb-2 pt-2">{table(additions, 'Additions')}</div>
      </section>
      <section className="lift-soft rounded-xl border border-line bg-surface" aria-label={`Deletions · ${deletions.length}`}>
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
          <h2 className="text-sm font-semibold">－ Deletions · {deletions.length}</h2><p className="text-xs text-muted">exits and dependants removed</p>
        </header>
        <div className="pb-2 pt-2">{table(deletions, 'Deletions')}</div>
      </section>
    </div>
  );
}

export interface SyncOption { id: string; label: string; lives: number }

/** Records money in or out of the CD account; for an endorsement charge, a guide amount from the premium per life. */
export function CdEntryForm({ action, today, syncs, premium }: {
  action: Action; today: string; syncs: SyncOption[]; premium: { perLife: number | null; validFrom: string | null; validTo: string | null };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const [kind, setKind] = useState(v.kind ?? 'deposit');
  const [date, setDate] = useState(v.entryDate ?? today);
  const [lives, setLives] = useState(v.lives ?? '');
  const guess = kind === 'endorsement' ? endorsementEstimate(premium.perLife, Number(lives) || 0, premium.validFrom, premium.validTo, date) : null;
  const err = (k: string) => e[k] && <p className="mt-1 text-xs text-danger">{e[k]}</p>;
  const label = 'mb-1 block text-xs font-medium text-muted';
  return (
    <form action={formAction} noValidate aria-label="Record a CD entry" className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm"><span className={label}>Date</span>
          <input type="date" name="entryDate" value={date} onChange={(x) => setDate(x.target.value)} className={control} />{err('entryDate')}</label>
        <label className="text-sm"><span className={label}>Entry</span>
          <select name="kind" aria-label="Entry" value={kind} onChange={(x) => setKind(x.target.value)} className={control}>
            {Object.entries(CD_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        {kind === 'adjustment' && (
          <label className="text-sm"><span className={label}>Direction</span>
            <select name="direction" aria-label="Direction" defaultValue={v.direction ?? 'in'} className={control}><option value="in">Money in</option><option value="out">Money out</option></select></label>
        )}
        <label className="text-sm"><span className={label}>Amount (₹)</span>
          <input name="amount" inputMode="decimal" defaultValue={v.amount ?? ''} className={control} />{err('amount')}</label>
        {(kind === 'endorsement' || kind === 'refund') && (
          <label className="text-sm"><span className={label}>Lives</span>
            <input name="lives" inputMode="numeric" value={lives} onChange={(x) => setLives(x.target.value)} className={control} />{err('lives')}</label>
        )}
        {kind === 'endorsement' && syncs.length > 0 && (
          <label className="text-sm sm:col-span-2"><span className={label}>For the endorsement of</span>
            <select name="syncId" aria-label="For the endorsement of" defaultValue={v.syncId ?? ''} onChange={(x) => { const s = syncs.find((y) => y.id === x.target.value); if (s) setLives(String(s.lives)); }} className={control}>
              <option value="">Not linked</option>{syncs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select></label>
        )}
        <label className="text-sm"><span className={label}>Reference</span>
          <input name="reference" maxLength={80} placeholder="Debit note, UTR or cheque no." defaultValue={v.reference ?? ''} className={control} />{err('reference')}</label>
        <label className="text-sm sm:col-span-2"><span className={label}>Note</span>
          <input name="note" maxLength={300} defaultValue={v.note ?? ''} className={control} />{err('note')}</label>
      </div>
      {kind === 'endorsement' && (
        <p className="text-xs text-muted">{guess !== null
          ? `Estimate ≈ ${inr.format(guess)} for ${lives} ${Number(lives) === 1 ? 'life' : 'lives'}: the premium per life, pro rata for the days left in the policy period. Enter the amount on the insurer’s debit note.`
          : premium.perLife ? 'Enter the lives added to see an estimate.' : 'Set the premium per life below to see an estimate.'}</p>
      )}
      <SubmitButton size="sm">Record entry</SubmitButton>
    </form>
  );
}

/** The premium per insured life (for estimates) and the balance that triggers the low-balance warning. */
export function CdSettingsForm({ action, perLife, lowBalance }: { action: Action; perLife: number | null; lowBalance: number | null }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="CD settings" className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted">Annual premium per life (₹)</span>
          <input name="premiumPerLife" inputMode="decimal" defaultValue={v.premiumPerLife ?? (perLife ?? '')} className={control} />
          {e.premiumPerLife && <p className="mt-1 text-xs text-danger">{e.premiumPerLife}</p>}</label>
        <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted">Warn when the balance falls below (₹)</span>
          <input name="lowBalance" inputMode="decimal" defaultValue={v.lowBalance ?? (lowBalance ?? '')} className={control} />
          {e.lowBalance && <p className="mt-1 text-xs text-danger">{e.lowBalance}</p>}</label>
      </div>
      <SubmitButton size="sm" variant="secondary">Save CD settings</SubmitButton>
    </form>
  );
}
