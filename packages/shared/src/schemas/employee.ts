import { z } from 'zod';
import { isoDate, optionalIsoDate, optionalEmail, optionalPhone, optionalText, optionalUuid, requiredText, uuid } from './common.ts';

/** Mirrors enums and constraints in supabase/migrations/*_org_structure_core_hr.sql. Keep both in sync. */

export const EMPLOYMENT_TYPES = ['permanent', 'contract', 'intern', 'temporary', 'consultant'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  permanent: 'Permanent',
  contract: 'Contract',
  intern: 'Intern',
  temporary: 'Temporary',
  consultant: 'Consultant',
};

/** Separation *type* (resignation, termination, retirement, …) lives on the Phase 6 separation record. */
export const EMPLOYEE_STATUSES = ['pre_joining', 'active', 'on_notice', 'exited'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  pre_joining: 'Pre-joining',
  active: 'Active',
  on_notice: 'On notice',
  exited: 'Exited',
};

export const ASSIGNMENT_CHANGE_REASONS = ['transfer', 'promotion', 'manager_change', 'type_change', 'correction', 'other'] as const;
export type AssignmentChangeReason = (typeof ASSIGNMENT_CHANGE_REASONS)[number] | 'joining';
export const ASSIGNMENT_CHANGE_REASON_LABELS: Record<AssignmentChangeReason, string> = {
  joining: 'Joining',
  transfer: 'Transfer',
  promotion: 'Promotion',
  manager_change: 'Manager change',
  type_change: 'Employment type change',
  correction: 'Correction',
  other: 'Other',
};

const optionalEmployeeCode = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().regex(/^[A-Za-z0-9/_-]{1,30}$/, 'Use up to 30 letters, digits, /, _ or -').optional(),
);

export const createEmployeeSchema = z
  .object({
    employeeCode: optionalEmployeeCode,
    firstName: requiredText(100, 'First name'),
    middleName: optionalText(100),
    lastName: optionalText(100),
    workEmail: optionalEmail,
    workPhone: optionalPhone,
    employmentType: z.enum(EMPLOYMENT_TYPES, { error: 'Choose an employment type' }),
    dateOfJoining: isoDate,
    probationEndDate: optionalIsoDate,
    departmentId: optionalUuid,
    designationId: optionalUuid,
    locationId: optionalUuid,
    legalEntityId: optionalUuid,
    managerEmployeeId: optionalUuid,
  })
  .refine((v) => !v.probationEndDate || v.probationEndDate >= v.dateOfJoining, {
    path: ['probationEndDate'],
    message: 'Probation must end on or after the joining date',
  });
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const changeAssignmentSchema = z.object({
  employeeId: uuid,
  effectiveFrom: isoDate,
  changeReason: z.enum(ASSIGNMENT_CHANGE_REASONS, { error: 'Choose a reason' }),
  departmentId: optionalUuid,
  designationId: optionalUuid,
  locationId: optionalUuid,
  managerEmployeeId: optionalUuid,
  notes: optionalText(2000),
});
export type ChangeAssignmentInput = z.infer<typeof changeAssignmentSchema>;

/** Untrusted URL search params → safe query; bad values silently fall back to defaults. */
export const employeeListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(EMPLOYEE_STATUSES).optional().catch(undefined),
  department: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
