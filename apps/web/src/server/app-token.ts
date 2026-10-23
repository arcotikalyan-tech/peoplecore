import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { Database } from '@peoplecore/db/types';
import { publicEnv } from '@/lib/env';

/** The phone app sends no cookies, only its sign-in token, so any origin may call the app endpoints. */
export const APP_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };

/**
 * The phone app's caller: a Supabase client acting as them (their token, so RLS applies exactly as on the website)
 * and their user id, once the token checks out. Null without a valid token.
 */
export async function appCaller(request: NextRequest): Promise<{ supabase: SupabaseClient<Database>; userId: string } | null> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  const { url, publishableKey } = publicEnv();
  const supabase = createClient<Database>(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  return userId ? { supabase, userId } : null;
}
