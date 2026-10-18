import { z } from 'zod';
import { isoDate, optionalText, optionalUuid, requiredText, uuid } from './common.ts';

/** Mirrors the leave enums and checks (migration 20261018001200). */
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};

export const ACCRUAL_PERIODS = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'none'] as const;
export const ACCRUAL_PERIOD_LABELS: Record<(typeof ACCRUAL_PERIODS)[number], string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Upfront each year', none: 'No accrual',
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
    reason: requiredText(500, 'Reason'),
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


/** Leave rules (migration 20261019000300): one rule per leave type. */
export const LEAVE_CATEGORIES = ['casual', 'sick', 'earned', 'comp_off', 'event', 'maternity', 'paternity', 'on_duty', 'wfh', 'lop', 'custom'] as const;
export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number];
export const LEAVE_CATEGORY_LABELS: Record<LeaveCategory, string> = {
  casual: 'Casual', sick: 'Sick', earned: 'Earned', comp_off: 'Comp off', event: 'Event', maternity: 'Maternity',
  paternity: 'Paternity', on_duty: 'On duty', wfh: 'Work from home', lop: 'Loss of pay', custom: 'Custom',
};
export const ACCRUAL_FREQUENCIES = ['monthly', 'quarterly', 'half_yearly'] as const;
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

const optionalNumber = (min: number, max: number, label: string) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v),
    z.coerce.number({ error: `Enter ${label}` }).min(min, `At least ${min}`).max(max, `At most ${max}`).optional());

export const leaveRuleSchema = z
  .object({
    typeId: optionalUuid,
    name: requiredText(60, 'Leave name').refine((v) => v.length >= 2, 'Use at least 2 characters'),
    category: z.enum(LEAVE_CATEGORIES).default('custom'),
    shortName: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() || undefined : v),
      z.string().regex(/^[A-Z0-9]{1,2}$/, 'One or two letters or digits').optional()),
    description: optionalText(300),
    annualDays: z.coerce.number({ error: 'Enter days' }).min(0, 'At least 0').max(366, 'At most 366'),
    countWeekends: checkbox,
    countHolidays: checkbox,
    accrueOverYear: checkbox,
    creditOnPresentDays: checkbox,
    accrualFrequency: z.enum(ACCRUAL_FREQUENCIES).default('monthly'),
    accrualTiming: z.enum(['start', 'end']).default('start'),
    carryForward: checkbox,
    carryForwardMode: z.enum(['all', 'max']).default('all'),
    carryForwardMax: optionalNumber(0, 366, 'days'),
    encashable: checkbox,
    appliesDuringProbation: checkbox,
    allowedOnNotice: checkbox,
    maxPerMonth: optionalNumber(0, 31, 'days'),
    maxContinuous: optionalNumber(0, 366, 'days'),
    allowNegative: checkbox,
    allowHalfDay: checkbox,
    isPaid: checkbox,
    allowFuture: checkbox,
    futureNoticeDays: optionalNumber(0, 365, 'days'),
    allowBackdated: checkbox,
    backdatedMaxDays: optionalNumber(0, 366, 'days'),
    nextYearUntil: optionalNumber(0, 12, 'a month'),
    appliesTo: z.enum(['everyone', 'assigned']).default('everyone'),
  })
  .refine((v) => !(v.carryForward && v.carryForwardMode === 'max' && v.carryForwardMax === undefined), {
    path: ['carryForwardMax'], message: 'Enter the most that carries forward',
  });
export type LeaveRuleInput = z.infer<typeof leaveRuleSchema>;

/** The JSON save_leave_rule takes. */
export function leaveRulePayload(v: LeaveRuleInput) {
  return {
    name: v.name, category: v.category, short_name: v.shortName ?? null, description: v.description ?? null, annual_days: v.annualDays,
    count_weekends: v.countWeekends, count_holidays: v.countHolidays, accrue_over_year: v.accrueOverYear,
    credit_on_present_days: v.creditOnPresentDays, accrual_frequency: v.accrualFrequency, accrual_timing: v.accrualTiming,
    carry_forward: v.carryForward, carry_forward_max: v.carryForward && v.carryForwardMode === 'max' ? (v.carryForwardMax ?? 0) : null,
    encashable: v.encashable, applies_during_probation: v.appliesDuringProbation, allowed_on_notice: v.allowedOnNotice,
    max_per_month: v.maxPerMonth ?? 0, max_continuous: v.maxContinuous ?? 0, allow_negative: v.allowNegative,
    allow_half_day: v.allowHalfDay, is_paid: v.isPaid, allow_future: v.allowFuture, future_notice_days: v.futureNoticeDays ?? 0,
    allow_backdated: v.allowBackdated, backdated_max_days: v.allowBackdated ? (v.backdatedMaxDays ?? null) : null,
    next_year_until: v.nextYearUntil ?? 0, applies_to: v.appliesTo,
  };
}

const halfDays = (label: string) =>
  z.coerce.number({ error: `Enter ${label}` }).min(0, 'At least 0').max(999, 'At most 999')
    .refine((d) => Number.isInteger(d * 2), 'Use whole or half days');

export const setBalanceSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  carried: halfDays('carry-forward'),
  credited: z.coerce.number({ error: 'Enter credited days' }).min(0, 'At least 0').max(999, 'At most 999'),
  penalty: halfDays('penalty'),
  note: requiredText(300, 'Reason'),
});

export const leaveSettingsSchema = z.object({
  yearStartMonth: z.coerce.number().int().refine((m) => m === 1 || m === 4, 'Choose January or April'),
  carryForwardExpiry: z.enum(['year_end', 'never', '12_months'], { error: 'Choose when carried leave expires' }),
  skipLevelApproval: checkbox,
  donationEnabled: checkbox,
});

export const assignLeaveSchema = z.object({
  leaveTypeId: uuid,
  effectiveFrom: isoDate,
  employeeIds: z.array(uuid).min(1, 'Select at least one employee').max(1000),
});

export const encashLeaveSchema = z.object({
  leaveTypeId: uuid,
  days: z.coerce.number({ error: 'Enter days' }).positive('More than 0').max(366).refine((d) => Number.isInteger(d * 2), 'Use whole or half days'),
  reason: optionalText(500),
});

export const donateLeaveSchema = z.object({
  toEmployeeId: uuid,
  leaveTypeId: uuid,
  days: z.coerce.number({ error: 'Enter days' }).positive('More than 0').max(30, 'At most 30').refine((d) => Number.isInteger(d * 2), 'Use whole or half days'),
  note: optionalText(200),
});

/** Leave health (0–100): rewards a break in the last 8 weeks and using leave in step with the year. */
export function leaveHealth(input: { daysSinceLastBreak: number | null; usedShare: number; yearShare: number }) {
  const gap = input.daysSinceLastBreak ?? 365;
  const recency = gap <= 56 ? 60 : Math.max(0, 60 - Math.round((gap - 56) / 5));
  const pace = Math.max(0, 40 - Math.round(Math.abs(input.yearShare - input.usedShare) * 60));
  const score = Math.min(100, recency + pace);
  return { score, label: score >= 75 ? 'Good' : score >= 50 ? 'Fair' : 'Low' } as const;
}

/** The first day of the leave year containing `date` (YYYY-MM-DD), for a year starting in `startMonth` (1–12). */
export function leaveCycleStart(date: string, startMonth: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, '0')}-01`;
}
