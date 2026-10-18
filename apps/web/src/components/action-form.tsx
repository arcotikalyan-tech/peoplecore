'use client';

import { useActionState, type ReactNode } from 'react';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { FormMessage } from './form-message';
import { SubmitButton } from './submit-button';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A server-action form: keeps typed values after a failed submit, shows the result, and renders its fields
 * from (values, fieldErrors). `hidden` carries ids bound to the item the form acts on.
 */
export function ActionForm({
  action, label, submit, pendingLabel = 'Saving…', hidden, className, variant, size, children,
}: {
  action: Action;
  label: string;
  submit: string;
  pendingLabel?: string;
  hidden?: Record<string, string>;
  className?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  children?: (values: Record<string, string>, errors: Record<string, string>) => ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const values = state.ok ? {} : (state.values ?? {});
  return (
    <form action={formAction} noValidate aria-label={label} className={className ?? 'space-y-4'}>
      <FormMessage state={state} />
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children?.(values, state.fieldErrors ?? {})}
      <SubmitButton pendingLabel={pendingLabel} variant={variant} size={size}>{submit}</SubmitButton>
    </form>
  );
}
