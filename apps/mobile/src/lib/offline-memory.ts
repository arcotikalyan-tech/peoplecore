import type { KeyValueStore } from './punch-queue';

/**
 * What the phone remembers so that it can be restarted with no signal and still offer Check in: where this person works,
 * and today's punches (without them the day would read as not checked in). Each person's own; the server decides
 * everything once there's a connection again. No React Native imports.
 */
type Store = KeyValueStore & { removeItem?(key: string): Promise<void> };

const workplaceKey = (userId: string) => `workplace.last.${userId}`;
const punchesKey = (employeeId: string) => `today.punches.${employeeId}`;

async function read<T>(store: Store, key: string): Promise<T | null> {
  try {
    const saved = await store.getItem(key);
    return saved ? (JSON.parse(saved) as T) : null;
  } catch {
    return null;
  }
}

async function write(store: Store, key: string, value: unknown): Promise<void> {
  await store.setItem(key, JSON.stringify(value)).catch(() => undefined);
}

export function rememberWorkplace<T>(store: Store, userId: string, workplace: T): Promise<void> {
  return write(store, workplaceKey(userId), workplace);
}

export function rememberedWorkplace<T>(store: Store, userId: string): Promise<T | null> {
  return read<T>(store, workplaceKey(userId));
}

export async function forgetWorkplace(store: Store, userId: string): Promise<void> {
  await store.removeItem?.(workplaceKey(userId)).catch(() => undefined);
}

export function rememberPunches<T>(store: Store, employeeId: string, date: string, punches: T[]): Promise<void> {
  return write(store, punchesKey(employeeId), { date, punches });
}

/** Today's punches as last read; none if what's saved is from another day. */
export async function rememberedPunches<T>(store: Store, employeeId: string, date: string): Promise<T[]> {
  const saved = await read<{ date: string; punches: T[] }>(store, punchesKey(employeeId));
  return saved?.date === date && Array.isArray(saved.punches) ? saved.punches : [];
}
