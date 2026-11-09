import { describe, expect, it } from 'vitest';
import { STARTER_POLICIES, unfilled } from './policy-library';

describe('starter policies', () => {
  it('lists the parts still to fill in, once each', () => {
    expect(unfilled('Notice is [[days]] days; probation [[days]]; contact [[ HR email ]].')).toEqual(['days', 'HR email']);
    expect(unfilled('Nothing left to fill in.')).toEqual([]);
  });

  it('has distinct titles that fit a policy, and every part to fill in is properly marked', () => {
    const titles = STARTER_POLICIES.map((p) => p.title);
    expect(new Set(titles.map((t) => t.toLowerCase())).size).toBe(titles.length);
    for (const p of STARTER_POLICIES) {
      expect(p.title.length).toBeGreaterThanOrEqual(2);
      expect(p.title.length).toBeLessThanOrEqual(120); // policy_drafts.title
      expect(p.body.length).toBeLessThanOrEqual(50000); // policy_drafts.body
      // Every [[ has its ]], so the check before publishing can't miss a half-marked part.
      expect(p.body.split('[[').length, p.title).toBe(p.body.split(']]').length);
      expect(p.body.split('[[').length - 1, p.title).toBe([...p.body.matchAll(/\[\[[^\]]+\]\]/g)].length);
    }
    // Most need the company's own details.
    expect(STARTER_POLICIES.filter((p) => unfilled(p.body).length > 0).length).toBeGreaterThanOrEqual(STARTER_POLICIES.length - 2);
  });
});
