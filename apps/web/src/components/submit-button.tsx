'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './ui/button';

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant,
  size,
  'aria-label': ariaLabel,
  name,
  value,
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  /** Distinguishes repeated buttons, e.g. "Archive Engineering" in a table. */
  'aria-label'?: string;
  /** For forms with several submit buttons (e.g. approve / reject). */
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} name={name} value={value} disabled={pending || disabled} aria-live="polite" aria-label={ariaLabel}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
