import { addDays } from '@peoplecore/shared';
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
import { createDeviceAction, createGeofenceAction, importDevicePunchesAction, saveAttendanceSettingsAction } from '../actions';
import { AttendanceSettingsForm, DeviceForm, DeviceImportForm, GeofenceForm } from '../attendance-forms';
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
  const s = setup.settings;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Attendance settings">
        <AttendanceSettingsForm action={saveAttendanceSettingsAction.bind(null, slug)} settings={{
          cycle_start_day: s?.cycle_start_day ?? 1, remind_missing_checkout: s?.remind_missing_checkout ?? true, pending_digest: s?.pending_digest ?? true,
          late_punch_alert: s?.late_punch_alert ?? false, skip_level_approval: s?.skip_level_approval ?? false, allowed_ips: s?.allowed_ips ?? [],
        }} />
      </Panel>
      <Panel title="Geofences" meta="punches outside the fence are flagged for review, not refused" flush>
        {att.geofences.length > 0 && (
          <ul className="divide-y divide-line text-sm" aria-label="Geofences">
            {att.geofences.map((g) => (
              <li key={g.id} className="flex justify-between px-5 py-2.5">
                <span className="font-medium">{g.name} · {locName.get(g.location_id) ?? 'Archived location'}</span>
                <span className="tabular-nums text-muted">{Number(g.latitude)}, {Number(g.longitude)} · {g.radius_m} m</span>
              </li>
            ))}
          </ul>
        )}
        <GeofenceForm action={createGeofenceAction.bind(null, slug)} locations={structureOptions(structure).locations} />
      </Panel>
    </div>
  );
}
