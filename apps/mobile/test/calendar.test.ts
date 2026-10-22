import { describe, expect, it } from 'vitest';
import { isoDate, longDate, monthGrid, shiftMonth } from '../src/lib/calendar';

describe('the phone date picker', () => {
  it('lays a month out Monday first', () => {
    const nov = monthGrid(2026, 11); // 1 Nov 2026 is a Sunday
    expect(nov[0]).toEqual([null, null, null, null, null, null, 1]);
    expect(nov.flat().filter(Boolean)).toHaveLength(30);
    expect(nov.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid(2027, 2).flat().filter(Boolean)).toHaveLength(28);
  });

  it('moves between months and years, and names dates', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual([2027, 1]);
    expect(shiftMonth(2026, 1, -1)).toEqual([2025, 12]);
    expect(isoDate(2026, 3, 7)).toBe('2026-03-07');
    expect(longDate('2026-11-03')).toBe('Tue, 3 Nov 2026');
  });
});
