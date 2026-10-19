'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Counted = ActionState & { n?: number };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function useCounted(action: Action) {
  const [state, formAction] = useActionState<Counted, FormData>(async (prev, fd) => ({ ...(await action(prev, fd)), n: (prev.n ?? 0) + 1 }), initialActionState);
  return { state, formAction, n: state.n ?? 0, v: state.ok ? {} : (state.values ?? {}), e: state.fieldErrors ?? {} };
}

export function HolidayForm({ action, calendarId, year }: { action: Action; calendarId: string; year: string }) {
  const { state, formAction, n, v, e } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="Add holiday" className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="calendarId" value={calendarId} />
      <div key={n} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_9rem]">
        <TextField idPrefix="hol" name="date" label="Date" type="date" required min={`${year}-01-01`} defaultValue={v.date ?? ''} error={e.date} />
        <TextField idPrefix="hol" name="name" label="Holiday" required placeholder="Diwali" defaultValue={v.name ?? ''} error={e.name} />
        <SelectField idPrefix="hol" name="kind" label="Type" options={[{ value: 'public', label: 'Public' }, { value: 'optional', label: 'Optional' }]} defaultValue={v.kind ?? 'public'} />
        <TextField idPrefix="hol" name="description" label="Description" className="sm:col-span-3" placeholder="Optional note" defaultValue={v.description ?? ''} error={e.description} />
      </div>
      <SubmitButton size="sm">＋ Add holiday</SubmitButton>
    </form>
  );
}

export function CalendarForm({ action, calendar, locations }: {
  action: Action;
  calendar?: { id: string; name: string; weekly_offs: number[]; optional_limit: number };
  locations?: Array<{ value: string; label: string }>;
}) {
  const { state, formAction, n, v, e } = useCounted(action);
  const id = calendar?.id ?? 'new';
  return (
    <form action={formAction} noValidate aria-label={calendar ? `Calendar ${calendar.name}` : 'Add calendar'} className="space-y-3">
      <FormMessage state={state} />
      {calendar && <input type="hidden" name="calendarId" value={calendar.id} />}
      <div key={calendar ? 0 : n} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        {!calendar && locations && <SelectField idPrefix={`cal-${id}`} name="locationId" label="Location" required options={locations} placeholder="Choose a location…" defaultValue={v.locationId ?? ''} className="sm:col-span-2" />}
        <TextField idPrefix={`cal-${id}`} name="name" label="Calendar name" required defaultValue={v.name ?? calendar?.name ?? ''} error={e.name} />
        <TextField idPrefix={`cal-${id}`} name="optionalLimit" label="Optional holidays a year" inputMode="numeric" defaultValue={v.optionalLimit ?? String(calendar?.optional_limit ?? 2)} error={e.optionalLimit} />
      </div>
      <fieldset><legend className="mb-1 text-xs font-medium text-muted">Weekly offs</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-sm">
              <input type="checkbox" name="off" value={i} defaultChecked={(calendar?.weekly_offs ?? [0, 6]).includes(i)} className="size-4 rounded border-line-strong accent-primary" />{d}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton size="sm" variant={calendar ? 'secondary' : 'primary'}>{calendar ? 'Save' : '＋ Add calendar'}</SubmitButton>
    </form>
  );
}

export function SmallAction({ action, fields, label, aria, variant = 'ghost' }: { action: Action; fields: Record<string, string>; label: string; aria: string; variant?: 'ghost' | 'secondary' | 'primary' }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={aria} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
      <SubmitButton size="sm" variant={variant} pendingLabel="…">{label}</SubmitButton>
    </form>
  );
}

export function ImportHolidaysForm({ action, calendarId, exportHref }: { action: Action; calendarId: string; exportHref: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Import holidays" className="space-y-2 rounded-xl border border-dashed border-line p-3">
      <FormMessage state={state} />
      <input type="hidden" name="calendarId" value={calendarId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm"><span className="mb-1 block text-xs font-medium text-muted">Import holidays (CSV: date, name, type, description)</span>
          <input type="file" name="file" accept=".csv,text/csv" aria-label="Holidays file" className="block w-full text-sm" /></label>
        <a href={exportHref} className="text-sm text-primary hover:underline" download>⬇ Export</a>
        <SubmitButton size="sm" pendingLabel="Importing…">⬆ Import</SubmitButton>
      </div>
    </form>
  );
}
