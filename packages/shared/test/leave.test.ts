import { describe, expect, it } from 'vitest';
import { adjustLeaveSchema, applyLeaveSchema, fieldErrors, leaveCycleStart, leaveHealth, leaveRulePayload, leaveRuleSchema } from '../src/index.ts';

const type = '7d1b2c3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('applyLeaveSchema', () => {
  it('reads checkboxes and checks the date order', () => {
    expect(applyLeaveSchema.parse({ leaveTypeId: type, startDate: '2026-11-02', endDate: '2026-11-03', halfDayStart: 'on', reason: 'Wedding' }))
      .toMatchObject({ halfDayStart: true, halfDayEnd: false });
    const r = applyLeaveSchema.safeParse({ leaveTypeId: type, startDate: '2026-11-03', endDate: '2026-11-02', reason: 'Trip' });
    expect(r.success || fieldErrors(r.error)).toEqual({ endDate: 'The leave can’t end before it starts' });
  });

  it('refuses both halves of a single day', () => {
    const r = applyLeaveSchema.safeParse({ leaveTypeId: type, startDate: '2026-11-02', endDate: '2026-11-02', halfDayStart: 'on', halfDayEnd: 'on', reason: 'Errand' });
    expect(r.success || fieldErrors(r.error)).toEqual({ halfDayEnd: 'For one day, choose either the first or the second half' });
  });
});

describe('applyLeaveSchema reason', () => {
  it('needs a reason', () => {
    const r = applyLeaveSchema.safeParse({ leaveTypeId: type, startDate: '2026-11-02', endDate: '2026-11-02', reason: '  ' });
    expect(r.success || fieldErrors(r.error)).toEqual({ reason: 'Reason is required' });
  });
});

describe('leaveRuleSchema', () => {
  it('turns the form into save_leave_rule’s JSON: carry-forward modes, limits, unchecked boxes', () => {
    const base = { name: 'Casual Leave', category: 'casual', shortName: 'cl', annualDays: '12', accrueOverYear: 'on', accrualFrequency: 'monthly' };
    const all = leaveRuleSchema.parse({ ...base, carryForward: 'on', carryForwardMode: 'all', maxPerMonth: '', backdatedMaxDays: '5', allowBackdated: 'on' });
    expect(leaveRulePayload(all)).toMatchObject({
      short_name: 'CL', annual_days: 12, carry_forward: true, carry_forward_max: null, max_per_month: 0, backdated_max_days: 5,
      count_weekends: false, allow_future: false, applies_to: 'everyone',
    });
    const max = leaveRuleSchema.parse({ ...base, carryForward: 'on', carryForwardMode: 'max', carryForwardMax: '4' });
    expect(leaveRulePayload(max).carry_forward_max).toBe(4);
    const none = leaveRuleSchema.parse({ ...base, carryForwardMode: 'max', carryForwardMax: '4' });
    expect(leaveRulePayload(none)).toMatchObject({ carry_forward: false, carry_forward_max: null });
    const missing = leaveRuleSchema.safeParse({ ...base, carryForward: 'on', carryForwardMode: 'max' });
    expect(missing.success || fieldErrors(missing.error)).toEqual({ carryForwardMax: 'Enter the most that carries forward' });
    expect(leaveRuleSchema.safeParse({ ...base, shortName: 'ABC' }).success).toBe(false);
  });
});

describe('leave year and health', () => {
  it('finds the leave year start for January and April years', () => {
    expect(leaveCycleStart('2026-10-19', 1)).toBe('2026-01-01');
    expect(leaveCycleStart('2026-10-19', 4)).toBe('2026-04-01');
    expect(leaveCycleStart('2026-02-10', 4)).toBe('2025-04-01');
  });
  it('scores a recent break and an even pace higher', () => {
    expect(leaveHealth({ daysSinceLastBreak: 20, usedShare: 0.5, yearShare: 0.5 })).toEqual({ score: 100, label: 'Good' });
    expect(leaveHealth({ daysSinceLastBreak: null, usedShare: 0, yearShare: 0.8 }).label).toBe('Low');
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
