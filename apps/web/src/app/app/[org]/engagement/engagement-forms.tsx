'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function PublishAnnouncementForm({ action, departments, locations, today }: { action: Action; departments: Option[]; locations: Option[]; today: string }) {
  return (
    <ActionForm action={action} label="Publish an announcement" submit="Publish" className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <TextField idPrefix="ann" name="title" label="Title" required placeholder="Office closed on Friday" defaultValue={v.title} error={e.title} />
          <TextAreaField idPrefix="ann" name="body" label="Message" required rows={5} defaultValue={v.body} error={e.body} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField idPrefix="ann" name="departmentId" label="Department" options={departments} placeholder="Everyone" defaultValue={v.departmentId ?? ''} />
            <SelectField idPrefix="ann" name="locationId" label="Location" options={locations} placeholder="Everywhere" defaultValue={v.locationId ?? ''} />
          </div>
          <TextField idPrefix="ann" name="showUntil" label="Show until" type="date" min={today} hint="Leave empty to keep it up." defaultValue={v.showUntil} error={e.showUntil} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requiresAck" defaultChecked={v.requiresAck === 'on'} className="size-4 rounded border-line-strong accent-primary" />
            Ask everyone to acknowledge it
          </label>
        </>
      )}
    </ActionForm>
  );
}

export function KudosForm({ action, colleagues }: { action: Action; colleagues: Option[] }) {
  return (
    <ActionForm action={action} label="Give kudos" submit="Send kudos" className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <SelectField idPrefix="kudos" name="to" label="Colleague" required options={colleagues} placeholder="Choose…" defaultValue={v.to ?? ''} error={e.to} />
          <TextAreaField idPrefix="kudos" name="message" label="What did they do?" required maxLength={500} defaultValue={v.message} error={e.message} />
        </>
      )}
    </ActionForm>
  );
}
