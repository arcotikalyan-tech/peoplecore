import { z } from 'zod';
import { code, optionalText, optionalUuid, requiredText } from './common.ts';

export const RESERVED_SLUGS = ['admin', 'api', 'app', 'auth', 'login', 'new', 'o', 'platform', 'settings', 'www'];

/** Matches the organizations.slug check constraint (3–50 chars) plus reserved route names. */
export const organizationSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'Use 3–50 lowercase letters, digits or hyphens')
  .refine((slug) => !RESERVED_SLUGS.includes(slug), 'This URL is reserved');

export const createOrganizationSchema = z.object({
  name: requiredText(200, 'Organization name'),
  slug: organizationSlug,
  ownerEmail: z.preprocess((v) => (v === '' ? undefined : v), z.email().optional()),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const createDepartmentSchema = z.object({
  code,
  name: requiredText(120, 'Department name'),
  parentId: optionalUuid,
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const createDesignationSchema = z.object({
  title: requiredText(120, 'Title'),
  level: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(0).max(50).optional()),
});
export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;

export const createLocationSchema = z.object({
  code,
  name: requiredText(120, 'Location name'),
  city: optionalText(120),
  stateCode: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().toUpperCase().max(10).optional()),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
