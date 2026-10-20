'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Counted = ActionState & { n?: number };
type Opt = { value: string; label: string };

function useCounted(action: Action) {
  const [state, formAction] = useActionState<Counted, FormData>(async (prev, fd) => ({ ...(await action(prev, fd)), n: (prev.n ?? 0) + 1 }), initialActionState);
  return { state, formAction, n: state.n ?? 0, v: state.ok ? {} : (state.values ?? {}), e: state.fieldErrors ?? {} };
}
const checkbox = 'size-4 rounded border-line-strong accent-primary';
const LEVELS: Opt[] = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `Level ${n}` }));

function Simple({ action, label, submit, children, variant = 'primary' }: {
  action: Action; label: string; submit: string; children: (v: Record<string, string>, e: Record<string, string>) => ReactNode; variant?: 'primary' | 'secondary';
}) {
  const { state, formAction, n, v, e } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label={label} className="space-y-3">
      <FormMessage state={state} />
      <div key={n} className="space-y-3">{children(v, e)}</div>
      <SubmitButton size="sm" variant={variant}>{submit}</SubmitButton>
    </form>
  );
}

/** Buttons that post hidden values (status changes, deletes, rule toggles). */
export function Buttons({ action, hidden, label, buttons, confirm }: {
  action: Action; hidden: Record<string, string>; label: string; buttons: Array<{ text: string; name?: string; value?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }>; confirm?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={label} className="inline-flex flex-wrap items-center gap-1" onSubmit={(ev) => { if (confirm && !window.confirm(confirm)) ev.preventDefault(); }}>
      {Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      {buttons.map((b) => <SubmitButton key={b.text} size="sm" variant={b.variant ?? 'ghost'} name={b.name} value={b.value} pendingLabel="…">{b.text}</SubmitButton>)}
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}

/** A button for an action that takes no fields (run rules now, remind everyone overdue). */
export function RunButton({ action, label, children }: { action: () => Promise<ActionState>; label: string; children: string }) {
  const [state, formAction] = useActionState(async () => action(), initialActionState);
  return (
    <form action={formAction} aria-label={label} className="inline-flex items-center gap-2">
      <SubmitButton size="sm" variant="secondary" pendingLabel="Working…">{children}</SubmitButton>
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}

export function LessonForm({ action, courseId, lesson }: {
  action: Action; courseId: string; lesson?: { id: string; position: number; title: string; kind: string; body: string | null; url: string | null; duration_minutes: number | null };
}) {
  const [kind, setKind] = useState(lesson?.kind ?? 'text');
  const p = `les-${lesson?.id ?? 'new'}`;
  return (
    <Simple action={action} label={lesson ? `Lesson ${lesson.title}` : 'New lesson'} submit={lesson ? 'Save lesson' : '＋ Add lesson'} variant={lesson ? 'secondary' : 'primary'}>{(v, e) => (
      <>
        <input type="hidden" name="courseId" value={courseId} />
        {lesson && <input type="hidden" name="lessonId" value={lesson.id} />}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_6rem]">
          <TextField idPrefix={p} name="title" label="Lesson" required defaultValue={v.title ?? lesson?.title ?? ''} error={e.title} />
          <SelectField idPrefix={p} name="kind" label="Type" value={kind} onChange={(ev) => setKind(ev.target.value)} options={[{ value: 'text', label: 'Text' }, { value: 'video', label: 'Video' }, { value: 'link', label: 'Link' }]} />
          <TextField idPrefix={p} name="minutes" label="Minutes" inputMode="numeric" defaultValue={v.minutes ?? (lesson?.duration_minutes ?? '').toString()} />
          {lesson && <TextField idPrefix={p} name="position" label="Order" inputMode="numeric" defaultValue={v.position ?? String(lesson.position)} />}
        </div>
        {kind !== 'text' && <TextField idPrefix={p} name="url" label="Link (https://)" required defaultValue={v.url ?? lesson?.url ?? ''} error={e.url} />}
        <TextAreaField idPrefix={p} name="body" label={kind === 'text' ? 'Content' : 'Notes'} rows={kind === 'text' ? 6 : 2} defaultValue={v.body ?? lesson?.body ?? ''} />
      </>
    )}</Simple>
  );
}

export function SkillForm({ action }: { action: Action }) {
  return (
    <Simple action={action} label="New skill" submit="＋ Add skill">{(v, e) => (
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField idPrefix="skill" name="name" label="Skill" required defaultValue={v.name ?? ''} error={e.name} />
        <TextField idPrefix="skill" name="category" label="Category" placeholder="e.g. Security" defaultValue={v.category ?? ''} />
      </div>
    )}</Simple>
  );
}

export function CourseSkillForm({ action, courseId, skills }: { action: Action; courseId: string; skills: Opt[] }) {
  return (
    <Simple action={action} label="Add a skill this course teaches" submit="Add skill" variant="secondary">{(v, e) => (
      <div className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="courseId" value={courseId} />
        <SelectField idPrefix="cs" name="skillId" label="Skill" required defaultValue={v.skillId ?? ''} options={skills} placeholder={skills.length ? 'Choose…' : 'Add skills under Learn › Skills'} error={e.skillId} />
        <SelectField idPrefix="cs" name="level" label="Level taught" defaultValue={v.level ?? '2'} options={LEVELS} />
      </div>
    )}</Simple>
  );
}

export function RoleSkillForm({ action, designations, skills }: { action: Action; designations: Opt[]; skills: Opt[] }) {
  return (
    <Simple action={action} label="Role requirement" submit="Add requirement" variant="secondary">{(v, e) => (
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField idPrefix="rs" name="designationId" label="Designation" required defaultValue={v.designationId ?? ''} options={designations} placeholder="Choose…" error={e.designationId} />
        <SelectField idPrefix="rs" name="skillId" label="Skill" required defaultValue={v.skillId ?? ''} options={skills} placeholder="Choose…" error={e.skillId} />
        <SelectField idPrefix="rs" name="level" label="Required level" defaultValue={v.level ?? '2'} options={LEVELS} />
      </div>
    )}</Simple>
  );
}

/** A journey: title, points and an ordered list of published courses (one select per step). */
export function JourneyForm({ action, courses, journey }: {
  action: Action; courses: Opt[]; journey?: { id: string; title: string; description: string | null; points: number; status: string; steps: string[] };
}) {
  const [steps, setSteps] = useState(Math.max(journey?.steps.length ?? 0, 2));
  const p = `jr-${journey?.id ?? 'new'}`;
  return (
    <Simple action={action} label={journey ? `Journey ${journey.title}` : 'New journey'} submit={journey ? 'Save journey' : '＋ New journey'} variant={journey ? 'secondary' : 'primary'}>{(v, e) => (
      <>
        {journey && <input type="hidden" name="journeyId" value={journey.id} />}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem]">
          <TextField idPrefix={p} name="title" label="Journey" required defaultValue={v.title ?? journey?.title ?? ''} error={e.title} />
          <TextField idPrefix={p} name="points" label="Points" inputMode="numeric" defaultValue={v.points ?? String(journey?.points ?? 0)} />
          <SelectField idPrefix={p} name="status" label="Status" defaultValue={v.status ?? journey?.status ?? 'draft'} options={[{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }]} />
        </div>
        <TextField idPrefix={p} name="description" label="Description" defaultValue={v.description ?? journey?.description ?? ''} />
        <fieldset><legend className="mb-1 text-xs font-medium text-muted">Courses, in order</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: steps }, (_, i) => (
              <SelectField key={i} idPrefix={`${p}-s${i}`} name="courseId" label={`Step ${i + 1}`} defaultValue={journey?.steps[i] ?? ''} options={[{ value: '', label: '—' }, ...courses]} />
            ))}
          </div>
          {steps < 20 && <button type="button" onClick={() => setSteps((n) => n + 1)} className="mt-2 text-xs text-primary">＋ Add step</button>}
        </fieldset>
      </>
    )}</Simple>
  );
}

