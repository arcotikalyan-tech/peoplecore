import { describe, expect, it } from 'vitest';
import { daysToFix, monthTotals, shiftTime, today } from '../src/lib/worked';

const at = (hhmm: string) => `2026-10-31T${hhmm}:00.000Z`;

describe('today’s attendance from punches', () => {
  it('is not checked in with no punches', () => {
    expect(today([], new Date(at('10:00')))).toEqual({ state: 'not_in', firstIn: null, lastOut: null, workedMinutes: 0 });
  });
  it('counts the time since the check-in while checked in', () => {
    const d = today([at('04:00')], new Date(at('06:30')));
    expect(d).toMatchObject({ state: 'in', firstIn: at('04:00'), lastOut: null, workedMinutes: 150 });
  });
  it('adds each in–out pair, in time order whatever order they arrive in', () => {
    const d = today([at('09:00'), at('04:00'), at('08:00'), at('06:00')], new Date(at('12:00')));
    expect(d).toMatchObject({ state: 'out', firstIn: at('04:00'), lastOut: at('09:00'), workedMinutes: 180 });
  });
  it('never counts negative time when the phone clock is behind', () => {
    expect(today([at('10:00')], new Date(at('09:00'))).workedMinutes).toBe(0);
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
