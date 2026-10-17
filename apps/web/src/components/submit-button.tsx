'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './ui/button';

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant,
  size,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  /** Distinguishes repeated buttons, e.g. "Archive Engineering" in a table. */
  'aria-label'?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-live="polite" aria-label={ariaLabel}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
