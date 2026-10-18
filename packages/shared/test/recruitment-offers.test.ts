import { describe, expect, it } from 'vitest';
import { fieldErrors, interviewSchema, offerSchema, zonedLocalToIso } from '../src/index.ts';

const id = '7d1b2c3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('zonedLocalToIso', () => {
  it('reads wall-clock times in the given zone', () => {
    expect(zonedLocalToIso('2026-10-20T15:00', 'Asia/Kolkata')).toBe('2026-10-20T09:30:00.000Z');
    expect(zonedLocalToIso('2026-07-01T09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z'); // EDT
    expect(zonedLocalToIso('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z'); // EST
  });
});

describe('offerSchema', () => {
  it('needs a CTC and an expiry before joining', () => {
    const r = offerSchema.safeParse({ applicationId: id, annualCtc: '', joiningDate: '2026-11-01', expiresOn: '2026-11-05' });
    expect(r.success || Object.keys(fieldErrors(r.error)).sort()).toEqual(['annualCtc', 'expiresOn']);
    expect(offerSchema.parse({ applicationId: id, annualCtc: '1200000', joiningDate: '2026-11-01', expiresOn: '2026-10-25' }).annualCtc).toBe(1200000);
  });
});

describe('interviewSchema', () => {
  it('needs at least one interviewer', () => {
    const r = interviewSchema.safeParse({ applicationId: id, roundName: 'Tech', scheduledAt: '2026-10-20T15:00', durationMinutes: '60', mode: 'video', panelistIds: [] });
    expect(r.success || fieldErrors(r.error)).toEqual({ panelistIds: 'Choose at least one interviewer' });
  });
});
