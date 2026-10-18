'use client';

import { useActionState, useState, useTransition } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Check in / check out. Each click gets its own punch id, so a retry after a network error is recorded once.
 * The location is sent when the browser allows it; without it the punch still counts (and may be flagged
 * for review where the workplace has a geofence).
 */
export function PunchButton({ action, label }: { action: Action; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [pending, startTransition] = useTransition();
  const [locating, setLocating] = useState(false);

  async function punch() {
    const fd = new FormData();
    fd.set('clientId', crypto.randomUUID());
    setLocating(true);
    const pos = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 4000, maximumAge: 60_000 });
    });
    setLocating(false);
    if (pos) {
      fd.set('latitude', pos.coords.latitude.toFixed(6));
      fd.set('longitude', pos.coords.longitude.toFixed(6));
      fd.set('accuracy', String(Math.round(pos.coords.accuracy)));
    }
    startTransition(() => formAction(fd));
  }

  return (
    <div className="space-y-2">
      <Button onClick={punch} disabled={pending || locating}>{locating ? 'Getting location…' : pending ? 'Recording…' : label}</Button>
      <FormMessage state={state} />
    </div>
  );
}

export function RegularizeForm({ action, maxDate }: { action: Action; maxDate: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Regularize a day" className="space-y-4 px-5 py-5">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField idPrefix="reg" name="workDate" label="Day" type="date" max={maxDate} required defaultValue={v.workDate} error={e.workDate} />
        <TextField idPrefix="reg" name="checkIn" label="Check-in" type="time" defaultValue={v.checkIn} error={e.checkIn} />
        <TextField idPrefix="reg" name="checkOut" label="Check-out" type="time" defaultValue={v.checkOut} error={e.checkOut} />
      </div>
      <TextField idPrefix="reg" name="reason" label="Reason" required placeholder="Forgot to check out" defaultValue={v.reason} error={e.reason} />
      <SubmitButton pendingLabel="Requesting…">Request regularization</SubmitButton>
    </form>
  );
}

