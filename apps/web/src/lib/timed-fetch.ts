/**
 * fetch with a deadline. The database is a network hop away (Seoul from the app server), and without one a stalled
 * connection holds a page for minutes (undici's default) instead of failing it. A caller's own signal still applies.
 */
export const DATABASE_TIMEOUT_MS = 20_000;

export function timedFetch(ms: number): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(ms);
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
  };
}
