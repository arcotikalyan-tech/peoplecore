import { teamCounts, teamRow } from '@peoplecore/shared/desks';
import { describe, expect, it, vi } from 'vitest';
import { orgMembers, type Day, type Person } from '../src/lib/org-today';

vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../src/lib/use-load', () => ({ must: (r: { data: unknown }) => r.data }));

const TODAY = '2026-11-10';
const person = (id: string, first: string, extra: Partial<Person> = {}): Person =>
  ({ id, first_name: first, last_name: 'Example', employee_code: id.toUpperCase(), job_title: null, status: 'active', ...extra });
const day = (employee_id: string, extra: Partial<Day> = {}): Day =>
  ({ employee_id, status: 'present', first_in: null, last_out: null, worked_minutes: 0, late_minutes: 0, break_minutes: 0, ...extra });
const none = { punches: [], leave: [], requests: [], types: [] };

describe('the organization today on the phone', () => {
  it('shows everyone but the person looking, with no reporting-line label', () => {
    const members = orgMembers({ ...none, people: [person('me', 'Owner'), person('a', 'Asha')], days: [] }, TODAY, 'me');
    expect(members.map((m) => m.name)).toEqual(['Asha Example']);
    expect(members[0]!.direct).toBe(true);
  });

  it('works out each person’s day from punches, leave and requests, as on a manager’s team', () => {
    const members = orgMembers({
      people: [person('a', 'Asha'), person('b', 'Bala'), person('c', 'Chitra'), person('d', 'Dev', { status: 'on_notice' }), person('e', 'Esha')],
      days: [day('a', { first_in: '2026-11-10T03:40:00Z', late_minutes: 10 }), day('c', { status: 'on_leave' })],
      punches: [
        { employee_id: 'a', punched_at: '2026-11-09T12:00:00Z', kind: 'out' }, // yesterday's, before today's check-in
        { employee_id: 'a', punched_at: '2026-11-10T03:40:00Z', kind: 'in' },
        { employee_id: 'b', punched_at: '2026-11-10T04:00:00Z', kind: 'in' }, // no day for it yet
      ],
      leave: [
        { employee_id: 'c', status: 'pending', start_date: TODAY, end_date: TODAY, half_day_start: false, half_day_end: false, leave_type_id: 'cl' },
        { employee_id: 'c', status: 'approved', start_date: '2026-11-09', end_date: TODAY, half_day_start: false, half_day_end: true, leave_type_id: 'sl' },
      ],
      requests: [{ employee_id: 'e', kind: 'wfh' }],
      types: [{ id: 'cl', name: 'Casual leave' }, { id: 'sl', name: 'Sick leave' }],
    }, TODAY, null);
    const by = Object.fromEntries(members.map((m) => [m.id, m]));
    expect(by.a!.punches).toEqual([{ punched_at: '2026-11-10T03:40:00Z', kind: 'in' }]);
    expect(by.b!.punches).toEqual([]);
    expect(by.c!.leave).toEqual({ what: 'Sick leave', status: 'approved', half_day: true });
    expect(by.d!.notice).toBe(true);
    expect(by.e!.request).toBe('wfh');

    const now = new Date('2026-11-10T06:00:00Z');
    const rows = members.map((m) => teamRow(m, now));
    expect(Object.fromEntries(rows.map((r) => [r.member.id, r.label]))).toEqual({
      a: 'Checked in', b: 'Not checked in', c: 'Half day · Sick leave', d: 'Not checked in', e: 'WFH · not checked in',
    });
    expect(teamCounts(rows)).toEqual({ in: 1, leave: 1, notIn: 3, late: 1 });
  });
});
