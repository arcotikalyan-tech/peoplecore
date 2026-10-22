'use client';

import { useActionState, useEffect, useRef } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** A form that clears itself once its action succeeds. */
function useClearingForm(action: Action) {
  const [state, formAction] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state]);
  return { state, formAction, ref, v: state.ok ? {} : (state.values ?? {}), e: state.fieldErrors ?? {} };
}

export function NewThreadForm({ action, topics, topicId }: { action: Action; topics: Option[]; topicId?: string }) {
  const { state, formAction, ref, v, e } = useClearingForm(action);
  return (
    <form ref={ref} action={formAction} noValidate aria-label="Start a discussion" className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <SelectField idPrefix="kt" name="topicId" label="Topic" required options={topics} defaultValue={v.topicId ?? topicId ?? topics[0]?.value} error={e.topicId} />
        <TextField idPrefix="kt" name="title" label="Title" required placeholder="What’s it about?" defaultValue={v.title} error={e.title} />
      </div>
      <TextAreaField idPrefix="kt" name="body" label="Message" required rows={4} defaultValue={v.body} error={e.body} />
      <SubmitButton pendingLabel="Posting…">Post discussion</SubmitButton>
    </form>
  );
}

export function EditThreadForm({ action, title, body }: { action: Action; title: string; body: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Edit discussion" className="space-y-3">
      <FormMessage state={state} />
      <TextField idPrefix="ke" name="title" label="Title" required defaultValue={v.title ?? title} error={e.title} />
      <TextAreaField idPrefix="ke" name="body" label="Message" required rows={5} defaultValue={v.body ?? body} error={e.body} />
      <SubmitButton size="sm" pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}

export function ReplyForm({ action }: { action: Action }) {
  const { state, formAction, ref, v, e } = useClearingForm(action);
  return (
    <form ref={ref} action={formAction} noValidate aria-label="Reply" className="space-y-2">
      <FormMessage state={state} />
      <TextAreaField idPrefix="kr" name="body" label="Your reply" required rows={3} defaultValue={v.body} error={e.body} />
      <SubmitButton size="sm" pendingLabel="Posting…">Reply</SubmitButton>
    </form>
  );
}

export function TopicForm({ action }: { action: Action }) {
  const { state, formAction, ref, v, e } = useClearingForm(action);
  return (
    <form ref={ref} action={formAction} noValidate aria-label="Add a topic" className="space-y-2">
      <FormMessage state={state} />
      <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
        <TextField idPrefix="tp" name="emoji" label="Emoji" placeholder="📣" defaultValue={v.emoji} error={e.emoji} />
        <TextField idPrefix="tp" name="name" label="Topic" required placeholder="Wellness" defaultValue={v.name} error={e.name} />
      </div>
      <TextField idPrefix="tp" name="description" label="What it’s for" defaultValue={v.description} error={e.description} />
      <SubmitButton size="sm" variant="secondary">＋ Add topic</SubmitButton>
    </form>
  );
}
