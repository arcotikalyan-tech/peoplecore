import { z } from 'zod';
import { isoDate, optionalText, optionalUuid, requiredText, uuid } from './common.ts';

/** Mirrors the leave enums and checks (migration 20261018001200). */
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};

export const ACCRUAL_PERIODS = ['monthly', 'yearly', 'none'] as const;
export const ACCRUAL_PERIOD_LABELS: Record<(typeof ACCRUAL_PERIODS)[number], string> = {
  monthly: 'Every month', yearly: 'Every year', none: 'No accrual',
};

const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const applyLeaveSchema = z
  .object({
    employeeId: optionalUuid, // HR applying on someone's behalf
    leaveTypeId: uuid,
    startDate: isoDate,
    endDate: isoDate,
    halfDayStart: checkbox,
    halfDayEnd: checkbox,
    reason: optionalText(500),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'The leave can’t end before it starts' })
  .refine((v) => !(v.startDate === v.endDate && v.halfDayStart && v.halfDayEnd), {
    path: ['halfDayEnd'], message: 'For one day, choose either the first or the second half',
  });
export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

export const adjustLeaveSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  days: z.coerce.number({ error: 'Enter a number of days' })
    .refine((d) => d !== 0 && Math.abs(d) <= 366, 'Between -366 and 366, not zero')
    .refine((d) => Number.isInteger(d * 2), 'Use whole or half days'),
  note: requiredText(300, 'Reason'),
});

export const holidaySchema = z.object({
  holidayDate: isoDate,
  name: requiredText(80, 'Name').refine((v) => v.length >= 2, 'Name is required'),
  isOptional: checkbox,
});

export const leavePolicySchema = z.object({
  leaveTypeId: uuid,
  effectiveFrom: isoDate,
  accrualPeriod: z.enum(ACCRUAL_PERIODS, { error: 'Choose how leave accrues' }),
  accrualDays: z.coerce.number({ error: 'Enter days' }).min(0).max(366),
  carryForwardMax: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().min(0).max(366).optional()),
});

