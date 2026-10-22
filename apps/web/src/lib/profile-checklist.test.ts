import { describe, expect, it } from 'vitest';
import { profileProgress, type Completeness } from './profile-checklist';

describe('profileProgress', () => {
  it('counts the parts filled in', () => {
    const c: Completeness = { employee_id: 'e', personal: true, blood_group: false, address: true, emergency: false, identity: false, bank: true };
    expect(profileProgress(c)).toEqual({ done: 3, total: 6, percent: 50, complete: false });
    expect(profileProgress({ ...c, blood_group: true, emergency: true, identity: true }).complete).toBe(true);
  });
});
