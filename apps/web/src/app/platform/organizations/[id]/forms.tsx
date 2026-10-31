'use client';

import { useActionState, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState } from '@/lib/action-state';
import { SUBSCRIPTION_STATUSES } from '@/lib/plans';
import { cleanSlug } from '@/lib/slug';
import { addOwnerAction, removeOwnerAction, setSubscriptionAction, updateOrganizationAction } from '../../actions';

export function EditOrgForm({ orgId, org, timezones, countries }: {
  orgId: string; org: { name: string; slug: string; timezone: string; country_code: string }; timezones: string[]; countries: Option[];
}) {
  const [slug, setSlug] = useState(org.slug);
  return (
    <ActionForm action={updateOrganizationAction.bind(null, orgId)} label="Organization details" submit="Save details">
      {(v, e) => (
        <>
          <TextField name="name" label="Organization name" required defaultValue={v.name ?? org.name} error={e.name} />
          <TextField name="slug" label="URL" required value={slug} error={e.slug} onChange={(ev) => setSlug(cleanSlug(ev.target.value))}
            hint={slug !== org.slug ? `Changing it moves the workspace to /app/${slug || '…'}: old links and bookmarks stop working. Tell the owner.` : 'Lowercase letters, digits and hyphens.'} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField name="timezone" label="Time zone" required defaultValue={v.timezone ?? org.timezone} error={e.timezone}
              options={timezones.map((t) => ({ value: t, label: t.replaceAll('_', ' ') }))} />
            <SelectField name="countryCode" label="Country" required defaultValue={v.countryCode ?? org.country_code} error={e.countryCode} options={countries} />
          </div>
        </>
      )}
    </ActionForm>
  );
}

export interface SubscriptionValues {
  plan_code: string; status: string; billing_cycle: string; employee_limit: number | null; price_per_employee: number | null;
  trial_ends_at: string | null; paid_until: string | null; billing_email: string | null; notes: string | null;
}

export function SubscriptionForm({ orgId, sub, plans }: {
  orgId: string; sub: SubscriptionValues | null; plans: Array<Option & { limit: number | null; price: number | null }>;
}) {
  const [plan, setPlan] = useState(sub?.plan_code ?? plans[0]?.value ?? '');
  const [status, setStatus] = useState(sub?.status ?? 'trialing');
  const chosen = plans.find((p) => p.value === plan);
  return (
    <ActionForm action={setSubscriptionAction.bind(null, orgId)} label="Change plan or billing" submit="Save plan and billing">
      {(v, e) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField name="plan" label="Plan" required defaultValue={plan} onChange={(ev) => setPlan(ev.target.value)} error={e.plan} options={plans} />
            <SelectField name="status" label="Status" required defaultValue={status} onChange={(ev) => setStatus(ev.target.value)} error={e.status} options={SUBSCRIPTION_STATUSES} />
            <SelectField name="billingCycle" label="Billing" required defaultValue={v.billingCycle ?? sub?.billing_cycle ?? 'monthly'} error={e.billingCycle}
              options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual (plan discount)' }]} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="employeeLimit" label="Employee limit" type="number" min={1} defaultValue={v.employeeLimit ?? sub?.employee_limit ?? ''} error={e.employeeLimit}
              placeholder={chosen?.limit ? String(chosen.limit) : 'No limit'} hint={`Blank: the plan’s ${chosen?.limit ? `${chosen.limit} employees` : '(no limit)'}.`} />
            <TextField name="pricePerEmployee" label="Price per employee a month (₹)" type="number" min={0} step="0.01" defaultValue={v.pricePerEmployee ?? sub?.price_per_employee ?? ''}
              error={e.pricePerEmployee} placeholder={chosen?.price != null ? String(chosen.price) : 'Custom'} hint="Blank: the plan’s price. Set it for a negotiated price." />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="trialEndsAt" label="Trial ends" type="date" defaultValue={v.trialEndsAt ?? sub?.trial_ends_at ?? ''} error={e.trialEndsAt}
              hint={status === 'trialing' ? 'Needed while on trial.' : 'Only used while on trial.'} />
            <TextField name="paidUntil" label="Paid until" type="date" defaultValue={v.paidUntil ?? sub?.paid_until ?? ''} error={e.paidUntil}
              hint="The end of the period the last payment covers." />
          </div>
          <TextField name="billingEmail" label="Billing email" type="email" defaultValue={v.billingEmail ?? sub?.billing_email ?? ''} error={e.billingEmail} />
          <TextAreaField name="notes" label="Internal notes" defaultValue={v.notes ?? sub?.notes ?? ''} error={e.notes}
            hint="Only platform administrators see these (agreed discounts, contacts, reminders)." />
        </>
      )}
    </ActionForm>
  );
}

export function AddOwnerForm({ orgId }: { orgId: string }) {
  return (
    <ActionForm action={addOwnerAction.bind(null, orgId)} label="Add an owner" submit="Add owner" variant="secondary" size="sm" className="space-y-3">
      {(v, e) => (
        <TextField name="email" label="Email" type="email" required defaultValue={v.email} error={e.email}
          hint="Someone new is invited to choose a password; everyone added is emailed." />
      )}
    </ActionForm>
  );
}

export function RemoveOwnerButton({ orgId, userId, email }: { orgId: string; userId: string; email: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(removeOwnerAction, initialActionState);
  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label={`Remove ${email} as owner`}>Remove</Button>
        {state.message && <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-xs text-success' : 'text-xs text-danger'}>{state.message}</p>}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton size="sm" variant="danger" pendingLabel="Removing…">Confirm</SubmitButton>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
    </form>
  );
}
