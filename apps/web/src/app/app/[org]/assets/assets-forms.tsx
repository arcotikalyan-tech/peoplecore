'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';
import { IDLE_OPTIONS, RETURN_OPTIONS } from './tone';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface AssetValues {
  id: string; tag: string; name: string; category: string; serial_number: string | null; location_id: string | null;
  purchased_on: string | null; purchase_cost: number | null; warranty_until: string | null; notes: string | null;
}

export function AssetForm({ action, asset, locations }: { action: Action; asset?: AssetValues; locations: Option[] }) {
  return (
    <ActionForm action={action} label={asset ? 'Edit asset' : 'Add an asset'} submit={asset ? 'Save' : 'Add asset'}
      hidden={asset ? { assetId: asset.id } : {}} className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="asset" name="name" label="Name" required placeholder="ThinkPad T14 Gen 4" defaultValue={v.name ?? asset?.name} error={e.name} />
            <TextField idPrefix="asset" name="category" label="Type" required placeholder="Laptop" list="asset-categories"
              defaultValue={v.category ?? asset?.category} error={e.category} />
            <datalist id="asset-categories">
              {['Laptop', 'Desktop', 'Monitor', 'Phone', 'Tablet', 'Headset', 'ID card', 'Access card', 'SIM card', 'Furniture'].map((c) => <option key={c} value={c} />)}
            </datalist>
            <TextField idPrefix="asset" name="tag" label="Asset tag" placeholder="AST-0001" hint={asset ? undefined : 'Leave blank for the next number.'}
              defaultValue={v.tag ?? asset?.tag} error={e.tag} />
            <TextField idPrefix="asset" name="serialNumber" label="Serial number" defaultValue={v.serialNumber ?? asset?.serial_number ?? ''} error={e.serialNumber} />
            <SelectField idPrefix="asset" name="locationId" label="Location" options={locations} placeholder="Not set"
              defaultValue={v.locationId ?? asset?.location_id ?? ''} />
            <TextField idPrefix="asset" name="purchasedOn" label="Purchased on" type="date" defaultValue={v.purchasedOn ?? asset?.purchased_on ?? ''} error={e.purchasedOn} />
            <TextField idPrefix="asset" name="purchaseCost" label="Purchase cost (₹)" inputMode="decimal"
              defaultValue={v.purchaseCost ?? (asset?.purchase_cost != null ? String(asset.purchase_cost) : '')} error={e.purchaseCost} />
            <TextField idPrefix="asset" name="warrantyUntil" label="Warranty until" type="date" defaultValue={v.warrantyUntil ?? asset?.warranty_until ?? ''} error={e.warrantyUntil} />
          </div>
          <TextAreaField idPrefix="asset" name="notes" label="Notes" rows={3} defaultValue={v.notes ?? asset?.notes ?? ''} error={e.notes} />
        </>
      )}
    </ActionForm>
  );
}

export function IssueAssetForm({ action, assetId, people, today }: { action: Action; assetId: string; people: Option[]; today: string }) {
  return (
    <ActionForm action={action} label="Issue asset" submit="Issue" hidden={{ assetId }} className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <SelectField idPrefix="issue" name="employeeId" label="Issue to" required options={people} placeholder="Choose a person…"
            defaultValue={v.employeeId ?? ''} error={e.employeeId} />
          <TextField idPrefix="issue" name="dueBackOn" label="Due back" type="date" min={today} hint="Only for loans. Leave blank for permanent issue."
            defaultValue={v.dueBackOn ?? ''} error={e.dueBackOn} />
          <TextField idPrefix="issue" name="condition" label="Condition" placeholder="New, sealed box" defaultValue={v.condition ?? ''} error={e.condition} />
        </>
      )}
    </ActionForm>
  );
}

export function ReturnAssetForm({ action, assetId }: { action: Action; assetId: string }) {
  return (
    <ActionForm action={action} label="Record return" submit="Record return" hidden={{ assetId }} className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <SelectField idPrefix="ret" name="status" label="Then" options={RETURN_OPTIONS} defaultValue={v.status ?? 'in_stock'} />
          <TextField idPrefix="ret" name="condition" label="Condition on return" placeholder="Good, charger included" defaultValue={v.condition ?? ''} error={e.condition} />
        </>
      )}
    </ActionForm>
  );
}

export function AssetStatusForm({ action, assetId, status }: { action: Action; assetId: string; status: string }) {
  return (
    <ActionForm action={action} label="Change status" submit="Change" hidden={{ assetId }} variant="secondary" size="sm"
      className="flex flex-wrap items-end gap-3 px-5 py-4">
      {(v) => <SelectField idPrefix="st" name="status" label="Status" options={IDLE_OPTIONS} defaultValue={v.status ?? status} className="min-w-48" />}
    </ActionForm>
  );
}

export function SystemForm({ action, system, people }: {
  action: Action; system?: { id: string; name: string; owner_employee_id: string | null; is_active: boolean }; people: Option[];
}) {
  const id = system?.id ?? 'new';
  return (
    <ActionForm action={action} label={system ? `System ${system.name}` : 'Add a system'} submit={system ? 'Save' : 'Add'}
      hidden={system ? { systemId: system.id } : {}} variant={system ? 'secondary' : 'primary'} size="sm"
      className="grid items-end gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
      {(v, e) => (
        <>
          <TextField idPrefix={`sys-${id}`} name="name" label="System" required placeholder="Google Workspace" defaultValue={v.name ?? system?.name} error={e.name} />
          <SelectField idPrefix={`sys-${id}`} name="ownerId" label="Owner" options={people} placeholder="HR only"
            defaultValue={v.ownerId ?? system?.owner_employee_id ?? ''} />
          {system ? (
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={system.is_active} className="size-4 rounded border-line-strong accent-primary" />
              In use
            </label>
          ) : <span />}
        </>
      )}
    </ActionForm>
  );
}

export function GrantAccessForm({ action, systems, people }: { action: Action; systems: Option[]; people: Option[] }) {
  return (
    <ActionForm action={action} label="Record access" submit="Record access" className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <SelectField idPrefix="grant" name="employeeId" label="Person" required options={people} placeholder="Choose a person…"
            defaultValue={v.employeeId ?? ''} error={e.employeeId} />
          <SelectField idPrefix="grant" name="systemId" label="System" required options={systems} placeholder="Choose a system…"
            defaultValue={v.systemId ?? ''} error={e.systemId} />
          <TextField idPrefix="grant" name="account" label="Account" required placeholder="name@company.example" defaultValue={v.account ?? ''} error={e.account} />
          <TextField idPrefix="grant" name="level" label="Access level" placeholder="Member, Admin…" defaultValue={v.level ?? ''} error={e.level} />
        </>
      )}
    </ActionForm>
  );
}

export function RevokeAccessForm({ action, grantId, label }: { action: Action; grantId: string; label: string }) {
  return (
    <ActionForm action={action} label={label} submit="Revoke" hidden={{ grantId }} variant="ghost" size="sm" className="flex items-end gap-2">
      {(v) => <TextField idPrefix={`rv-${grantId}`} name="note" label="Reason" placeholder="Optional" defaultValue={v.note ?? ''} className="w-36" />}
    </ActionForm>
  );
}
