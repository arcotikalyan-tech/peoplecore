import { describe, expect, it } from 'vitest';
import { adjustLeaveSchema, applyLeaveSchema, fieldErrors } from '../src/index.ts';

const type = '7d1b2c3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('applyLeaveSchema', () => {
  it('reads checkboxes and checks the date order', () => {
    expect(applyLeaveSchema.parse({ leaveTypeId: type, startDate: '2026-11-02', endDate: '2026-11-03', halfDayStart: 'on' }))
      .toMatchObject({ halfDayStart: true, halfDayEnd: false });
    const r = applyLeaveSchema.safeParse({ leaveTypeId: type, startDate: '2026-11-03', endDate: '2026-11-02' });
    expect(r.success || fieldErrors(r.error)).toEqual({ endDate: 'The leave can’t end before it starts' });
  });

  it('refuses both halves of a single day', () => {
    const r = applyLeaveSchema.safeParse({ leaveTypeId: type, startDate: '2026-11-02', endDate: '2026-11-02', halfDayStart: 'on', halfDayEnd: 'on' });
    expect(r.success || fieldErrors(r.error)).toEqual({ halfDayEnd: 'For one day, choose either the first or the second half' });
  });
});

describe('adjustLeaveSchema', () => {
  it('accepts whole and half days, not zero or quarters', () => {
    const base = { employeeId: type, leaveTypeId: type, note: 'Opening balance' };
    expect(adjustLeaveSchema.parse({ ...base, days: '-1.5' }).days).toBe(-1.5);
    expect(adjustLeaveSchema.safeParse({ ...base, days: '0' }).success).toBe(false);
    expect(adjustLeaveSchema.safeParse({ ...base, days: '0.25' }).success).toBe(false);
  });
});
