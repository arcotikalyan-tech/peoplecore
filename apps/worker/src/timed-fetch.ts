/**
 * fetch with a deadline, so one stalled connection (the database, Firebase) can't hold the worker's loop for minutes
 * (undici's default) while every other job waits. A caller's own signal still applies.
 */
export function timedFetch(ms: number): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(ms);
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
  };
}
