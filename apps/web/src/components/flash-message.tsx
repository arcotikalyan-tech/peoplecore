'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearFlash } from '@/app/app/flash-actions';
import { Alert } from './ui/surface';

/**
 * Shows a one-time confirmation set by a server action (see server/flash.ts) and clears the cookie. Clearing
 * refreshes the page without the message, so the message is kept here until the person goes to another page;
 * otherwise, on a fast connection, it would vanish as soon as it appeared.
 */
export function FlashMessage({ message }: { message: string | null }) {
  const pathname = usePathname();
  const [shown, setShown] = useState(message);
  const [page, setPage] = useState(pathname);
  if (pathname !== page) {
    setPage(pathname);
    setShown(message); // a new page keeps only its own message
  } else if (message && message !== shown) {
    setShown(message);
  }
  useEffect(() => {
    if (message) void clearFlash();
  }, [message]);
  if (!shown) return null;
  return (
    <div className="mb-6">
      <Alert tone="success" title={shown} />
    </div>
  );
}
