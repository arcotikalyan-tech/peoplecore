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

export function GoalForm({ action, employeeId, cycleId }: { action: Action; employeeId: string; cycleId?: string }) {
  return (
    <ActionForm action={action} label="Add a goal" submit="Add goal" hidden={{ employeeId, ...(cycleId ? { cycleId } : {}) }} className="space-y-3 border-t border-line px-5 py-4">
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

export function SkillRatingForm({ action, reviewId, as, skills, label }: {
  action: Action; reviewId: string; as: 'self' | 'manager'; label: string;
  skills: Array<{ skill_id: string; name: string; category: string; self_rating: number | null; manager_rating: number | null }>;
}) {
  return (
    <ActionForm action={action} label={label} submit="Save skill ratings" hidden={{ reviewId, as }} variant="secondary" size="sm" className="space-y-3 px-5 py-4">
      {(v) => (
        <div className="grid gap-2 sm:grid-cols-2">
          {skills.map((s) => (
            <SelectField key={s.skill_id} idPrefix={`sk-${reviewId}-${as}`} name={`skill:${s.skill_id}`} label={`${s.name} (${s.category})`}
              options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n}` }))} placeholder="—"
              defaultValue={v[`skill:${s.skill_id}`] ?? String((as === 'self' ? s.self_rating : s.manager_rating) ?? '')} />
          ))}
        </div>
      )}
    </ActionForm>
  );
}

export function PmsSettingsForm({ action, s }: { action: Action; s: { evaluation_period: string; rating_labels: string[]; goals_weight: number; goal_weightage: boolean; self_appraisal: boolean; peer_feedback: boolean } }) {
  const check = 'size-4 rounded border-line-strong accent-primary';
  return (
    <ActionForm action={action} label="Performance settings" submit="Save settings" className="space-y-4">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField idPrefix="pms" name="evaluationPeriod" label="Evaluation period" options={[{ value: 'quarterly', label: 'Quarterly' }, { value: 'half_yearly', label: 'Half-yearly' }, { value: 'annual', label: 'Annual' }]}
              defaultValue={v.evaluationPeriod ?? s.evaluation_period} />
            <TextField idPrefix="pms" name="goalsWeight" label="Goals weight in the overall rating (%)" inputMode="numeric" hint="Skills make up the rest."
              defaultValue={v.goalsWeight ?? String(s.goals_weight)} error={e.goalsWeight} />
          </div>
          <fieldset><legend className="mb-2 text-sm font-medium">Rating scale</legend>
            <div className="grid gap-2 sm:grid-cols-5">
              {[1, 2, 3, 4, 5].map((n) => <TextField key={n} idPrefix="pms" name={`label${n}`} label={`${n}`} defaultValue={v[`label${n}`] ?? s.rating_labels[n - 1] ?? ''} />)}
            </div>
          </fieldset>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="goalWeightage" defaultChecked={s.goal_weightage} className={check} />Goals in a cycle must add up to 100% before the self review</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="selfAppraisal" defaultChecked={s.self_appraisal} className={check} />Employees write a self-appraisal</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="peerFeedback" defaultChecked={s.peer_feedback} className={check} />Employees can ask colleagues for feedback</label>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function KraForm({ action, departments }: { action: Action; departments: Option[] }) {
  return (
    <ActionForm action={action} label="Add KRA" submit="＋ Add KRA" className="space-y-3">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_7rem]">
          <TextField idPrefix="kra" name="title" label="KRA" required placeholder="Deliver the quarterly roadmap" defaultValue={v.title ?? ''} error={e.title} />
          <SelectField idPrefix="kra" name="departmentId" label="Department" options={departments} placeholder="Everyone" defaultValue={v.departmentId ?? ''} />
          <TextField idPrefix="kra" name="weight" label="Weight (%)" inputMode="numeric" defaultValue={v.weight ?? '20'} error={e.weight} />
          <TextField idPrefix="kra" name="description" label="How it’s measured" className="sm:col-span-3" defaultValue={v.description ?? ''} error={e.description} />
        </div>
      )}
    </ActionForm>
  );
}

export function AssignKraForm({ action, kraId, title, cycles, departments }: { action: Action; kraId: string; title: string; cycles: Option[]; departments: Option[] }) {
  return (
    <ActionForm action={action} label={`Assign ${title}`} submit="Assign as goal" hidden={{ kraId }} variant="secondary" size="sm" className="flex flex-wrap items-end gap-2">
      {(v, e) => (
        <>
          <SelectField idPrefix={`ak-${kraId}`} name="cycleId" label="Cycle" options={cycles} placeholder="Choose…" defaultValue={v.cycleId ?? cycles[0]?.value ?? ''} error={e.cycleId} className="w-44" />
          <SelectField idPrefix={`ak-${kraId}`} name="departmentId" label="To" options={departments} placeholder="Everyone" defaultValue={v.departmentId ?? ''} className="w-44" />
        </>
      )}
    </ActionForm>
  );
}

export function SkillForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} label="Add skill" submit="＋ Add skill" className="space-y-3">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <TextField idPrefix="skill" name="name" label="Skill" required placeholder="Communication" defaultValue={v.name ?? ''} error={e.name} />
          <TextField idPrefix="skill" name="category" label="Category" required list="skill-categories" defaultValue={v.category ?? 'Core'} error={e.category} />
          <datalist id="skill-categories">{['Core', 'Technical', 'Leadership', 'Functional', 'Behavioural'].map((c) => <option key={c} value={c} />)}</datalist>
          <TextField idPrefix="skill" name="description" label="What good looks like" className="sm:col-span-2" defaultValue={v.description ?? ''} error={e.description} />
        </div>
      )}
    </ActionForm>
  );
}
