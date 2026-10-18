'use client';

import { useActionState, useRef, useState, type RefObject } from 'react';
import type { JobDescriptionDraft, ResumeResult } from '@peoplecore/ai';
import { AiSuggestion } from '@/components/ai-suggestion';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { TextAreaField, TextField } from '@/components/ui/fields';
import { Alert, Badge } from '@/components/ui/surface';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { AddCandidateForm } from './recruitment-forms';

type Action<S> = (prev: S, formData: FormData) => Promise<S>;

export interface ResumeState extends ActionState {
  result?: ResumeResult;
  suggestionId?: string;
}

export interface DraftState extends ActionState {
  draft?: JobDescriptionDraft;
  suggestionId?: string;
}

/** Sets an uncontrolled form field, as if the person had typed it. */
function setField(form: HTMLFormElement | null, name: string, value: string | number | null | undefined) {
  const el = form?.elements.namedItem(name);
  if (value != null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) el.value = String(value);
}

const RESUME_LABELS: Record<string, string> = {
  firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone', currentCompany: 'Current company',
  currentTitle: 'Current title', totalExperienceYears: 'Experience (years)',
};

/** "Add candidate" with an optional resume reader that fills the form; the recruiter checks it and submits. */
export function CandidateIntake({ add, read, dismiss }: { add: Action<ActionState>; read: Action<ResumeState> | null; dismiss: Action<ActionState> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, readAction] = useActionState<ResumeState, FormData>(read ?? (async () => ({ ok: false })), initialActionState);
  // The read whose fields were copied into the form (its suggestion id goes with the submission).
  const [filled, setFilled] = useState<ResumeState | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const r = state.ok && state.result?.isResume ? state.result : null;

  const fill = () => {
    if (!r) return;
    for (const k of ['firstName', 'lastName', 'email', 'phone', 'currentCompany'] as const) setField(formRef.current, k, r[k]);
    setFilled(state);
    (formRef.current?.elements.namedItem('firstName') as HTMLInputElement | null)?.focus();
  };

  return (
    <>
      {read && (
        <div className="space-y-3 border-b border-line px-5 py-4">
          <form action={readAction} aria-label="Read a resume" noValidate className="flex flex-wrap items-end gap-3">
            <TextField idPrefix="cv" name="resume" label="Read a resume with AI" type="file" accept="application/pdf,image/jpeg,image/png"
              hint="PDF, JPEG or PNG up to 5 MB. The file isn’t stored; only what you submit below is." className="min-w-0 flex-1 [&_input]:h-auto [&_input]:py-2" />
            <SubmitButton pendingLabel="Reading…" variant="secondary">Read resume</SubmitButton>
          </form>
          {!state.ok && <FormMessage state={state} />}
          {state.ok && state.result && !state.result.isResume && <Alert tone="warning" title="That doesn’t look like a resume." />}
          {r && state.suggestionId !== hidden && (
            <AiSuggestion title="Read from the resume" note="Check every field before you add the candidate."
              actions={filled === state ? <span className="text-xs text-muted">Filled in below. Check it, tick consent and add.</span> : (
                <>
                  <Button type="button" size="sm" onClick={fill}>Fill in the form</Button>
                  <form action={async (fd) => { setHidden(state.suggestionId ?? null); await dismiss(initialActionState, fd); }}>
                    <input type="hidden" name="suggestionId" value={state.suggestionId ?? ''} />
                    <Button type="submit" size="sm" variant="ghost">Dismiss</Button>
                  </form>
                </>
              )}>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2" aria-label="Fields read">
                {(Object.keys(RESUME_LABELS) as Array<keyof typeof RESUME_LABELS>).map((k) => {
                  const value = r[k as keyof typeof r];
                  return (
                    <div key={k} className="min-w-0">
                      <dt className="text-xs text-muted">{RESUME_LABELS[k]}</dt>
                      <dd className="truncate">{value != null && value !== '' ? String(value) : <span className="text-muted">Not found</span>}
                        {r.lowConfidence.includes(k as never) && <> <Badge tone="warning">Check</Badge></>}</dd>
                    </div>
                  );
                })}
              </dl>
              {r.skills.length > 0 && <p className="mt-2 text-xs text-muted">Skills: {r.skills.join(', ')}</p>}
            </AiSuggestion>
          )}
        </div>
      )}
      <AddCandidateForm action={add} formRef={formRef} suggestionId={filled?.suggestionId} />
    </>
  );
}

/** The requisition's description, editable, with an AI draft the recruiter can copy in. */
export function DescriptionEditor({ save, draft, initial }: { save: Action<ActionState>; draft: Action<DraftState> | null; initial: string }) {
  const ref = useRef<HTMLTextAreaElement>(null) as RefObject<HTMLTextAreaElement>;
  const [state, saveAction] = useActionState(save, initialActionState);
  const [draftState, draftAction] = useActionState<DraftState, FormData>(draft ?? (async () => ({ ok: false })), initialActionState);
  const [used, setUsed] = useState<DraftState | null>(null);
  const d = draftState.ok ? draftState.draft : undefined;

  const use = () => {
    if (!d || !ref.current) return;
    ref.current.value = d.text;
    setUsed(draftState);
    ref.current.focus();
  };

  return (
    <div className="space-y-4 px-5 py-4">
      <form action={saveAction} aria-label="Job description" noValidate className="space-y-3">
        <FormMessage state={state} />
        <input type="hidden" name="suggestionId" value={used?.suggestionId ?? ''} />
        <TextAreaField ref={ref} idPrefix="jd" name="description" label="Description" rows={10} maxLength={5000}
          hint="Shown on the careers page when the requisition is published." defaultValue={state.ok ? undefined : (state.values?.description ?? initial)}
          error={state.fieldErrors?.description} />
        <SubmitButton>Save description</SubmitButton>
      </form>
      {draft && (
        <div className="space-y-3">
          <form action={draftAction} aria-label="Draft a description">
            <SubmitButton variant="secondary" pendingLabel="Drafting…">Draft with AI</SubmitButton>
          </form>
          {!draftState.ok && <FormMessage state={draftState} />}
          {d && (
            <AiSuggestion title="Draft description" note="Edit it to fit; nothing is saved until you save the description."
              actions={used === draftState ? <span className="text-xs text-muted">Copied into the description. Edit it, then save.</span>
                : <Button type="button" size="sm" onClick={use}>Use this draft</Button>}>
              {d.warnings.length > 0 && (
                <ul className="mb-3 space-y-1 text-xs text-warning" aria-label="Wording to check">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              )}
              <p className="whitespace-pre-line leading-6">{d.text}</p>
            </AiSuggestion>
          )}
        </div>
      )}
    </div>
  );
}
