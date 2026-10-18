import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getAttendanceSetup } from '@/server/attendance';
import { requirePermission } from '@/server/context';
import { managerOptions } from '@/server/employees';
import { namesFor } from '@/server/leave';
import { getStructure, structureOptions } from '@/server/structure';
import { assignRosterAction, createDeviceAction, createGeofenceAction, createShiftAction, importDevicePunchesAction } from '../actions';
import { DeviceForm, DeviceImportForm, GeofenceForm, RosterForm, ShiftForm } from '../attendance-forms';

export const metadata: Metadata = { title: 'Attendance settings' };

export default async function AttendanceSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'attendance.manage', 'org');
  const [setup, employees, structure] = await Promise.all([getAttendanceSetup(ctx.org.id), managerOptions(ctx.org.id), getStructure(ctx.org.id)]);
  const names = await namesFor(ctx.org.id, setup.rosters.map((r) => r.employee_id));
  const shiftName = new Map(setup.shifts.map((s) => [s.id, `${s.name} (${s.code})`]));
  const locName = new Map(structure.locations.map((l) => [l.id, l.name]));
  const locations = structureOptions(structure).locations;

  return (
    <>
      <PageHeader eyebrow={<Link href={`/app/${slug}/attendance`} className="hover:text-fg">← Attendance</Link>} title="Attendance settings"
        description="Shifts, who works which shift, geofences and biometric devices. Every change is audited." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Shifts" description="Everyone without an assignment works the default shift." />
          <Table caption="Shifts">
            <thead><tr><Th>Code</Th><Th>Name</Th><Th>Hours</Th><Th>Break</Th><Th>Grace</Th><Th>Full / half day</Th></tr></thead>
            <tbody>
              {setup.shifts.map((s) => (
                <tr key={s.id}>
                  <Td className="font-mono text-xs">{s.code}</Td>
                  <Td className="font-medium">{s.name} {s.is_default && <Badge>Default</Badge>}</Td>
                  <Td className="tabular-nums">{s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}</Td>
                  <Td className="tabular-nums">{s.break_minutes} min</Td>
                  <Td className="tabular-nums">{s.grace_minutes} min</Td>
                  <Td className="tabular-nums">{s.full_day_minutes} / {s.half_day_minutes} min</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <ShiftForm action={createShiftAction.bind(null, slug)} />
        </Card>
        <Card>
          <CardHeader title="Shift assignments" />
          {setup.rosters.length > 0 && (
            <Table caption="Shift assignments">
              <thead><tr><Th>Employee</Th><Th>Shift</Th><Th>From</Th><Th>Until</Th></tr></thead>
              <tbody>
                {setup.rosters.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{names.get(r.employee_id) ?? '—'}</Td>
                    <Td>{shiftName.get(r.shift_id)}</Td>
                    <Td>{formatDate(r.effective_from)}</Td>
                    <Td>{r.effective_to ? formatDate(r.effective_to) : 'Open-ended'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <RosterForm action={assignRosterAction.bind(null, slug)} employees={employees} today={todayIn(ctx.org.timezone)}
            shifts={setup.shifts.filter((s) => s.is_active).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
        </Card>
        <Card>
          <CardHeader title="Geofences" description="Punches outside the fence of the employee’s location are flagged for review, not refused." />
          {setup.geofences.length > 0 && (
            <ul className="divide-y divide-line text-sm" aria-label="Geofences">
              {setup.geofences.map((g) => (
                <li key={g.id} className="flex justify-between px-5 py-2.5">
                  <span className="font-medium">{g.name} · {locName.get(g.location_id) ?? 'Archived location'}</span>
                  <span className="tabular-nums text-muted">{Number(g.latitude)}, {Number(g.longitude)} · {g.radius_m} m</span>
                </li>
              ))}
            </ul>
          )}
          <GeofenceForm action={createGeofenceAction.bind(null, slug)} locations={locations} />
        </Card>
        <Card>
          <CardHeader title="Biometric devices" description="Import the device’s CSV export; records already imported are skipped." />
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
          <DeviceForm action={createDeviceAction.bind(null, slug)} locations={locations} />
          {setup.devices.length > 0 && (
            <DeviceImportForm action={importDevicePunchesAction.bind(null, slug)} devices={setup.devices.map((d) => ({ value: d.id, label: `${d.name} (${d.serial_number})` }))} />
          )}
        </Card>
      </div>
    </>
  );
}
