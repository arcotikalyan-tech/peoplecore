'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './ui/button';

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant,
  size,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-live="polite">
      {pending ? pendingLabel : children}
    </Button>
  );
}
