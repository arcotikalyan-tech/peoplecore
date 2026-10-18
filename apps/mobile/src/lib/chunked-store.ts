import type { KeyValueStore } from './punch-queue';

/**
 * Secure storage for the session. Device keychains limit the size of one value (about 2 KB on iOS) and a
 * Supabase session can be larger, so values are split across numbered keys. No React Native imports.
 */
export interface SecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const CHUNK = 1800;
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_'); // keychain keys allow only these

export function chunkedStore(secure: SecureStore): KeyValueStore & { removeItem(key: string): Promise<void> } {
  return {
    async getItem(key) {
      const k = safe(key);
      const count = Number(await secure.getItemAsync(`${k}.n`));
      if (!count) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await secure.getItemAsync(`${k}.${i}`);
        if (part === null) return null; // half-written: treat as absent
        parts.push(part);
      }
      return parts.join('');
    },
    async setItem(key, value) {
      const k = safe(key);
      const old = Number(await secure.getItemAsync(`${k}.n`)) || 0;
      const count = Math.max(1, Math.ceil(value.length / CHUNK));
      for (let i = 0; i < count; i++) await secure.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
      await secure.setItemAsync(`${k}.n`, String(count));
      for (let i = count; i < old; i++) await secure.deleteItemAsync(`${k}.${i}`);
    },
    async removeItem(key) {
      const k = safe(key);
      const count = Number(await secure.getItemAsync(`${k}.n`)) || 0;
      for (let i = 0; i < count; i++) await secure.deleteItemAsync(`${k}.${i}`);
      await secure.deleteItemAsync(`${k}.n`);
    },
  };
}
