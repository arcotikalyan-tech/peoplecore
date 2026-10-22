'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { parseZonePoints, ZONE_SHAPE_LABELS, ZONE_SHAPES, zoneMeasures, type LatLng, type ZoneShape } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** The browser's location, or null when it isn't allowed or takes too long. */
function locate(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 });
  });
}

export interface ZoneRow {
  id: string; location_id: string; name: string; shape: ZoneShape; latitude: number; longitude: number; radius_m: number | null;
  points: LatLng[] | null; is_active: boolean;
}

const area = (m2: number) => (m2 >= 10_000 ? `${(m2 / 10_000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString('en-IN')} m²`);
const length = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

/** The zone drawn to scale, north up, with an optional test point. */
function ZonePreview({ shape, centre, radius, points, test }: { shape: ZoneShape; centre: LatLng | null; radius: number; points: LatLng[]; test?: LatLng | null }) {
  const k = (Math.PI / 180) * 6371000;
  const ref = centre ?? points[0] ?? null;
  if (!ref) return <div className="grid h-40 place-items-center rounded-lg border border-dashed border-line text-xs text-muted">The zone appears here as you fill it in.</div>;
  const cos = Math.cos((ref[0] * Math.PI) / 180);
  const xy = ([la, lo]: LatLng) => [(lo - ref[1]) * k * cos, (la - ref[0]) * k] as const;
  const corners = shape === 'rectangle' && points.length === 2
    ? [points[0]!, [points[0]![0], points[1]![1]] as LatLng, points[1]!, [points[1]![0], points[0]![1]] as LatLng]
    : points;
  const shapePts = shape === 'circle' ? [] : corners.map(xy);
  const extra = test ? [xy(test)] : [];
  const all = shape === 'circle' && centre ? [[-radius, -radius], [radius, radius], ...extra] : [...shapePts, ...extra];
  if (all.length === 0) return null;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, 20);
  const W = 260;
  const H = 170;
  const scale = (Math.min(W, H) - 30) / span;
  const sx = (x: number) => W / 2 + (x - (minX + maxX) / 2) * scale;
  const sy = (y: number) => H / 2 - (y - (minY + maxY) / 2) * scale;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${ZONE_SHAPE_LABELS[shape]} zone preview`} className="h-44 w-full rounded-lg border border-line bg-subtle/40">
      {shape === 'circle' && centre
        ? <circle cx={sx(0)} cy={sy(0)} r={radius * scale} className="fill-primary/15 stroke-primary" strokeWidth={1.5} />
        : shapePts.length >= 2 && <polygon points={shapePts.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} className="fill-primary/15 stroke-primary" strokeWidth={1.5} />}
      {shapePts.map(([x, y], i) => <circle key={i} cx={sx(x)} cy={sy(y)} r={2.5} className="fill-primary" />)}
      {test && <g><circle cx={sx(xy(test)[0])} cy={sy(xy(test)[1])} r={4} className="fill-warning stroke-surface" strokeWidth={1.5} /></g>}
      <text x={8} y={14} className="fill-muted text-[9px]">N ↑</text>
      <text x={W - 8} y={H - 8} textAnchor="end" className="fill-muted text-[9px]">{length(span)} across</text>
    </svg>
  );
}

/** Add or edit a zone: a circle (centre and radius), a rectangle (two opposite corners) or a polygon (corners, one per line). */
export function ZoneEditor({ action, locations, zone }: { action: Action; locations: Option[]; zone?: ZoneRow }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const p = zone?.points ?? [];
  const [shape, setShape] = useState<ZoneShape>((v.shape as ZoneShape) ?? zone?.shape ?? 'circle');
  const [lat, setLat] = useState(v.latitude ?? (zone?.shape === 'circle' ? String(zone.latitude) : ''));
  const [lng, setLng] = useState(v.longitude ?? (zone?.shape === 'circle' ? String(zone.longitude) : ''));
  const [radius, setRadius] = useState(v.radiusM ?? String(zone?.radius_m ?? 200));
  const [rect, setRect] = useState({
    lat1: v.lat1 ?? (zone?.shape === 'rectangle' ? String(p[0]?.[0] ?? '') : ''), lng1: v.lng1 ?? (zone?.shape === 'rectangle' ? String(p[0]?.[1] ?? '') : ''),
    lat2: v.lat2 ?? (zone?.shape === 'rectangle' ? String(p[1]?.[0] ?? '') : ''), lng2: v.lng2 ?? (zone?.shape === 'rectangle' ? String(p[1]?.[1] ?? '') : ''),
  });
  const [corners, setCorners] = useState(v.points ?? (zone?.shape === 'polygon' ? p.map((x) => x.join(', ')).join('\n') : ''));
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const id = zone?.id ?? 'new';

  const num = (x: string) => (x.trim() === '' || Number.isNaN(Number(x)) ? null : Number(x));
  const centre: LatLng | null = shape === 'circle' && num(lat) !== null && num(lng) !== null ? [num(lat)!, num(lng)!] : null;
  const points: LatLng[] = shape === 'rectangle'
    ? ([[num(rect.lat1), num(rect.lng1)], [num(rect.lat2), num(rect.lng2)]].filter((x) => x[0] !== null && x[1] !== null) as LatLng[])
    : shape === 'polygon' ? parseZonePoints(corners).points : [];
  const m = zoneMeasures(shape, shape === 'circle' ? null : points, num(radius));

  async function here(apply: (pos: LatLng) => void) {
    setLocating(true);
    setLocError('');
    const pos = await locate();
    setLocating(false);
    if (!pos) return setLocError('Your browser didn’t share a location. Allow location access, or type the coordinates.');
    apply([Math.round(pos.coords.latitude * 1e6) / 1e6, Math.round(pos.coords.longitude * 1e6) / 1e6]);
  }

  return (
    <form action={formAction} noValidate aria-label={zone ? `Edit zone ${zone.name}` : 'New zone'} className="space-y-4">
      <FormMessage state={state} />
      {zone && <input type="hidden" name="zoneId" value={zone.id} />}
      <input type="hidden" name="shape" value={shape} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField idPrefix={`z${id}`} name="locationId" label="Location" required options={locations} placeholder="Choose…" defaultValue={v.locationId ?? zone?.location_id ?? ''} error={e.locationId} />
        <TextField idPrefix={`z${id}`} name="name" label="Zone name" required placeholder="Main gate" defaultValue={v.name ?? zone?.name ?? ''} error={e.name} />
      </div>
      <div role="radiogroup" aria-label="Shape" className="flex flex-wrap gap-2">
        {ZONE_SHAPES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={shape === s} onClick={() => setShape(s)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${shape === s ? 'border-primary bg-primary-soft font-medium' : 'border-line hover:bg-subtle'}`}>
            {s === 'circle' ? '◯' : s === 'rectangle' ? '▭' : '⬠'} {ZONE_SHAPE_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {shape === 'circle' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <TextField idPrefix={`z${id}`} name="latitude" label="Centre latitude" inputMode="decimal" value={lat} onChange={(ev) => setLat(ev.target.value)} error={e.latitude} />
                <TextField idPrefix={`z${id}`} name="longitude" label="Centre longitude" inputMode="decimal" value={lng} onChange={(ev) => setLng(ev.target.value)} error={e.longitude} />
              </div>
              <TextField idPrefix={`z${id}`} name="radiusM" label="Radius (m)" inputMode="numeric" value={radius} onChange={(ev) => setRadius(ev.target.value)} error={e.radiusM} hint="20 m to 5 km." />
              <Button type="button" size="sm" variant="secondary" disabled={locating} onClick={() => here(([a, b]) => { setLat(String(a)); setLng(String(b)); })}>
                {locating ? 'Locating…' : '📍 Use my location as the centre'}
              </Button>
            </>
          )}
          {shape === 'rectangle' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {(['lat1', 'lng1', 'lat2', 'lng2'] as const).map((k) => (
                  <TextField key={k} idPrefix={`z${id}`} name={k} inputMode="decimal" error={e[k]}
                    label={`${k.endsWith('1') ? 'Corner 1' : 'Opposite corner'} ${k.startsWith('lat') ? 'latitude' : 'longitude'}`}
                    value={rect[k]} onChange={(ev) => setRect({ ...rect, [k]: ev.target.value })} />
                ))}
              </div>
              <Button type="button" size="sm" variant="secondary" disabled={locating}
                onClick={() => here(([a, b]) => setRect(rect.lat1 ? { ...rect, lat2: String(a), lng2: String(b) } : { ...rect, lat1: String(a), lng1: String(b) }))}>
                {locating ? 'Locating…' : '📍 Use my location for a corner'}
              </Button>
            </>
          )}
          {shape === 'polygon' && (
            <>
              <TextAreaField idPrefix={`z${id}`} name="points" label="Corners" rows={6} value={corners} onChange={(ev) => setCorners(ev.target.value)} error={e.points}
                placeholder={'12.9691, 77.5890\n12.9691, 77.5911\n12.9712, 77.5911'}
                hint="One corner per line as latitude, longitude, in order around the zone (3 to 50). Copy them from any map." />
              <Button type="button" size="sm" variant="secondary" disabled={locating}
                onClick={() => here(([a, b]) => setCorners((c) => `${c.trim() ? `${c.trim()}\n` : ''}${a}, ${b}`))}>
                {locating ? 'Locating…' : '📍 Add my location as a corner'}
              </Button>
            </>
          )}
          {locError && <p role="alert" className="text-xs text-danger">{locError}</p>}
        </div>
        <div className="space-y-2">
          <ZonePreview shape={shape} centre={centre} radius={num(radius) ?? 0} points={points} />
          <p className="text-xs text-muted">Coverage: {area(m.area)} · perimeter {length(m.perimeter)}. A check-in counts inside when its reported position, give or take the phone’s accuracy, is in the zone.</p>
        </div>
      </div>
      <SubmitButton pendingLabel="Saving…">{zone ? 'Save zone' : '＋ Add zone'}</SubmitButton>
    </form>
  );
}

