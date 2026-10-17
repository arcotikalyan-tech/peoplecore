'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './ui/button';

export function SubmitButton({ children, pendingLabel = 'Saving…', variant }: { children: React.ReactNode; pendingLabel?: string; variant?: 'primary' | 'secondary' | 'danger' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-live="polite">
      {pending ? pendingLabel : children}
    </Button>
  );
}
