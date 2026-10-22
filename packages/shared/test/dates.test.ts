import { describe, expect, it } from 'vitest';
import { addDays, addMonths, ageOn, compareIsoDates, isIsoDate, monthCells, startOfDayIn, todayIn } from '../src/dates.ts';

describe('isIsoDate', () => {
  it.each(['2026-01-01', '2024-02-29', '2026-12-31'])('accepts %s', (d) => expect(isIsoDate(d)).toBe(true));
  it.each(['2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '26-01-01', '2026-04-31', ''])('rejects %s', (d) =>
    expect(isIsoDate(d)).toBe(false),
  );
});

describe('addMonths', () => {
  it('adds months within a year', () => expect(addMonths('2026-01-15', 6)).toBe('2026-07-15'));
  it('rolls over the year', () => expect(addMonths('2026-11-30', 3)).toBe('2027-02-28'));
  it('clamps to month end', () => expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'));
  it('handles leap years', () => expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'));
  it('subtracts months', () => expect(addMonths('2026-03-31', -1)).toBe('2026-02-28'));
  it('rejects invalid input', () => expect(() => addMonths('2026-02-30', 1)).toThrow(RangeError));
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('monthCells', () => {
  it('lays a month out in Monday-first weeks with padding', () => {
    const oct = monthCells('2026-10'); // 1 Oct 2026 is a Thursday
    expect(oct.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(oct.at(-1)).toBeNull();
    expect(oct.filter(Boolean)).toHaveLength(31);
    expect(oct.length % 7).toBe(0);
    expect(monthCells('2027-02')).toHaveLength(28); // 1 Feb 2027 is a Monday: four full weeks
  });
});

describe('ageOn', () => {
  it('counts completed years', () => {
    expect(ageOn('2000-06-15', '2026-06-14')).toBe(25);
    expect(ageOn('2000-06-15', '2026-06-15')).toBe(26);
  });
  it('treats 29 Feb birthdays as reached on 28 Feb in non-leap years', () => {
    expect(ageOn('2004-02-29', '2022-02-27')).toBe(17);
    expect(ageOn('2004-02-29', '2022-02-28')).toBe(18);
  });
});

describe('compareIsoDates', () => {
  it('orders dates', () => {
    expect(compareIsoDates('2026-01-01', '2026-01-02')).toBeLessThan(0);
    expect(compareIsoDates('2026-01-02', '2026-01-02')).toBe(0);
  });
});

describe('todayIn', () => {
  it('uses the organization time zone, not UTC', () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in India (UTC+05:30)
    const instant = new Date('2026-12-31T20:00:00Z');
    expect(todayIn('Asia/Kolkata', instant)).toBe('2027-01-01');
    expect(todayIn('UTC', instant)).toBe('2026-12-31');
  });
});

describe('startOfDayIn', () => {
  it('is local midnight in the organization time zone', () => {
    expect(startOfDayIn('2026-12-01', 'Asia/Kolkata').toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(startOfDayIn('2026-12-01', 'UTC').toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('handles daylight-saving changes', () => {
    expect(startOfDayIn('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z'); // EST, DST starts 02:00
    expect(startOfDayIn('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z'); // EDT
  });
});
