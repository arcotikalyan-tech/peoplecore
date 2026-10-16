import { describe, expect, it } from 'vitest';
import {
  computeProbationEndDate,
  displayName,
  formatEmployeeCode,
  initials,
  legalName,
} from '../src/index.ts';

describe('formatEmployeeCode', () => {
  it('pads the sequence', () => expect(formatEmployeeCode('EMP', 42)).toBe('EMP00042'));
  it('does not truncate long sequences', () => expect(formatEmployeeCode('E', 123456, 3)).toBe('E123456'));
  it('rejects non-positive sequences', () => expect(() => formatEmployeeCode('E', 0)).toThrow());
});

describe('computeProbationEndDate', () => {
  it('ends the day before the same date N months later', () =>
    expect(computeProbationEndDate('2026-01-15', 6)).toBe('2026-07-14'));
  it('handles month-end joining dates', () => expect(computeProbationEndDate('2026-08-31', 6)).toBe('2027-02-27'));
  it('returns null for no probation', () => expect(computeProbationEndDate('2026-01-15', 0)).toBeNull());
});

describe('names', () => {
  const person = { first_name: 'Aarav', middle_name: 'K', last_name: 'Sharma', preferred_name: 'Avi' };
  it('prefers the preferred name for display', () => expect(displayName(person)).toBe('Avi Sharma'));
  it('uses all legal parts for legal name', () => expect(legalName(person)).toBe('Aarav K Sharma'));
  it('builds initials', () => expect(initials({ first_name: 'Meera' })).toBe('M'));
  it('ignores blank preferred names', () =>
    expect(displayName({ first_name: 'Meera', preferred_name: '  ', last_name: 'Iyer' })).toBe('Meera Iyer'));
});
