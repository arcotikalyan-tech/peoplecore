'use client';

import { useActionState, useState } from 'react';
import {
  BLOOD_GROUPS, FAMILY_RELATIONSHIPS, FAMILY_RELATIONSHIP_LABELS, GENDERS, GENDER_LABELS, MARITAL_STATUSES, MARITAL_STATUS_LABELS,
  QUALIFICATION_LEVELS, QUALIFICATION_LEVEL_LABELS,
} from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Defaults = Record<string, string | null | undefined>;

type Counted = ActionState & { n?: number };

/**
 * Form state plus a submission count. React resets a form after each submission and a <select> goes back to the
 * option it was first rendered with, so forms key their fields on `n` to re-render the echoed values.
 */
function useForm(action: Action, defaults: Defaults) {
  const [state, formAction] = useActionState<Counted, FormData>(
    async (prev, formData) => ({ ...(await action(prev, formData)), n: (prev.n ?? 0) + 1 }), initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  return { state, formAction, n: state.n ?? 0, e: state.fieldErrors ?? {}, val: (key: string) => v[key] ?? defaults[key] ?? '' };
}

export function WorkDetailsForm({ action, defaults, legalEntities }: { action: Action; defaults: Defaults; legalEntities: Option[] }) {
  const { state, formAction, n, e, val } = useForm(action, defaults);
  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4">
      <FormMessage state={state} />
      <div key={n} className="grid gap-4 sm:grid-cols-2">
        <TextField idPrefix="work" name="firstName" label="First name" required defaultValue={val('firstName')} error={e.firstName} />
        <TextField idPrefix="work" name="middleName" label="Middle name" defaultValue={val('middleName')} error={e.middleName} />
        <TextField idPrefix="work" name="lastName" label="Last name" defaultValue={val('lastName')} error={e.lastName} />
        <TextField idPrefix="work" name="workEmail" label="Work email" type="email" defaultValue={val('workEmail')} error={e.workEmail} />
        <TextField idPrefix="work" name="workPhone" label="Work phone" type="tel" defaultValue={val('workPhone')} error={e.workPhone} />
        <TextField idPrefix="work" name="dateOfJoining" label="Date of joining" type="date" defaultValue={val('dateOfJoining')} error={e.dateOfJoining}
          hint="To correct a mistake. Leave and payroll already processed aren’t recalculated." />
        <TextField idPrefix="work" name="probationEndDate" label="Probation end date" type="date" defaultValue={val('probationEndDate')} error={e.probationEndDate} />
        <SelectField idPrefix="work" name="legalEntityId" label="Legal entity" options={legalEntities} placeholder="None" defaultValue={val('legalEntityId')} error={e.legalEntityId} />
        <TextField idPrefix="work" name="jobTitle" label="Job title" defaultValue={val('jobTitle')} error={e.jobTitle} />
        <SelectField idPrefix="work" name="billable" label="Billing status" options={[{ value: 'no', label: 'Non-Billable' }, { value: 'yes', label: 'Billable' }]}
          defaultValue={val('billable') || 'no'} error={e.billable} />
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:max-w-md">
          <TextField idPrefix="work" name="priorYears" label="Experience before joining (years)" inputMode="numeric" defaultValue={val('priorYears')} error={e.priorYears} />
          <TextField idPrefix="work" name="priorMonths" label="and months" inputMode="numeric" defaultValue={val('priorMonths')} error={e.priorMonths} />
        </div>
      </div>
      <p className="text-xs text-muted">Department, designation, location, manager and employee type change through “Change assignment”, which keeps history.</p>
      <div className="flex justify-end">
        <SubmitButton>Save work details</SubmitButton>
      </div>
    </form>
  );
}

const genders = GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }));
const yesNo = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }];
const bloodGroups = BLOOD_GROUPS.map((b) => ({ value: b, label: b }));
const marital = MARITAL_STATUSES.map((m) => ({ value: m, label: MARITAL_STATUS_LABELS[m] }));

function SaveRow({ label = 'Save' }: { label?: string }) {
  return <div className="flex justify-end"><SubmitButton>{label}</SubmitButton></div>;
}

