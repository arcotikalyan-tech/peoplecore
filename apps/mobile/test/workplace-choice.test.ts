import { describe, expect, it } from 'vitest';
import { pickWorkplace, type OrgChoice } from '../src/lib/workplace-choice';

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
