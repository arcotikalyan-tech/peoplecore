import { describe, expect, it } from 'vitest';
import { directOnly, roleDesks, teamCounts, teamRow, type Desks, type TeamMember } from '../src/desks.ts';
import type { Grant } from '../src/permissions.ts';

const now = new Date('2026-11-02T13:00:00+05:30');
const month = { present: 0, expected: 0, late: 0, leave: 0, absent: 0 };
const member = (over: Partial<TeamMember>): TeamMember => ({
  id: 'e1', name: 'Dev Nair', code: 'E-1', title: null, direct: true, notice: false, status: null, first_in: null, last_out: null,
  worked: 0, late: 0, breaks: 0, punches: [], leave: null, request: null, month, ...over,
});
const at = (hhmm: string, kind: TeamMember['punches'][number]['kind']) => ({ punched_at: `2026-11-02T${hhmm}:00+05:30`, kind });

describe('where someone in a manager’s team is today', () => {
  it('reads punches first: at work, at lunch, checked out', () => {
    const lunch = teamRow(member({ punches: [at('09:40', 'in'), at('12:30', 'lunch_start')], late: 10 }), now);
    expect([lunch.label, lunch.group, lunch.atWork, lunch.breaks]).toEqual(['At lunch', 'in', 200, 30]);
    expect(teamRow(member({ punches: [at('09:40', 'in')], request: 'wfh' }), now)).toMatchObject({ label: 'Working from home', tone: 'success', group: 'in' });
    expect(teamRow(member({ punches: [at('07:00', 'in'), at('11:00', 'out')] }), now)).toMatchObject({ label: 'Checked out', group: 'out', atWork: 240 });
    // A biometric device's punches have no kind: they alternate.
    expect(teamRow(member({ punches: [at('09:00', null)] }), now).label).toBe('Checked in');
  });

  it('then leave, offs, requests and absence; otherwise not checked in', () => {
    expect(teamRow(member({ leave: { what: 'Sick leave', status: 'approved', half_day: true } }), now)).toMatchObject({ label: 'Half day · Sick leave', group: 'leave' });
    expect(teamRow(member({ status: 'weekly_off' }), now)).toMatchObject({ label: 'Weekly off', group: 'off' });
    expect(teamRow(member({ request: 'on_duty' }), now)).toMatchObject({ label: 'On duty', group: 'away' });
    expect(teamRow(member({ status: 'absent' }), now)).toMatchObject({ label: 'Absent', tone: 'danger' });
    expect(teamRow(member({ leave: { what: 'Casual leave', status: 'pending', half_day: false } }), now).label).toBe('Not checked in · leave asked');
    expect(teamRow(member({}), now)).toMatchObject({ label: 'Not checked in', group: 'not_in' });
    // A day corrected without punches still counts as at work.
    expect(teamRow(member({ status: 'present', worked: 480 }), now)).toMatchObject({ label: 'Present', group: 'out', atWork: 480 });
  });

  it('counts the team: came in, on leave, not in (or absent), late', () => {
    const rows = [
      member({ punches: [at('09:40', 'in')], late: 10 }), member({ leave: { what: 'Leave', status: 'approved', half_day: false } }),
      member({}), member({ status: 'absent' }), member({ status: 'holiday' }),
    ].map((m) => teamRow(m, now));
    expect(teamCounts(rows)).toEqual({ in: 1, leave: 1, notIn: 2, late: 1 });
  });

  it('keeps only direct reports, with their leave and events, for people who see the whole organization', () => {
    const team: NonNullable<Desks['team']> = {
      reports: 1, reviews: [],
      members: [member({ id: 'd' }), member({ id: 'i', direct: false })],
      away: [{ employee_id: 'd', name: 'D', start: '2026-11-03', end: '2026-11-03', days: 1, what: 'Leave', status: 'approved' },
        { employee_id: 'i', name: 'I', start: '2026-11-03', end: '2026-11-03', days: 1, what: 'Leave', status: 'approved' }],
      events: [{ kind: 'joining', employee_id: 'i', name: 'I', on: '2026-11-10', detail: null }],
    };
    const direct = directOnly(team);
    expect([direct.members.map((m) => m.id), direct.away.map((a) => a.employee_id), direct.events]).toEqual([['d'], ['d'], []]);
  });
});

describe('which desks a person gets', () => {
  const grants = (...keys: string[]): Grant[] => keys.map((k) => ({ permission_key: k, scope: 'org' }));
  it('follows their grants at organization scope', () => {
    expect(roleDesks(grants('employee.read', 'org.manage', 'payroll.approve', 'recruitment.manage', 'audit.read', 'attendance.device.manage')))
      .toEqual(['hr', 'finance', 'hiring', 'devices']); // an owner: no audit desk (they have the log), no payroll run (no maker)
    expect(roleDesks(grants('employee.read', 'payroll.prepare', 'payroll.approve', 'expense.manage', 'vendor.manage'))).toEqual(['payroll', 'finance']);
    expect(roleDesks(grants('employee.read', 'audit.read'))).toEqual(['audit']);
    expect(roleDesks(grants('vendor.manage'))).toEqual(['finance']);
    expect(roleDesks([{ permission_key: 'employee.read', scope: 'team' }, { permission_key: 'leave.approve', scope: 'team' }])).toEqual([]); // a manager: the team desk only
  });
});
