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
