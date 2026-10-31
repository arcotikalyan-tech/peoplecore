/** Platform-level audit entries (platform_activity) in words, for the console's activity log. */

export interface ActivityEntry {
  action: string;
  entity_type: string;
  changes: Record<string, unknown> | null;
}

type Change = { from?: unknown; to?: unknown };

const STATUS_WORDS: Record<string, string> = { trialing: 'trial', active: 'active', past_due: 'payment due', cancelled: 'cancelled', suspended: 'suspended', archived: 'archived' };
const word = (v: unknown) => (v == null || v === '' ? 'none' : STATUS_WORDS[String(v)] ?? String(v));

/** "plan: starter → growth; status: trial → active" from an update's {column: {from, to}}. */
function diff(changes: Record<string, unknown>, labels: Record<string, string>): string {
  return Object.entries(labels)
    .filter(([k]) => changes[k] && typeof changes[k] === 'object')
    .map(([k, label]) => `${label}: ${word((changes[k] as Change).from)} → ${word((changes[k] as Change).to)}`)
    .join('; ');
}

const SUBSCRIPTION_LABELS = {
  plan_code: 'plan', status: 'status', billing_cycle: 'billing', employee_limit: 'employee limit', price_per_employee: 'price per employee',
  trial_ends_at: 'trial ends', paid_until: 'paid until', billing_email: 'billing email', notes: 'notes',
};

export function describeActivity(e: ActivityEntry): string {
  const c = e.changes ?? {};
  switch (e.entity_type) {
    case 'organizations':
      if (e.action === 'insert') return `Organization created: ${String(c.name ?? '')} (/app/${String(c.slug ?? '')})`;
      if (e.action === 'delete') return `Organization deleted: ${String(c.name ?? '')}`;
      if (c.status) return (c.status as Change).to === 'suspended' ? 'Organization suspended' : `Organization ${word((c.status as Change).to)}`;
      return `Organization details changed (${diff(c, { name: 'name', slug: 'URL', timezone: 'time zone', country_code: 'country' }) || 'details'})`;
    case 'organization_subscriptions':
      if (e.action === 'insert') return `Plan set: ${String(c.plan_code ?? '')}, ${word(c.status)}`;
      return `Plan and billing changed (${diff(c, SUBSCRIPTION_LABELS) || 'details'})`;
    case 'platform_plans':
      if (e.action === 'insert') return `Plan added: ${String(c.name ?? c.code ?? '')}`;
      return `Plan changed (${diff(c, { name: 'name', price_per_employee: 'price per employee', base_price: 'flat price', max_employees: 'employee limit', trial_days: 'trial days', is_active: 'offered', modules: 'modules', annual_discount_pct: 'annual discount' }) || 'details'})`;
    case 'platform_admins':
      return e.action === 'insert' ? `Platform administrator added: ${String(c.email ?? '')}` : `Platform administrator removed: ${String(c.email ?? '')}`;
    case 'platform_settings':
      if ('require_mfa_for_admins' in c) return `Two-step sign-in for platform administrators turned ${c.require_mfa_for_admins ? 'on' : 'off'}`;
      if ('default_plan_code' in c) return `Default plan for new organizations: ${String(c.default_plan_code)}`;
      return 'Platform settings changed';
    case 'support_access_windows':
      return e.action === 'insert' ? `Support access opened${c.reason ? `: ${String(c.reason)}` : ''}` : 'Support access closed';
    default:
      return `${e.entity_type.replaceAll('_', ' ')} ${e.action}`;
  }
}
