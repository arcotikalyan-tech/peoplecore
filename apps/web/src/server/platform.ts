import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { BillingCycle, SubscriptionStatus } from '@/lib/plans';
import { isPlatformAdmin, requireMfaIfNeeded, requirePasswordSet, requireUser } from './context';
import { createClient } from './supabase';

/**
 * Every platform page: signed in, listed as a platform admin (anyone else gets a 404), a password chosen and two-step
 * done where the platform requires it. Data comes through functions that check platform-admin status again.
 */
export const requirePlatformAdmin = cache(async () => {
  const user = await requireUser();
  if (!(await isPlatformAdmin())) notFound();
  await requirePasswordSet('/platform');
  await requireMfaIfNeeded(user, '/platform');
  return user;
});

/** One organization as the console lists it (platform_org_overview): plan, subscription and usage counts. */
export interface PlatformOrg {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'archived';
  is_demo: boolean;
  created_at: string;
  timezone: string;
  country_code: string;
  plan_code: string | null;
  plan_name: string | null;
  subscription_status: SubscriptionStatus | null;
  billing_cycle: BillingCycle | null;
  trial_ends_at: string | null;
  paid_until: string | null;
  employee_limit: number | null;
  price_per_employee: number | null;
  base_price: number | null;
  annual_discount_pct: number | null;
  billing_email: string | null;
  employees: number;
  members: number;
  active_members_30d: number;
  last_sign_in_at: string | null;
  owner_emails: string[];
}

export const platformOrgs = cache(async (): Promise<PlatformOrg[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('platform_org_overview');
  if (error) throw new Error('Failed to load organizations');
  return (data ?? []) as unknown as PlatformOrg[];
});

export interface Plan {
  code: string;
  name: string;
  description: string | null;
  price_per_employee: number | null;
  base_price: number;
  annual_discount_pct: number;
  max_employees: number | null;
  modules: string[] | null;
  trial_days: number;
  is_active: boolean;
  sort_order: number;
}

export const platformPlans = cache(async (): Promise<Plan[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('platform_plans')
    .select('code, name, description, price_per_employee, base_price, annual_discount_pct, max_employees, modules, trial_days, is_active, sort_order')
    .order('sort_order').order('name');
  if (error) throw new Error('Failed to load plans');
  return data ?? [];
});

export const platformSettings = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from('platform_settings').select('require_mfa_for_admins, default_plan_code').maybeSingle();
  return { requireMfa: data?.require_mfa_for_admins ?? false, defaultPlan: data?.default_plan_code ?? 'starter' };
});

/** Sign-up requests from the website still waiting for someone (for the navigation badge). */
export const newRequestCount = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'new');
  return count ?? 0;
});

export interface ActivityRow {
  id: number;
  occurred_at: string;
  organization_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
}

export async function platformActivity(orgId: string | null, limit: number): Promise<ActivityRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('platform_activity', { p_org: orgId ?? undefined, p_limit: limit });
  return (data ?? []) as unknown as ActivityRow[];
}

/** Today in India (the console's working day), as YYYY-MM-DD. */
export function platformToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
