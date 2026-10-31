'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * React resets a form after its action runs, which puts uncontrolled fields back to their default values but leaves
 * component state as it was. Children of this scope mount again on every reset, so state that shapes the fields
 * (a chosen state's cities, a "same as" toggle) starts again from the re-filled values too.
 */
export function FormResetScope({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest('form');
    const again = () => setRound((r) => r + 1);
    form?.addEventListener('reset', again);
    return () => form?.removeEventListener('reset', again);
  }, []);
  return <div ref={ref} key={round} className="contents">{children}</div>;
}
