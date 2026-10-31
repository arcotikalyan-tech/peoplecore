/** Plans and subscriptions in the platform console: prices, states and what needs attention. */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';
export type BillingCycle = 'monthly' | 'annual';

export const SUBSCRIPTION_STATUSES: ReadonlyArray<{ value: SubscriptionStatus; label: string }> = [
  { value: 'trialing', label: 'Trial' },
  { value: 'active', label: 'Active (paying)' },
  { value: 'past_due', label: 'Payment due' },
  { value: 'cancelled', label: 'Cancelled' },
];

export interface Billable {
  subscription_status: SubscriptionStatus | null;
  billing_cycle: BillingCycle | null;
  price_per_employee: number | null;
  base_price: number | null;
  annual_discount_pct: number | null;
  employees: number;
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const formatINR = (n: number) => inr.format(Math.round(n));

/**
 * What the organization pays per month, in rupees: the flat price plus the price per employee for everyone who
 * hasn't left; billed annually, at the plan's annual discount. Null when it's priced per customer and no price is set.
 */
export function monthlyValue(r: Billable): number | null {
  if (r.price_per_employee == null && !Number(r.base_price)) return null;
  const gross = Number(r.base_price ?? 0) + Number(r.price_per_employee ?? 0) * r.employees;
  return r.billing_cycle === 'annual' ? gross * (1 - Number(r.annual_discount_pct ?? 0) / 100) : gross;
}

/** Counted as recurring revenue: paying, or paying late. Trials and cancellations aren't. */
export const isRevenue = (status: SubscriptionStatus | null) => status === 'active' || status === 'past_due';

/** Days from today (a YYYY-MM-DD date) to a date; negative when it has passed. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary';

/** A subscription in a few words, with the tone of its badge. */
export function subscriptionState(r: { subscription_status: SubscriptionStatus | null; trial_ends_at: string | null; paid_until: string | null }, today: string): { label: string; tone: Tone } {
  switch (r.subscription_status) {
    case null:
      return { label: 'No plan', tone: 'neutral' };
    case 'trialing': {
      const left = r.trial_ends_at ? daysUntil(r.trial_ends_at, today) : 0;
      if (left < 0) return { label: 'Trial ended', tone: 'danger' };
      return { label: left === 0 ? 'Trial ends today' : `Trial · ${left} day${left === 1 ? '' : 's'} left`, tone: left <= 7 ? 'warning' : 'primary' };
    }
    case 'active':
      return r.paid_until && daysUntil(r.paid_until, today) < 0 ? { label: 'Renewal due', tone: 'warning' } : { label: 'Active', tone: 'success' };
    case 'past_due':
      return { label: 'Payment due', tone: 'danger' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral' };
  }
}

export interface AttentionRow {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'archived';
  subscription_status: SubscriptionStatus | null;
  trial_ends_at: string | null;
  paid_until: string | null;
  employee_limit: number | null;
  employees: number;
}

/** Why an organization needs a platform admin's attention, most urgent first (none: nothing to do). */
export function attentionReasons(r: AttentionRow, today: string): Array<{ text: string; tone: Tone }> {
  const out: Array<{ text: string; tone: Tone }> = [];
  if (r.status === 'suspended') out.push({ text: 'Suspended: nobody can sign in', tone: 'danger' });
  if (r.subscription_status === 'past_due') out.push({ text: 'Payment due', tone: 'danger' });
  if (r.subscription_status === 'trialing' && r.trial_ends_at) {
    const left = daysUntil(r.trial_ends_at, today);
    if (left < 0) out.push({ text: `Trial ended ${-left} day${left === -1 ? '' : 's'} ago`, tone: 'danger' });
    else if (left <= 7) out.push({ text: left === 0 ? 'Trial ends today' : `Trial ends in ${left} day${left === 1 ? '' : 's'}`, tone: 'warning' });
  }
  if (r.subscription_status === 'active' && r.paid_until && daysUntil(r.paid_until, today) < 0) out.push({ text: 'Paid period is over: renew or extend', tone: 'warning' });
  if (r.employee_limit && r.employees >= r.employee_limit) out.push({ text: `At the plan’s limit (${r.employees} of ${r.employee_limit} employees)`, tone: 'danger' });
  else if (r.employee_limit && r.employees >= r.employee_limit * 0.9) out.push({ text: `Near the plan’s limit (${r.employees} of ${r.employee_limit} employees)`, tone: 'warning' });
  if (!r.subscription_status && r.status !== 'archived') out.push({ text: 'No plan assigned', tone: 'warning' });
  return out;
}

/** "₹49 per employee a month · up to 50 employees", or "Custom price · no employee limit". */
export function planSummary(p: { price_per_employee: number | null; base_price: number; max_employees: number | null }): string {
  const price = p.price_per_employee == null
    ? (p.base_price ? `${formatINR(p.base_price)} a month` : 'Custom price')
    : p.price_per_employee === 0 && !p.base_price
      ? 'Free'
      : [p.base_price ? `${formatINR(p.base_price)} a month` : null, p.price_per_employee ? `${formatINR(p.price_per_employee)} per employee a month` : null].filter(Boolean).join(' + ');
  return `${price} · ${p.max_employees ? `up to ${p.max_employees.toLocaleString('en-IN')} employees` : 'no employee limit'}`;
}
