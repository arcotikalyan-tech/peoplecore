'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { initialActionState } from '@/lib/action-state';
import { requestAccess } from './actions';

const SIZES = ['1-25', '26-100', '101-500', '501-2000', '2000+'].map((v) => ({ value: v, label: `${v} employees` }));

export function SignupForm() {
  const [state, action] = useActionState(requestAccess, initialActionState);
  if (state.ok) return <FormMessage state={state} />;
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} aria-label="Sign up" className="space-y-4" noValidate>
      <FormMessage state={state} />
      <TextField name="company" label="Company name" required autoComplete="organization" defaultValue={v.company} error={e.company} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Your name" required autoComplete="name" defaultValue={v.name} error={e.name} />
        <TextField name="email" label="Work email" type="email" required autoComplete="email" defaultValue={v.email} error={e.email} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="phone" label="Phone" type="tel" autoComplete="tel" defaultValue={v.phone} error={e.phone} />
        <SelectField name="headcount" label="Team size" options={SIZES} placeholder="Choose…" defaultValue={v.headcount ?? ''} error={e.headcount} />
      </div>
      <TextAreaField name="message" label="Anything we should know?" defaultValue={v.message} error={e.message} hint="Optional: modules you need, when you want to start, current HR software." />
      <SubmitButton pendingLabel="Sending…">Sign up</SubmitButton>
      <p className="text-xs text-muted">We use these details only to set up your workspace and contact you about it.</p>
    </form>
  );
}
