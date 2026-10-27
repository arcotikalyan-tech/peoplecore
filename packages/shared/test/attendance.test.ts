import { describe, expect, it } from 'vitest';
import { fieldErrors, parseDeviceCsvRows, regularizationSchema, shiftSchema } from '../src/index.ts';

describe('regularizationSchema', () => {
  it('needs at least one time; a check-out before check-in is left to the database (night shifts)', () => {
    expect(regularizationSchema.parse({ workDate: '2026-10-12', checkIn: '09:30', checkOut: '', reason: 'Forgot' }).checkOut).toBeUndefined();
    const none = regularizationSchema.safeParse({ workDate: '2026-10-12', checkIn: '', checkOut: '', reason: 'Forgot' });
    expect(none.success || fieldErrors(none.error)).toEqual({ checkIn: 'Give a check-in time, a check-out time, or both' });
    expect(regularizationSchema.safeParse({ workDate: '2026-10-12', checkIn: '22:00', checkOut: '06:00', reason: 'Night' }).success).toBe(true);
    const same = regularizationSchema.safeParse({ workDate: '2026-10-12', checkIn: '09:00', checkOut: '09:00', reason: 'Same' });
    expect(same.success || fieldErrors(same.error)).toEqual({ checkOut: 'Check-out can’t be the same as check-in' });
  });
});

describe('shiftSchema', () => {
  it('upper-cases the code and keeps half a day within a full day', () => {
    const base = { code: 'gen2', name: 'General', startTime: '09:30', endTime: '18:30', breakMinutes: '60', graceMinutes: '15', fullDayMinutes: '480', halfDayMinutes: '240' };
    expect(shiftSchema.parse(base).code).toBe('GEN2');
    expect(shiftSchema.safeParse({ ...base, halfDayMinutes: '500' }).success).toBe(false);
    expect(shiftSchema.safeParse({ ...base, startTime: '9:30' }).success).toBe(false);
  });
});

describe('parseDeviceCsvRows', () => {
  it('maps columns by name and numbers lines', () => {
    expect(parseDeviceCsvRows([['Record_ID', 'employee_code', 'punched_at'], ['7', 'E1', '2026-10-12 09:30:00']]))
      .toEqual({ rows: [{ line: 2, employee_code: 'E1', punched_at: '2026-10-12 09:30:00', record_id: '7' }] });
    expect(parseDeviceCsvRows([['code', 'time']]).error).toBe('The file needs the columns employee_code, punched_at and record_id.');
  });
});
