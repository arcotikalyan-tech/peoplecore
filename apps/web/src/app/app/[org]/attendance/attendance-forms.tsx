'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { describePenalty, PENALTY_METHOD_LABELS, PENALTY_METHODS, SHORT_HOURS_METHODS, type PenaltyMethod } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';
import type { RuleValues } from './rule-values';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Check in / check out. Each click gets its own punch id, so a retry after a network error is recorded once.
 * The location is sent when the browser allows it; without it the punch still counts (and may be flagged
 * for review where the workplace has a geofence).
 */
export function PunchButton({ action, label, selfie: needsSelfie = false }: { action: Action; label: string; selfie?: boolean }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [pending, startTransition] = useTransition();
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  // Show the camera when the rule asks for a selfie, or once a check-in was refused for lack of one.
  const askSelfie = needsSelfie || (!state.ok && /selfie/i.test(state.message ?? ''));

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
    if (photo) fd.set('selfie', photo);
    startTransition(() => formAction(fd));
  }

  return (
    <div className="space-y-2">
      {askSelfie && <SelfieCamera onPhoto={setPhoto} />}
      <Button onClick={punch} disabled={pending || locating || (askSelfie && !photo)}>{locating ? 'Getting location…' : pending ? 'Recording…' : label}</Button>
      <FormMessage state={state} />
    </div>
  );
}

/**
 * The selfie for a check-in: the device's camera, live (front camera where there is one): open it, take the photo,
 * retake if needed. A browser without a camera (or that refuses it) can choose a photo instead.
 */
