import { describe, expect, it } from 'vitest';
import { dayProgress, nextPunches, punchLabels, punchState, type PunchKind, type PunchLike } from '../src/punches.ts';

const at = (hhmm: string, kind: PunchKind | null = null): PunchLike => ({ punched_at: `2026-11-02T${hhmm}:00+05:30`, kind });
const now = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00+05:30`);
const rule = { fullDayMinutes: 480, halfDayMinutes: 240, breakMinutes: 60 };

describe('where a day stands', () => {
  it('offers check-in, then lunch, a break or check-out, then the end of the one that is on', () => {
    expect(nextPunches(punchState([]))).toEqual(['in']);
    expect(nextPunches(punchState([at('09:00', 'in')]))).toEqual(['lunch_start', 'break_start', 'out']);
    expect(nextPunches(punchState([at('09:00', 'in'), at('13:00', 'lunch_start')]))).toEqual(['lunch_end']);
    expect(nextPunches(punchState([at('09:00', 'in'), at('16:00', 'break_start')]))).toEqual(['break_end']);
    expect(nextPunches(punchState([at('09:00', 'in'), at('13:00', 'lunch_start'), at('13:30', 'lunch_end')]))).toEqual(['lunch_start', 'break_start', 'out']);
    expect(nextPunches(punchState([at('09:00', 'in'), at('18:00', 'out')]))).toEqual(['in']);
  });

  it('reads punches without a kind (a device, an older app) as check-ins and check-outs by their place, in time order', () => {
    expect(punchState([at('09:00')])).toEqual({ checkedIn: true, paused: null });
    expect(punchState([at('18:00'), at('09:00')])).toEqual({ checkedIn: false, paused: null });
    expect(punchState([at('09:00'), at('13:00', 'lunch_start'), at('14:00')])).toEqual({ checkedIn: false, paused: null });
    expect(punchLabels([at('09:00'), at('13:00', 'lunch_start'), at('13:40', 'lunch_end'), at('18:00')]))
      .toEqual(['Check-in', 'Lunch started', 'Lunch ended', 'Check-out']);
  });
});

describe('progress towards a full day (8 hours with an hour’s break: 9 hours at work)', () => {
  it('counts down from 9 hours once checked in, not 8', () => {
    expect(dayProgress([at('09:00', 'in')], now('09:05'), rule)).toMatchObject({ atWorkMinutes: 5, toFullDayMinutes: 535 });
  });

  it('an hour of lunch and breaks, however split, keeps the full day at 9 hours at work', () => {
    const day = [at('09:00', 'in'), at('13:00', 'lunch_start'), at('13:45', 'lunch_end'), at('16:00', 'break_start'), at('16:15', 'break_end')];
    expect(dayProgress(day, now('17:00'), rule)).toEqual({ atWorkMinutes: 480, breakMinutes: 60, workedMinutes: 420, toFullDayMinutes: 60 });
    expect(dayProgress([...day, at('18:00', 'out')], now('20:00'), rule)).toMatchObject({ workedMinutes: 480, toFullDayMinutes: 0 });
  });

  it('breaks beyond the hour make the day longer; a short lunch does not shorten it', () => {
    const long = [at('09:00', 'in'), at('12:30', 'lunch_start'), at('14:00', 'lunch_end')];
    expect(dayProgress(long, now('15:00'), rule)).toMatchObject({ breakMinutes: 90, toFullDayMinutes: 570 - 360 });
    const short = [at('09:00', 'in'), at('13:00', 'lunch_start'), at('13:20', 'lunch_end'), at('18:00', 'out')];
    expect(dayProgress(short, now('18:30'), rule)).toMatchObject({ breakMinutes: 20, workedMinutes: 480, toFullDayMinutes: 0 });
  });

  it('a lunch that is on keeps counting, and checking out ends it', () => {
    expect(dayProgress([at('09:00', 'in'), at('13:00', 'lunch_start')], now('13:20'), rule)).toMatchObject({ breakMinutes: 20 });
    expect(dayProgress([at('09:00', 'in'), at('17:00', 'lunch_start'), at('18:00', 'out')], now('19:00'), rule))
      .toMatchObject({ atWorkMinutes: 540, breakMinutes: 60, workedMinutes: 480 });
  });
});
