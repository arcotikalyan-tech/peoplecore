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

// ─── Attendance operations ──────────────────────────────────────────────────

export function AttendanceRequestForm({ action, minDate, maxDate }: { action: Action; minDate: string; maxDate: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Request work from home or on duty" className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField idPrefix="areq" name="kind" label="Type" required defaultValue={v.kind ?? 'wfh'} error={e.kind}
          options={[{ value: 'wfh', label: 'Work from home' }, { value: 'on_duty', label: 'On duty (client site, travel)' }]} />
        <TextField idPrefix="areq" name="startDate" label="From" type="date" min={minDate} max={maxDate} required defaultValue={v.startDate} error={e.startDate} />
        <TextField idPrefix="areq" name="endDate" label="To" type="date" min={minDate} max={maxDate} required defaultValue={v.endDate} error={e.endDate} />
      </div>
      <TextField idPrefix="areq" name="reason" label="Reason" required placeholder="Waiting for a delivery" defaultValue={v.reason} error={e.reason} />
      <SubmitButton pendingLabel="Requesting…">Send request</SubmitButton>
    </form>
  );
}

export interface RuleValues {
  id?: string;
  name: string;
  description: string | null;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  early_grace_minutes: number;
  full_day_minutes: number;
  half_day_minutes: number;
  verify_selfie: boolean;
  verify_geofence: boolean;
  verify_ip: boolean;
  overtime_after_minutes: number | null;
  comp_off_min_minutes: number | null;
  late_marks_allowed: number | null;
  late_penalty_days: number;
}

const RULE_SECTIONS = [['schedule', 'Schedule'], ['verification', 'Verification'], ['behaviour', 'Behaviour & anomaly'], ['penalties', 'Penalties']] as const;

/** One attendance rule. Every section's fields stay in the form (hidden ones too), so one save covers all of them. */
export function RuleEditor({ action, rule, readOnly = false }: { action?: Action; rule: RuleValues; readOnly?: boolean }) {
  const [state, formAction] = useActionState(action ?? noAction, initialActionState);
  const [section, setSection] = useState<(typeof RULE_SECTIONS)[number][0]>('schedule');
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const val = (k: string, fallback: string | number | null | undefined) => v[k] ?? (fallback === null || fallback === undefined ? '' : String(fallback));
  const box = (k: string, fallback: boolean) => (v[k] !== undefined ? v[k] === 'on' : fallback);
  return (
    <form action={formAction} noValidate aria-label={rule.id ? `Edit rule ${rule.name}` : 'New attendance rule'}>
      <fieldset disabled={readOnly} className="space-y-5">
        {rule.id && <input type="hidden" name="ruleId" value={rule.id} />}
        <FormMessage state={state} />
        <div role="tablist" aria-label="Rule sections" className="flex flex-wrap gap-4 border-b border-line">
          {RULE_SECTIONS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={section === key} onClick={() => setSection(key)}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium ${section === key ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
              {label}
            </button>
          ))}
        </div>
        <div hidden={section !== 'schedule'} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField idPrefix="rule" name="name" label="Rule name" required defaultValue={val('name', rule.name)} error={e.name} />
            <TextField idPrefix="rule" name="description" label="Description" defaultValue={val('description', rule.description)} error={e.description} />
            <TextField idPrefix="rule" name="startTime" label="In time" type="time" required defaultValue={val('startTime', rule.start_time.slice(0, 5))} error={e.startTime} />
            <TextField idPrefix="rule" name="endTime" label="Out time" type="time" required defaultValue={val('endTime', rule.end_time.slice(0, 5))} error={e.endTime} />
            <TextField idPrefix="rule" name="graceMinutes" label="In-time grace (minutes)" type="number" min={0} max={240} hint="Arrivals within this many minutes aren’t late." defaultValue={val('graceMinutes', rule.grace_minutes)} error={e.graceMinutes} />
            <TextField idPrefix="rule" name="earlyGraceMinutes" label="Out-time grace (minutes)" type="number" min={0} max={240} hint="Leaving this much early isn’t an early exit." defaultValue={val('earlyGraceMinutes', rule.early_grace_minutes)} error={e.earlyGraceMinutes} />
            <TextField idPrefix="rule" name="breakMinutes" label="Break (minutes)" type="number" min={0} max={240} hint="Deducted from worked time on days longer than a half day." defaultValue={val('breakMinutes', rule.break_minutes)} error={e.breakMinutes} />
            <div className="grid grid-cols-2 gap-3">
              <TextField idPrefix="rule" name="fullDayMinutes" label="Full day (minutes)" type="number" min={60} max={1440} defaultValue={val('fullDayMinutes', rule.full_day_minutes)} error={e.fullDayMinutes} />
              <TextField idPrefix="rule" name="halfDayMinutes" label="Half day (minutes)" type="number" min={30} max={1440} defaultValue={val('halfDayMinutes', rule.half_day_minutes)} error={e.halfDayMinutes} />
            </div>
          </div>
        </div>
        <div hidden={section !== 'verification'} className="space-y-3">
          <p className="text-sm text-muted">How a check-in must be verified. Punches that miss a check are flagged for review, never refused.</p>
          {([['verifySelfie', 'Selfie', 'A photo with each mobile punch.', rule.verify_selfie],
            ['verifyGeofence', 'Location (geofence)', 'Inside the geofence of the person’s office.', rule.verify_geofence],
            ['verifyIp', 'Office network', 'From one of the office IP addresses in Settings.', rule.verify_ip]] as const).map(([name, label, hint, on]) => (
            <label key={name} className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
              <input type="checkbox" name={name} defaultChecked={box(name, on)} className="mt-0.5 size-4 accent-primary" />
              <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
            </label>
          ))}
        </div>
        <div hidden={section !== 'behaviour'} className="grid gap-4 sm:grid-cols-2">
          <TextField idPrefix="rule" name="overtimeAfterMinutes" label="Overtime after (minutes beyond a full day)" type="number" min={0} max={720}
            hint="Leave empty for no overtime. Overtime waits for the manager’s approval." defaultValue={val('overtimeAfterMinutes', rule.overtime_after_minutes)} error={e.overtimeAfterMinutes} />
          <TextField idPrefix="rule" name="compOffMinMinutes" label="Comp-off for work on an off day (minimum minutes)" type="number" min={60} max={1440}
            hint="Leave empty for no comp-off. A full day’s work earns 1 day, less earns half." defaultValue={val('compOffMinMinutes', rule.comp_off_min_minutes)} error={e.compOffMinMinutes} />
        </div>
        <div hidden={section !== 'penalties'} className="grid gap-4 sm:grid-cols-2">
          <TextField idPrefix="rule" name="lateMarksAllowed" label="Late marks allowed per month" type="number" min={0} max={31}
            hint="Leave empty for no late-mark penalty." defaultValue={val('lateMarksAllowed', rule.late_marks_allowed)} error={e.lateMarksAllowed} />
          <SelectField idPrefix="rule" name="latePenaltyDays" label="Each late mark beyond that costs" defaultValue={val('latePenaltyDays', String(rule.late_penalty_days))}
            options={[{ value: '0.5', label: 'Half a day of pay' }, { value: '1', label: 'A full day of pay' }]} error={e.latePenaltyDays} />
        </div>
        {!readOnly && <SubmitButton pendingLabel="Saving…">{rule.id ? 'Save changes' : 'Create rule'}</SubmitButton>}
      </fieldset>
    </form>
  );
}