export function ReviewAnomaly({ action, flagId, label }: { action: Action; flagId: string; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-2" aria-label={`Review: ${label}`}>
      <input type="hidden" name="flagId" value={flagId} />
      <button name="status" value="resolved" className="text-sm font-medium text-primary hover:underline">Resolve</button>
      <button name="status" value="dismissed" className="text-sm text-muted hover:underline">Dismiss</button>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

/** Settings forms share one shape: fields in a grid, a message, a submit button. */
function SettingsForm({ action, label, submit, children }: { action: Action; label: string; submit: string; children: (v: Record<string, string>, e: Record<string, string>) => React.ReactNode }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  return (
    <form action={formAction} noValidate aria-label={label} className="space-y-4 border-t border-line px-5 py-5">
      <FormMessage state={state} />
      {children(v, state.fieldErrors ?? {})}
      <SubmitButton pendingLabel="Saving…">{submit}</SubmitButton>
    </form>
  );
}

export function ShiftForm({ action }: { action: Action }) {
  return (
    <SettingsForm action={action} label="New shift" submit="Create shift">
      {(v, e) => (
        <div className="grid gap-4 sm:grid-cols-4">
          <TextField idPrefix="sh" name="code" label="Code" required placeholder="NIGHT" defaultValue={v.code} error={e.code} />
          <TextField idPrefix="sh" name="name" label="Name" required placeholder="Night shift" defaultValue={v.name} error={e.name} />
          <TextField idPrefix="sh" name="startTime" label="Starts" type="time" required defaultValue={v.startTime ?? '09:30'} error={e.startTime} />
          <TextField idPrefix="sh" name="endTime" label="Ends" type="time" required defaultValue={v.endTime ?? '18:30'} error={e.endTime} />
          <TextField idPrefix="sh" name="breakMinutes" label="Break (min)" inputMode="numeric" defaultValue={v.breakMinutes ?? '60'} error={e.breakMinutes} />
          <TextField idPrefix="sh" name="graceMinutes" label="Grace (min)" inputMode="numeric" defaultValue={v.graceMinutes ?? '15'} error={e.graceMinutes} />
          <TextField idPrefix="sh" name="fullDayMinutes" label="Full day (min)" inputMode="numeric" defaultValue={v.fullDayMinutes ?? '480'} error={e.fullDayMinutes} />
          <TextField idPrefix="sh" name="halfDayMinutes" label="Half day (min)" inputMode="numeric" defaultValue={v.halfDayMinutes ?? '240'} error={e.halfDayMinutes} />
        </div>
      )}
    </SettingsForm>
  );
}

export function RosterForm({ action, employees, shifts, today }: { action: Action; employees: Option[]; shifts: Option[]; today: string }) {
  return (
    <SettingsForm action={action} label="Assign a shift" submit="Assign">
      {(v, e) => (
        <div className="grid gap-4 sm:grid-cols-4">
          <SelectField idPrefix="ro" name="employeeId" label="Employee" required options={employees} placeholder="Choose…" defaultValue={v.employeeId ?? ''} error={e.employeeId} />
          <SelectField idPrefix="ro" name="shiftId" label="Shift" required options={shifts} placeholder="Choose…" defaultValue={v.shiftId ?? ''} error={e.shiftId} />
          <TextField idPrefix="ro" name="effectiveFrom" label="From" type="date" required defaultValue={v.effectiveFrom ?? today} error={e.effectiveFrom} />
          <TextField idPrefix="ro" name="effectiveTo" label="Until" type="date" defaultValue={v.effectiveTo} error={e.effectiveTo} />
        </div>
      )}
    </SettingsForm>
  );
}

export function GeofenceForm({ action, locations }: { action: Action; locations: Option[] }) {
  return (
    <SettingsForm action={action} label="New geofence" submit="Add geofence">
      {(v, e) => (
        <div className="grid gap-4 sm:grid-cols-5">
          <SelectField idPrefix="geo" name="locationId" label="Location" required options={locations} placeholder="Choose…" defaultValue={v.locationId ?? ''} error={e.locationId} />
          <TextField idPrefix="geo" name="name" label="Name" required placeholder="Main gate" defaultValue={v.name} error={e.name} />
          <TextField idPrefix="geo" name="latitude" label="Latitude" required inputMode="decimal" defaultValue={v.latitude} error={e.latitude} />
          <TextField idPrefix="geo" name="longitude" label="Longitude" required inputMode="decimal" defaultValue={v.longitude} error={e.longitude} />
          <TextField idPrefix="geo" name="radiusM" label="Radius (m)" required inputMode="numeric" defaultValue={v.radiusM ?? '200'} error={e.radiusM} />
        </div>
      )}
    </SettingsForm>
  );
}

export function DeviceForm({ action, locations }: { action: Action; locations: Option[] }) {
  return (
    <SettingsForm action={action} label="New device" submit="Add device">
      {(v, e) => (
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField idPrefix="dev" name="serialNumber" label="Serial number" required defaultValue={v.serialNumber} error={e.serialNumber} />
          <TextField idPrefix="dev" name="name" label="Name" required placeholder="Front door" defaultValue={v.name} error={e.name} />
          <SelectField idPrefix="dev" name="locationId" label="Location" options={locations} placeholder="None" defaultValue={v.locationId ?? ''} error={e.locationId} />
        </div>
      )}
    </SettingsForm>
  );
}

export function DeviceImportForm({ action, devices }: { action: Action; devices: Option[] }) {
  return (
    <SettingsForm action={action} label="Import device punches" submit="Import">
      {(v, e) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField idPrefix="imp" name="deviceId" label="Device" required options={devices} placeholder="Choose…" defaultValue={v.deviceId ?? ''} error={e.deviceId} />
          <TextField idPrefix="imp" name="file" label="CSV export" type="file" required accept=".csv,text/csv"
            hint="Columns: employee_code, punched_at (device local time), record_id. Records already imported are skipped." className="[&_input]:h-auto [&_input]:py-2" />
        </div>
      )}
    </SettingsForm>
  );
}
