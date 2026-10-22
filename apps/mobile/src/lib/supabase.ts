import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { chunkedStore } from './chunked-store';

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

export const supabase = createClient(url ?? 'http://127.0.0.1:54321', key ?? 'not-configured', {
  auth: {
    storage: Platform.OS === 'web' ? webStore : chunkedStore(SecureStore),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Checks a password with a separate client that keeps nothing, so the signed-in session is untouched. */
export async function passwordIsRight(email: string, password: string): Promise<boolean> {
  const memory = new Map<string, string>();
  const check = createClient(url ?? 'http://127.0.0.1:54321', key ?? 'not-configured', {
    auth: {
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: async (k) => memory.get(k) ?? null, setItem: async (k, v) => { memory.set(k, v); }, removeItem: async (k) => { memory.delete(k); } },
    },
  });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (!error) await check.auth.signOut({ scope: 'local' });
  return !error;
}
