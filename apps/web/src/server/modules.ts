import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { outsidePlan, type ModuleKey } from '@/lib/modules';
import { requestShell } from './context';
import { createClient } from './supabase';

/** Modules the organization's plan includes (null: every module). Cached per request. */
export const planModules = cache(async (orgId: string): Promise<string[] | null> => {
  const shell = requestShell();
  if (shell.plans.has(orgId)) return shell.plans.get(orgId) ?? null;
  const supabase = await createClient();
  const { data } = await supabase.rpc('org_plan_modules', { p_org: orgId });
  return (data as string[] | null) ?? null;
});

/** Modules off for an organization: switched off (Settings › Module selector) or outside its plan. Cached per request. */
export const disabledModules = cache(async (orgId: string): Promise<Set<string>> => {
  const known = requestShell().disabled.get(orgId);
  if (known) return known;
  const supabase = await createClient();
  const [{ data }, plan] = await Promise.all([supabase.from('org_modules').select('module, enabled').eq('organization_id', orgId), planModules(orgId)]);
  return new Set([...(data ?? []).filter((m) => !m.enabled).map((m) => m.module), ...outsidePlan(plan)]);
});

/** For a module's pages: not found when the organization has switched it off. */
export async function requireModule(orgId: string, key: ModuleKey) {
  if ((await disabledModules(orgId)).has(key)) notFound();
}

export const orgControls = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from('org_controls').select('block_self_edit, salary_history_visible, birthdays_visible, require_mfa, notify_data_changes').eq('organization_id', orgId).maybeSingle();
  return data ?? { block_self_edit: false, salary_history_visible: true, birthdays_visible: true, require_mfa: false, notify_data_changes: false };
});
