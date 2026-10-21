import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { ModuleKey } from '@/lib/modules';
import { requestShell } from './context';
import { createClient } from './supabase';

/** Modules switched off for an organization (Settings › Module selector). Cached per request. */
export const disabledModules = cache(async (orgId: string): Promise<Set<string>> => {
  const known = requestShell().disabled.get(orgId);
  if (known) return known;
  const supabase = await createClient();
  const { data } = await supabase.from('org_modules').select('module, enabled').eq('organization_id', orgId);
  return new Set((data ?? []).filter((m) => !m.enabled).map((m) => m.module));
});

/** For a module's pages: not found when the organization has switched it off. */
export async function requireModule(orgId: string, key: ModuleKey) {
  if ((await disabledModules(orgId)).has(key)) notFound();
}

export const orgControls = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from('org_controls').select('block_self_edit, salary_history_visible, birthdays_visible, require_mfa').eq('organization_id', orgId).maybeSingle();
  return data ?? { block_self_edit: false, salary_history_visible: true, birthdays_visible: true, require_mfa: true };
});