/** Personal tab › Personal info. Posts only its own fields. */
export function PersonalInfoForm({ action, defaults }: { action: Action; defaults: Defaults }) {
  const { state, formAction, n, e, val } = useForm(action, defaults);
  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4" aria-label="Personal info">
      <FormMessage state={state} />
      <div key={n} className="grid gap-4 sm:grid-cols-3">
        <TextField idPrefix="pi" name="dateOfBirth" label="Date of birth" type="date" defaultValue={val('dateOfBirth')} error={e.dateOfBirth} />
        <SelectField idPrefix="pi" name="gender" label="Gender" options={genders} placeholder="Not recorded" defaultValue={val('gender')} error={e.gender} />
        <SelectField idPrefix="pi" name="bloodGroup" label="Blood group" options={bloodGroups} placeholder="Not recorded" defaultValue={val('bloodGroup')} error={e.bloodGroup} />
        <SelectField idPrefix="pi" name="maritalStatus" label="Marital status" options={marital} placeholder="Not recorded" defaultValue={val('maritalStatus')} error={e.maritalStatus} />
        <SelectField idPrefix="pi" name="isDisabled" label="Is employee disabled" options={yesNo} defaultValue={val('isDisabled') || 'no'} error={e.isDisabled} />
      </div>
      <SaveRow label="Save personal info" />
    </form>
  );
}

/** Contact info: the company's (official email, work phone; HR edits them, the employee sees them) and the person's own. */
export function ContactInfoForm({ action, defaults, canEditWork }: { action: Action; defaults: Defaults; canEditWork: boolean }) {
  const { state, formAction, e, val } = useForm(action, defaults);
  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4" aria-label="Contact info">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        {canEditWork ? (
          <>
            <TextField idPrefix="ci" name="workEmail" label="Official email" type="email" defaultValue={val('workEmail')} error={e.workEmail} />
            <TextField idPrefix="ci" name="workPhone" label="Work phone" type="tel" defaultValue={val('workPhone')} error={e.workPhone} />
          </>
        ) : (
          <>
            {/* Disabled fields aren't submitted: shown for reference only. */}
            <TextField idPrefix="ci" name="workEmail" label="Official email" type="email" defaultValue={val('workEmail')} disabled hint="Set by HR" />
            <TextField idPrefix="ci" name="workPhone" label="Work phone" type="tel" defaultValue={val('workPhone')} disabled hint="Set by HR" />
          </>
        )}
        <div className="hidden sm:block" />
        <TextField idPrefix="ci" name="personalEmail" label="Personal email" type="email" defaultValue={val('personalEmail')} error={e.personalEmail} />
        <TextField idPrefix="ci" name="personalPhone" label="Personal phone" type="tel" defaultValue={val('personalPhone')} error={e.personalPhone} />
        <TextField idPrefix="ci" name="alternatePhone" label="Alternate phone" type="tel" defaultValue={val('alternatePhone')} error={e.alternatePhone} />
        <TextField idPrefix="ci" name="linkedinUrl" label="LinkedIn" type="url" placeholder="https://www.linkedin.com/in/…" defaultValue={val('linkedinUrl')} error={e.linkedinUrl} />
        <TextField idPrefix="ci" name="twitterUrl" label="X / Twitter" type="url" placeholder="https://x.com/…" defaultValue={val('twitterUrl')} error={e.twitterUrl} />
        <TextField idPrefix="ci" name="websiteUrl" label="Website" type="url" placeholder="https://…" defaultValue={val('websiteUrl')} error={e.websiteUrl} />
      </div>
      <p className="text-xs text-muted">Social links show in the directory only if your organization switches social info on.</p>
      <SaveRow label="Save contact info" />
    </form>
  );
}

