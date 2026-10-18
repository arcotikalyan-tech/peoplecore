'use client';

import { ActionForm } from '@/components/action-form';
import { TextField } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function AiSettingsForm({ action, enabled, budget, hourly }: { action: Action; enabled: boolean; budget: number; hourly: number }) {
  return (
    <ActionForm action={action} label="AI settings" submit="Save" className="space-y-4 px-5 py-4">
      {(v, e) => (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={v.enabled ? v.enabled === 'on' : enabled} className="mt-0.5 size-4 rounded border-line-strong accent-primary" />
            <span>Turn on AI assistants for everyone whose role allows them
              <span className="block text-xs text-muted">Answers and drafts are always shown as suggestions; nothing is saved until a person submits it.</span></span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="ai" name="budget" label="Monthly budget (tokens)" inputMode="numeric" required
              hint="All assistants together. A question uses roughly 3,000–6,000 tokens."
              defaultValue={v.budget ?? String(budget)} error={e.budget} />
            <TextField idPrefix="ai" name="hourly" label="Requests per person per hour" inputMode="numeric" required
              defaultValue={v.hourly ?? String(hourly)} error={e.hourly} />
          </div>
        </>
      )}
    </ActionForm>
  );
}
