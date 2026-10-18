'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextField } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function NewRunForm({ action, defaultMonth }: { action: Action; defaultMonth: string }) {
  return (
    <ActionForm action={action} label="New payroll run" submit="Create run" className="space-y-4 px-5 py-5">
      {(v) => (
        <>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Month</span>
            <input type="month" name="month" required defaultValue={v.month ?? defaultMonth} className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm" />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="lopFromAbsence" className="mt-0.5" />
            <span>Treat absences (no punches, no leave) as loss of pay. Off: only unpaid leave is deducted.</span>
          </label>
        </>
      )}
    </ActionForm>
  );
}

export function RunAction({ action, runId, submit, variant }: { action: Action; runId: string; submit: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <ActionForm action={action} label={submit} submit={submit} hidden={{ runId }} variant={variant} className="space-y-2" />;
}

export function CompensationForm({ action, employeeId, components, current, today }: {
  action: Action; employeeId: string; components: Array<{ id: string; name: string }>; current: Record<string, number>; today: string;
}) {
  return (
    <ActionForm action={action} label="Change compensation" submit="Save compensation" hidden={{ employeeId }} className="space-y-4 border-t border-line px-5 py-5">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {components.map((c) => (
              <TextField key={c.id} idPrefix="comp" name={`component:${c.id}`} label={`${c.name} (monthly ₹)`} inputMode="decimal"
                defaultValue={v[`component:${c.id}`] ?? (current[c.id] !== undefined ? String(current[c.id]) : '')} />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="comp" name="effectiveFrom" label="Effective from" type="date" required defaultValue={v.effectiveFrom ?? today} error={e.effectiveFrom} />
            <TextField idPrefix="comp" name="note" label="Note" placeholder="Annual revision" defaultValue={v.note} />
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function StatutoryForm({ action, employeeId, profile }: { action: Action; employeeId: string; profile: { pf: boolean; esi: boolean | null; ptState: string | null } }) {
  return (
    <ActionForm action={action} label="Statutory settings" submit="Save statutory settings" hidden={{ employeeId }} className="space-y-4 border-t border-line px-5 py-5" variant="secondary">
      {(v) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField idPrefix="stat" name="pf" label="Provident fund" options={[{ value: 'yes', label: 'Applies' }, { value: 'no', label: 'Doesn’t apply' }]} defaultValue={v.pf ?? (profile.pf ? 'yes' : 'no')} />
          <SelectField idPrefix="stat" name="esi" label="ESI" options={[{ value: 'auto', label: 'By wage ceiling' }, { value: 'yes', label: 'Applies' }, { value: 'no', label: 'Doesn’t apply' }]}
            defaultValue={v.esi ?? (profile.esi === null ? 'auto' : profile.esi ? 'yes' : 'no')} />
          <TextField idPrefix="stat" name="ptState" label="Professional tax state" placeholder="From location" defaultValue={v.ptState ?? profile.ptState ?? ''} />
        </div>
      )}
    </ActionForm>
  );
}

export function AdjustmentForm({ action, employees }: { action: Action; employees: Array<{ value: string; label: string }> }) {
  return (
    <ActionForm action={action} label="Record an adjustment" submit="Record adjustment" className="space-y-4 border-t border-line px-5 py-5">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField idPrefix="adj" name="employeeId" label="Employee" required options={employees} placeholder="Choose…" defaultValue={v.employeeId ?? ''} error={e.employeeId} />
            <SelectField idPrefix="adj" name="type" label="Type" options={[
              { value: 'ARREAR', label: 'Arrears (taxable)' }, { value: 'BONUS', label: 'Bonus (taxable)' },
              { value: 'RECOVERY', label: 'Recovery' }, { value: 'OTHER_DEDUCTION', label: 'Other deduction' },
            ]} defaultValue={v.type ?? 'ARREAR'} />
            <TextField idPrefix="adj" name="amount" label="Amount (₹)" required inputMode="decimal" defaultValue={v.amount} error={e.amount} />
          </div>
          <TextField idPrefix="adj" name="reason" label="Reason" required placeholder="Revision effective September, paid late" defaultValue={v.reason} error={e.reason} />
        </>
      )}
    </ActionForm>
  );
}
