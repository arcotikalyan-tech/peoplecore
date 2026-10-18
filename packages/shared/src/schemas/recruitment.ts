import { z } from 'zod';
import { optionalEmail, optionalIsoDate, optionalPhone, optionalText, optionalUuid, requiredText, uuid } from './common.ts';
import { EMPLOYMENT_TYPES } from './employee.ts';

/** Mirrors the recruitment enums and checks (migration 20261018000800). */
export const REQUISITION_STATUSES = ['open', 'on_hold', 'closed'] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];
export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = { open: 'Open', on_hold: 'On hold', closed: 'Closed' };

export const APPLICATION_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer',
  hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
/** Stages a person can move an application to (hiring has its own step). */
export const MOVABLE_STAGES = ['applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn'] as const;

export const CANDIDATE_SOURCES = ['careers_site', 'referral', 'agency', 'job_board', 'direct', 'other'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
export const CANDIDATE_SOURCE_LABELS: Record<CandidateSource, string> = {
  careers_site: 'Careers site', referral: 'Referral', agency: 'Agency', job_board: 'Job board', direct: 'Direct', other: 'Other',
};

export const createRequisitionSchema = z.object({
  title: requiredText(120, 'Title').refine((v) => v.length >= 2, 'Title is required'),
  openings: z.coerce.number({ error: 'Enter the number of openings' }).int().min(1, 'At least 1').max(500, 'At most 500'),
  employmentType: z.enum(EMPLOYMENT_TYPES, { error: 'Choose an employment type' }),
  departmentId: optionalUuid,
  designationId: optionalUuid,
  locationId: optionalUuid,
  hiringManagerId: optionalUuid,
  description: optionalText(5000),
});
export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;

export const addCandidateSchema = z
  .object({
    firstName: requiredText(100, 'First name'),
    lastName: optionalText(100),
    email: optionalEmail,
    phone: optionalPhone,
    source: z.enum(CANDIDATE_SOURCES, { error: 'Choose a source' }),
    currentCompany: optionalText(120),
    consent: z.literal('on', { error: 'The candidate must agree before their details are stored' }),
  })
  .refine((v) => v.email || v.phone, { path: ['email'], message: 'Enter an email or a phone number' });
export type AddCandidateInput = z.infer<typeof addCandidateSchema>;

export const moveApplicationSchema = z.object({
  applicationId: uuid,
  stage: z.enum(MOVABLE_STAGES, { error: 'Choose a stage' }),
  note: optionalText(1000),
});

export const hireSchema = z.object({
  applicationId: uuid,
  dateOfJoining: optionalIsoDate, // defaults to the accepted offer's joining date
  workEmail: optionalEmail,
});
