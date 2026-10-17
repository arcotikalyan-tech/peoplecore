import { describe, expect, it } from 'vitest';
import { addCandidateSchema, createRequisitionSchema, fieldErrors, moveApplicationSchema } from '../src/index.ts';

describe('recruitment schemas', () => {
  it('requisitions need a title, openings and a type', () => {
    expect(createRequisitionSchema.parse({ title: ' Engineer ', openings: '2', employmentType: 'permanent', departmentId: '' }))
      .toMatchObject({ title: 'Engineer', openings: 2, departmentId: undefined });
    const r = createRequisitionSchema.safeParse({ title: '', openings: '0', employmentType: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(fieldErrors(r.error)).sort()).toEqual(['employmentType', 'openings', 'title']);
  });

  it('candidates need consent and an email or phone', () => {
    const base = { firstName: 'Kavya', source: 'referral', consent: 'on' };
    expect(addCandidateSchema.parse({ ...base, phone: '+91 98450 11111' }).phone).toBe('+919845011111');
    const noContact = addCandidateSchema.safeParse(base);
    expect(noContact.success || fieldErrors(noContact.error)).toEqual({ email: 'Enter an email or a phone number' });
    const noConsent = addCandidateSchema.safeParse({ ...base, consent: undefined, email: 'k@example.test' });
    expect(noConsent.success || fieldErrors(noConsent.error)).toEqual({ consent: 'The candidate must agree before their details are stored' });
  });

  it('applications cannot be moved straight to hired', () => {
    expect(moveApplicationSchema.safeParse({ applicationId: '7d1b2c3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d', stage: 'hired' }).success).toBe(false);
  });
});
