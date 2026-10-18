'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export const RATINGS: Option[] = [
  { value: '5', label: '5 · Exceptional' }, { value: '4', label: '4 · Exceeds expectations' }, { value: '3', label: '3 · Meets expectations' },
  { value: '2', label: '2 · Partly meets' }, { value: '1', label: '1 · Below expectations' },
];

function Comments({ name, label, value, error }: { name: string; label: string; value?: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      <textarea name={name} rows={4} defaultValue={value} className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" aria-invalid={error ? true : undefined} />
      {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
    </label>
  );
}

export function GoalForm({ action, employeeId }: { action: Action; employeeId: string }) {
  return (
    <ActionForm action={action} label="Add a goal" submit="Add goal" hidden={{ employeeId }} className="space-y-3 border-t border-line px-5 py-4">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <TextField idPrefix={`goal-${employeeId}`} name="title" label="Goal" required placeholder="Launch the new billing flow by Q3" defaultValue={v.title} error={e.title} />
          <TextField idPrefix={`goal-${employeeId}`} name="weight" label="Weight (%)" inputMode="numeric" defaultValue={v.weight ?? '0'} error={e.weight} />
        </div>
      )}
    </ActionForm>
  );
}

export function GoalProgressForm({ action, goalId, title, progress, status }: { action: Action; goalId: string; title: string; progress: number; status: string }) {
  return (
    <ActionForm action={action} label={`Update ${title}`} submit="Update" hidden={{ goalId }} variant="secondary" size="sm" className="flex flex-wrap items-end gap-2">
      {() => (
        <>
          <TextField idPrefix={`gp-${goalId}`} name="progress" label="Progress %" inputMode="numeric" defaultValue={String(progress)} className="w-28" />
          <SelectField idPrefix={`gp-${goalId}`} name="status" label="Status" options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'dropped', label: 'Dropped' }]} defaultValue={status} />
        </>
      )}
    </ActionForm>
  );
}

export function ReviewForm({ action, reviewId, label, submit }: { action: Action; reviewId: string; label: string; submit: string }) {
  return (
    <ActionForm action={action} label={label} submit={submit} hidden={{ reviewId }} className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <SelectField idPrefix={`rv-${reviewId}`} name="rating" label="Rating" required options={RATINGS} placeholder="Choose…" defaultValue={v.rating ?? ''} error={e.rating} />
          <Comments name="comments" label="Comments" value={v.comments} error={e.comments} />
        </>
      )}
    </ActionForm>
  );
}

export function FeedbackRequestForm({ action, reviewId, colleagues }: { action: Action; reviewId: string; colleagues: Option[] }) {
  return (
    <ActionForm action={action} label="Ask for feedback" submit="Ask" hidden={{ reviewId }} variant="secondary" className="space-y-3 border-t border-line px-5 py-4">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField idPrefix={`fb-${reviewId}`} name="fromId" label="Colleague" required options={colleagues} placeholder="Choose…" defaultValue={v.fromId ?? ''} error={e.fromId} />
          <TextField idPrefix={`fb-${reviewId}`} name="question" label="Question" required defaultValue={v.question ?? 'What should I keep doing, and what should I change?'} error={e.question} />
        </div>
      )}
    </ActionForm>
  );
}

export function GiveFeedbackForm({ action, requestId, question }: { action: Action; requestId: string; question: string }) {
  return (
    <ActionForm action={action} label={`Answer: ${question}`} submit="Send feedback" hidden={{ requestId }} className="space-y-3 px-5 py-4">
      {(v, e) => <Comments name="response" label={question} value={v.response} error={e.response} />}
    </ActionForm>
  );
}

export function CycleForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} label="New review cycle" submit="Create cycle" className="space-y-3 px-5 py-5">
      {(v, e) => (
        <>
          <TextField idPrefix="cy" name="name" label="Name" required placeholder="FY26 annual review" defaultValue={v.name} error={e.name} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="cy" name="periodStart" label="Period from" type="date" required defaultValue={v.periodStart} error={e.periodStart} />
            <TextField idPrefix="cy" name="periodEnd" label="Period to" type="date" required defaultValue={v.periodEnd} error={e.periodEnd} />
            <TextField idPrefix="cy" name="selfReviewDue" label="Self reviews due" type="date" defaultValue={v.selfReviewDue} />
            <TextField idPrefix="cy" name="managerReviewDue" label="Manager reviews due" type="date" defaultValue={v.managerReviewDue} />
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function SmallAction({ action, label, submit, hidden, variant = 'primary' }: { action: Action; label: string; submit: string; hidden: Record<string, string>; variant?: 'primary' | 'secondary' }) {
  return <ActionForm action={action} label={label} submit={submit} hidden={hidden} variant={variant} size="sm" className="space-y-2" />;
}

export function CalibrateForm({ action, reviewId, current, name }: { action: Action; reviewId: string; current: number | null; name: string }) {
  return (
    <ActionForm action={action} label={`Calibrate ${name}`} submit="Save" hidden={{ reviewId }} variant="secondary" size="sm" className="flex flex-wrap items-end gap-2">
      {() => (
        <>
          <SelectField idPrefix={`cal-${reviewId}`} name="rating" label="Final" options={RATINGS} defaultValue={current ? String(current) : ''} />
          <TextField idPrefix={`cal-${reviewId}`} name="note" label="Note (needed if it differs)" className="min-w-48" />
        </>
      )}
    </ActionForm>
  );
}
