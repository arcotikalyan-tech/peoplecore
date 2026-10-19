'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { SelectField, TextField } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export const ENTITY_TYPES = [
  { value: 'private_limited', label: 'Private Limited Company' }, { value: 'public_limited', label: 'Public Limited Company' },
  { value: 'llp', label: 'Limited Liability Partnership' }, { value: 'opc', label: 'One Person Company' }, { value: 'partnership', label: 'Partnership firm' },
  { value: 'proprietorship', label: 'Sole proprietorship' }, { value: 'section_8', label: 'Section 8 company' }, { value: 'trust', label: 'Trust' },
  { value: 'society', label: 'Society' }, { value: 'other', label: 'Other' },
];

export interface Profile {
  legal_name: string | null; brand_name: string | null; email: string | null; phone: string | null; website: string | null; industry: string | null;
  social: Record<string, string>; entity_type: string | null; cin: string | null; llpin: string | null; incorporated_on: string | null;
  pan: string | null; tan: string | null; gstin: string | null; pf_code: string | null; esi_code: string | null;
}

export function DetailsForm({ action, p }: { action: Action; p: Profile }) {
  return (
    <ActionForm action={action} label="Company details" submit="Save details" size="sm" hidden={{ section: 'details' }} className="space-y-4">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="co" name="legal_name" label="Registered company name" required defaultValue={v.legal_name ?? p.legal_name ?? ''} error={e.legal_name} />
            <TextField idPrefix="co" name="brand_name" label="Brand name" defaultValue={v.brand_name ?? p.brand_name ?? ''} error={e.brand_name} />
            <TextField idPrefix="co" name="email" label="Company official email" type="email" defaultValue={v.email ?? p.email ?? ''} error={e.email} />
            <TextField idPrefix="co" name="phone" label="Company official contact" defaultValue={v.phone ?? p.phone ?? ''} error={e.phone} />
            <TextField idPrefix="co" name="website" label="Website" defaultValue={v.website ?? p.website ?? ''} error={e.website} />
            <TextField idPrefix="co" name="industry" label="Industry type" defaultValue={v.industry ?? p.industry ?? ''} error={e.industry} />
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Social profiles</legend>
            {['linkedin', 'twitter', 'facebook', 'instagram'].map((k) => (
              <TextField key={k} idPrefix="co" name={k} label={k === 'twitter' ? 'X (Twitter)' : k[0]!.toUpperCase() + k.slice(1)} placeholder="https://…" defaultValue={v[k] ?? p.social[k] ?? ''} error={e[k]} />
            ))}
          </fieldset>
        </>
      )}
    </ActionForm>
  );
}

export function StatutoryForm({ action, p }: { action: Action; p: Profile }) {
  return (
    <ActionForm action={action} label="Company ID" submit="Save" size="sm" hidden={{ section: 'statutory' }} className="space-y-4">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField idPrefix="st" name="entity_type" label="Entity type" options={ENTITY_TYPES} placeholder="Choose…" defaultValue={v.entity_type ?? p.entity_type ?? ''} />
          <TextField idPrefix="st" name="cin" label="CIN" defaultValue={v.cin ?? p.cin ?? ''} error={e.cin} />
          <TextField idPrefix="st" name="llpin" label="LLPIN (LLPs)" defaultValue={v.llpin ?? p.llpin ?? ''} error={e.llpin} />
          <TextField idPrefix="st" name="incorporated_on" label="Date of incorporation" type="date" defaultValue={v.incorporated_on ?? p.incorporated_on ?? ''} error={e.incorporated_on} />
          <TextField idPrefix="st" name="pan" label="Company PAN" defaultValue={v.pan ?? p.pan ?? ''} error={e.pan} />
          <TextField idPrefix="st" name="tan" label="Company TAN" defaultValue={v.tan ?? p.tan ?? ''} error={e.tan} />
          <TextField idPrefix="st" name="gstin" label="GST" defaultValue={v.gstin ?? p.gstin ?? ''} error={e.gstin} />
          <TextField idPrefix="st" name="pf_code" label="PF establishment code" defaultValue={v.pf_code ?? p.pf_code ?? ''} error={e.pf_code} />
          <TextField idPrefix="st" name="esi_code" label="ESI employer code" defaultValue={v.esi_code ?? p.esi_code ?? ''} error={e.esi_code} />
        </div>
      )}
    </ActionForm>
  );
}

export function AddressForm({ action, kind, address, label }: {
  action: Action; kind: 'registered' | 'corporate' | 'branch' | 'custom'; label: string;
  address?: { id: string; label: string | null; line1: string; line2: string | null; city: string; state: string | null; country: string; pincode: string | null };
}) {
  const id = `ad${address?.id.slice(0, 6) ?? kind}`;
  return (
    <ActionForm action={action} label={label} submit={address ? 'Save address' : 'Add address'} size="sm" hidden={{ kind, addressId: address?.id ?? '' }} className="space-y-3">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === 'custom' || kind === 'branch' ? <TextField idPrefix={id} name="label" label="Name" placeholder="Warehouse" defaultValue={v.label ?? address?.label ?? ''} /> : null}
          <TextField idPrefix={id} name="line1" label="Address line 1" required defaultValue={v.line1 ?? address?.line1 ?? ''} error={e.line1} className="sm:col-span-2" />
          <TextField idPrefix={id} name="line2" label="Address line 2" defaultValue={v.line2 ?? address?.line2 ?? ''} className="sm:col-span-2" />
          <TextField idPrefix={id} name="city" label="City" required defaultValue={v.city ?? address?.city ?? ''} error={e.city} />
          <TextField idPrefix={id} name="state" label="State" defaultValue={v.state ?? address?.state ?? ''} />
          <TextField idPrefix={id} name="country" label="Country" defaultValue={v.country ?? address?.country ?? 'India'} />
          <TextField idPrefix={id} name="pincode" label="PIN code" defaultValue={v.pincode ?? address?.pincode ?? ''} error={e.pincode} />
        </div>
      )}
    </ActionForm>
  );
}

