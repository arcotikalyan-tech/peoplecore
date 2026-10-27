import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@peoplecore/db/types';
import { publicEnv } from '@/lib/env';
import { DATABASE_TIMEOUT_MS, timedFetch } from '@/lib/timed-fetch';

/**
 * Supabase client acting as the signed-in user (publishable key + session cookie). Every query is subject
 * to Row Level Security — this is the client all feature code should use.
 */
export async function createClient() {
  // Read cookies first: it marks the route as per-request, so a missing env var fails at request
  // time with a clear message instead of breaking static prerendering at build time.
  const cookieStore = await cookies();
  const { url, publishableKey } = publicEnv();
  return createServerClient<Database>(url, publishableKey, {
    global: { fetch: timedFetch(DATABASE_TIMEOUT_MS) },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. proxy.ts refreshes the session.
        }
      },
    },
  });
}
