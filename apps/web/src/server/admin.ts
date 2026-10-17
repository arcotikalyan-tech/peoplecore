import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import { publicEnv } from '@/lib/env';

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * Rules: only call after an explicit authorization check in the calling server action, never return
 * its raw results to the client without filtering, and never import this from client components.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.');
  }
  return createClient<Database>(publicEnv().url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
