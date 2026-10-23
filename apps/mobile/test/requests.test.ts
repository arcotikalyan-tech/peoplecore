import { describe, expect, it } from 'vitest';
import { attendanceRequestProblem, correctionProblem, normalizeTime } from '../src/lib/requests';

describe('attendance requests on the phone', () => {
  it('reads times the way people type them', () => {
    expect(normalizeTime('9:5')).toBe('09:05');
    expect(normalizeTime('0930')).toBe('09:30');
    expect(normalizeTime('18.30')).toBe('18:30');
  });

  it('checks a correction before sending it', () => {
    const ok = { date: '2026-10-20', checkIn: '09:30', checkOut: '18:30', reason: 'Badge reader down' };
    expect(correctionProblem(ok, '2026-10-23')).toBeNull();
    expect(correctionProblem({ ...ok, date: '2026-10-23' }, '2026-10-23')).toBe('You can correct days before today.');
    expect(correctionProblem({ ...ok, checkIn: '', checkOut: '' }, '2026-10-23')).toBe('Give a check-in time, a check-out time, or both.');
    expect(correctionProblem({ ...ok, checkOut: '09:00' }, '2026-10-23')).toBe('Check-out must be after check-in.');
    expect(correctionProblem({ ...ok, checkIn: '25:00' }, '2026-10-23')).toBe('Write the check-in time like 09:30.');
    expect(correctionProblem({ ...ok, reason: '' }, '2026-10-23')).toBe('Say why the day needs correcting.');
  });

  it('checks work from home and on duty requests', () => {
    expect(attendanceRequestProblem({ start: '2026-10-26', end: '', reason: 'Plumber visit' })).toBeNull();
    expect(attendanceRequestProblem({ start: '2026-10-26', end: '2026-10-25', reason: 'x y z' })).toBe('The last day can’t be before the first.');
  });
});