function SelfieCamera({ onPhoto }: { onPhoto: (file: File | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [noCamera, setNoCamera] = useState(false);
  const [live, setLive] = useState(false); // the camera's picture is showing (only then can a photo be taken)

  useEffect(() => {
    if (stream && video.current) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => undefined);
    }
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  async function open() {
    setPreview(null);
    setLive(false);
    onPhoto(null);
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false }));
    } catch {
      setNoCamera(true);
    }
  }

  function take() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(720, v.videoWidth);
    canvas.height = Math.round((v.videoHeight * canvas.width) / v.videoWidth);
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
    setPreview(canvas.toDataURL('image/jpeg', 0.8));
    canvas.toBlob((blob) => { if (blob) onPhoto(new File([blob], 'selfie.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.8);
    setStream(null);
    setLive(false);
  }

  if (noCamera) {
    return (
      <label className="block text-sm">📸 Your attendance rule needs a selfie, and this browser can’t open the camera. Take or choose a photo:
        <input type="file" accept="image/jpeg,image/png" capture="user" aria-label="Selfie" onChange={(e) => onPhoto(e.target.files?.[0] ?? null)} className="mt-1 block text-sm" />
      </label>
    );
  }
  return (
    <div className="space-y-2 text-sm" aria-label="Selfie">
      <p className="text-muted">📸 Your attendance rule needs a selfie with each check-in and check-out.</p>
      {stream && <video ref={video} playsInline muted aria-label="Camera preview" onPlaying={() => setLive(true)} className="w-full max-w-xs -scale-x-100 rounded-lg bg-black" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- a photo just taken, as a data URL */}
      {preview && <img src={preview} alt="Your selfie" className="w-full max-w-xs -scale-x-100 rounded-lg" />}
      <div className="flex flex-wrap gap-2">
        {stream ? <Button type="button" size="sm" onClick={take} disabled={!live}>{live ? 'Take photo' : 'Starting camera…'}</Button>
          : <Button type="button" size="sm" variant="secondary" onClick={() => void open()}>{preview ? 'Retake' : 'Open camera'}</Button>}
      </div>
    </div>
  );
}

export function RotationForm({ action, shifts, today, rotation }: {
  action: Action; shifts: Option[]; today: string; rotation?: { id: string; name: string; period_days: number; start_date: string; pattern: string[] };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [steps, setSteps] = useState(rotation?.pattern.length ?? 2);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const id = rotation?.id ?? 'new';
  return (
    <form action={formAction} noValidate aria-label={rotation ? `Edit rotation ${rotation.name}` : 'New rotation'} className="space-y-3 px-5 py-4">
      <FormMessage state={state} />
      {rotation && <input type="hidden" name="rotationId" value={rotation.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField idPrefix={`rot-${id}`} name="name" label="Rotation" required placeholder="Weekly day/late swap" defaultValue={v.name ?? rotation?.name} error={e.name} />
        <TextField idPrefix={`rot-${id}`} name="periodDays" label="Switch every (days)" inputMode="numeric" defaultValue={v.periodDays ?? String(rotation?.period_days ?? 7)} error={e.periodDays} />
        <TextField idPrefix={`rot-${id}`} name="startDate" label="First day" type="date" defaultValue={v.startDate ?? rotation?.start_date ?? today} error={e.startDate}
          hint="The rotation’s effective date: its first shift starts here." />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: steps }, (_, i) => <SelectField key={i} idPrefix={`rot-${id}-${i}`} name="shiftId" label={`Shift ${i + 1}`} options={shifts} placeholder="Choose…"
          defaultValue={rotation?.pattern[i] ?? ''} />)}
      </div>
      <div className="flex items-center gap-3">
        {steps < 12 && <button type="button" onClick={() => setSteps((n) => n + 1)} className="text-xs text-primary">＋ Add shift</button>}
        {steps > 2 && <button type="button" onClick={() => setSteps((n) => n - 1)} className="text-xs text-muted">− Remove the last</button>}
        <SubmitButton size="sm">{rotation ? 'Save rotation' : 'Create rotation'}</SubmitButton>
      </div>
    </form>
  );
}

export function AssignRotationForm({ action, rotations, employees, today }: { action: Action; rotations: Option[]; employees: Option[]; today: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Assign a rotation" className="grid items-end gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
      <div className="sm:col-span-4"><FormMessage state={state} /></div>
      <SelectField idPrefix="ra" name="employeeId" label="Employee" options={employees} placeholder="Choose…" defaultValue={v.employeeId} error={e.employeeId} />
      <SelectField idPrefix="ra" name="rotationId" label="Rotation" options={rotations} placeholder="Choose…" defaultValue={v.rotationId} error={e.rotationId} />
      <TextField idPrefix="ra" name="effectiveFrom" label="From" type="date" defaultValue={v.effectiveFrom ?? today} error={e.effectiveFrom} />
      <SubmitButton size="sm" variant="secondary">Assign</SubmitButton>
    </form>
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

const RULE_SECTIONS = [['schedule', 'Schedule'], ['verification', 'Verification'], ['behaviour', 'Behaviour & anomaly'], ['penalties', 'Penalties']] as const;

/** One attendance rule. Every section's fields stay in the form (hidden ones too), so one save covers all of them. */
export function RuleEditor({ action, rule, leaveTypes = [], readOnly = false }: { action?: Action; rule: RuleValues; leaveTypes?: Option[]; readOnly?: boolean }) {
  const [state, formAction] = useActionState(action ?? noAction, initialActionState);
  const [section, setSection] = useState<(typeof RULE_SECTIONS)[number][0]>('schedule');
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const val = (k: string, fallback: string | number | null | undefined) => v[k] ?? (fallback === null || fallback === undefined ? '' : String(fallback));
  const box = (k: string, fallback: boolean) => (v[k] !== undefined ? v[k] === 'on' : fallback);
  const [ladder, setLadder] = useState<[string, string]>([v.penaltyLeave1 ?? rule.penalty_leave_order[0] ?? '', v.penaltyLeave2 ?? rule.penalty_leave_order[1] ?? '']);
  const ladderNames = ladder.filter(Boolean).map((id) => leaveTypes.find((t) => t.value === id)?.label ?? 'Leave');
  const check = (name: string, label: string, hint: string, on: boolean) => (
    <label key={name} className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={box(name, on)} className="mt-0.5 size-4 accent-primary" />
      <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
    </label>
  );
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
            {rule.is_default ? (
              <p className="self-end text-xs text-muted sm:col-span-2">The default rule applies to everyone without another rule, from the day they join.</p>
            ) : (
              <TextField idPrefix="rule" name="effectiveFrom" label="Effective date" type="date" className="sm:col-span-2 sm:max-w-xs"
                hint="People assigned to this rule follow it from this date; before it, the default rule applies. Empty: from their assignment."
                defaultValue={val('effectiveFrom', rule.effective_from)} error={e.effectiveFrom} />
            )}
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
          <p className="text-sm text-muted">How a check-in is verified. A web check-in that misses a check is refused; an offline mobile punch synced later is counted and flagged for review. Zones are drawn in Settings › Zones.</p>
          {check('verifySelfie', 'Selfie', 'A photo with each check-in.', rule.verify_selfie)}
          {check('verifyGeofence', 'Location (zones)', 'Inside one of the zones of the person’s office: a circle, a rectangle or a polygon.', rule.verify_geofence)}
          {check('verifyIp', 'Office network', 'From one of the office IP addresses in Settings.', rule.verify_ip)}
          <p className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Automatic clock-in and clock-out</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {check('autoClockIn', 'Clock in automatically at the in time', 'On working days, for people who haven’t punched within 4 hours of the start. Not on weekly offs, holidays or full-day leave.', rule.auto_clock_in)}
            {check('autoClockOut', 'Clock out automatically at the out time', 'For people still checked in when the shift ends.', rule.auto_clock_out)}
          </div>
        </div>
        <div hidden={section !== 'behaviour'} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField idPrefix="rule" name="overtimeAfterMinutes" label="Overtime after (minutes beyond a full day)" type="number" min={0} max={720}
              hint="Leave empty for no overtime. Overtime waits for the manager’s approval." defaultValue={val('overtimeAfterMinutes', rule.overtime_after_minutes)} error={e.overtimeAfterMinutes} />
            <TextField idPrefix="rule" name="compOffMinMinutes" label="Comp-off for work on an off day (minimum minutes)" type="number" min={60} max={1440}
              hint="Leave empty for no comp-off. A full day’s work earns 1 day, less earns half." defaultValue={val('compOffMinMinutes', rule.comp_off_min_minutes)} error={e.compOffMinMinutes} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {check('compOffAutoApprove', 'Approve comp-off automatically', 'Otherwise it waits for HR or the manager in Logs › Comp-off before it reaches the leave balance.', rule.comp_off_auto_approve)}
            {check('deductAbsent', 'Automatic deduction at the end of each cycle', 'The morning after the attendance cycle ends, this rule’s penalties are applied and absent days are deducted from salary.', rule.deduct_absent)}
          </div>
        </div>
        <div hidden={section !== 'penalties'} className="space-y-4">
          {check('penaltiesEnabled', 'Penalty rules', 'Master switch for this rule’s late-coming, early-leaving and short-hours penalties. They are applied per attendance cycle: automatically at its end with automatic deduction, or from Logs › Penalties.', rule.penalties_enabled)}
          <div className="grid gap-4 lg:grid-cols-3">
            <PenaltyCard kind="late" title="🕘 Late coming" noun="late arrivals" v={v} e={e} ladder={ladderNames}
              allowed={rule.late_marks_allowed} step={rule.late_interval} method={rule.late_method} />
            <PenaltyCard kind="early" title="🏃 Early leaving" noun="early exits" v={v} e={e} ladder={ladderNames}
              allowed={rule.early_marks_allowed} step={rule.early_interval} method={rule.early_method} />
            <PenaltyCard kind="short" title="⏳ Short hours" noun="short days" v={v} e={e} ladder={ladderNames} shortHours
              allowed={rule.short_marks_allowed} step={rule.short_interval} method={rule.short_method} />
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <SelectField idPrefix="rule" name="penaltyLeave1" label="Deduct from first" placeholder="Loss of pay" options={leaveTypes}
              value={ladder[0]} onChange={(ev) => setLadder([ev.target.value, ev.target.value ? ladder[1] : ''])} error={e.penaltyLeave1} />
            <SelectField idPrefix="rule" name="penaltyLeave2" label="Then from" placeholder={ladder[0] ? 'Loss of pay' : '—'} options={leaveTypes.filter((t) => t.value !== ladder[0])}
              value={ladder[1]} disabled={!ladder[0]} onChange={(ev) => setLadder([ladder[0], ev.target.value])} error={e.penaltyLeave2} />
            <p className="pb-2.5 text-sm text-muted">→ then loss of pay</p>
          </div>
          <p className="text-xs text-muted">Order: late coming, then early leaving, then short hours. With full- or half-day deductions a day counted by a higher rule isn’t counted again; hourly rules count every day they apply to. Leave is used while there’s a balance.</p>
        </div>
        {!readOnly && <SubmitButton pendingLabel="Saving…">{rule.id ? 'Save changes' : 'Create rule'}</SubmitButton>}
      </fieldset>
    </form>
  );
}

/** One penalty rule: the allowance, the interval and the method, with what they mean in a sentence. */
function PenaltyCard({ kind, title, noun, allowed, step, method, v, e, ladder, shortHours = false }: {
  kind: 'late' | 'early' | 'short'; title: string; noun: string; allowed: number | null; step: number; method: string;
  v: Record<string, string>; e: Record<string, string>; ladder: string[]; shortHours?: boolean;
}) {
  const [a, setA] = useState(v[`${kind}MarksAllowed`] ?? (allowed === null ? '' : String(allowed)));
  const [n, setN] = useState(v[`${kind}Interval`] ?? String(step));
  const [m, setM] = useState(v[`${kind}Method`] ?? method);
  const methods = (shortHours ? SHORT_HOURS_METHODS : PENALTY_METHODS).map((x) => ({ value: x, label: PENALTY_METHOD_LABELS[x] }));
  return (
    <div role="group" aria-label={title.replace(/^\S+\s/, '')} className="space-y-3 rounded-xl border border-line p-4">
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <TextField idPrefix="rule" name={`${kind}MarksAllowed`} label="Allowed per cycle" type="number" min={0} max={31} placeholder="Off"
          value={a} onChange={(ev) => setA(ev.target.value)} error={e[`${kind}MarksAllowed`]} />
        <TextField idPrefix="rule" name={`${kind}Interval`} label="Then one per" type="number" min={1} max={31} disabled={m === 'hourly' || m === 'half_day_by_duration'}
          value={n} onChange={(ev) => setN(ev.target.value)} error={e[`${kind}Interval`]} />
      </div>
      <SelectField idPrefix="rule" name={`${kind}Method`} label="Deduction" options={methods} value={m} onChange={(ev) => setM(ev.target.value)} error={e[`${kind}Method`]} />
      {(m === 'hourly' || m === 'half_day_by_duration') && <input type="hidden" name={`${kind}Interval`} value={n || '1'} />}
      <p className="text-xs text-muted" aria-live="polite">
        {describePenalty(a === '' ? null : Number(a), Math.max(1, Number(n) || 1), m as PenaltyMethod, noun, ladder)}
      </p>
    </div>
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
  daily_summary: boolean;
  punch_reminders: boolean;
  comp_off_notify_employee: boolean;
  comp_off_notify_hr: boolean;
  regularize_days_back: number;
  regularize_monthly_limit: number | null;
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
  const heading = (t: string) => <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{t}</p>;
  return (
    <form action={formAction} noValidate aria-label="Attendance settings" className="space-y-5">
      <FormMessage state={state} />
      <TextField idPrefix="aset" name="cycleStartDay" label="Attendance cycle starts on day" type="number" min={1} max={28} className="max-w-xs"
        hint="1 for calendar months; 26 for a 26th–25th cycle. The same setting as payroll’s attendance and leave cycle; penalties are counted per cycle."
        defaultValue={v.cycleStartDay ?? String(settings.cycle_start_day)} error={e.cycleStartDay} />
      {heading('Reminders')}
      <div className="grid gap-3 sm:grid-cols-2">
        {toggle('remindMissingCheckout', 'Missing check-out reminder', 'At 10 am, to people who checked in yesterday but not out.', settings.remind_missing_checkout)}
        {toggle('pendingDigest', 'Pending approvals digest', 'At 9 am, to approvers with regularizations or requests waiting.', settings.pending_digest)}
        {toggle('latePunchAlert', 'Late arrivals to managers', 'At 11 am, the people in each manager’s team who are late today.', settings.late_punch_alert)}
        {toggle('punchReminders', 'Late / early punch reminder', 'At 11 am, to people who checked in late today or out early yesterday.', settings.punch_reminders)}
        {toggle('dailySummary', 'Daily attendance summary', 'At 9 am, yesterday’s present, late, on leave and absent counts to attendance admins.', settings.daily_summary)}
        {toggle('compOffNotifyEmployee', 'Comp-off for employees', 'Tell people when they earn comp-off and when it’s credited to claim.', settings.comp_off_notify_employee)}
        {toggle('compOffNotifyHr', 'Comp-off for HR', 'Tell attendance admins when someone earns comp-off by working an off day.', settings.comp_off_notify_hr)}
      </div>
      {heading('Approvals and regularization')}
      <div className="grid gap-3 sm:grid-cols-2">
        {toggle('skipLevelApproval', 'Skip-level approval', 'Route requests to the manager’s manager when the manager is away.', settings.skip_level_approval)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField idPrefix="aset" name="regularizeDaysBack" label="Employees can regularize up to (days back)" type="number" min={1} max={90}
          hint="1–90. Attendance admins can always go back 90 days." defaultValue={v.regularizeDaysBack ?? String(settings.regularize_days_back)} error={e.regularizeDaysBack} />
        <TextField idPrefix="aset" name="regularizeMonthlyLimit" label="Regularizations per person per month" type="number" min={1} max={31} placeholder="No limit"
          hint="Pending and approved requests count." defaultValue={v.regularizeMonthlyLimit ?? (settings.regularize_monthly_limit === null ? '' : String(settings.regularize_monthly_limit))} error={e.regularizeMonthlyLimit} />
      </div>
      <TextField idPrefix="aset" name="allowedIps" label="Office IP addresses" placeholder="203.0.113.10, 198.51.100.0/24"
        hint="Used by rules that verify the office network. Separate with commas or spaces." defaultValue={v.allowedIps ?? settings.allowed_ips.join(', ')} error={e.allowedIps} />
      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </form>
  );
}