export interface ZoneTestState extends ActionState {
  results?: Array<{ id: string; name: string; shape: ZoneShape; active: boolean; inside: boolean; metres: number }>;
  point?: LatLng;
}

/** Test a point: which zones of the location it falls in, as a check-in there would be judged. */
export function ZoneTest({ action, locations }: { action: (prev: ZoneTestState, formData: FormData) => Promise<ZoneTestState>; locations: Option[] }) {
  const [state, formAction] = useActionState(action, { ok: false } as ZoneTestState);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [acc, setAcc] = useState('0');
  const [locating, setLocating] = useState(false);
  return (
    <form action={formAction} noValidate aria-label="Test a punch" className="space-y-3">
      {!state.results && <FormMessage state={state} />}
      <div className="grid gap-3 sm:grid-cols-4">
        <SelectField idPrefix="zt" name="locationId" label="Location" options={locations} placeholder="All locations" />
        <TextField idPrefix="zt" name="latitude" label="Latitude" inputMode="decimal" value={lat} onChange={(ev) => setLat(ev.target.value)} />
        <TextField idPrefix="zt" name="longitude" label="Longitude" inputMode="decimal" value={lng} onChange={(ev) => setLng(ev.target.value)} />
        <TextField idPrefix="zt" name="accuracy" label="Accuracy (m)" inputMode="numeric" value={acc} onChange={(ev) => setAcc(ev.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" pendingLabel="Testing…">🎯 Test punch</SubmitButton>
        <Button type="button" size="sm" variant="secondary" disabled={locating} onClick={async () => {
          setLocating(true);
          const pos = await locate();
          setLocating(false);
          if (pos) { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setAcc(String(Math.round(pos.coords.accuracy))); }
        }}>{locating ? 'Locating…' : '📍 Use my location'}</Button>
      </div>
      {state.results && (
        <div role="status" className="space-y-2">
          {state.results.length === 0 ? <p className="text-sm text-muted">No zones there yet.</p> : (
            <ul className="divide-y divide-line rounded-lg border border-line text-sm" aria-label="Test results">
              {state.results.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{r.name} <span className="text-xs text-muted">{ZONE_SHAPE_LABELS[r.shape]}{r.active ? '' : ' · inactive'}</span></span>
                  <span className={r.inside ? 'font-medium text-success' : 'text-danger'}>{r.inside ? '✓ Inside' : `✗ Outside, ${r.metres.toLocaleString('en-IN')} m away`}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">{state.results.some((r) => r.inside && r.active) ? 'A check-in here would count as inside the workplace.' : 'A check-in here would be outside the workplace.'}</p>
        </div>
      )}
    </form>
  );
}

/** The same correction for several days: pick the days, give the times and a reason. */
export function BulkRegularizeForm({ action, days }: { action: Action; days: Array<{ date: string; label: string }> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [picked, setPicked] = useState<string[]>([]);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  if (days.length === 0) return <p className="px-5 py-4 text-sm text-muted">No days need correcting in the window you can regularize.</p>;
  return (
    <form action={formAction} noValidate aria-label="Regularize several days" className="space-y-4 px-5 py-4">
      <FormMessage state={state} />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Days</legend>
        <div className="scroll-thin grid max-h-48 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
          {days.map((d) => (
            <label key={d.date} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-subtle">
              <input type="checkbox" name="workDates" value={d.date} className="size-4 accent-primary" checked={picked.includes(d.date)}
                onChange={(ev) => setPicked(ev.target.checked ? [...picked, d.date] : picked.filter((x) => x !== d.date))} />{d.label}
            </label>
          ))}
        </div>
        {e.workDates && <p className="mt-1 text-xs font-medium text-danger">{e.workDates}</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField idPrefix="breg" name="checkIn" label="Check-in" type="time" defaultValue={v.checkIn} error={e.checkIn} />
        <TextField idPrefix="breg" name="checkOut" label="Check-out" type="time" defaultValue={v.checkOut} error={e.checkOut} />
      </div>
      <TextField idPrefix="breg" name="reason" label="Reason" required placeholder="Card reader was down" defaultValue={v.reason} error={e.reason} />
      <SubmitButton pendingLabel="Requesting…">Regularize {picked.length || ''} day{picked.length === 1 ? '' : 's'}</SubmitButton>
    </form>
  );
}

export interface BoardRow { value: string; selectable: boolean; label: string; cells: ReactNode[] }

/** A table whose rows can be picked and acted on together (bulk revert, approve, reject). */
export function SelectBoard({ action, label, columns, rows, buttons, empty, children }: {
  action: Action; label: string; columns: string[]; rows: BoardRow[]; empty: string; children?: ReactNode;
  buttons: Array<{ op: string; label: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }>;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [picked, setPicked] = useState<string[]>([]);
  const selectable = rows.filter((r) => r.selectable).map((r) => r.value);
  const pickedNow = picked.filter((p) => selectable.includes(p));
  return (
    <form action={formAction} aria-label={label} className="space-y-3">
      <div className="px-5"><FormMessage state={state} /></div>
      {selectable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5">
          <span className="text-xs text-muted">{pickedNow.length} selected</span>
          {buttons.map((b) => (
            <SubmitButton key={b.op} size="sm" variant={b.variant ?? 'secondary'} name="op" value={b.op} disabled={pickedNow.length === 0}>{b.label}</SubmitButton>
          ))}
          {children}
        </div>
      )}
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{label}</caption>
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="w-10 px-5 py-2">{selectable.length > 0 && <input type="checkbox" aria-label="Select all" className="accent-primary"
              checked={selectable.length > 0 && pickedNow.length === selectable.length} onChange={(ev) => setPicked(ev.target.checked ? selectable : [])} />}</th>
            {columns.map((c) => <th key={c} scope="col" className="py-2 pr-4 font-semibold">{c}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.value}>
                <td className="px-5 py-2">{r.selectable && <input type="checkbox" name="item" value={r.value} aria-label={`Select ${r.label}`} className="accent-primary"
                  checked={picked.includes(r.value)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, r.value] : picked.filter((x) => x !== r.value))} />}</td>
                {r.cells.map((c, i) => <td key={i} className="py-2 pr-4">{c}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={columns.length + 1} className="py-8 text-center text-muted">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </form>
  );
}

/** Save the current filters as a named view. */
export function SaveViewForm({ action, params }: { action: Action; params: Record<string, string> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Save this view" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="params" value={JSON.stringify(params)} />
      <TextField idPrefix="sv" name="name" label="Save this view as" placeholder="Late in Engineering" className="min-w-48" />
      <SubmitButton size="sm" variant="secondary">★ Save view</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
