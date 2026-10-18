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
