import { z } from 'zod';
import { optionalEmail, optionalIsoDate, optionalPhone, optionalText, phone, requiredText, uuid } from './common.ts';

/** Mirrors the check constraints in supabase/migrations/*_sensitive_employee_data.sql. */

export const GENDERS = ['female', 'male', 'non_binary', 'undisclosed'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  female: 'Female',
  male: 'Male',
  non_binary: 'Non-binary',
  undisclosed: 'Prefer not to say',
};

export const BANK_ACCOUNT_TYPES = ['savings', 'current', 'salary'] as const;
export const BANK_ACCOUNT_TYPE_LABELS: Record<(typeof BANK_ACCOUNT_TYPES)[number], string> = {
  savings: 'Savings',
  current: 'Current',
  salary: 'Salary',
};

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const upperNoSpaces = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v);
const digitsOnly = (v: unknown) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v);

export const updateWorkDetailsSchema = z
  .object({
    firstName: requiredText(100, 'First name'),
    middleName: optionalText(100),
    lastName: optionalText(100),
    workEmail: optionalEmail,
    workPhone: optionalPhone,
    probationEndDate: optionalIsoDate,
    legalEntityId: z.preprocess(blankToUndefined, uuid.optional()),
  });
export type UpdateWorkDetailsInput = z.infer<typeof updateWorkDetailsSchema>;

export const personalDetailsSchema = z.object({
  dateOfBirth: optionalIsoDate.refine((d) => !d || d < new Date().toISOString().slice(0, 10), 'Date of birth must be in the past'),
  gender: z.preprocess(blankToUndefined, z.enum(GENDERS).optional()),
  personalEmail: optionalEmail,
  personalPhone: optionalPhone,
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  stateCode: z.preprocess(blankToUndefined, z.string().trim().toUpperCase().max(10).optional()),
  postalCode: z.preprocess(blankToUndefined, z.string().trim().regex(/^[0-9A-Za-z -]{3,10}$/, 'Enter a valid postal code').optional()),
});
export type PersonalDetailsInput = z.infer<typeof personalDetailsSchema>;

export const emergencyContactSchema = z.object({
  name: requiredText(120, 'Name'),
  relationship: requiredText(60, 'Relationship'),
  phone,
});
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;

export const identitySchema = z.object({
  pan: z.preprocess(
    (v) => blankToUndefined(upperNoSpaces(v)),
    z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN looks like ABCDE1234F')
      .refine((p) => p[3] === 'P', 'An individual’s PAN has P as its 4th character')
      .optional(),
  ),
  aadhaarLast4: z.preprocess((v) => blankToUndefined(digitsOnly(v)), z.string().regex(/^[0-9]{4}$/, 'Enter only the last 4 digits').optional()),
  uan: z.preprocess((v) => blankToUndefined(digitsOnly(v)), z.string().regex(/^[0-9]{12}$/, 'UAN has 12 digits').optional()),
  esicNumber: z.preprocess((v) => blankToUndefined(digitsOnly(v)), z.string().regex(/^[0-9]{10,17}$/, 'ESIC number has 10–17 digits').optional()),
  passportNumber: z.preprocess(
    (v) => blankToUndefined(upperNoSpaces(v)),
    z.string().regex(/^[A-Z0-9]{6,12}$/, 'Passport numbers have 6–12 letters and digits').optional(),
  ),
  passportExpiry: optionalIsoDate,
});
export type IdentityInput = z.infer<typeof identitySchema>;

export const bankAccountSchema = z
  .object({
    accountHolderName: requiredText(120, 'Account holder name'),
    bankName: requiredText(120, 'Bank name'),
    accountNumber: z.preprocess(digitsOnly, z.string().regex(/^[0-9]{6,18}$/, 'Account numbers have 6–18 digits')),
    confirmAccountNumber: z.preprocess(digitsOnly, z.string()),
    ifsc: z.preprocess(upperNoSpaces, z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like HDFC0001234')),
    accountType: z.enum(BANK_ACCOUNT_TYPES),
  })
  .refine((v) => v.accountNumber === v.confirmAccountNumber, {
    path: ['confirmAccountNumber'],
    message: 'The account numbers don’t match',
  });
export type BankAccountInput = z.infer<typeof bankAccountSchema>;