export function AssignJourneyForm({ action, journeyId, people, today }: { action: Action; journeyId: string; people: Opt[]; today: string }) {
  const { state, formAction, n } = useCounted(action);
  const [q, setQ] = useState('');
  const shown = people.filter((x) => x.label.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return (
    <form action={formAction} aria-label="Assign journey" className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="journeyId" value={journeyId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField idPrefix={`aj-${journeyId}`} name="q" label="Find people" value={q} onChange={(ev) => setQ(ev.target.value)} />
        <TextField idPrefix={`aj-${journeyId}`} name="dueOn" label="Due" type="date" min={today} />
      </div>
      <div key={n} className="scroll-thin flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {shown.map((x) => <label key={x.value} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs"><input type="checkbox" name="employeeId" value={x.value} className={checkbox} />{x.label}</label>)}
      </div>
      <SubmitButton size="sm" variant="secondary">Assign</SubmitButton>
    </form>
  );
}

export function RuleForm({ action, targets, departments, designations, locations }: { action: Action; targets: Opt[]; departments: Opt[]; designations: Opt[]; locations: Opt[] }) {
  const any = (o: Opt[]) => [{ value: '', label: 'Any' }, ...o];
  return (
    <Simple action={action} label="New rule" submit="＋ New rule">{(v, e) => (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField idPrefix="rule" name="name" label="Rule" required placeholder="POSH for every new joiner" defaultValue={v.name ?? ''} error={e.name} />
          <SelectField idPrefix="rule" name="target" label="Assigns" required defaultValue={v.target ?? ''} options={targets} placeholder="Choose a course or journey…" error={e.target} />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <SelectField idPrefix="rule" name="departmentId" label="Department" defaultValue={v.departmentId ?? ''} options={any(departments)} />
          <SelectField idPrefix="rule" name="designationId" label="Designation" defaultValue={v.designationId ?? ''} options={any(designations)} />
          <SelectField idPrefix="rule" name="locationId" label="Location" defaultValue={v.locationId ?? ''} options={any(locations)} />
          <SelectField idPrefix="rule" name="employmentType" label="Employee type" defaultValue={v.employmentType ?? ''}
            options={any([{ value: 'permanent', label: 'Permanent' }, { value: 'contract', label: 'Contract' }, { value: 'intern', label: 'Intern' }, { value: 'temporary', label: 'Temporary' }, { value: 'consultant', label: 'Consultant' }])} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField idPrefix="rule" name="trigger" label="Trigger" defaultValue={v.trigger ?? 'new_joiners'} options={[{ value: 'new_joiners', label: 'New joiners from now' }, { value: 'everyone', label: 'Everyone matching, now and later' }]} />
          <TextField idPrefix="rule" name="dueDays" label="Due (days after assigning)" inputMode="numeric" defaultValue={v.dueDays ?? '14'} error={e.dueDays} />
          <SelectField idPrefix="rule" name="recurrence" label="Recurrence" defaultValue={v.recurrence ?? 'none'} options={[{ value: 'none', label: 'Once' }, { value: 'yearly', label: 'Every year' }]} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mandatory" defaultChecked className={checkbox} />Mandatory</label>
      </>
    )}</Simple>
  );
}

