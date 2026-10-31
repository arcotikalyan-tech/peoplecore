import { z } from 'zod';
import { email, optionalIsoDate, optionalText, optionalUuid, uuid } from './common.ts';

/**
 * An invitation's employee record: a new one added with the invitation, an existing one without a sign-in, or none
 * (an accountant, an auditor). Punching in, leave and pay all need one.
 */
export const INVITE_RECORD_CHOICES = ['new', 'existing', 'none'] as const;
export type InviteRecordChoice = (typeof INVITE_RECORD_CHOICES)[number];

export const inviteMemberSchema = z
  .object({
    email,
    roleIds: z.array(uuid).min(1, 'Choose at least one role'),
    record: z.preprocess((v) => (v === '' ? undefined : v), z.enum(INVITE_RECORD_CHOICES).optional()),
    employeeId: optionalUuid,
    firstName: optionalText(100),
    lastName: optionalText(100),
    dateOfJoining: optionalIsoDate,
  })
  // Without a choice, an employee id means that existing record.
  .transform((v) => ({ ...v, record: v.record ?? (v.employeeId ? 'existing' : 'none') }))
  .superRefine((v, c) => {
    const issue = (path: string, message: string) => c.addIssue({ code: 'custom', path: [path], message });
    if (v.record === 'new' && !v.firstName) issue('firstName', 'First name is required');
    if (v.record === 'new' && !v.dateOfJoining) issue('dateOfJoining', 'Enter a valid date (YYYY-MM-DD)');
    if (v.record === 'existing' && !v.employeeId) issue('employeeId', 'Choose their employee record');
  });
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const memberRolesSchema = z.object({
  memberId: uuid,
  roleIds: z.array(uuid).min(1, 'Choose at least one role'),
});

export const memberStatusSchema = z.object({
  memberId: uuid,
  status: z.enum(['active', 'suspended']),
});
