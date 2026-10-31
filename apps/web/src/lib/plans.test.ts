import { describe, expect, it } from 'vitest';
import { attentionReasons, daysUntil, monthlyValue, planSummary, subscriptionState } from './plans';
import { describeActivity } from './platform-activity';
import { cleanSlug, slugify } from './slug';

describe('organization URLs', () => {
  it('come from the name: lowercase words joined by hyphens, accents and symbols dropped', () => {
    expect(slugify('Digital Hike')).toBe('digital-hike');
    expect(slugify('  Acme & Sons Pvt. Ltd.  ')).toBe('acme-and-sons-pvt-ltd');
    expect(slugify('Café Müller')).toBe('cafe-muller');
    expect(slugify('AB')).toBe('ab-hr'); // at least 3 characters
    expect(slugify('***')).toBe('');
    expect(slugify('x'.repeat(60))).toHaveLength(50);
    expect(slugify(`${'a'.repeat(49)} b`)).toBe('a'.repeat(49)); // no trailing hyphen after cutting
  });

  it('typed by hand are cleaned as they go', () => {
    expect(cleanSlug('Digitalhike')).toBe('digitalhike');
    expect(cleanSlug('My Company')).toBe('my-company');
    expect(cleanSlug('-a--b')).toBe('a-b');
  });
});

describe('plans and subscriptions', () => {
  const base = { subscription_status: 'active' as const, billing_cycle: 'monthly' as const, price_per_employee: 49, base_price: 0, annual_discount_pct: 15, employees: 20 };

  it('a month’s value is the flat price plus the price per employee, less the annual discount when billed yearly', () => {
    expect(monthlyValue(base)).toBe(980);
    expect(monthlyValue({ ...base, base_price: 500 })).toBe(1480);
    expect(monthlyValue({ ...base, billing_cycle: 'annual' })).toBeCloseTo(833);
    expect(monthlyValue({ ...base, price_per_employee: null, base_price: 0 })).toBeNull(); // priced per customer
    expect(planSummary({ price_per_employee: 49, base_price: 0, max_employees: 50 })).toBe('₹49 per employee a month · up to 50 employees');
    expect(planSummary({ price_per_employee: 0, base_price: 0, max_employees: 10 })).toBe('Free · up to 10 employees');
    expect(planSummary({ price_per_employee: null, base_price: 0, max_employees: null })).toBe('Custom price · no employee limit');
  });

  it('states and attention: trials running out, payments due, limits reached', () => {
    const today = '2026-10-31';
    expect(daysUntil('2026-11-03', today)).toBe(3);
    expect(subscriptionState({ subscription_status: 'trialing', trial_ends_at: '2026-11-03', paid_until: null }, today)).toEqual({ label: 'Trial · 3 days left', tone: 'warning' });
    expect(subscriptionState({ subscription_status: 'trialing', trial_ends_at: '2026-10-30', paid_until: null }, today)).toEqual({ label: 'Trial ended', tone: 'danger' });
    expect(subscriptionState({ subscription_status: 'active', trial_ends_at: null, paid_until: '2026-10-01' }, today).label).toBe('Renewal due');
    expect(subscriptionState({ subscription_status: null, trial_ends_at: null, paid_until: null }, today).label).toBe('No plan');

    const row = { id: 'x', name: 'Acme', status: 'active' as const, subscription_status: 'active' as const, trial_ends_at: null, paid_until: null, employee_limit: 50, employees: 10 };
    expect(attentionReasons(row, today)).toEqual([]);
    expect(attentionReasons({ ...row, employees: 46 }, today).map((r) => r.text)).toEqual(['Near the plan’s limit (46 of 50 employees)']);
    expect(attentionReasons({ ...row, status: 'suspended', subscription_status: 'past_due', employees: 50 }, today).map((r) => r.tone)).toEqual(['danger', 'danger', 'danger']);
    expect(attentionReasons({ ...row, subscription_status: 'trialing', trial_ends_at: '2026-10-31' }, today).map((r) => r.text)).toEqual(['Trial ends today']);
  });
});

describe('the platform activity log', () => {
  it('says what happened in words', () => {
    expect(describeActivity({ action: 'insert', entity_type: 'organizations', changes: { name: 'Acme', slug: 'acme' } })).toBe('Organization created: Acme (/app/acme)');
    expect(describeActivity({ action: 'update', entity_type: 'organizations', changes: { status: { from: 'active', to: 'suspended' } } })).toBe('Organization suspended');
    expect(describeActivity({ action: 'update', entity_type: 'organization_subscriptions', changes: { plan_code: { from: 'starter', to: 'growth' }, status: { from: 'trialing', to: 'active' } } }))
      .toBe('Plan and billing changed (plan: starter → growth; status: trial → active)');
    expect(describeActivity({ action: 'insert', entity_type: 'platform_admins', changes: { email: 'ops@example.test' } })).toBe('Platform administrator added: ops@example.test');
    expect(describeActivity({ action: 'update', entity_type: 'platform_settings', changes: { require_mfa_for_admins: true } })).toBe('Two-step sign-in for platform administrators turned on');
  });
});
