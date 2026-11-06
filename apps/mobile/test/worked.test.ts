import { describe, expect, it } from 'vitest';
import type { PunchKind } from '@peoplecore/shared/punches';
import { daysToFix, monthTotals, punchButton, shiftTime, today } from '../src/lib/worked';

const at = (hhmm: string) => `2026-10-31T${hhmm}:00.000Z`;
const p = (hhmm: string, kind: PunchKind | null = null) => ({ punched_at: at(hhmm), kind });

describe('a punch button', () => {
  it('spins only when it’s the one pressed; the others wait without a spinner', () => {
    expect(punchButton('lunch_start', 'lunch_start', true)).toEqual({ busy: true, disabled: true });
    expect(punchButton('break_start', 'lunch_start', true)).toEqual({ busy: false, disabled: true });
    expect(punchButton('out', 'lunch_start', true)).toEqual({ busy: false, disabled: true });
  });

  it('can be pressed when nothing is being punched', () => {
    expect(punchButton('in', null, true)).toEqual({ busy: false, disabled: false });
  });

  it('waits, without a spinner, until today’s punches have been read', () => {
    expect(punchButton('in', null, false)).toEqual({ busy: false, disabled: true });
  });
});

describe('today’s attendance from punches', () => {
  it('is not checked in with no punches, and offers check-in', () => {
    expect(today([], new Date(at('10:00')))).toEqual({
      state: 'not_in', paused: null, firstIn: null, lastOut: null, atWorkMinutes: 0, breakMinutes: 0, fullDayMinutes: 540, next: ['in'],
    });
  });
  it('counts down from 9 hours at work after checking in (8 hours of work and an hour’s break), not 8', () => {
    const d = today([p('04:00', 'in')], new Date(at('04:05')));
    expect(d).toMatchObject({ state: 'in', atWorkMinutes: 5, fullDayMinutes: 540, next: ['lunch_start', 'break_start', 'out'] });
    expect(d.fullDayMinutes - d.atWorkMinutes).toBe(535); // 8h 55m to a full day
  });
  it('a lunch that is on offers only its end; breaks past the hour make the day longer', () => {
    const d = today([p('04:00', 'in'), p('08:00', 'lunch_start')], new Date(at('09:30')));
    expect(d).toMatchObject({ state: 'in', paused: 'lunch', breakMinutes: 90, fullDayMinutes: 570, next: ['lunch_end'] });
  });
  it('adds each in–out pair, in time order whatever order they arrive in, and reads punches without a kind by place', () => {
    const d = today([p('09:00'), p('04:00'), p('08:00'), p('06:00')], new Date(at('12:00')));
    expect(d).toMatchObject({ state: 'out', firstIn: at('04:00'), lastOut: at('09:00'), atWorkMinutes: 180 });
  });
  it('takes the check-in and check-out from check punches, not lunch or breaks', () => {
    const d = today([p('04:00', 'in'), p('08:00', 'lunch_start'), p('08:30', 'lunch_end'), p('13:00', 'out')], new Date(at('14:00')));
    expect(d).toMatchObject({ state: 'out', firstIn: at('04:00'), lastOut: at('13:00'), atWorkMinutes: 540, breakMinutes: 30, fullDayMinutes: 540 });
  });
  it('never counts negative time when the phone clock is behind', () => {
    expect(today([p('10:00', 'in')], new Date(at('09:00'))).atWorkMinutes).toBe(0);
  });
});

describe('a month’s totals', () => {
  const rows = [
    { work_date: '2026-10-01', status: 'present', late_minutes: 12 },
    { work_date: '2026-10-02', status: 'half_day', late_minutes: 0 },
    { work_date: '2026-10-03', status: 'wfh', late_minutes: 0 },
    { work_date: '2026-10-04', status: 'weekly_off', late_minutes: 0 },
    { work_date: '2026-10-05', status: 'on_leave', late_minutes: 0 },
    { work_date: '2026-10-06', status: 'absent', late_minutes: 0 },
    { work_date: '2026-10-07', status: 'present', late_minutes: 0 },
  ];
  it('counts days up to today, a half day as half', () => {
    expect(monthTotals(rows, '2026-10-06')).toEqual({ present: 2.5, late: 1, leave: 1, absent: 1 });
  });
});

describe('days to fix', () => {
  it('lists past absences and days with a check-in but no check-out', () => {
    const rows = [
      { work_date: '2026-10-01', status: 'present', late_minutes: 0, punch_count: 2 },
      { work_date: '2026-10-02', status: 'present', late_minutes: 0, punch_count: 1 },
      { work_date: '2026-10-03', status: 'absent', late_minutes: 0, punch_count: 0 },
      { work_date: '2026-10-04', status: 'weekly_off', late_minutes: 0, punch_count: 0 },
      { work_date: '2026-10-05', status: 'absent', late_minutes: 0, punch_count: 0 },
    ];
    expect(daysToFix(rows, '2026-10-05')).toEqual(['2026-10-02', '2026-10-03']);
  });
});

describe('shift times', () => {
  it('reads like the rest of the app', () => {
    expect(shiftTime('09:30:00')).toBe('09:30 am');
    expect(shiftTime('18:05:00')).toBe('06:05 pm');
    expect(shiftTime('00:00:00')).toBe('12:00 am');
    expect(shiftTime('12:00:00')).toBe('12:00 pm');
  });
});
