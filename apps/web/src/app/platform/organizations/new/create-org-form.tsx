'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField } from '@/components/ui/fields';
import { initialActionState } from '@/lib/action-state';
import { cleanSlug, slugify } from '@/lib/slug';
import { createOrganizationAction } from '../../actions';

export interface PlanOption { code: string; label: string; trialDays: number }

/** New organization: the URL follows the name until it's edited by hand; the plan sets the trial unless changed. */
export function CreateOrgForm({ plans, defaultPlan, prefill, host }: {
  plans: PlanOption[]; defaultPlan: string; host: string;
  prefill?: { name: string; ownerEmail: string; requestId: string };
}) {
  const [state, formAction] = useActionState(createOrganizationAction, initialActionState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [name, setName] = useState(v.name ?? prefill?.name ?? '');
  const [slug, setSlug] = useState(v.slug ?? slugify(prefill?.name ?? ''));
  const [auto, setAuto] = useState(!v.slug || v.slugAuto === '1');
  const [plan, setPlan] = useState(v.plan ?? defaultPlan);
  const trial = plans.find((p) => p.code === plan)?.trialDays ?? 0;

  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-5" aria-label="New organization">
      <FormMessage state={state} />
      {prefill && <input type="hidden" name="requestId" value={prefill.requestId} />}
      <input type="hidden" name="slugAuto" value={auto ? '1' : '0'} />
      <TextField name="name" label="Organization name" required value={name} error={e.name} autoComplete="organization"
        onChange={(ev) => { setName(ev.target.value); if (auto) setSlug(slugify(ev.target.value)); }} />
      <TextField name="slug" label="URL" required value={slug} error={e.slug}
        hint={slug ? `Their workspace: ${host}/app/${slug}. Filled in from the name; change it if you like.` : 'Filled in from the name: lowercase letters, digits and hyphens.'}
        onChange={(ev) => { setSlug(cleanSlug(ev.target.value)); setAuto(false); }} />
      <TextField name="ownerEmail" label="Owner email" type="email" defaultValue={v.ownerEmail ?? prefill?.ownerEmail} error={e.ownerEmail}
        hint="They become the owner and get two emails: an invitation to choose a password (new accounts only) and a welcome email. You can add owners later too." />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="plan" label="Plan" required defaultValue={plan} onChange={(ev) => setPlan(ev.target.value)} error={e.plan}
          options={plans.map((p) => ({ value: p.code, label: p.label }))} />
        <TextField name="trialDays" label="Free trial (days)" type="number" min={0} max={365} defaultValue={v.trialDays} error={e.trialDays}
          placeholder={String(trial)} hint={`Leave blank for the plan’s ${trial} day${trial === 1 ? '' : 's'}; 0 starts it as paying.`} />
      </div>
      <TextField name="billingEmail" label="Billing email" type="email" defaultValue={v.billingEmail} error={e.billingEmail}
        hint="Optional. Where invoices go; the owner’s email if left blank." />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Creating…">Create organization</SubmitButton>
      </div>
    </form>
  );
}
