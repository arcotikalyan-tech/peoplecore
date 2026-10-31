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
  formAction,
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
  /** A second action for the same form (e.g. "Send me a test" next to "Save"). */
  formAction?: React.ComponentProps<'button'>['formAction'];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} name={name} value={value} formAction={formAction} disabled={pending || disabled} aria-live="polite" aria-label={ariaLabel}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
