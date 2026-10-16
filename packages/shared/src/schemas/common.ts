import { z } from 'zod';
import { isIsoDate } from '../dates.ts';

/** Trims, and turns empty strings into undefined so optional form fields behave consistently. */
export const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  );

export const requiredText = (max: number, label = 'This field') =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

export const isoDate = z.string().trim().refine(isIsoDate, 'Enter a valid date (YYYY-MM-DD)');

export const optionalIsoDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  isoDate.optional(),
);

export const uuid = z.uuid('Invalid identifier');

export const optionalUuid = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  uuid.optional(),
);

export const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));

export const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  email.optional(),
);

/** Accepts international numbers; spaces, dashes and parentheses are stripped. */
export const phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s\-()]/g, ''))
  .pipe(z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Enter a valid phone number, e.g. +91 98765 43210'));

export const optionalPhone = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  phone.optional(),
);

/** Short uppercase codes for departments, locations, cost centres. */
export const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,19}$/, 'Use 2–20 letters, digits, - or _');

export const optionalCode = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  code.optional(),
);

/** Converts Zod issues into `{ "field.path": "message" }` for form display (first message per field). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    errors[key] ??= issue.message;
  }
  return errors;
}
