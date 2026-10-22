import 'server-only';
import { cache } from 'react';
import { evaluateSetup, type SetupFacts, type SetupProgress } from '@/lib/org-setup';
import { disabledModules } from './modules';
import { createClient } from './supabase';

/**
 * Organization setup progress (dashboard card, Organization setup page, Settings › Setup wizard, Onboarding), from
 * org_setup_status: the same for everyone who runs setup. Null for anyone else.
 */
export const orgSetup = cache(async (orgId: string): Promise<SetupProgress | null> => {
  const supabase = await createClient();
  const [{ data, error }, disabled] = await Promise.all([supabase.rpc('org_setup_status', { p_org: orgId }), disabledModules(orgId)]);
  if (error) throw new Error('Failed to load organization setup');
  return data ? evaluateSetup(data as unknown as SetupFacts, disabled) : null;
});