const noAction: Action = async () => initialActionState;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NEXT: Record<string, string> = { W: 'H', H: 'O', O: 'W' };
const CELL: Record<string, string> = { W: 'bg-success/80 text-black', H: 'bg-warning/80 text-black', O: 'bg-danger/80 text-white' };
const CELL_LABEL: Record<string, string> = { W: 'Working day', H: 'Half day', O: 'Weekly off' };

/** The 5-week grid. Click a day to cycle working → half day → off. Read-only when no action is given. */
export function WorkWeekGrid({ pattern, action, id, name, description }: { pattern: string[]; action?: Action; id?: string; name?: string; description?: string | null }) {
  const [cells, setCells] = useState(pattern);
  const [state, formAction] = useActionState(action ?? noAction, initialActionState);
  const flip = (w: number, d: number) => setCells((c) => c.map((row, i) => (i === w ? row.slice(0, d) + NEXT[row[d]!] + row.slice(d + 1) : row)));
  const grid = (
    <table className="w-full max-w-xl border-separate border-spacing-1 text-center text-xs">
      <caption className="sr-only">Work week pattern</caption>
      <thead><tr><th className="w-16 text-left font-medium text-muted">Week</th>{DAY_NAMES.map((d) => <th key={d} className="font-medium text-muted">{d}</th>)}</tr></thead>
      <tbody>
        {cells.map((row, w) => (
          <tr key={w}>
            <th className="text-left font-medium text-muted">{w + 1}</th>
            {[...row].map((c, d) => (
              <td key={d}>
                {action ? (
                  <button type="button" onClick={() => flip(w, d)} aria-label={`Week ${w + 1} ${DAY_NAMES[d]}: ${CELL_LABEL[c]}`}
                    className={`h-8 w-full rounded-md font-semibold ${CELL[c]}`}>{c}</button>
                ) : (
                  <span className={`grid h-8 place-items-center rounded-md font-semibold ${CELL[c]}`} title={CELL_LABEL[c]}>{c}</span>
                )}
                {action && <input type="hidden" name={`d${w + 1}${d + 1}`} value={c} />}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  const legend = (
    <p className="flex flex-wrap gap-4 text-xs text-muted">
      {Object.entries(CELL_LABEL).map(([k, l]) => <span key={k} className="flex items-center gap-1.5"><span className={`size-3 rounded ${CELL[k]}`} />{l}</span>)}
      <span>Week 1 is the 1st–7th of the month, week 5 the 29th onwards.</span>
    </p>
  );
  if (!action) return <div className="space-y-3">{grid}{legend}</div>;
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label={id ? `Edit work week ${name}` : 'New work week'} className="space-y-4">
      <FormMessage state={state} />
      {id && <input type="hidden" name="weekId" value={id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField idPrefix={`ww-${id ?? 'new'}`} name="name" label="Name" required defaultValue={v.name ?? name ?? ''} error={e.name} />
        <TextField idPrefix={`ww-${id ?? 'new'}`} name="description" label="Description" defaultValue={v.description ?? description ?? ''} error={e.description} />
      </div>
      {grid}
      {legend}
      <SubmitButton pendingLabel="Saving…">{id ? 'Save work week' : 'Create work week'}</SubmitButton>
    </form>
  );
}

export function AssignWorkWeekForm({ action, weeks, employees, today }: { action: Action; weeks: Option[]; employees: Option[]; today: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [filter, setFilter] = useState('');
  const e = state.fieldErrors ?? {};
  const shown = employees.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()));
  return (
    <form action={formAction} noValidate aria-label="Assign a work week" className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField idPrefix="wwa" name="weekId" label="Work week" required options={weeks} error={e.weekId} />
        <TextField idPrefix="wwa" name="effectiveFrom" label="From" type="date" required defaultValue={today} error={e.effectiveFrom} />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">People</legend>
        <input value={filter} onChange={(ev) => setFilter(ev.target.value)} placeholder="Filter by name" aria-label="Filter people"
          className="mb-2 block h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />
        <div className="scroll-thin grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
          {employees.map((o) => (
            <label key={o.value} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-subtle" hidden={!shown.includes(o)}>
              <input type="checkbox" name="employeeIds" value={o.value} className="size-4 accent-primary" />{o.label}
            </label>
          ))}
        </div>
        {e.employeeIds && <p className="mt-1 text-xs font-medium text-danger">{e.employeeIds}</p>}
      </fieldset>
      <SubmitButton pendingLabel="Assigning…">Assign</SubmitButton>
    </form>
  );
}

export interface SettingsValues {
  cycle_start_day: number;
  remind_missing_checkout: boolean;
  pending_digest: boolean;
  late_punch_alert: boolean;
  skip_level_approval: boolean;
  allowed_ips: string[];
}

export function AttendanceSettingsForm({ action, settings }: { action: Action; settings: SettingsValues }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const toggle = (name: string, label: string, hint: string, on: boolean) => (
    <label key={name} className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={v[name] !== undefined ? v[name] === 'on' : on} className="mt-0.5 size-4 accent-primary" />
      <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
    </label>
  );
  return (
    <form action={formAction} noValidate aria-label="Attendance settings" className="space-y-5">
      <FormMessage state={state} />
      <TextField idPrefix="aset" name="cycleStartDay" label="Attendance cycle starts on day" type="number" min={1} max={28} className="max-w-xs"
        hint="1 for calendar months; 26 for a 26th–25th cycle." defaultValue={v.cycleStartDay ?? String(settings.cycle_start_day)} error={e.cycleStartDay} />
      <div className="grid gap-3 sm:grid-cols-2">
        {toggle('remindMissingCheckout', 'Missing check-out reminder', 'Remind people who checked in but not out.', settings.remind_missing_checkout)}
        {toggle('pendingDigest', 'Pending approvals digest', 'A daily summary of regularizations waiting for approvers.', settings.pending_digest)}
        {toggle('latePunchAlert', 'Late punch alert', 'Tell people when a punch is marked late.', settings.late_punch_alert)}
        {toggle('skipLevelApproval', 'Skip-level approval', 'Route requests to the manager’s manager when the manager is away.', settings.skip_level_approval)}
      </div>
      <TextField idPrefix="aset" name="allowedIps" label="Office IP addresses" placeholder="203.0.113.10, 198.51.100.0/24"
        hint="Used by rules that verify the office network. Separate with commas or spaces." defaultValue={v.allowedIps ?? settings.allowed_ips.join(', ')} error={e.allowedIps} />
      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </form>
  );
}
