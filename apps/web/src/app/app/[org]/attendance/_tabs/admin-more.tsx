import Link from 'next/link';
import { addDays, attendanceCycle, attendanceCycleMonth, todayIn, ZONE_SHAPE_LABELS, zoneMeasures, type LatLng, type ZoneShape } from '@peoplecore/shared';
import { BarChart } from '@/components/ui/charts';
import { cn } from '@/components/ui/cn';
import { Panel, StatCard } from '@/components/ui/hub';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import { getAttendanceSetup } from '@/server/attendance';
import { analytics, recentDevicePunches, rulesSetup, structureNames } from '@/server/attendance-ops';
import { namesFor } from '@/server/leave';
import { getStructure, structureOptions } from '@/server/structure';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { ButtonAction } from '../../settings/settings-client';
import {
  createDeviceAction, deleteZoneAction, importDevicePunchesAction, runPenaltiesAction, saveAttendanceSettingsAction, saveZoneAction, setZoneActiveAction, testZoneAction,
} from '../actions';
import { AttendanceSettingsForm, DeviceForm, DeviceImportForm } from '../attendance-forms';
import { ZoneEditor, ZoneTest, type ZoneRow } from '../automation-client';
import { hours } from './status';

export async function AnalyticsTab({ ctx, today }: { ctx: OrgContext; today: string }) {
  const from = addDays(today, -29);
  const [a, names, heat] = await Promise.all([analytics(ctx.org.id, from, today), structureNames(ctx.org.id), analytics(ctx.org.id, addDays(today, -83), today)]);
  if (!a) return <p className="text-sm text-muted">Analytics aren’t available right now.</p>;
  const dept = new Map(names.departments.map((d) => [d.id, d.name]));
  const avgPresence = a.daily.length ? Math.round((a.daily.reduce((s, d) => s + (d.expected ? d.present / d.expected : 0), 0) / a.daily.length) * 100) : 0;
  const onTime = a.presentDays ? Math.round(((a.presentDays - a.lateDays) / a.presentDays) * 100) : 0;
  const daily = a.daily.slice(-30).map((d) => ({ label: d.date.slice(8), value: d.expected ? Math.round((d.present / d.expected) * 100) : 0 }));
  const weeks = [...new Set((heat?.heatmap ?? []).map((h) => h.week))].sort().slice(-12);
  const late = new Map((heat?.heatmap ?? []).map((h) => [`${h.week}:${h.dow}`, h.late]));
  const maxLate = Math.max(1, ...(heat?.heatmap ?? []).filter((h) => h.dow <= 5).map((h) => h.late));

  return (
    <div className="space-y-5">
      <section aria-label="Last 30 days" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Average presence" value={`${avgPresence}%`} note="of expected working days" tone="success" />
        <StatCard label="On time" value={`${onTime}%`} note={`${a.lateDays} late arrivals`} tone="info" />
        <StatCard label="Average work hours" value={hours(Number(a.avgWorkedMinutes))} note="per day worked" tone="primary" />
        <StatCard label="Overtime" value={hours(Number(a.overtimeMinutes))} note="last 30 days" tone="warning" />
      </section>
      <Panel title="Presence trend" meta="last 30 days, % of expected">
        <BarChart label="Daily presence, percent of expected" data={daily} format={(n) => `${n}%`} height={150} empty="No attendance recorded yet." />
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Punctuality by department" meta="on-time share of days worked">
          {a.departments.every((d) => !d.worked) ? <p className="text-sm text-muted">No days worked yet.</p> : (
            <ul className="space-y-3" aria-label="Punctuality by department">
              {a.departments.filter((d) => d.worked > 0).map((d) => {
                const pct = d.worked ? Math.round((d.onTime / d.worked) * 100) : 0;
                return (
                  <li key={d.departmentId ?? 'none'}>
                    <div className="flex justify-between text-sm"><span>{d.departmentId ? dept.get(d.departmentId) ?? 'Department' : 'No department'}</span><span className="tabular-nums font-medium">{pct}%</span></div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle"><div className={cn('h-full', pct >= 90 ? 'bg-success' : pct >= 75 ? 'bg-warning' : 'bg-danger')} style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Late arrivals" meta="12 weeks, weekdays">
          <table className="w-full border-separate border-spacing-1 text-center text-[10px]">
            <caption className="sr-only">Late arrivals by week and weekday</caption>
            <thead><tr><th className="text-left font-medium text-muted">Week of</th>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => <th key={d} className="font-medium text-muted">{d}</th>)}</tr></thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w}>
                  <th className="whitespace-nowrap text-left font-normal text-muted">{w.slice(8)}/{w.slice(5, 7)}</th>
                  {[1, 2, 3, 4, 5].map((dow) => {
                    const n = late.get(`${w}:${dow}`) ?? 0;
                    return <td key={dow}><span className="grid h-6 place-items-center rounded font-semibold tabular-nums" style={{ background: n ? `color-mix(in srgb, var(--primary) ${Math.round(15 + (n / maxLate) * 75)}%, transparent)` : 'var(--subtle)' }}>{n || ''}</span></td>;
                  })}
                </tr>
              ))}
              {weeks.length === 0 && <tr><td colSpan={6} className="py-6 text-sm text-muted">No attendance recorded yet.</td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

export async function DevicesTab({ ctx, slug }: { ctx: OrgContext; slug: string }) {
  const [setup, structure, punches] = await Promise.all([getAttendanceSetup(ctx.org.id), getStructure(ctx.org.id), recentDevicePunches(ctx.org.id)]);
  const locName = new Map(structure.locations.map((l) => [l.id, l.name]));
  const devName = new Map(setup.devices.map((d) => [d.id, d.name]));
  const names = await namesFor(ctx.org.id, punches.map((p) => p.employee_id));
  return (
    <div className="space-y-5">
      <Panel title="Biometric devices" meta="import each device’s CSV export; records already imported are skipped" flush>
        {setup.devices.length > 0 && (
          <ul className="divide-y divide-line text-sm" aria-label="Devices">
            {setup.devices.map((d) => (
              <li key={d.id} className="flex justify-between px-5 py-2.5">
                <span className="font-medium">{d.name}</span>
                <span className="font-mono text-xs text-muted">{d.serial_number}{d.location_id ? ` · ${locName.get(d.location_id) ?? ''}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
        <DeviceForm action={createDeviceAction.bind(null, slug)} locations={structureOptions(structure).locations} />
        {setup.devices.length > 0 && (
          <DeviceImportForm action={importDevicePunchesAction.bind(null, slug)} devices={setup.devices.map((d) => ({ value: d.id, label: `${d.name} (${d.serial_number})` }))} />
        )}
      </Panel>
      <Panel title="Biometric log" meta="latest 50 device punches" flush>
        <Table caption="Biometric log">
          <thead><tr><Th>Employee</Th><Th>Device</Th><Th>Punched at</Th><Th>Received</Th></tr></thead>
          <tbody>
            {punches.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{names.get(p.employee_id) ?? '—'}</Td>
                <Td>{p.device_id ? devName.get(p.device_id) ?? '—' : '—'}</Td>
                <Td className="tabular-nums">{formatDateTime(p.punched_at, ctx.org.timezone)}</Td>
                <Td className="tabular-nums text-muted">{formatDateTime(p.received_at, ctx.org.timezone)}</Td>
              </tr>
            ))}
            {punches.length === 0 && <tr><Td className="py-6 text-center text-muted">No device punches yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}

export async function SettingsTab({ ctx, slug }: { ctx: OrgContext; slug: string }) {
  const [setup, structure, att] = await Promise.all([rulesSetup(ctx.org.id), getStructure(ctx.org.id), getAttendanceSetup(ctx.org.id)]);
  const locName = new Map(structure.locations.map((l) => [l.id, l.name]));
  const locations = structureOptions(structure).locations;
  const s = setup.settings;
  const today = todayIn(ctx.org.timezone);
  const startDay = s?.cycle_start_day ?? 1;
  // The cycle under way, and the one that ended most recently.
  const curCycle = attendanceCycleMonth(today, startDay);
  const lastCycle = `${addDays(curCycle, -1).slice(0, 7)}-01`;
  const last = attendanceCycle(lastCycle, startDay);
  const auto = setup.shifts.filter((r) => r.deduct_absent);
  const zones: ZoneRow[] = att.geofences.map((g) => ({
    id: g.id, location_id: g.location_id, name: g.name, shape: g.shape as ZoneShape, latitude: Number(g.latitude), longitude: Number(g.longitude),
    radius_m: g.radius_m, points: (g.points as LatLng[] | null) ?? null, is_active: g.is_active,
  }));
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Attendance settings">
          <AttendanceSettingsForm action={saveAttendanceSettingsAction.bind(null, slug)} settings={{
            cycle_start_day: startDay, remind_missing_checkout: s?.remind_missing_checkout ?? true, pending_digest: s?.pending_digest ?? true,
            late_punch_alert: s?.late_punch_alert ?? false, skip_level_approval: s?.skip_level_approval ?? false, allowed_ips: s?.allowed_ips ?? [],
            daily_summary: s?.daily_summary ?? false, punch_reminders: s?.punch_reminders ?? false, comp_off_notify_employee: s?.comp_off_notify_employee ?? false,
            comp_off_notify_hr: s?.comp_off_notify_hr ?? false, regularize_days_back: s?.regularize_days_back ?? 60, regularize_monthly_limit: s?.regularize_monthly_limit ?? null,
          }} />
        </Panel>
        <Panel title="Automatic deduction" meta="penalties and absent days, per attendance cycle">
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              Rules with automatic deduction get their penalties applied and absent days deducted from salary the morning after each cycle ends.
              Other rules’ penalties are applied when you run them. Payroll picks the deductions up for the month the cycle ends in.
            </p>
            <p>{auto.length ? <>On for <strong>{auto.map((r) => r.name).join(', ')}</strong>.</> : 'No rule has automatic deduction on (Rules › Behaviour & anomaly).'}</p>
            <p className="text-muted">Last cycle: {formatDate(last.from)} – {formatDate(last.to)}{s?.last_deduction_cycle ? ` · automatic deduction last ran for the ${new Date(`${s.last_deduction_cycle}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} cycle` : ''}.</p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={runPenaltiesAction.bind(null, slug)} label="Run penalty deduction for the last cycle" submit="Run for the last cycle" size="sm" hidden={{ month: lastCycle.slice(0, 7) }} className="flex flex-col gap-2" />
              <ActionForm action={runPenaltiesAction.bind(null, slug)} label="Run penalty deduction for the current cycle" submit="Run for the current cycle so far" size="sm" variant="secondary" hidden={{ month: curCycle.slice(0, 7) }} className="flex flex-col gap-2" />
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Zones" meta="circles, rectangles and polygons per location; rules that verify the location use them" flush>
        {zones.length === 0 ? <p className="px-5 pb-3 text-sm text-muted">No zones yet.</p> : (
          <ul className="divide-y divide-line" aria-label="Zones">
            {zones.map((z) => {
              const m = zoneMeasures(z.shape, z.points, z.radius_m);
              return (
                <li key={z.id} className="px-5 py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                      <span>
                        <span className="font-medium">{z.name}</span> <span className="text-xs text-muted">· {locName.get(z.location_id) ?? 'Archived location'}</span>
                        {!z.is_active && <span className="ml-2"><Badge>Off</Badge></span>}
                        <span className="block text-xs text-muted">{ZONE_SHAPE_LABELS[z.shape]} · {z.shape === 'circle' ? `${z.radius_m} m around ${z.latitude}, ${z.longitude}` : `${z.points?.length ?? 0} corners`} · {m.area >= 10_000 ? `${(m.area / 10_000).toFixed(2)} ha` : `${Math.round(m.area).toLocaleString('en-IN')} m²`}</span>
                      </span>
                      <span className="text-xs text-primary">Edit</span>
                    </summary>
                    <div className="mt-3 space-y-3 rounded-xl border border-line p-4">
                      <ZoneEditor action={saveZoneAction.bind(null, slug)} locations={locations} zone={z} />
                      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                        <ButtonAction action={setZoneActiveAction.bind(null, slug, z.id, !z.is_active)} aria={`${z.is_active ? 'Switch off' : 'Switch on'} zone ${z.name}`} label={z.is_active ? 'Switch off' : 'Switch on'} variant="ghost" />
                        <ButtonAction action={deleteZoneAction.bind(null, slug, z.id)} aria={`Remove zone ${z.name}`} label="Remove" variant="ghost" />
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-line px-5 py-4">
          <p className="mb-3 text-sm font-semibold">New zone</p>
          {locations.length === 0
            ? <p className="text-sm text-muted">Zones belong to a location, and there are none yet. <Link href={`/app/${slug}/company?tab=address`} className="font-medium text-primary hover:underline">Add a location in Company Profile</Link>, then come back to draw its zone.</p>
            : <ZoneEditor action={saveZoneAction.bind(null, slug)} locations={locations} />}
        </div>
      </Panel>

      <Panel title="Test punch" meta="where would a check-in here fall?">
        <ZoneTest action={testZoneAction.bind(null, slug)} locations={locations} />
      </Panel>
    </div>
  );
}
