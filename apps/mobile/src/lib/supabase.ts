import { createClient, type Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { chunkedStore } from './chunked-store';
import { DATABASE_TIMEOUT_MS, timedFetch } from './timeout';

/**
 * Supabase as the signed-in person: the publishable key only (RLS decides everything; the secret key never
 * reaches a device). The session lives in the device keychain; on the web build, in localStorage.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isConfigured = Boolean(url && key);

const webStore = {
  getItem: async (k: string) => globalThis.localStorage?.getItem(k) ?? null,
  setItem: async (k: string, v: string) => { globalThis.localStorage?.setItem(k, v); },
  removeItem: async (k: string) => { globalThis.localStorage?.removeItem(k); },
};

const network = { fetch: timedFetch(DATABASE_TIMEOUT_MS) };
const sessionStore = Platform.OS === 'web' ? webStore : chunkedStore(SecureStore);

export const supabase = createClient(url ?? 'http://127.0.0.1:54321', key ?? 'not-configured', {
  global: network,
  auth: {
    storage: sessionStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * The session as saved on this device, when it can't be read the usual way: Supabase answers "nobody" while a token that
 * has expired can't be renewed, though the session is safe and is renewed once there's a connection. Its key is the one
 * Supabase uses by default.
 */
export async function savedSession(): Promise<Session | null> {
  const key = `sb-${new URL(url ?? 'http://127.0.0.1:54321').hostname.split('.')[0]}-auth-token`;
  try {
    const saved = await sessionStore.getItem(key);
    const session = saved ? (JSON.parse(saved) as Session) : null;
    return session?.user?.id ? session : null;
  } catch {
    return null;
  }
}

/** Checks a password with a separate client that keeps nothing, so the signed-in session is untouched. */
export async function passwordIsRight(email: string, password: string): Promise<boolean> {
  const memory = new Map<string, string>();
  const check = createClient(url ?? 'http://127.0.0.1:54321', key ?? 'not-configured', {
    global: network,
    auth: {
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: async (k) => memory.get(k) ?? null, setItem: async (k, v) => { memory.set(k, v); }, removeItem: async (k) => { memory.delete(k); } },
    },
  });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (!error) await check.auth.signOut({ scope: 'local' });
  return !error;
}
