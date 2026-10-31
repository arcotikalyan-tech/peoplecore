'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { TextAreaField, TextField } from '@/components/ui/fields';
import { MODULES } from '@/lib/modules';
import { savePlanAction } from '../actions';

export interface PlanValues {
  code: string; name: string; description: string | null; price_per_employee: number | null; base_price: number; annual_discount_pct: number;
  max_employees: number | null; modules: string[] | null; trial_days: number; is_active: boolean; sort_order: number;
}

const GROUPS = [...new Set(MODULES.map((m) => m.group))];
const check = 'size-4 shrink-0 rounded border-line-strong accent-primary';

/** A plan's price, limits, trial and modules. A new plan also gets its code (fixed once created). */
export function PlanForm({ plan }: { plan: PlanValues | null }) {
  const [all, setAll] = useState(plan ? plan.modules === null : false);
  const included = new Set(plan?.modules ?? MODULES.map((m) => m.key));
  return (
    <ActionForm action={savePlanAction.bind(null, plan?.code ?? null)} label={plan ? `Edit ${plan.name}` : 'New plan'} submit={plan ? 'Save plan' : 'Add plan'}>
      {(v, e) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="name" label="Name" required defaultValue={v.name ?? plan?.name} error={e.name} />
            {plan ? (
              <TextField name="code" label="Code" defaultValue={plan.code} disabled hint="Fixed: organizations on the plan point at it." />
            ) : (
              <TextField name="code" label="Code" required defaultValue={v.code} error={e.code} hint="Short and permanent, e.g. pro or growth-2027." />
            )}
          </div>
          <TextAreaField name="description" label="Description" defaultValue={v.description ?? plan?.description ?? ''} error={e.description}
            hint="One line on who it’s for and what’s in it." />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField name="pricePerEmployee" label="Per employee a month (₹)" type="number" min={0} step="0.01" error={e.pricePerEmployee}
              defaultValue={v.pricePerEmployee ?? (plan ? plan.price_per_employee ?? '' : '')} hint="Blank: priced per customer." />
            <TextField name="basePrice" label="Flat price a month (₹)" type="number" min={0} step="0.01" error={e.basePrice}
              defaultValue={v.basePrice ?? plan?.base_price ?? 0} hint="Charged on top, whatever the size." />
            <TextField name="annualDiscount" label="Annual discount (%)" type="number" min={0} max={90} step="0.5" error={e.annualDiscount}
              defaultValue={v.annualDiscount ?? plan?.annual_discount_pct ?? 0} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField name="maxEmployees" label="Employee limit" type="number" min={1} error={e.maxEmployees}
              defaultValue={v.maxEmployees ?? (plan ? plan.max_employees ?? '' : '')} hint="Blank: no limit." />
            <TextField name="trialDays" label="Free trial (days)" type="number" min={0} max={90} error={e.trialDays}
              defaultValue={v.trialDays ?? plan?.trial_days ?? 14} />
            <TextField name="sortOrder" label="Order" type="number" min={0} error={e.sortOrder}
              defaultValue={v.sortOrder ?? plan?.sort_order ?? 10} hint="Lower comes first in lists." />
          </div>
          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-sm font-medium">Modules</legend>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="allModules" className={check} checked={all} onChange={(ev) => setAll(ev.target.checked)} />
              Every module, including ones added later
            </label>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {GROUPS.map((g) => (
                <div key={g}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{g}</p>
                  <div className="space-y-1.5">
                    {MODULES.filter((m) => m.group === g).map((m) => (
                      <label key={m.key} className={`flex items-center gap-2 text-sm ${all ? 'opacity-50' : ''}`}>
                        <input type="checkbox" name="module" value={m.key} defaultChecked={included.has(m.key)} disabled={all} className={check} />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">The core (employees, the dashboard, approvals and settings) is always included. Modules outside the plan are hidden from its organizations.</p>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={plan ? plan.is_active : true} className={check} />
            Offered for new organizations and plan changes (untick to retire it; organizations already on it keep it)
          </label>
        </>
      )}
    </ActionForm>
  );
}
