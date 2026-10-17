'use client';

import { useActionState } from 'react';
import { GENDERS, GENDER_LABELS } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Defaults = Record<string, string | null | undefined>;

function useForm(action: Action, defaults: Defaults) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  return { state, formAction, e: state.fieldErrors ?? {}, val: (key: string) => v[key] ?? defaults[key] ?? '' };
}

export function WorkDetailsForm({ action, defaults, legalEntities }: { action: Action; defaults: Defaults; legalEntities: Option[] }) {
  const { state, formAction, e, val } = useForm(action, defaults);
  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField idPrefix="work" name="firstName" label="First name" required defaultValue={val('firstName')} error={e.firstName} />
        <TextField idPrefix="work" name="middleName" label="Middle name" defaultValue={val('middleName')} error={e.middleName} />
        <TextField idPrefix="work" name="lastName" label="Last name" defaultValue={val('lastName')} error={e.lastName} />
        <TextField idPrefix="work" name="workEmail" label="Work email" type="email" defaultValue={val('workEmail')} error={e.workEmail} />
        <TextField idPrefix="work" name="workPhone" label="Work phone" type="tel" defaultValue={val('workPhone')} error={e.workPhone} />
        <TextField idPrefix="work" name="probationEndDate" label="Probation end date" type="date" defaultValue={val('probationEndDate')} error={e.probationEndDate} />
        <SelectField idPrefix="work" name="legalEntityId" label="Legal entity" options={legalEntities} placeholder="None" defaultValue={val('legalEntityId')} error={e.legalEntityId} />
      </div>
      <p className="text-xs text-muted">Department, designation, location and manager change through “Change assignment”, which keeps history.</p>
      <div className="flex justify-end">
        <SubmitButton>Save work details</SubmitButton>
      </div>
    </form>
  );
}

const genders = GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }));

export function PersonalDetailsForm({ action, defaults }: { action: Action; defaults: Defaults }) {
  const { state, formAction, e, val } = useForm(action, defaults);
  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField idPrefix="pd" name="dateOfBirth" label="Date of birth" type="date" defaultValue={val('dateOfBirth')} error={e.dateOfBirth} />
        <SelectField idPrefix="pd" name="gender" label="Gender" options={genders} placeholder="Not recorded" defaultValue={val('gender')} error={e.gender} />
        <TextField idPrefix="pd" name="personalEmail" label="Personal email" type="email" defaultValue={val('personalEmail')} error={e.personalEmail} />
        <TextField idPrefix="pd" name="personalPhone" label="Personal phone" type="tel" defaultValue={val('personalPhone')} error={e.personalPhone} />
        <TextField idPrefix="pd" name="addressLine1" label="Address line 1" className="sm:col-span-2" defaultValue={val('addressLine1')} error={e.addressLine1} />
        <TextField idPrefix="pd" name="addressLine2" label="Address line 2" className="sm:col-span-2" defaultValue={val('addressLine2')} error={e.addressLine2} />
        <TextField idPrefix="pd" name="city" label="City" defaultValue={val('city')} error={e.city} />
        <TextField idPrefix="pd" name="stateCode" label="State" placeholder="KA" defaultValue={val('stateCode')} error={e.stateCode} />
        <TextField idPrefix="pd" name="postalCode" label="PIN code" defaultValue={val('postalCode')} error={e.postalCode} />
      </div>
      <div className="flex justify-end">
        <SubmitButton>Save personal details</SubmitButton>
      </div>
    </form>
  );
}

export interface ContactRow {
  id: string;
  name: string;
  relationship: string;
  phone: string;
}

export function EmergencyContacts({ contacts, canEdit, add, remove }: { contacts: ContactRow[]; canEdit: boolean; add: Action; remove: Action }) {
  const { state, formAction, e, val } = useForm(add, {});
  return (
    <div className="border-t border-line px-5 py-4">
      <h3 className="text-sm font-semibold">Emergency contacts</h3>
      {contacts.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None recorded.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium">{c.name}</span> <span className="text-muted">· {c.relationship} · {c.phone}</span>
              </span>
              {canEdit && <RemoveContact id={c.id} remove={remove} />}
            </li>
          ))}
        </ul>
      )}
      {canEdit && contacts.length < 5 && (
        <form action={formAction} noValidate className="mt-3 space-y-3">
          <FormMessage state={state} />
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <TextField idPrefix="contact" name="name" label="Name" required defaultValue={val('name')} error={e.name} />
            <TextField idPrefix="contact" name="relationship" label="Relationship" required placeholder="Parent" defaultValue={val('relationship')} error={e.relationship} />
            <TextField idPrefix="contact" name="phone" label="Phone" type="tel" required defaultValue={val('phone')} error={e.phone} />
            <SubmitButton pendingLabel="Adding…">Add contact</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}

function RemoveContact({ id, remove }: { id: string; remove: Action }) {
  const [state, action] = useActionState(remove, initialActionState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="contactId" value={id} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant="ghost" pendingLabel="Removing…">Remove</SubmitButton>
    </form>
  );
}
