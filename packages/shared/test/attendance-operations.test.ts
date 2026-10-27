import { describe, expect, it } from 'vitest';
import {
  attendanceCycle, attendanceCycleMonth, fieldErrors, attendanceRequestSchema, attendanceRuleSchema, attendanceSettingsSchema, bulkRegularizationSchema, describePenalty, parseZonePoints,
  weekPatternFromForm, workWeekSchema, zoneMeasures, zonePoints, zoneSchema,
} from '../src/index.ts';

describe('attendance operations schemas', () => {
  it('reads a rule with optional thresholds and checkboxes', () => {
    const r = attendanceRuleSchema.parse({
      name: 'General', startTime: '09:30', endTime: '18:30', breakMinutes: '60', graceMinutes: '15', earlyGraceMinutes: '10',
      fullDayMinutes: '480', halfDayMinutes: '240', verifySelfie: 'on', overtimeAfterMinutes: '', compOffMinMinutes: '240',
      lateMarksAllowed: '3', lateInterval: '', lateMethod: 'half_day', penaltiesEnabled: 'on', earlyMarksAllowed: '2', earlyMethod: 'hourly',
      shortMethod: 'half_day_by_duration', effectiveFrom: '2026-11-01',
    });
    expect(r).toMatchObject({ verifySelfie: true, verifyGeofence: false, overtimeAfterMinutes: undefined, compOffMinMinutes: 240, lateMarksAllowed: 3,
      lateInterval: 1, penaltiesEnabled: true, earlyMarksAllowed: 2, earlyMethod: 'hourly', effectiveFrom: '2026-11-01', autoClockIn: false });
    expect(attendanceRuleSchema.safeParse({ ...r, startTime: '09:30', endTime: '18:30', fullDayMinutes: '200', halfDayMinutes: '240' }).success).toBe(false);
    const cl = '00000000-0000-4000-8000-000000000001';
    expect(attendanceRuleSchema.safeParse({ ...r, penaltyLeave1: cl, penaltyLeave2: cl }).success).toBe(false);
    expect(attendanceRuleSchema.safeParse({ ...r, lateMethod: 'half_day_by_duration' }).success).toBe(false);
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

  it('reads zones as circles, rectangles or polygons, and measures them', () => {
    expect(parseZonePoints('12.969, 77.589\n12.969 77.591\n\n12.971,77.591')).toEqual({ points: [[12.969, 77.589], [12.969, 77.591], [12.971, 77.591]] });
    expect(parseZonePoints('12.969, 77.589\nnorth gate').error).toBe('Line 2 isn’t a latitude and a longitude.');
    const loc = '00000000-0000-4000-8000-000000000002';
    const poly = zoneSchema.parse({ shape: 'polygon', locationId: loc, name: 'Yard', points: '12.969,77.589\n12.969,77.591\n12.971,77.591\n12.971,77.589' });
    expect(zonePoints(poly)).toHaveLength(4);
    expect(zoneSchema.safeParse({ shape: 'polygon', locationId: loc, name: 'Line', points: '12.969,77.589\n12.969,77.591' }).success).toBe(false);
    const rect = zoneSchema.parse({ shape: 'rectangle', locationId: loc, name: 'Gate', lat1: '12.969', lng1: '77.589', lat2: '12.971', lng2: '77.591' });
    expect(zonePoints(rect)).toEqual([[12.969, 77.589], [12.971, 77.591]]);
    expect(zoneSchema.safeParse({ shape: 'rectangle', locationId: loc, name: 'Flat', lat1: '12.969', lng1: '77.589', lat2: '12.969', lng2: '77.591' }).success).toBe(false);
    expect(zoneSchema.safeParse({ shape: 'circle', locationId: loc, name: 'HQ', latitude: '12.97', longitude: '77.59', radiusM: '10' }).success).toBe(false);
    const noLoc = zoneSchema.safeParse({ shape: 'circle', locationId: '', name: 'HQ', latitude: '12.97', longitude: '77.59', radiusM: '100' });
    expect(fieldErrors(noLoc.error!).locationId).toBe('Choose an option');
    const badLoc = zoneSchema.safeParse({ shape: 'circle', locationId: 'x', name: 'HQ', latitude: '12.97', longitude: '77.59', radiusM: '100' });
    expect(fieldErrors(badLoc.error!).locationId).toBe('Invalid identifier');
    // A 222 m × 217 m box: about 4.8 hectares.
    const box = zoneMeasures('rectangle', [[12.969, 77.589], [12.971, 77.591]], null);
    expect(Math.round(box.area / 1000)).toBe(48);
    expect(Math.round(zoneMeasures('circle', null, 200).area)).toBe(125664);
  });

  it('says what a penalty does, regularizes several days and names cycles by the month they end in', () => {
    expect(describePenalty(4, 3, 'half_day', 'late arrivals', ['Casual leave', 'Earned leave']))
      .toBe('4 late arrivals allowed per cycle; then half a day for every 3 more, from Casual leave → Earned leave → loss of pay.');
    expect(describePenalty(0, 1, 'hourly', 'early exits', [])).toBe('0 early exits allowed per cycle; then the time itself, pro rata to a full day, from loss of pay.');
    expect(describePenalty(null, 1, 'full_day', 'short-hours', [])).toBe('No short-hours penalty.');
    expect(bulkRegularizationSchema.safeParse({ workDates: [], checkIn: '09:30', reason: 'Forgot' }).success).toBe(false);
    expect(bulkRegularizationSchema.parse({ workDates: ['2026-10-05', '2026-10-06'], checkIn: '09:30', checkOut: '', reason: 'Forgot' }))
      .toMatchObject({ checkIn: '09:30', checkOut: undefined });
    expect(attendanceCycle('2026-10-01', 1)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect([attendanceCycleMonth('2026-10-25', 26), attendanceCycleMonth('2026-10-26', 26), attendanceCycleMonth('2026-12-31', 26), attendanceCycleMonth('2026-12-31', 1)])
      .toEqual(['2026-10-01', '2026-11-01', '2027-01-01', '2026-12-01']);
    expect(attendanceCycle('2026-10-01', 26)).toEqual({ from: '2026-09-26', to: '2026-10-25' });
    expect(attendanceCycle('2026-03-01', 29 > 28 ? 28 : 29)).toEqual({ from: '2026-02-28', to: '2026-03-27' });
    const s = attendanceSettingsSchema.parse({ cycleStartDay: '1', regularizeDaysBack: '', regularizeMonthlyLimit: '3', dailySummary: 'on', allowedIps: '' });
    expect(s).toMatchObject({ regularizeDaysBack: 60, regularizeMonthlyLimit: 3, dailySummary: true, punchReminders: false });
  });
});
