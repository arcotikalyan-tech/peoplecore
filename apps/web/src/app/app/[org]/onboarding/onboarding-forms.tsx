'use client';

import { useActionState } from 'react';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function StartOnboardingForm({ action, employees, templates }: { action: Action; employees: Option[]; templates: Option[] }) {
  return (
    <ActionForm action={action} label="Start onboarding" submit="Start onboarding" className="space-y-4 px-5 py-5">
      {(v, e) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField idPrefix="ob" name="employeeId" label="Employee" required options={employees} placeholder="Choose…" defaultValue={v.employeeId ?? ''} error={e.employeeId} />
          <SelectField idPrefix="ob" name="templateId" label="Template" options={templates} placeholder="Default template" defaultValue={v.templateId ?? ''} />
        </div>
      )}
    </ActionForm>
  );
}

export function TemplateTaskForm({ action, templateId }: { action: Action; templateId: string }) {
  return (
    <ActionForm action={action} label="Add a template task" submit="Add task" hidden={{ templateId }} className="space-y-3 border-t border-line px-5 py-4" size="sm">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_130px]">
          <TextField idPrefix={`tt-${templateId}`} name="title" label="Task" required placeholder="Order business cards" defaultValue={v.title} error={e.title} />
          <SelectField idPrefix={`tt-${templateId}`} name="assignee" label="For" options={[{ value: 'joiner', label: 'The joiner' }, { value: 'manager', label: 'Their manager' }, { value: 'owner', label: 'Template owner' }]} defaultValue={v.assignee ?? 'manager'} />
          <TextField idPrefix={`tt-${templateId}`} name="dueOffsetDays" label="Due (days from joining)" inputMode="numeric" defaultValue={v.dueOffsetDays ?? '0'} error={e.dueOffsetDays} />
        </div>
      )}
    </ActionForm>
  );
}

export function SmallAction({ action, label, submit, hidden }: { action: Action; label: string; submit: string; hidden: Record<string, string> }) {
  return <ActionForm action={action} label={label} submit={submit} hidden={hidden} className="inline-flex items-center gap-2" variant="ghost" size="sm" />;
}

export function PublishPolicyForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} label="Publish a policy" submit="Publish" className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <TextField idPrefix="pol" name="title" label="Title" required placeholder="Code of conduct" hint="Publishing an existing title creates a new version." defaultValue={v.title} error={e.title} />
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Policy text <span className="text-danger" aria-hidden="true">*</span></span>
            <textarea name="body" rows={8} defaultValue={v.body} aria-invalid={e.body ? true : undefined}
              className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
            {e.body && <span className="mt-1 block text-xs font-medium text-danger">{e.body}</span>}
          </label>
        </>
      )}
    </ActionForm>
  );
}

/** Activation: tick employees without a sign-in and invite them (Employee role, linked to their record). */
export function ActivationForm({ action, people }: { action: Action; people: Array<{ id: string; code: string; name: string; email: string | null }> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Invite employees" className="space-y-3">
      {state.message && <p role={state.ok ? 'status' : 'alert'} className={`text-sm ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</p>}
      <ul className="divide-y divide-line" aria-label="Not yet activated">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
            <input type="checkbox" name="employeeId" value={p.id} disabled={!p.email} defaultChecked={!!p.email} aria-label={`Invite ${p.name}`} className="size-4 rounded border-line-strong accent-primary" />
            <span className="flex-1"><span className="font-medium">{p.name}</span> <span className="text-xs text-muted">{p.code}</span></span>
            <span className="text-xs text-muted">{p.email ?? 'No work email'}</span>
          </li>
        ))}
      </ul>
      <SubmitButton pendingLabel="Inviting…">Send invitations (up to 25)</SubmitButton>
    </form>
  );
}
