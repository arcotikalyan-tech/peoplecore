'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { PasswordField } from '@/components/ui/password-field';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { PASSWORD_HINT } from '@/lib/password';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function ChangePasswordForm({ action, email }: { action: Action; email: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state]);
  const e = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={formAction} noValidate aria-label="Change password" className="space-y-3">
      <FormMessage state={state} />
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <PasswordField name="current" label="Current password" autoComplete="current-password" required error={e.current} />
      <PasswordField name="password" label="New password" autoComplete="new-password" required hint={PASSWORD_HINT} error={e.password} />
      <PasswordField name="confirm" label="Confirm new password" autoComplete="new-password" required error={e.confirm} />
      <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
    </form>
  );
}

export function SignOutOthersButton({ action }: { action: () => Promise<ActionState> }) {
  const [state, formAction] = useActionState(async () => action(), initialActionState);
  return (
    <form action={formAction} aria-label="Sign out on other devices" className="flex flex-wrap items-center gap-3">
      <SubmitButton size="sm" variant="secondary" pendingLabel="Signing out…">Sign out on other devices</SubmitButton>
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}

/** Turning off one's own two-step sign-in, with a confirmation first. */
export function TurnOffTwoStepButton({ action }: { action: () => Promise<ActionState> }) {
  const [state, formAction] = useActionState(async () => action(), initialActionState);
  const [asking, setAsking] = useState(false);
  if (!asking && !state.message) {
    return <button type="button" className="text-sm text-danger hover:underline" onClick={() => setAsking(true)}>Turn off</button>;
  }
  return (
    <form action={formAction} aria-label="Turn off two-step sign-in" className="flex flex-wrap items-center gap-3">
      {!state.ok && <>
        <span className="text-xs text-muted">Your password alone will open your account.</span>
        <SubmitButton size="sm" variant="danger" pendingLabel="Turning off…">Yes, turn it off</SubmitButton>
      </>}
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}
