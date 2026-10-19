'use client';

import { useActionState } from 'react';
import { ActionForm } from '@/components/action-form';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { CONDITIONS, IDLE_OPTIONS, RETURN_OPTIONS } from './tone';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Counted = ActionState & { n?: number };

/** Form state plus a submission count, so fields re-render (and clear) after each successful submit. */
function useCounted(action: Action) {
  const [state, formAction] = useActionState<Counted, FormData>(
    async (prev, formData) => ({ ...(await action(prev, formData)), n: (prev.n ?? 0) + 1 }), initialActionState);
  return { state, formAction, n: state.n ?? 0, v: state.ok ? {} : (state.values ?? {}), e: state.fieldErrors ?? {} };
}

interface AssetValues {
  id: string; tag: string; name: string; category_id: string; condition: string; serial_number: string | null; location_id: string | null;
  purchased_on: string | null; purchase_cost: number | null; warranty_until: string | null; notes: string | null;
}

export function AssetForm({ action, asset, locations, categories }: { action: Action; asset?: AssetValues; locations: Option[]; categories: Option[] }) {
  return (
    <ActionForm action={action} label={asset ? 'Edit asset' : 'Add an asset'} submit={asset ? 'Save' : 'Add asset'}
      hidden={asset ? { assetId: asset.id } : {}} className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="asset" name="name" label="Name" required placeholder="ThinkPad T14 Gen 4" defaultValue={v.name ?? asset?.name} error={e.name} />
            <SelectField idPrefix="asset" name="categoryId" label="Category" required options={categories} placeholder="Choose a category…"
              hint={categories.length === 0 ? 'Add categories on the Categories tab first.' : undefined}
              defaultValue={v.categoryId ?? asset?.category_id ?? ''} error={e.categoryId} />
            <TextField idPrefix="asset" name="tag" label="Asset tag" placeholder="AST-0001" hint={asset ? undefined : 'Leave blank for the next number.'}
              defaultValue={v.tag ?? asset?.tag} error={e.tag} />
            <TextField idPrefix="asset" name="serialNumber" label="Serial number" defaultValue={v.serialNumber ?? asset?.serial_number ?? ''} error={e.serialNumber} />
            <SelectField idPrefix="asset" name="condition" label="Condition" options={CONDITIONS} defaultValue={v.condition ?? asset?.condition ?? 'good'} />
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

export function CategoryForm({ action, category }: {
  action: Action;
  category?: { id: string; name: string; icon: string | null; description: string | null; useful_life_months: number | null; requestable: boolean };
}) {
  const { state, formAction, n, v, e } = useCounted(action);
  const id = category?.id ?? 'new';
  return (
    <form action={formAction} noValidate aria-label={category ? `Edit ${category.name}` : 'Add category'} className="space-y-3">
      <FormMessage state={state} />
      {category && <input type="hidden" name="categoryId" value={category.id} />}
      <div key={category ? 0 : n} className="grid items-end gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_8rem]">
        <TextField idPrefix={`cat-${id}`} name="icon" label="Icon" placeholder="💻" defaultValue={v.icon ?? category?.icon ?? ''} error={e.icon} />
        <TextField idPrefix={`cat-${id}`} name="name" label="Category" required placeholder="Laptop" defaultValue={v.name ?? category?.name ?? ''} error={e.name} />
        <TextField idPrefix={`cat-${id}`} name="usefulLife" label="Useful life (months)" inputMode="numeric" placeholder="36"
          defaultValue={v.usefulLife ?? (category?.useful_life_months != null ? String(category.useful_life_months) : '')} error={e.usefulLife} />
        <TextField idPrefix={`cat-${id}`} name="description" label="Description" className="sm:col-span-2" defaultValue={v.description ?? category?.description ?? ''} error={e.description} />
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="requestable" defaultChecked={v.requestable ? v.requestable === 'on' : (category?.requestable ?? true)} className="size-4 rounded border-line-strong accent-primary" />
          Employees can request
        </label>
      </div>
      <SubmitButton size="sm" variant={category ? 'secondary' : 'primary'}>{category ? 'Save' : '＋ Add Category'}</SubmitButton>
    </form>
  );
}

export function RequestAssetForm({ action, categories }: { action: Action; categories: Option[] }) {
  const { state, formAction, n, v, e } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="Request asset" className="space-y-3">
      <FormMessage state={state} />
      <div key={n} className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <SelectField idPrefix="req" name="categoryId" label="Category" required options={categories} placeholder="Choose…"
          defaultValue={v.categoryId ?? ''} error={e.categoryId} />
        <TextField idPrefix="req" name="reason" label="Reason" required placeholder="What you need it for" defaultValue={v.reason ?? ''} error={e.reason} />
      </div>
      <SubmitButton size="sm">＋ Request Asset</SubmitButton>
    </form>
  );
}

/** Approve (optionally issuing an asset in stock at once) or reject with a reason. */
export function DecideRequestForm({ action, requestId, label, stock, approved }: { action: Action; requestId: string; label: string; stock: Option[]; approved: boolean }) {
  const { state, formAction, v } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label={`Decide: ${label}`} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <SelectField idPrefix={`dr-${requestId}`} name="assetId" label="Issue" options={stock} placeholder={approved ? 'Choose an asset…' : 'Approve only'}
        defaultValue={v.assetId ?? ''} className="min-w-44" />
      {!approved && <TextField idPrefix={`dr-${requestId}`} name="note" label="Note" placeholder="Required to reject" defaultValue={v.note ?? ''} className="w-40" />}
      <SubmitButton size="sm" name="decision" value="approve">{approved ? 'Issue' : 'Approve'}</SubmitButton>
      {!approved && <SubmitButton size="sm" variant="ghost" name="decision" value="reject">Reject</SubmitButton>}
      {state.message && <p role={state.ok ? 'status' : 'alert'} className={`w-full text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</p>}
    </form>
  );
}

export function RepairForm({ action, assetId, today }: { action: Action; assetId: string; today: string }) {
  return (
    <ActionForm action={action} label="Send for repair" submit="Send for repair" hidden={{ assetId }} variant="secondary" className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <TextField idPrefix="rep" name="issue" label="Problem" required placeholder="Battery doesn’t hold charge" defaultValue={v.issue ?? ''} error={e.issue} />
          <TextField idPrefix="rep" name="vendor" label="Vendor" placeholder="Service centre" defaultValue={v.vendor ?? ''} error={e.vendor} />
          <TextField idPrefix="rep" name="expectedOn" label="Expected back" type="date" min={today} defaultValue={v.expectedOn ?? ''} error={e.expectedOn} />
        </>
      )}
    </ActionForm>
  );
}

export function CompleteRepairForm({ action, repairId, label }: { action: Action; repairId: string; label: string }) {
  return (
    <ActionForm action={action} label={`Complete repair of ${label}`} submit="Mark repaired" hidden={{ repairId }} size="sm" className="flex flex-wrap items-end gap-2">
      {(v, e) => (
        <>
          <TextField idPrefix={`cr-${repairId}`} name="cost" label="Cost (₹)" inputMode="decimal" defaultValue={v.cost ?? ''} error={e.cost} className="w-28" />
          <SelectField idPrefix={`cr-${repairId}`} name="condition" label="Condition" options={CONDITIONS} placeholder="Unchanged" defaultValue={v.condition ?? ''} className="w-32" />
          <SelectField idPrefix={`cr-${repairId}`} name="outcome" label="Then" options={[{ value: 'in_stock', label: 'Available' }, { value: 'retired', label: 'Retire' }]}
            defaultValue={v.outcome ?? 'in_stock'} className="w-32" />
        </>
      )}
    </ActionForm>
  );
}

export function RecoveryForm({ action, assignmentId }: { action: Action; assignmentId: string }) {
  return (
    <ActionForm action={action} label="Record dues" submit="Record dues" hidden={{ assignmentId }} variant="secondary" size="sm" className="mt-2 flex flex-wrap items-end gap-2">
      {(v, e) => (
        <>
          <TextField idPrefix={`rc-${assignmentId}`} name="amount" label="Amount due (₹)" inputMode="decimal" defaultValue={v.amount ?? ''} error={e.amount} className="w-32" />
          <TextField idPrefix={`rc-${assignmentId}`} name="note" label="For" placeholder="Lost charger" defaultValue={v.note ?? ''} error={e.note} className="w-48" />
        </>
      )}
    </ActionForm>
  );
}

export function SettleForm({ action, assignmentId, label }: { action: Action; assignmentId: string; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={`Settle dues: ${label}`} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <SubmitButton size="sm" name="mode" value="payroll">Deduct in payroll</SubmitButton>
      <SubmitButton size="sm" variant="secondary" name="mode" value="recovered">Recovered</SubmitButton>
      <SubmitButton size="sm" variant="ghost" name="mode" value="waived">Waive</SubmitButton>
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}

export function SmallAction({ action, fields, label, aria }: { action: Action; fields: Record<string, string>; label: string; aria: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={aria} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant="ghost" pendingLabel="…">{label}</SubmitButton>
    </form>
  );
}

export function ImportAssetsForm({ action, templateHref }: { action: Action; templateHref: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Import assets" className="space-y-2 rounded-xl border border-dashed border-line p-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm"><span className="mb-1 block text-xs font-medium text-muted">Import assets (CSV)</span>
          <input type="file" name="file" accept=".csv,text/csv" aria-label="Assets file" className="block w-full text-sm" /></label>
        <a href={templateHref} className="text-sm text-primary hover:underline" download>⬇ Template</a>
        <SubmitButton size="sm" pendingLabel="Importing…">⬆ Import</SubmitButton>
      </div>
    </form>
  );
}
