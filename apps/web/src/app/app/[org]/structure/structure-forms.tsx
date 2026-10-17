'use client';

import { useActionState, useEffect } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Inline "add" forms, also used to edit a row: pass `initial` (with the row id) and `onDone`.
 * Element ids are prefixed per form (idPrefix) so they stay unique on one page.
 */
interface FormProps<T> {
  action: Action;
  initial?: T & { id: string };
  /** Called with the success message after a save, or with nothing on cancel. */
  onDone?: (message?: string) => void;
}

const formClass = 'space-y-3 border-t border-line bg-subtle/40 px-5 py-4';

/** After a successful edit, close the editor. */
function useCloseOnSuccess(state: ActionState, onDone?: (message?: string) => void) {
  useEffect(() => {
    if (state.ok) onDone?.(state.message);
  }, [state, onDone]);
}

function Buttons({ editing, onDone }: { editing: boolean; onDone?: (message?: string) => void }) {
  return (
    <div className="flex gap-2">
      <SubmitButton pendingLabel={editing ? 'Saving…' : 'Adding…'}>{editing ? 'Save' : 'Add'}</SubmitButton>
      {editing && <Button variant="secondary" onClick={() => onDone?.()}>Cancel</Button>}
    </div>
  );
}

export function DepartmentForm({
  action, parents, initial, onDone,
}: FormProps<{ code: string; name: string; parentId: string | null }> & { parents: Option[] }) {
  const [state, formAction] = useActionState(action, initialActionState);
  useCloseOnSuccess(state, onDone);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const p = initial ? `dept-${initial.id}` : 'dept';
  return (
    <form action={formAction} noValidate className={formClass} aria-label={initial ? `Edit department ${initial.name}` : 'Add department'}>
      {/* While editing, the success message is shown by the row once the editor closes. */}
      {!(initial && state.ok) && <FormMessage state={state} />}
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-[120px_1fr_1fr_auto] sm:items-end">
        <TextField idPrefix={p} name="code" label="Code" required placeholder="ENG" defaultValue={v.code ?? initial?.code} error={e.code} />
        <TextField idPrefix={p} name="name" label="Department name" required placeholder="Engineering" defaultValue={v.name ?? initial?.name} error={e.name} />
        <SelectField idPrefix={p} name="parentId" label="Parent department" options={parents} placeholder="None (top level)" defaultValue={v.parentId ?? initial?.parentId ?? ''} error={e.parentId} />
        <Buttons editing={!!initial} onDone={onDone} />
      </div>
    </form>
  );
}

export function DesignationForm({ action, initial, onDone }: FormProps<{ title: string; level: number | null }>) {
  const [state, formAction] = useActionState(action, initialActionState);
  useCloseOnSuccess(state, onDone);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const p = initial ? `desig-${initial.id}` : 'desig';
  return (
    <form action={formAction} noValidate className={formClass} aria-label={initial ? `Edit designation ${initial.title}` : 'Add designation'}>
      {!(initial && state.ok) && <FormMessage state={state} />}
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
        <TextField idPrefix={p} name="title" label="Title" required placeholder="Senior Engineer" defaultValue={v.title ?? initial?.title} error={e.title} />
        <TextField idPrefix={p} name="level" label="Level" type="number" min={0} max={50} inputMode="numeric" defaultValue={v.level ?? initial?.level ?? ''} error={e.level} />
        <Buttons editing={!!initial} onDone={onDone} />
      </div>
    </form>
  );
}

export function LocationForm({
  action, initial, onDone,
}: FormProps<{ code: string; name: string; city: string | null; stateCode: string | null }>) {
  const [state, formAction] = useActionState(action, initialActionState);
  useCloseOnSuccess(state, onDone);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const p = initial ? `loc-${initial.id}` : 'loc';
  return (
    <form action={formAction} noValidate className={formClass} aria-label={initial ? `Edit location ${initial.name}` : 'Add location'}>
      {!(initial && state.ok) && <FormMessage state={state} />}
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-[110px_1fr_1fr_90px_auto] sm:items-end">
        <TextField idPrefix={p} name="code" label="Code" required placeholder="BLR" defaultValue={v.code ?? initial?.code} error={e.code} />
        <TextField idPrefix={p} name="name" label="Location name" required placeholder="Bengaluru office" defaultValue={v.name ?? initial?.name} error={e.name} />
        <TextField idPrefix={p} name="city" label="City" defaultValue={v.city ?? initial?.city ?? ''} error={e.city} />
        <TextField idPrefix={p} name="stateCode" label="State" placeholder="KA" defaultValue={v.stateCode ?? initial?.stateCode ?? ''} error={e.stateCode} />
        <Buttons editing={!!initial} onDone={onDone} />
      </div>
    </form>
  );
}
