import { describe, expect, it } from 'vitest';
import { ago, dateParts, dateRange, dayMonth, days, duration, firstName, inr, monthYear, plainText, relativeDay } from '../src/lib/format';

describe('formatting', () => {
  it('writes rupees with Indian grouping', () => {
    expect(inr(123456.4)).toBe('₹1,23,456');
  });
  it('writes durations in hours and minutes', () => {
    expect(duration(0)).toBe('0m');
    expect(duration(45)).toBe('45m');
    expect(duration(452)).toBe('7h 32m');
    expect(duration(-5)).toBe('0m');
  });
  it('writes dates by hand, the same on every phone', () => {
    expect(dayMonth('2026-10-31')).toBe('Sat, 31 Oct');
    expect(dateParts('2026-11-03')).toEqual({ day: '3', month: 'Nov', weekday: 'Tue' });
    expect(monthYear('2026-10-01')).toBe('October 2026');
    expect(monthYear('2026-10')).toBe('October 2026');
  });
  it('writes ranges compactly, with the year only when it isn’t this one', () => {
    expect(dateRange('2026-11-03', '2026-11-03', 2026)).toBe('3 Nov');
    expect(dateRange('2026-11-03', '2026-11-05', 2026)).toBe('3 – 5 Nov');
    expect(dateRange('2026-10-30', '2026-11-02', 2026)).toBe('30 Oct – 2 Nov');
    expect(dateRange('2026-12-30', '2027-01-02', 2026)).toBe('30 Dec – 2 Jan 2027');
  });
  it('says how long ago, then the date', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    expect(ago('2026-10-31T11:59:40Z', now)).toBe('Just now');
    expect(ago('2026-10-31T11:55:00Z', now)).toBe('5m ago');
    expect(ago('2026-10-31T09:00:00Z', now)).toBe('3h ago');
    expect(ago('2026-10-30T09:00:00Z', now)).toBe('Yesterday');
    expect(ago('2026-10-04T09:00:00Z', now)).toBe('4 Oct');
    expect(ago('2025-10-04T09:00:00Z', now)).toBe('4 Oct 2025');
  });
  it('names today and tomorrow', () => {
    expect(relativeDay('2026-10-31', '2026-10-31')).toBe('Today');
    expect(relativeDay('2026-11-01', '2026-10-31')).toBe('Tomorrow');
    expect(relativeDay('2026-11-03', '2026-10-31')).toBe('Tue, 3 Nov');
  });
  it('counts days and greets by first name', () => {
    expect(days(1)).toBe('1 day');
    expect(days(1.5)).toBe('1.5 days');
    expect(days(3)).toBe('3 days');
    expect(firstName('  Asha  Rao ')).toBe('Asha');
    expect(firstName(null)).toBe('');
  });
  it('previews an announcement without its formatting', () => {
    expect(plainText('## Diwali\n**Office closed** on *Friday*.\n- Bring sweets\n1. Read [the note](https://example.test/n)')).toBe(
      'Diwali\nOffice closed on Friday.\n• Bring sweets\n• Read the note',
    );
  });
});
