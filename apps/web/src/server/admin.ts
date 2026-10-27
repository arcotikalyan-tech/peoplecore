import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import { publicEnv } from '@/lib/env';
import { DATABASE_TIMEOUT_MS, timedFetch } from '@/lib/timed-fetch';

/**
 * Service-role client, authenticated with the project's *secret* key. BYPASSES ROW LEVEL SECURITY.
 *
 * Rules: only call after an explicit authorization check in the calling server action, never return
 * its raw results to the client without filtering, and never import this from client components.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('SUPABASE_SECRET_KEY is not configured on the server.');
  }
  return createClient<Database>(publicEnv().url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timedFetch(DATABASE_TIMEOUT_MS) },
  });
}
