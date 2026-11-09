import { describe, expect, it } from 'vitest';
import { attendanceRequestProblem, correctionProblem, typedTime } from '../src/lib/requests';

/** Typed one key at a time, each result going back into the field. */
const type = (keys: string) => [...keys].reduce((field, key) => typedTime(field + key), '');

describe('attendance requests on the phone', () => {
  it('takes no letters in a time, only digits', () => {
    expect(type('abc')).toBe('');
    expect(type('18a3b0x')).toBe('18:30');
    expect(type('9:30 am')).toBe('09:30');
    expect(typedTime('nine')).toBe('');
  });

  it('adds the colon and the leading zero', () => {
    expect(type('0930')).toBe('09:30');
    expect(type('930')).toBe('09:30');
    expect(type('1830')).toBe('18:30');
    expect(type('9.30')).toBe('09:30');
    expect(type('1.30')).toBe('01:30');
    expect(type('1 30')).toBe('01:30'); // each symbol on Android's number pad
    expect(type('1-30')).toBe('01:30');
    expect(type('1,30')).toBe('01:30');
    expect(typedTime(' 9:30')).toBe('09:30');
    expect(typedTime('18.30')).toBe('18:30');
    expect(typedTime('9:30')).toBe('09:30');
    expect(type('09301')).toBe('09:30');
  });

  it('refuses digits that can\'t make a time', () => {
    expect(type('25')).toBe('2');
    expect(type('2359')).toBe('23:59');
    expect(type('2400')).toBe('20:0');
    expect(type('097')).toBe('09');
    expect(typedTime('25:00')).toBe('2');
  });

  it('lets a time be deleted one key at a time', () => {
    expect(typedTime('09:3')).toBe('09:3');
    expect(typedTime('09:')).toBe('09');
    expect(typedTime('0')).toBe('0');
    expect(typedTime('')).toBe('');
  });

  it('doesn\'t send a half-typed time', () => {
    const half = { date: '2026-10-20', checkOut: '', reason: 'Badge reader down' };
    expect(correctionProblem({ ...half, checkIn: type('093') }, '2026-10-23')).toBe('Write the check-in time like 09:30.');
    expect(correctionProblem({ ...half, checkIn: type('9') }, '2026-10-23')).toBe('Write the check-in time like 09:30.');
    expect(correctionProblem({ ...half, checkIn: type('930') }, '2026-10-23')).toBeNull();
  });

  it('checks a correction before sending it', () => {
    const ok = { date: '2026-10-20', checkIn: '09:30', checkOut: '18:30', reason: 'Badge reader down' };
    expect(correctionProblem(ok, '2026-10-23')).toBeNull();
    expect(correctionProblem({ ...ok, date: '2026-10-24' }, '2026-10-23')).toBe('You can’t correct a day that hasn’t started yet.');
    expect(correctionProblem({ ...ok, date: '2026-10-23' }, '2026-10-23')).toBeNull(); // today: a punch missed earlier
    expect(correctionProblem({ ...ok, checkIn: '', checkOut: '' }, '2026-10-23')).toBe('Give a check-in time, a check-out time, or both.');
    expect(correctionProblem({ ...ok, checkOut: '09:30' }, '2026-10-23')).toBe('Check-out can’t be the same as check-in.');
    expect(correctionProblem({ ...ok, checkIn: '22:00', checkOut: '06:00' }, '2026-10-23')).toBeNull(); // a night shift
    expect(correctionProblem({ ...ok, checkIn: '25:00' }, '2026-10-23')).toBe('Write the check-in time like 09:30.');
    expect(correctionProblem({ ...ok, reason: '' }, '2026-10-23')).toBe('Say why the day needs correcting.');
  });

  it('checks work from home and on duty requests', () => {
    expect(attendanceRequestProblem({ start: '2026-10-26', end: '', reason: 'Plumber visit' })).toBeNull();
    expect(attendanceRequestProblem({ start: '2026-10-26', end: '2026-10-25', reason: 'x y z' })).toBe('The last day can’t be before the first.');
  });
});
