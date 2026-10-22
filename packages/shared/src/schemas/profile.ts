import { z } from 'zod';
import { optionalIsoDate, optionalPhone, optionalText, requiredText } from './common.ts';
import { GENDERS, personalDetailsSchema } from './sensitive.ts';

/** My Profile. Mirrors the check constraints in supabase/migrations/*_my_profile.sql. */

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const yesNo = z.preprocess(blank, z.enum(['yes', 'no']).optional());

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'A1+', 'A1-', 'A2+', 'A2-', 'A1B+', 'A1B-', 'A2B+', 'A2B-'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'separated'] as const;
export const MARITAL_STATUS_LABELS: Record<(typeof MARITAL_STATUSES)[number], string> = {
  single: 'Single', married: 'Married', divorced: 'Divorced', widowed: 'Widowed', separated: 'Separated',
};

export const QUALIFICATION_LEVELS = ['secondary', 'higher_secondary', 'diploma', 'bachelors', 'masters', 'doctorate', 'certificate', 'other'] as const;
export const QUALIFICATION_LEVEL_LABELS: Record<(typeof QUALIFICATION_LEVELS)[number], string> = {
  secondary: 'Secondary (10th)', higher_secondary: 'Higher secondary (12th)', diploma: 'Diploma', bachelors: 'Bachelor’s',
  masters: 'Master’s', doctorate: 'Doctorate', certificate: 'Certificate', other: 'Other',
};

export const FAMILY_RELATIONSHIPS = ['spouse', 'child', 'father', 'mother', 'sibling', 'father_in_law', 'mother_in_law', 'other'] as const;
export const FAMILY_RELATIONSHIP_LABELS: Record<(typeof FAMILY_RELATIONSHIPS)[number], string> = {
  spouse: 'Spouse', child: 'Child', father: 'Father', mother: 'Mother', sibling: 'Sibling',
  father_in_law: 'Father-in-law', mother_in_law: 'Mother-in-law', other: 'Other',
};

export const DOCUMENT_PROOFS = ['photo_id', 'date_of_birth', 'current_address', 'permanent_address'] as const;
export type DocumentProof = (typeof DOCUMENT_PROOFS)[number];
export const DOCUMENT_PROOF_LABELS: Record<DocumentProof, string> = {
  photo_id: 'Photo ID', date_of_birth: 'Date of Birth', current_address: 'Current Address', permanent_address: 'Permanent Address',
};

const postal = z.preprocess(blank, z.string().trim().regex(/^[0-9A-Za-z -]{3,10}$/, 'Enter a valid postal code').optional());
const stateCode = z.preprocess(blank, z.string().trim().toUpperCase().max(10).optional());

/** Every personal field; each Personal-tab card posts only its own fields. */
export const personalProfileSchema = personalDetailsSchema.extend({
  bloodGroup: z.preprocess(blank, z.enum(BLOOD_GROUPS).optional()),
  maritalStatus: z.preprocess(blank, z.enum(MARITAL_STATUSES).optional()),
  isDisabled: yesNo,
  alternatePhone: optionalPhone,
  linkedinUrl: z.preprocess(blank, z.string().trim().max(200).regex(/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//, 'A https://linkedin.com/… link').optional()),
  twitterUrl: z.preprocess(blank, z.string().trim().max(200).regex(/^https:\/\/(www\.)?(twitter|x)\.com\//, 'A https://x.com/… link').optional()),
  websiteUrl: z.preprocess(blank, z.string().trim().max(200).regex(/^https:\/\/\S+$/, 'A link starting with https://').optional()),
  permSameAsCurrent: yesNo,
  permAddressLine1: optionalText(200),
  permAddressLine2: optionalText(200),
  permCity: optionalText(100),
  permStateCode: stateCode,
  permPostalCode: postal,
});
export type PersonalProfileInput = z.infer<typeof personalProfileSchema>;

const year = z.preprocess(blank, z.coerce.number().int().min(1950, 'Enter a year from 1950').max(2100, 'Enter a valid year').optional());

export const qualificationSchema = z.object({
  level: z.enum(QUALIFICATION_LEVELS, 'Choose a level'),
  degree: requiredText(120, 'Degree'),
  specialization: optionalText(120),
  institution: requiredText(160, 'Institution'),
  startYear: year,
  endYear: year,
  score: optionalText(20),
}).refine((v) => !v.startYear || !v.endYear || v.endYear >= v.startYear, { path: ['endYear'], message: 'Ends before it starts' });

export const familyMemberSchema = z.object({
  name: requiredText(120, 'Name'),
  relationship: z.enum(FAMILY_RELATIONSHIPS, 'Choose a relationship'),
  dateOfBirth: optionalIsoDate.refine((d) => !d || d < new Date().toISOString().slice(0, 10), 'Date of birth must be in the past'),
  gender: z.preprocess(blank, z.enum(GENDERS).optional()),
  phone: optionalPhone,
  occupation: optionalText(80),
  isDependent: yesNo,
});

export const workProfileSchema = z.object({
  jobTitle: z.preprocess(blank, z.string().trim().min(2, 'At least 2 characters').max(120).optional()),
  billable: yesNo,
  // Work experience before joining, as years and months (stored in months).
  priorYears: z.preprocess(blank, z.coerce.number({ error: 'Whole years' }).int('Whole years').min(0).max(60, 'At most 60').optional()),
  priorMonths: z.preprocess(blank, z.coerce.number({ error: 'Whole months' }).int('Whole months').min(0).max(11, '0 to 11').optional()),
});

/** Months of experience before joining from the form's years and months (null when both are empty). */
export function priorExperienceMonths(v: { priorYears?: number; priorMonths?: number }): number | null {
  return v.priorYears === undefined && v.priorMonths === undefined ? null : (v.priorYears ?? 0) * 12 + (v.priorMonths ?? 0);
}
