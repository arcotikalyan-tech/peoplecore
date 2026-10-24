'use client';

import { useActionState } from 'react';
import { ActionForm } from '@/components/action-form';
import { AiSuggestion } from '@/components/ai-suggestion';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';
import type { PhotoCheckState } from './photo-check-actions';

const SAME: Record<string, string> = { yes: 'Looks like the same person as the profile photo.', no: 'Doesn’t look like the person in the profile photo.', unsure: 'Can’t tell whether it’s the same person as the profile photo.', no_profile_photo: 'No profile photo to compare with.' };

/** "Check photo with AI" for one punch, and a flag the reviewer can raise with their own note. */
export function PhotoCheck({ check, flag, punchId, label }: {
  check: (prev: PhotoCheckState, formData: FormData) => Promise<PhotoCheckState>;
  flag: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  punchId: string; label: string;
}) {
  const [state, action] = useActionState(check, initialActionState as PhotoCheckState);
  const r = state.ok ? state.review : undefined;
  const worry = r && (!r.looksLive || r.samePerson === 'no');
  return (
    <div className="space-y-2">
      <form action={action} aria-label={`Check photo with AI: ${label}`}>
        <input type="hidden" name="punchId" value={punchId} />
        <SubmitButton variant="ghost" size="sm" pendingLabel="Checking…">Check photo with AI</SubmitButton>
      </form>
      {!state.ok && <FormMessage state={state} />}
      {r && (
        <AiSuggestion title={r.looksLive ? 'Looks like a live photo' : 'May not be a live photo'} note="A suggestion: you decide whether to flag it.">
          <p>{r.note}</p>
          {r.livenessConcerns.length > 0 && <ul className="mt-1 list-disc pl-5" aria-label="Concerns">{r.livenessConcerns.map((c) => <li key={c}>{c}</li>)}</ul>}
          <p className="mt-1 text-muted">{SAME[r.samePerson]}</p>
          {worry && (
            <ActionForm action={flag} label={`Flag photo: ${label}`} submit="Flag for review" hidden={{ punchId, note: r.note }} size="sm" variant="secondary" className="mt-2 flex flex-wrap items-center gap-3" />
          )}
        </AiSuggestion>
      )}
    </div>
  );
}
