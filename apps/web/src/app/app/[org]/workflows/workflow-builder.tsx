'use client';

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ActionForm } from '@/components/action-form';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type Step =
  | { type: 'notify'; to: 'employee' | 'manager' | 'permission' | 'user'; title: string; body?: string; permission?: string; user_id?: string }
  | { type: 'task'; assignee: 'employee' | 'manager' | 'person'; title: string; details?: string; employee_id?: string; due_in_days?: number }
  | { type: 'course'; course_id: string; due_in_days?: number; mandatory?: boolean }
  | { type: 'approval'; summary: string }
  | { type: 'wait'; days: number };

export interface Condition { field: 'department_id' | 'location_id' | 'designation_id' | 'employment_type'; value: string }

export interface BuilderOptions {
  triggers: Array<{ value: string; label: string; aboutEmployee: boolean }>;
  departments: Option[]; locations: Option[]; designations: Option[]; employmentTypes: Option[];
  courses: Option[]; groups: Option[]; members: Option[]; people: Option[];
}

const STEP_LABEL: Record<Step['type'], string> = {
  notify: 'Notify someone', task: 'Create a task', course: 'Assign a course', approval: 'Ask for approval', wait: 'Wait',
};
const blank = (type: Step['type']): Step =>
  type === 'notify' ? { type, to: 'employee', title: '' }
    : type === 'task' ? { type, assignee: 'manager', title: '' }
    : type === 'course' ? { type, course_id: '', mandatory: true }
    : type === 'approval' ? { type, summary: '' }
    : { type, days: 1 };

const inputClass = 'block h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm';
const num = (v: string) => (v === '' ? undefined : Number(v));

