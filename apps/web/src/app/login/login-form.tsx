'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { TextField } from '@/components/ui/fields';
import { PasswordField } from '@/components/ui/password-field';
import { initialActionState } from '@/lib/action-state';
import { sendMagicLink, signInWithPassword } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [pwState, pwAction] = useActionState(signInWithPassword, initialActionState);
  const [linkState, linkAction] = useActionState(sendMagicLink, initialActionState);

  return (
    <div className="space-y-5">
      {mode === 'password' ? (
        <form action={pwAction} className="space-y-4" noValidate>
          <input type="hidden" name="next" value={next} />
          <FormMessage state={pwState} />
          <TextField name="email" label="Work email" type="email" autoComplete="username" required defaultValue={pwState.values?.email} />
          <PasswordField name="password" label="Password" autoComplete="current-password" required />
          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
        </form>
      ) : (
        <form action={linkAction} className="space-y-4" noValidate>
          <input type="hidden" name="next" value={next} />
          <FormMessage state={linkState} />
          <TextField name="email" label="Work email" type="email" autoComplete="email" required />
          <SubmitButton pendingLabel="Sending…">Email me a sign-in link</SubmitButton>
        </form>
      )}
      <button
        type="button"
        onClick={() => setMode(mode === 'password' ? 'link' : 'password')}
        className="text-sm font-medium text-primary hover:underline"
      >
        {mode === 'password' ? 'Sign in with an email link instead' : 'Sign in with a password instead'}
      </button>
    </div>
  );
}
