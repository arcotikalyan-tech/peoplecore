/**
 * The promise's answer, or `fallback` once `ms` have passed (or it fails). For calls into the phone or the network
 * that can wait forever, such as a GPS fix indoors, so a button never spins without end.
 */
export async function within<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<F>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** How long a database request may take on the phone: longer than the website's 20 s, phone networks being slower. */
export const DATABASE_TIMEOUT_MS = 30_000;

/**
 * fetch with a deadline, for the Supabase client: without one a stalled connection leaves a screen loading for good.
 * The request then fails, and the screen shows its "check your connection" state. A caller's own signal still applies.
 * The timer keeps running after the headers arrive, so it covers reading the body too; aborting a finished request does
 * nothing. (By hand: React Native has neither AbortSignal.timeout nor AbortSignal.any.)
 */
export function timedFetch(ms: number): typeof fetch {
  return (input, init) => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), ms);
    const caller = init?.signal;
    if (caller?.aborted) stop.abort();
    else caller?.addEventListener('abort', () => stop.abort(), { once: true });
    return fetch(input, { ...init, signal: stop.signal });
  };
}
