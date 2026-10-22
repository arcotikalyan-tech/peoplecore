import { describe, expect, it } from 'vitest';
import { endorsementEstimate, endorsementReason, rosterKeys } from './insurance';

describe('endorsementReason', () => {
  const today = '2026-10-22';
  it('names the change: initial roster, joiners, dependants, newborns and removals', () => {
    expect(endorsementReason({ change: 'addition', relationship: 'self', date_of_birth: null }, true, today)).toBe('Initial roster');
    expect(endorsementReason({ change: 'addition', relationship: 'self', date_of_birth: null }, false, today)).toBe('New joiner or newly covered');
    expect(endorsementReason({ change: 'addition', relationship: 'spouse', date_of_birth: null }, false, today)).toBe('Spouse added');
    expect(endorsementReason({ change: 'addition', relationship: 'child', date_of_birth: '2026-09-01' }, false, today)).toBe('Newborn');
    expect(endorsementReason({ change: 'addition', relationship: 'child', date_of_birth: '2019-09-01' }, false, today)).toBe('Child added');
    expect(endorsementReason({ change: 'addition', relationship: 'parent', date_of_birth: null }, false, today)).toBe('Parent added');
    expect(endorsementReason({ change: 'deletion', relationship: 'self', date_of_birth: null }, false, today)).toBe('Exit or cover ended');
    expect(endorsementReason({ change: 'deletion', relationship: 'child', date_of_birth: null }, false, today)).toBe('Dependant removed');
  });
});

describe('endorsementEstimate', () => {
  it('prorates the annual premium per life over the days left in the policy period', () => {
    expect(endorsementEstimate(3650, 2, '2026-04-01', '2027-03-31', '2026-04-01')).toBe(7300);
    expect(endorsementEstimate(3650, 2, '2026-04-01', '2027-03-31', '2026-10-01')).toBe(3640); // 182 of 365 days left
    expect(endorsementEstimate(3650, 1, '2026-04-01', '2027-03-31', '2026-01-15')).toBe(3650); // before the start: the full year
  });
  it('falls back to the full premium without dates and gives nothing to estimate otherwise', () => {
    expect(endorsementEstimate(4200, 3, null, null, '2026-10-22')).toBe(12600);
    expect(endorsementEstimate(null, 3, null, null, '2026-10-22')).toBeNull();
    expect(endorsementEstimate(4200, 0, null, null, '2026-10-22')).toBeNull();
    expect(endorsementEstimate(4200, 1, '2025-04-01', '2026-03-31', '2026-10-22')).toBeNull(); // the policy has ended
  });
});

describe('rosterKeys', () => {
  it('keeps unique ids from lists and fields and drops anything else', () => {
    const a = '0b9a6a8e-3c1d-4c56-9a52-2f1f4f6f0a11';
    const b = '5e2d1c0b-7a6f-4e3d-8c2b-1a0f9e8d7c6b';
    expect(rosterKeys([`${a},${b.toUpperCase()}`, a, 'x; drop table', ''])).toEqual([a, b]);
  });
});
