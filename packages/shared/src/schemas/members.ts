import { z } from 'zod';
import { email, optionalUuid, uuid } from './common.ts';

export const inviteMemberSchema = z.object({
  email,
  roleIds: z.array(uuid).min(1, 'Choose at least one role'),
  employeeId: optionalUuid,
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
