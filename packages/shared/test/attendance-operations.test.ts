import { describe, expect, it } from 'vitest';
import { attendanceRequestSchema, attendanceRuleSchema, attendanceSettingsSchema, weekPatternFromForm, workWeekSchema } from '../src/index.ts';

describe('attendance operations schemas', () => {
  it('reads a rule with optional thresholds and checkboxes', () => {
    const r = attendanceRuleSchema.parse({
      name: 'General', startTime: '09:30', endTime: '18:30', breakMinutes: '60', graceMinutes: '15', earlyGraceMinutes: '10',
      fullDayMinutes: '480', halfDayMinutes: '240', verifySelfie: 'on', overtimeAfterMinutes: '', compOffMinMinutes: '240',
      lateMarksAllowed: '3', latePenaltyDays: '0.5',
    });
    expect(r).toMatchObject({ verifySelfie: true, verifyGeofence: false, overtimeAfterMinutes: undefined, compOffMinMinutes: 240, lateMarksAllowed: 3, latePenaltyDays: 0.5 });
    expect(attendanceRuleSchema.safeParse({ ...r, startTime: '09:30', endTime: '18:30', fullDayMinutes: '200', halfDayMinutes: '240', latePenaltyDays: '1' }).success).toBe(false);
  });

  it('builds a 5-week pattern from the grid and refuses anything but W, H and O', () => {
    const f = new FormData();
    f.set('d16', 'O'); f.set('d17', 'O'); f.set('d26', 'H'); f.set('d37', 'X');
    const pattern = weekPatternFromForm(f);
    expect(pattern).toEqual(['WWWWWOO', 'WWWWWHW', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW']);
    expect(workWeekSchema.safeParse({ name: 'Custom', pattern }).success).toBe(true);
    expect(workWeekSchema.safeParse({ name: 'Short', pattern: pattern.slice(0, 4) }).success).toBe(false);
  });

  it('requests run forwards; settings take a list of office IPs', () => {
    expect(attendanceRequestSchema.safeParse({ kind: 'wfh', startDate: '2026-10-20', endDate: '2026-10-19', reason: 'Plumber' }).success).toBe(false);
    const s = attendanceSettingsSchema.parse({ cycleStartDay: '26', remindMissingCheckout: 'on', allowedIps: '203.0.113.10, 198.51.100.0/24' });
    expect(s).toMatchObject({ cycleStartDay: 26, remindMissingCheckout: true, pendingDigest: false, allowedIps: ['203.0.113.10', '198.51.100.0/24'] });
    expect(attendanceSettingsSchema.safeParse({ cycleStartDay: '1', allowedIps: 'not-an-ip' }).success).toBe(false);
  });
});