export function AddressesForm({ action, defaults }: { action: Action; defaults: Defaults }) {
  const { state, formAction, e, val } = useForm(action, defaults);
  const [same, setSame] = useState(val('permSameAsCurrent') === 'yes');
  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4" aria-label="Addresses">
      <FormMessage state={state} />
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Current address</legend>
        <TextField idPrefix="ad" name="addressLine1" label="Address line 1" className="sm:col-span-3" defaultValue={val('addressLine1')} error={e.addressLine1} />
        <TextField idPrefix="ad" name="addressLine2" label="Address line 2" className="sm:col-span-3" defaultValue={val('addressLine2')} error={e.addressLine2} />
        <TextField idPrefix="ad" name="city" label="City" defaultValue={val('city')} error={e.city} />
        <TextField idPrefix="ad" name="stateCode" label="State" placeholder="KA" defaultValue={val('stateCode')} error={e.stateCode} />
        <TextField idPrefix="ad" name="postalCode" label="PIN code" defaultValue={val('postalCode')} error={e.postalCode} />
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={same} onChange={(ev) => setSame(ev.target.checked)} className="size-4 accent-primary" />
        Permanent address is the same as current
      </label>
      <input type="hidden" name="permSameAsCurrent" value={same ? 'yes' : 'no'} />
      {!same && (
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Permanent address</legend>
          <TextField idPrefix="pa" name="permAddressLine1" label="Permanent address line 1" className="sm:col-span-3" defaultValue={val('permAddressLine1')} error={e.permAddressLine1} />
          <TextField idPrefix="pa" name="permAddressLine2" label="Permanent address line 2" className="sm:col-span-3" defaultValue={val('permAddressLine2')} error={e.permAddressLine2} />
          <TextField idPrefix="pa" name="permCity" label="Permanent city" defaultValue={val('permCity')} error={e.permCity} />
          <TextField idPrefix="pa" name="permStateCode" label="Permanent state" defaultValue={val('permStateCode')} error={e.permStateCode} />
          <TextField idPrefix="pa" name="permPostalCode" label="Permanent PIN code" defaultValue={val('permPostalCode')} error={e.permPostalCode} />
        </fieldset>
      )}
      <SaveRow label="Save addresses" />
    </form>
  );
}

const levels = QUALIFICATION_LEVELS.map((l) => ({ value: l, label: QUALIFICATION_LEVEL_LABELS[l] }));
const relationships = FAMILY_RELATIONSHIPS.map((r) => ({ value: r, label: FAMILY_RELATIONSHIP_LABELS[r] }));

export function QualificationForm({ action }: { action: Action }) {
  const { state, formAction, n, e, val } = useForm(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4 border-t border-line bg-subtle/40 px-5 py-4" aria-label="Add qualification">
      <FormMessage state={state} />
      <div key={n} className="grid gap-4 sm:grid-cols-3">
        <SelectField idPrefix="q" name="level" label="Level" required options={levels} placeholder="Choose…" defaultValue={val('level')} error={e.level} />
        <TextField idPrefix="q" name="degree" label="Degree" required placeholder="B.Tech" defaultValue={val('degree')} error={e.degree} />
        <TextField idPrefix="q" name="specialization" label="Specialization" defaultValue={val('specialization')} error={e.specialization} />
        <TextField idPrefix="q" name="institution" label="Institution" required className="sm:col-span-3" defaultValue={val('institution')} error={e.institution} />
        <TextField idPrefix="q" name="startYear" label="From (year)" inputMode="numeric" defaultValue={val('startYear')} error={e.startYear} />
        <TextField idPrefix="q" name="endYear" label="To (year)" inputMode="numeric" defaultValue={val('endYear')} error={e.endYear} />
        <TextField idPrefix="q" name="score" label="Grade / %" defaultValue={val('score')} error={e.score} />
      </div>
      <SaveRow label="⊕ Add qualification" />
    </form>
  );
}

export function FamilyForm({ action }: { action: Action }) {
  const { state, formAction, n, e, val } = useForm(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4 border-t border-line bg-subtle/40 px-5 py-4" aria-label="Add family member">
      <FormMessage state={state} />
      <div key={n} className="grid gap-4 sm:grid-cols-3">
        <TextField idPrefix="fm" name="name" label="Full name" required defaultValue={val('name')} error={e.name} />
        <SelectField idPrefix="fm" name="relationship" label="Relation" required options={relationships} placeholder="Choose…" defaultValue={val('relationship')} error={e.relationship} />
        <TextField idPrefix="fm" name="dateOfBirth" label="Date of birth" type="date" defaultValue={val('dateOfBirth')} error={e.dateOfBirth} />
        <SelectField idPrefix="fm" name="gender" label="Gender" options={genders} placeholder="Not recorded" defaultValue={val('gender')} error={e.gender} />
        <TextField idPrefix="fm" name="phone" label="Contact number" type="tel" defaultValue={val('phone')} error={e.phone} />
        <TextField idPrefix="fm" name="occupation" label="Occupation" defaultValue={val('occupation')} error={e.occupation} />
        <SelectField idPrefix="fm" name="isDependent" label="Dependent" options={yesNo} defaultValue={val('isDependent') || 'no'} error={e.isDependent} />
      </div>
      <SaveRow label="⊕ Add family member" />
    </form>
  );
}

export function RemoveRow({ action, kind, id, label }: { action: Action; kind: 'qualification' | 'family'; id: string; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="rowId" value={id} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant="ghost" pendingLabel="Removing…" aria-label={`Remove ${label}`}>Remove</SubmitButton>
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
