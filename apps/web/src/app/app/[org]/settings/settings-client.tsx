'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type NoInput = (prev: ActionState) => Promise<ActionState>;
const check = 'size-4 rounded border-line-strong accent-primary';

export function ToggleList({ action, label, name, items, submit }: {
  action: Action; label: string; name: string; submit: string;
  items: Array<{ key: string; label: string; note?: string; on: boolean; group?: string }>;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const groups = [...new Set(items.map((i) => i.group ?? ''))];
  return (
    <form action={formAction} aria-label={label} className="space-y-4">
      <FormMessage state={state} />
      {groups.map((g) => (
        <fieldset key={g}>
          {g && <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{g}</legend>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.filter((i) => (i.group ?? '') === g).map((i) => (
              <label key={i.key} className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm has-[:checked]:border-primary/50">
                <input type="checkbox" name={name} value={i.key} defaultChecked={i.on} className={`${check} mt-0.5`} />
                <span><span className="block font-medium">{i.label}</span>{i.note && <span className="block text-xs text-muted">{i.note}</span>}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <SubmitButton>{submit}</SubmitButton>
    </form>
  );
}

export function ControlsForm({ action, c }: { action: Action; c: { block_self_edit: boolean; salary_history_visible: boolean; birthdays_visible: boolean; notify_data_changes: boolean } }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const row = (name: string, on: boolean, title: string, note: string) => (
    <label className="flex items-start gap-3 rounded-xl border border-line p-4 text-sm">
      <input type="checkbox" name={name} defaultChecked={on} className={`${check} mt-0.5`} />
      <span><span className="block font-medium">{title}</span><span className="block text-xs text-muted">{note}</span></span>
    </label>
  );
  return (
    <form action={formAction} aria-label="Controls" className="space-y-3">
      <FormMessage state={state} />
      {row('blockSelfEdit', c.block_self_edit, 'Nobody edits their own HR record', 'HR and managers can’t change their own employee record or pay. Owners are exempt.')}
      {row('salaryHistory', c.salary_history_visible, 'Employees see their salary revision history', 'Shown under My Pay › Salary structure.')}
      {row('birthdays', c.birthdays_visible, 'Show upcoming birthdays on the dashboard', 'Only names and days, never the year.')}
      {row('notifyChanges', c.notify_data_changes, 'Tell admins when company data changes', 'Owners and HR get a notification when someone edits the company profile, an address or the salary bank account.')}
      <SubmitButton>Save controls</SubmitButton>
    </form>
  );
}

/** Owners: close the company after typing its name. */
export function ClosureForm({ action, name }: { action: Action; name: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Close the company" className="space-y-3">
      <FormMessage state={state} />
      <label className="block text-sm"><span className="mb-1 block font-medium">Type <b>{name}</b> to confirm</span>
        <input name="confirmName" required autoComplete="off" aria-label="Company name to confirm" aria-invalid={Boolean(state.fieldErrors?.confirmName)}
          className="h-10 w-full max-w-md rounded-md border border-line-strong bg-surface px-3 text-sm" /></label>
      {state.fieldErrors?.confirmName && <p className="text-xs text-danger">{state.fieldErrors.confirmName}</p>}
      <SubmitButton variant="danger">Close the company in 30 days</SubmitButton>
    </form>
  );
}

export function SupportForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Open support access" className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="text-sm"><span className="mb-1 block font-medium">For</span>
          <select name="hours" defaultValue="24" aria-label="For" className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
            {[[1, '1 hour'], [4, '4 hours'], [24, '1 day'], [72, '3 days'], [168, '7 days']].map(([h, l]) => <option key={h} value={h}>{l}</option>)}
          </select></label>
        <label className="text-sm"><span className="mb-1 block font-medium">What support is helping with</span>
          <input name="reason" required aria-label="What support is helping with" placeholder="Payroll setup questions" className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" /></label>
      </div>
      <SubmitButton>Open support access</SubmitButton>
    </form>
  );
}

export function ButtonAction({ action, label, aria, variant = 'secondary' }: { action: NoInput; label: string; aria: string; variant?: 'secondary' | 'ghost' | 'danger' }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={aria} className="inline-flex items-center gap-2">
      <SubmitButton size="sm" variant={variant} pendingLabel="…">{label}</SubmitButton>
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}

export function RoleForm({ action, roles }: { action: Action; roles: Array<{ id: string; name: string }> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const input = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm';
  return (
    <form action={formAction} aria-label="New role" className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm"><span className="mb-1 block font-medium">Role name</span><input name="name" required aria-label="Role name" placeholder="Finance admin" className={input} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">Start from</span>
          <select name="copyFrom" aria-label="Start from" className={input}><option value="">No permissions</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label className="text-sm"><span className="mb-1 block font-medium">Description</span><input name="description" aria-label="Description" className={input} /></label>
      </div>
      <p className="text-xs text-muted">Custom roles require two-step sign-in and only owners can assign them.</p>
      <SubmitButton>＋ Create role</SubmitButton>
    </form>
  );
}

export function ScopeCell({ action, roleId, permission, scope, label }: { action: Action; roleId: string; permission: string; scope: string | null; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={label}>
      <input type="hidden" name="roleId" value={roleId} /><input type="hidden" name="permission" value={permission} />
      <select name="scope" defaultValue={scope ?? 'none'} aria-label={label} onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`h-7 rounded border px-1 text-xs ${state.ok === false && state.message ? 'border-danger' : 'border-line'} bg-surface`}>
        <option value="none">—</option><option value="self">Self</option><option value="team">Team</option><option value="org">Org</option>
      </select>
    </form>
  );
}