/** One step's fields. Controlled, so the JSON sent to the server always matches what is on screen. */
function StepFields({ step, n, options, aboutEmployee, onChange }: {
  step: Step; n: number; options: BuilderOptions; aboutEmployee: boolean; onChange: (s: Step) => void;
}) {
  const id = (f: string) => `wf-${n}-${f}`;
  const field = (label: string, f: string, control: ReactNode) => (
    <div><label htmlFor={id(f)} className="mb-1 block text-xs font-medium text-muted">{label}</label>{control}</div>
  );
  const select = (f: string, value: string, opts: Option[], set: (v: string) => void, placeholder?: string) => (
    <select id={id(f)} className={inputClass} value={value} onChange={(e) => set(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const text = (f: string, value: string | number | undefined, set: (v: string) => void, extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={id(f)} className={inputClass} value={value ?? ''} onChange={(e) => set(e.target.value)} {...extra} />
  );
  const who = (opts: Array<[string, string]>) => opts.filter(([v]) => aboutEmployee || !['employee', 'manager'].includes(v)).map(([value, label]) => ({ value, label }));

  switch (step.type) {
    case 'notify':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {field('Who', 'to', select('to', step.to, who([['employee', 'The employee'], ['manager', 'Their manager'], ['permission', 'A group'], ['user', 'A specific person']]),
            (v) => onChange({ ...step, to: v as typeof step.to })))}
          {step.to === 'permission' && field('Group', 'permission', select('permission', step.permission ?? '', options.groups, (v) => onChange({ ...step, permission: v }), 'Choose…'))}
          {step.to === 'user' && field('Person', 'user', select('user', step.user_id ?? '', options.members, (v) => onChange({ ...step, user_id: v }), 'Choose…'))}
          <div className="sm:col-span-2">{field('Message title', 'title', text('title', step.title, (v) => onChange({ ...step, title: v }), { maxLength: 150 }))}</div>
          <div className="sm:col-span-2">{field('Message (optional)', 'body', text('body', step.body, (v) => onChange({ ...step, body: v }), { maxLength: 1000 }))}</div>
        </div>
      );
    case 'task':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {field('Assign to', 'assignee', select('assignee', step.assignee, who([['manager', 'Their manager'], ['employee', 'The employee'], ['person', 'A specific person']]),
            (v) => onChange({ ...step, assignee: v as typeof step.assignee })))}
          {step.assignee === 'person' && field('Person', 'person', select('person', step.employee_id ?? '', options.people, (v) => onChange({ ...step, employee_id: v }), 'Choose…'))}
          <div className="sm:col-span-2">{field('Task', 'title', text('title', step.title, (v) => onChange({ ...step, title: v }), { maxLength: 150 }))}</div>
          {field('Due in (days)', 'due', text('due', step.due_in_days, (v) => onChange({ ...step, due_in_days: num(v) }), { inputMode: 'numeric', placeholder: 'No due date' }))}
        </div>
      );
    case 'course':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {field('Course', 'course', select('course', step.course_id, options.courses, (v) => onChange({ ...step, course_id: v }), 'Choose…'))}
          {field('Due in (days)', 'due', text('due', step.due_in_days, (v) => onChange({ ...step, due_in_days: num(v) }), { inputMode: 'numeric', placeholder: 'No due date' }))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={step.mandatory ?? true} onChange={(e) => onChange({ ...step, mandatory: e.target.checked })} className="size-4 accent-primary" />
            Mandatory
          </label>
        </div>
      );
    case 'approval':
      return field('What is being approved', 'summary', text('summary', step.summary, (v) => onChange({ ...step, summary: v }), { maxLength: 200 }));
    case 'wait':
      return field('Days', 'days', text('days', step.days, (v) => onChange({ ...step, days: num(v) ?? 0 }), { inputMode: 'numeric' }));
  }
}

export function WorkflowBuilder({ action, options, workflow }: {
  action: Action;
  options: BuilderOptions;
  workflow?: { id: string; name: string; trigger: string; active: boolean; conditions: Condition[]; steps: Step[] };
}) {
  const [trigger, setTrigger] = useState(workflow?.trigger ?? '');
  const [conditions, setConditions] = useState<Condition[]>(workflow?.conditions ?? []);
  const [steps, setSteps] = useState<Step[]>(workflow?.steps ?? [blank('notify')]);
  const [adding, setAdding] = useState<Step['type']>('task');
  const aboutEmployee = options.triggers.find((t) => t.value === trigger)?.aboutEmployee ?? true;
  const condition = (field: Condition['field']) => conditions.find((c) => c.field === field)?.value ?? '';
  const setCondition = (field: Condition['field'], value: string) =>
    setConditions((cs) => [...cs.filter((c) => c.field !== field), ...(value ? [{ field, value }] : [])]);
  const move = (i: number, d: -1 | 1) => setSteps((s) => {
    const next = [...s];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    return next;
  });

  return (
    <ActionForm action={action} label={workflow ? 'Edit workflow' : 'New workflow'} submit="Save" className="space-y-6 px-5 py-5"
      hidden={{ ...(workflow ? { workflowId: workflow.id } : {}), steps: JSON.stringify(steps), conditions: JSON.stringify(aboutEmployee ? conditions : []) }}>
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="wf" name="name" label="Name" required defaultValue={v.name ?? workflow?.name} error={e.name} />
            <SelectField idPrefix="wf" name="trigger" label="Starts when" required options={options.triggers} placeholder="Choose…"
              value={trigger} onChange={(ev) => setTrigger(ev.target.value)} disabled={!!workflow}
              hint={workflow ? 'The trigger is fixed once a workflow exists.' : undefined} />
          </div>
          {workflow && <input type="hidden" name="trigger" value={trigger} />}
          {aboutEmployee && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Only for employees in (optional)</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                {([['department_id', 'Department', options.departments], ['location_id', 'Location', options.locations],
                   ['designation_id', 'Designation', options.designations], ['employment_type', 'Employment type', options.employmentTypes]] as const).map(([f, label, opts]) => (
                  <div key={f}>
                    <label htmlFor={`wf-cond-${f}`} className="mb-1 block text-xs font-medium text-muted">{label}</label>
                    <select id={`wf-cond-${f}`} className={inputClass} value={condition(f)} onChange={(ev) => setCondition(f, ev.target.value)}>
                      <option value="">Any</option>
                      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <p className="mb-2 text-sm font-medium">Steps <span className="font-normal text-muted">(run in order; use {'{{employee}}'} for their name)</span></p>
            <ol className="space-y-3" aria-label="Steps">
              {steps.map((s, i) => (
                <li key={i} className="rounded-lg border border-line bg-subtle/40 p-4" aria-label={`Step ${i + 1}: ${STEP_LABEL[s.type]}`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{i + 1}. {STEP_LABEL[s.type]}</p>
                    <span className="flex gap-1 text-xs">
                      <button type="button" className="rounded px-2 py-1 hover:bg-surface disabled:opacity-40" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}>Up</button>
                      <button type="button" className="rounded px-2 py-1 hover:bg-surface disabled:opacity-40" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}>Down</button>
                      <button type="button" className="rounded px-2 py-1 text-danger hover:bg-surface" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>Remove</button>
                    </span>
                  </div>
                  <StepFields step={s} n={i} options={options} aboutEmployee={aboutEmployee} onChange={(next) => setSteps((x) => x.map((y, j) => (j === i ? next : y)))} />
                </li>
              ))}
            </ol>
            {steps.length < 20 && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="wf-add" className="mb-1 block text-xs font-medium text-muted">Add a step</label>
                  <select id="wf-add" className={inputClass} value={adding} onChange={(ev) => setAdding(ev.target.value as Step['type'])}>
                    {(Object.keys(STEP_LABEL) as Step['type'][]).filter((t) => aboutEmployee || t !== 'course').map((t) => <option key={t} value={t}>{STEP_LABEL[t]}</option>)}
                  </select>
                </div>
                <button type="button" className="h-9 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-subtle" onClick={() => setSteps((x) => [...x, blank(adding)])}>
                  Add step
                </button>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={v.active ? v.active === 'on' : (workflow?.active ?? false)} className="size-4 rounded border-line-strong accent-primary" />
            Switched on (runs for new events from now)
          </label>
        </>
      )}
    </ActionForm>
  );
}