export function OfficerForm({ action, kind }: { action: Action; kind: 'director' | 'auditor' | 'secretary' }) {
  const idLabel = kind === 'director' ? 'DIN' : kind === 'auditor' ? 'ICAI membership / FRN' : 'ICSI membership no.';
  return (
    <ActionForm action={action} label={`Add ${kind}`} submit={`⊕ Add ${kind === 'secretary' ? 'company secretary' : kind}`} size="sm" hidden={{ kind }} className="space-y-3">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField idPrefix={kind} name="name" label="Name" required defaultValue={v.name} error={e.name} />
          <TextField idPrefix={kind} name="email" label="Email ID" type="email" defaultValue={v.email} error={e.email} />
          <TextField idPrefix={kind} name="phone" label="Phone number" defaultValue={v.phone} error={e.phone} />
          <TextField idPrefix={kind} name="identifier" label={idLabel} defaultValue={v.identifier} />
          {kind !== 'director' && <TextField idPrefix={kind} name="firm" label="Firm" defaultValue={v.firm} />}
        </div>
      )}
    </ActionForm>
  );
}

export function CustomFieldForm({ action }: { action: Action }) {
  const [type, setType] = useState('text');
  return (
    <ActionForm action={action} label="Create field" submit="Create field" size="sm" className="space-y-3">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField idPrefix="cf" name="label" label="Field name" required placeholder="T-shirt size" defaultValue={v.label} error={e.label} />
            <div>
              <label htmlFor="f-cf-type" className="mb-1.5 block text-sm font-medium">Type</label>
              <select id="f-cf-type" name="field_type" value={type} onChange={(ev) => setType(ev.target.value)} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
                <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">List of options</option><option value="boolean">Yes / no</option>
              </select>
            </div>
            {type === 'select' && <TextField idPrefix="cf" name="options" label="Options (comma-separated)" placeholder="S, M, L, XL" defaultValue={v.options} error={e.options} />}
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="required" className="accent-primary" /> Required</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="editable" className="accent-primary" /> Employees can fill it in themselves</label>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function GradeForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} label="Add grade" submit="＋ Add Grade" size="sm" className="space-y-3">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField idPrefix="gr" name="name" label="Grade" required placeholder="L3" defaultValue={v.name} error={e.name} />
          <TextField idPrefix="gr" name="rank" label="Order (low to high)" inputMode="numeric" defaultValue={v.rank ?? '0'} />
          <TextField idPrefix="gr" name="description" label="Description" defaultValue={v.description} />
        </div>
      )}
    </ActionForm>
  );
}

export function GradeSelect({ action, designationId, current, grades }: { action: Action; designationId: string; current: string | null; grades: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={action} label="Set grade" submit="Set" size="sm" variant="ghost" hidden={{ designationId }} className="flex items-center gap-1.5">
      {() => (
        <select name="gradeId" defaultValue={current ?? ''} aria-label="Grade" className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm">
          <option value="">No grade</option>{grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
    </ActionForm>
  );
}

/** Custom fields on an employee's profile. */
export function CustomValuesForm({ action, fields, values, canEditAll }: {
  action: Action; canEditAll: boolean;
  fields: Array<{ id: string; label: string; field_type: string; options: string[]; required: boolean; editable_by_employee: boolean }>;
  values: Record<string, string>;
}) {
  return (
    <ActionForm action={action} label="Custom fields" submit="Save" size="sm" className="space-y-3 px-5 py-4">
      {(v) => (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            const disabled = !canEditAll && !f.editable_by_employee;
            const name = `field:${f.id}`;
            const value = v[name] ?? values[f.id] ?? '';
            const id = `f-cv-${f.id}`;
            return (
              <div key={f.id}>
                <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{f.label}{f.required && <span className="text-danger" aria-hidden="true"> *</span>}</label>
                {f.field_type === 'select' || f.field_type === 'boolean' ? (
                  <select id={id} name={name} defaultValue={value} disabled={disabled} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
                    <option value="">—</option>
                    {(f.field_type === 'boolean' ? ['yes', 'no'] : f.options).map((o) => <option key={o} value={o}>{o === 'yes' ? 'Yes' : o === 'no' ? 'No' : o}</option>)}
                  </select>
                ) : (
                  <input id={id} name={name} type={f.field_type === 'date' ? 'date' : 'text'} inputMode={f.field_type === 'number' ? 'decimal' : undefined} defaultValue={value} disabled={disabled}
                    className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm disabled:bg-subtle" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </ActionForm>
  );
}
