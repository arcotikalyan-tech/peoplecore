'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { PasswordField } from '@/components/ui/password-field';
import { initialActionState } from '@/lib/action-state';
import { PASSWORD_HINT } from '@/lib/password';
import { setPasswordAction } from './actions';

export function SetPasswordForm({ email, next, submit }: { email: string; next: string; submit: string }) {
  const [state, action] = useActionState(setPasswordAction, initialActionState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate aria-label="Set your password">
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next} />
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <p className="text-sm">Signing in as <span className="font-medium">{email}</span></p>
      <PasswordField name="password" label="New password" autoComplete="new-password" required hint={PASSWORD_HINT} error={e.password} />
      <PasswordField name="confirm" label="Confirm new password" autoComplete="new-password" required error={e.confirm} />
      <SubmitButton pendingLabel="Saving…">{submit}</SubmitButton>
    </form>
  );
}