export function LearnSettingsForm({ action, s }: { action: Action; s: { journey_points: number; due_soon_days: number; overdue_alerts: boolean; certificate_accent: string; signature_name: string | null; signature_title: string | null } }) {
  return (
    <Simple action={action} label="Learn settings" submit="Save settings">{(v, e) => (
      <>
        <h3 className="text-sm font-semibold">🎮 Gamification</h3>
        <p className="text-xs text-muted">Points are paid into the PeopleXP wallet. Each course sets its own completion points on its page.</p>
        <TextField idPrefix="ls" name="journeyPoints" label="Journey complete (points)" inputMode="numeric" className="max-w-xs" defaultValue={v.journeyPoints ?? String(s.journey_points)} error={e.journeyPoints} />
        <h3 className="pt-2 text-sm font-semibold">🔔 Reminders</h3>
        <TextField idPrefix="ls" name="dueSoonDays" label="Due-soon nudge (days before the due date; 0 = off)" inputMode="numeric" className="max-w-xs" defaultValue={v.dueSoonDays ?? String(s.due_soon_days)} error={e.dueSoonDays} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="overdueAlerts" defaultChecked={s.overdue_alerts} className={checkbox} />Overdue alerts to the learner and whoever assigned it</label>
        <h3 className="pt-2 text-sm font-semibold">🎓 Certificate</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField idPrefix="ls" name="accent" label="Accent colour" type="color" defaultValue={v.accent ?? s.certificate_accent} />
          <TextField idPrefix="ls" name="signatureName" label="Signature name" defaultValue={v.signatureName ?? s.signature_name ?? ''} />
          <TextField idPrefix="ls" name="signatureTitle" label="Signature title" defaultValue={v.signatureTitle ?? s.signature_title ?? ''} />
        </div>
      </>
    )}</Simple>
  );
}

export function PointsForm({ action, courseId, points }: { action: Action; courseId: string; points: number }) {
  const { state, formAction } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="Completion points" className="flex items-end gap-2">
      <input type="hidden" name="courseId" value={courseId} />
      <TextField idPrefix="pts" name="points" label="Points on completion" inputMode="numeric" defaultValue={String(points)} className="w-40" />
      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
      {state.message && <span className={`pb-2 text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}
