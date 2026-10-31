import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/** A Supabase answer's data, or a thrown error so the screen shows "Couldn’t load this" instead of an empty list. */
export function must<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

/**
 * Loads a screen's data: skeletons on the first load, an error state if it fails, and quietly again whenever the
 * screen comes back into view (after a form closes, or switching tabs), so it never shows stale numbers.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const run = useRef(0);
  // `deps` are the caller's, as with useCallback.
  const load = useCallback(fn, deps);
  const reload = useCallback(async () => {
    const mine = ++run.current;
    try {
      const next = await load();
      if (mine !== run.current) return;
      setData(next);
      setError(false);
    } catch {
      if (mine === run.current) setError(true);
    } finally {
      if (mine === run.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => { setLoading(true); void reload(); }, [reload]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    void reload();
  }, [reload]));
  return { data, error, loading: loading && data === undefined, reload };
}
