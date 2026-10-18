'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function EscalationForm({ action, stepId, label, hours }: { action: Action; stepId: string; label: string; hours: number | null }) {
  return (
    <ActionForm action={action} label={`Escalation for ${label}`} submit="Save" hidden={{ stepId }} variant="secondary" size="sm"
      className="flex flex-wrap items-end gap-3">
      {(v, e) => (
        <TextField idPrefix={`esc-${stepId}`} name="hours" label="Escalate after (hours)" inputMode="numeric" placeholder="Never"
          defaultValue={v.hours ?? (hours === null ? '' : String(hours))} error={e.hours} className="w-48" />
      )}
    </ActionForm>
  );
}

export function DelegateForm({ action, people, today }: { action: Action; people: Option[]; today: string }) {
  return (
    <ActionForm action={action} label="Delegate your approvals" submit="Delegate" className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <SelectField idPrefix="dlg" name="delegateId" label="Colleague" required options={people} placeholder="Choose…"
            defaultValue={v.delegateId ?? ''} error={e.delegateId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="dlg" name="startsOn" label="From" type="date" required min={today} defaultValue={v.startsOn ?? today} error={e.startsOn} />
            <TextField idPrefix="dlg" name="endsOn" label="To" type="date" required min={today} defaultValue={v.endsOn ?? ''} error={e.endsOn} />
          </div>
          <TextField idPrefix="dlg" name="note" label="Note" placeholder="On leave; back on Monday" defaultValue={v.note ?? ''} error={e.note} />
        </>
      )}
    </ActionForm>
  );
}
