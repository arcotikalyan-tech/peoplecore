'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Inline "add" forms. Element ids are prefixed per form (idPrefix) so they stay unique on one page. */

export function DepartmentForm({ action, parents }: { action: Action; parents: Option[] }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate className="space-y-3 border-t border-line bg-subtle/40 px-5 py-4">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[120px_1fr_1fr_auto] sm:items-end">
        <TextField idPrefix="dept" name="code" label="Code" required placeholder="ENG" defaultValue={v.code} error={e.code} />
        <TextField idPrefix="dept" name="name" label="Department name" required placeholder="Engineering" defaultValue={v.name} error={e.name} />
        <SelectField idPrefix="dept" name="parentId" label="Parent department" options={parents} placeholder="None (top level)" defaultValue={v.parentId} error={e.parentId} />
        <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}

export function DesignationForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate className="space-y-3 border-t border-line bg-subtle/40 px-5 py-4">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
        <TextField idPrefix="desig" name="title" label="Title" required placeholder="Senior Engineer" defaultValue={v.title} error={e.title} />
        <TextField idPrefix="desig" name="level" label="Level" type="number" min={0} max={50} inputMode="numeric" defaultValue={v.level} error={e.level} />
        <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}

export function LocationForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate className="space-y-3 border-t border-line bg-subtle/40 px-5 py-4">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[110px_1fr_1fr_90px_auto] sm:items-end">
        <TextField idPrefix="loc" name="code" label="Code" required placeholder="BLR" defaultValue={v.code} error={e.code} />
        <TextField idPrefix="loc" name="name" label="Location name" required placeholder="Bengaluru office" defaultValue={v.name} error={e.name} />
        <TextField idPrefix="loc" name="city" label="City" defaultValue={v.city} error={e.city} />
        <TextField idPrefix="loc" name="stateCode" label="State" placeholder="KA" defaultValue={v.stateCode} error={e.stateCode} />
        <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}
