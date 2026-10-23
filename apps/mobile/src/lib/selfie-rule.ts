import type { KeyValueStore } from './punch-queue';

/**
 * Whether the person's attendance rule asks for a selfie. Asked again before every check-in and check-out and whenever
 * the app comes back to the front, since HR can switch it on at any time. The last answer stays on the phone for
 * check-ins made offline or when the server is slow to answer. `ask` returns null when the server can't be asked.
 */
export async function selfieRequired(store: KeyValueStore, employeeId: string, ask: () => Promise<boolean | null>, timeoutMs = 5000): Promise<boolean> {
  const key = `selfie.required.${employeeId}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answer = await Promise.race([
    ask().catch(() => null),
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
  ]);
  clearTimeout(timer);
  if (answer === null) return (await store.getItem(key)) === '1';
  await store.setItem(key, answer ? '1' : '0');
  return answer;
}
