'use client';

import { useEffect } from 'react';
import { clearFlash } from '@/app/app/flash-actions';
import { Alert } from './ui/surface';

/** Shows a one-time confirmation set by a server action (see server/flash.ts) and clears it. */
export function FlashMessage({ message }: { message: string }) {
  useEffect(() => {
    void clearFlash();
  }, [message]);
  return (
    <div className="mb-6">
      <Alert tone="success" title={message} />
    </div>
  );
}
