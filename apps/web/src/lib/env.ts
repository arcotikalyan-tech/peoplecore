/**
 * Public Supabase settings (safe for the browser): project URL and *publishable* key. The secret key
 * is deliberately NOT here; it is read only in src/server/admin.ts.
 *
 * Written as literal `process.env.NEXT_PUBLIC_*` accesses so Next.js can inline them into client bundles.
 */
export function publicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local (see README).',
    );
  }
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
