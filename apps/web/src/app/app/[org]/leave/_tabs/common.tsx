import { Baby, Briefcase, Coffee, House, Leaf, Minus, PartyPopper, Sprout, Stethoscope, UserRound, Zap, type LucideIcon } from 'lucide-react';
import { ACCRUAL_PERIOD_LABELS, LEAVE_STATUS_LABELS, MONTH_NAMES, type LeaveStatus } from '@peoplecore/shared';
import { cn } from '@/components/ui/cn';
import { formatDate } from '@/lib/format';
import type { LeaveRule } from '@/server/leave-ops';

const ICONS: Record<string, [LucideIcon, string]> = {
  casual: [Coffee, 'bg-warning/15 text-warning'], sick: [Stethoscope, 'bg-info/15 text-info'], earned: [Leaf, 'bg-success/15 text-success'],
  comp_off: [Zap, 'bg-accent/15 text-accent'], event: [PartyPopper, 'bg-primary-soft text-primary'], maternity: [Baby, 'bg-danger/15 text-danger'],
  paternity: [UserRound, 'bg-info/15 text-info'], on_duty: [Briefcase, 'bg-warning/15 text-warning'], wfh: [House, 'bg-success/15 text-success'],
  lop: [Minus, 'bg-subtle text-muted'], custom: [Sprout, 'bg-primary-soft text-primary'],
};

export function CategoryIcon({ category, size = 'md' }: { category: string; size?: 'sm' | 'md' }) {
  const [Icon, tone] = ICONS[category] ?? ICONS.custom!;
  return (
    <span aria-hidden="true" className={cn('grid shrink-0 place-items-center rounded-lg', tone, size === 'md' ? 'size-10' : 'size-7')}>
      <Icon className={size === 'md' ? 'size-5' : 'size-4'} strokeWidth={1.8} />
    </span>
  );
}

export const STATUS_TONE: Record<LeaveStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral',
};
export const statusLabel = (s: LeaveStatus) => LEAVE_STATUS_LABELS[s];

export const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

export const dateRange = (r: { start_date: string; end_date: string; half_day_start: boolean; half_day_end: boolean }) =>
  `${formatDate(r.start_date)}${r.half_day_start ? ' (pm)' : ''}${r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ''}${r.half_day_end ? ' (am)' : ''}`;

export const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

/** The rule in plain English: accrual, carry-forward, encashment, weekends (the rule card's four lines). */
export function ruleFacts(r: LeaveRule) {
  const p = r.policy;
  const accrual = !p || p.accrual_period === 'none' ? 'None' : p.accrual_period === 'yearly' ? 'Upfront' : ACCRUAL_PERIOD_LABELS[p.accrual_period];
  const carry = r.allow_negative ? '—' : !p || p.carry_forward_max === 0 ? 'No' : p.carry_forward_max === null ? 'All' : `≤ ${num(p.carry_forward_max)}`;
  return [
    ['Allowed a year', p ? `${num(p.annual_days)} days` : '—'],
    ['Accrual', accrual],
    ['Carry-forward', carry],
    ['Encashment', r.encashable ? 'Yes' : 'No'],
    ['Weekends', r.count_weekends ? 'Counted' : 'Excluded'],
  ] as const;
}

/** Longer plain-English lines for the employee's "My leave rules". */
export function ruleSentences(r: LeaveRule): string[] {
  const p = r.policy;
  const out: string[] = [];
  if (!p || p.accrual_period === 'none') out.push(r.allow_negative ? 'You can take it whenever you need; it doesn’t use up a balance.' : 'It isn’t credited automatically; HR adds days when they apply.');
  else if (p.accrual_period === 'yearly') out.push(`You get ${num(p.annual_days)} days at the start of each leave year.`);
  else out.push(`You get ${num(p.annual_days)} days a year, credited ${ACCRUAL_PERIOD_LABELS[p.accrual_period].toLowerCase()} at the ${p.accrual_timing === 'end' ? 'end' : 'start'} of each period${p.credit_on_present_days ? ', in proportion to the days you’re present' : ''}.`);
  if (p && !r.allow_negative) {
    out.push(p.carry_forward_max === 0 ? 'Unused days don’t carry forward to the next year.'
      : p.carry_forward_max === null ? 'All unused days carry forward to the next year.' : `Up to ${num(p.carry_forward_max)} unused days carry forward to the next year.`);
  }
  if (p) {
    if (p.max_continuous) out.push(`At most ${num(p.max_continuous)} days in one request.`);
    if (p.max_per_month) out.push(`At most ${num(p.max_per_month)} days in a month.`);
    if (!p.allow_future) out.push('It can’t be requested for future dates.');
    else if (p.future_notice_days) out.push(`Apply at least ${p.future_notice_days} days ahead.`);
    if (!p.allow_backdated) out.push('It can’t be requested for past dates.');
    else if (p.backdated_max_days !== null) out.push(`You can apply up to ${p.backdated_max_days} days after the date.`);
    if (!p.accrue_during_probation) out.push('Not available during probation.');
    if (!p.allowed_on_notice) out.push('Not available during the notice period.');
    if (p.next_year_until) out.push(`Next year’s leave can be applied for up to ${MONTH_NAMES[p.next_year_until - 1]}.`);
  }
  out.push(r.count_weekends ? 'Weekends inside a request are counted.' : 'Weekends inside a request aren’t counted.');
  out.push(r.count_holidays ? 'Holidays inside a request are counted.' : 'Holidays inside a request aren’t counted.');
  if (!r.allow_half_day) out.push('It can only be taken in full days.');
  if (r.encashable) out.push('Unused days can be encashed.');
  if (!r.is_paid) out.push('It’s unpaid: these days are deducted from salary.');
  return out;
}

/** "Under-utilised", "Lapse risk", "High usage", "Balanced" or "No policy". */
export function riskOf(input: { anyPolicy: boolean; entitled: number; usedPct: number; yearShare: number; overCap: boolean }) {
  if (!input.anyPolicy) return { label: 'No policy', tone: 'text-muted' };
  if (input.entitled <= 0) return { label: 'No balance yet', tone: 'text-muted' };
  if (input.overCap && input.yearShare > 0.75) return { label: 'Lapse risk', tone: 'text-danger' };
  if (input.usedPct >= 80) return { label: 'High usage', tone: 'text-warning' };
  if (input.usedPct < Math.max(10, input.yearShare * 100 - 30)) return { label: 'Under-utilised', tone: 'text-info' };
  return { label: 'Balanced', tone: 'text-success' };
}
