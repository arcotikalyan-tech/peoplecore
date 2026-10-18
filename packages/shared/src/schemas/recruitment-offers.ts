import { z } from 'zod';
import { isoDate, optionalText, optionalUuid, requiredText, uuid } from './common.ts';

/** Offers, interviews, scorecards and public applications (migration 20261018001400). */
export const OFFER_STATUS_LABELS = {
  draft: 'Draft', pending_approval: 'Waiting for approval', approved: 'Approved', sent: 'Sent',
  accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn',
} as const;
export type OfferStatus = keyof typeof OFFER_STATUS_LABELS;

export const INTERVIEW_MODES = ['video', 'in_person', 'phone'] as const;
export const INTERVIEW_MODE_LABELS: Record<(typeof INTERVIEW_MODES)[number], string> = { video: 'Video call', in_person: 'In person', phone: 'Phone' };
export const RECOMMENDATIONS = ['strong_yes', 'yes', 'no', 'strong_no'] as const;
export const RECOMMENDATION_LABELS: Record<(typeof RECOMMENDATIONS)[number], string> = {
  strong_yes: 'Strong yes', yes: 'Yes', no: 'No', strong_no: 'Strong no',
};
/** The criteria every scorecard rates, 1 (poor) to 5 (excellent). */
export const SCORECARD_CRITERIA = ['Role skills', 'Problem solving', 'Communication', 'Values and teamwork'] as const;

export const offerSchema = z
  .object({
    applicationId: uuid,
    annualCtc: z.coerce.number({ error: 'Enter the annual CTC' }).positive('Enter the annual CTC').max(999_999_999),
    joiningDate: isoDate,
    expiresOn: isoDate,
    designationId: optionalUuid,
    terms: optionalText(5000),
  })
  .refine((v) => v.expiresOn <= v.joiningDate, { path: ['expiresOn'], message: 'The offer should expire before the joining date' });

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Choose a date and time');

export const interviewSchema = z.object({
  applicationId: uuid,
  roundName: requiredText(80, 'Round'),
  scheduledAt: localDateTime,
  durationMinutes: z.coerce.number().int().min(15).max(480),
  mode: z.enum(INTERVIEW_MODES),
  location: optionalText(300),
  panelistIds: z.array(uuid).min(1, 'Choose at least one interviewer').max(10),
});

export const scorecardSchema = z.object({
  interviewId: uuid,
  recommendation: z.enum(RECOMMENDATIONS, { error: 'Choose a recommendation' }),
  summary: requiredText(3000, 'Summary').refine((v) => v.length >= 3, 'Summary is required'),
  ratings: z.array(z.object({ criterion: z.string(), rating: z.coerce.number().int().min(1).max(5) })).min(1),
});

export const publicApplicationSchema = z.object({
  requisitionId: uuid,
  firstName: requiredText(100, 'First name'),
  lastName: optionalText(100),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
  phone: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(20).optional()),
  consent: z.literal('on', { error: 'Please agree to the processing of your details to apply' }),
});

/**
 * A wall-clock time in a time zone (e.g. a datetime-local input in the organization's zone) as an ISO
 * instant. Handles any IANA zone; for zones with DST the second pass settles on the right offset.
 */
export function zonedLocalToIso(local: string, timeZone: string): string {
  const [date, time] = local.split('T') as [string, string];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - instant;
  };
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  return new Date(instant).toISOString();
}
