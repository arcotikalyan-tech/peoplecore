import { describe, expect, it } from 'vitest';
import { pickWorkplace, sameWorkplace, type OrgChoice, type WorkplaceFacts } from '../src/lib/workplace-choice';

const org = (id: string, status = 'active'): OrgChoice => ({ id, name: `Org ${id}`, slug: `org-${id}`, status });

describe('which organization the phone app opens in', () => {
  it('opens the one chosen last, by id or slug, while it is active', () => {
    const orgs = [org('a'), org('b')];
    expect(pickWorkplace(orgs, 'b')?.id).toBe('b');
    expect(pickWorkplace(orgs, 'org-b')?.id).toBe('b');
  });

  it('falls back to the first active one when nothing was chosen or the choice is gone', () => {
    expect(pickWorkplace([org('a', 'suspended'), org('b'), org('c')], null)?.id).toBe('b');
    expect(pickWorkplace([org('a'), org('b', 'closed')], 'b')?.id).toBe('a');
    expect(pickWorkplace([org('a', 'closed')], 'a')).toBeNull();
    expect(pickWorkplace(null, null)).toBeNull();
  });
});

describe('re-reading the workplace while the app is open', () => {
  const place: WorkplaceFacts = { orgId: 'a', orgName: 'Org a', slug: 'org-a', timezone: 'Asia/Kolkata', employeeId: null, employeeName: null, off: ['loans'] };

  it('keeps what it has when nothing changed, whatever order the switched-off modules come in', () => {
    expect(sameWorkplace(place, { ...place })).toBe(true);
    expect(sameWorkplace({ ...place, off: ['loans', 'assets'] }, { ...place, off: ['assets', 'loans'] })).toBe(true);
    expect(sameWorkplace(null, null)).toBe(true);
  });

  it('notices an employee record HR added after sign-in, and other changes', () => {
    expect(sameWorkplace(place, { ...place, employeeId: 'e1', employeeName: 'Ubaid Example' })).toBe(false);
    expect(sameWorkplace(place, { ...place, off: [] })).toBe(false);
    expect(sameWorkplace(place, { ...place, orgName: 'Renamed' })).toBe(false);
    expect(sameWorkplace(place, null)).toBe(false);
  });
});
