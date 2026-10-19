'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { loanEmi, loanSchedule } from '@/lib/loans';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Limits { maxAmount: number; maxTenure: number; interestRate: number; maxEmi: number; monthlyGross: number }

function Figures({ kind, amount, tenure, limits }: { kind: string; amount: number; tenure: number; limits: Limits }) {
  const rate = kind === 'advance' ? 0 : limits.interestRate;
  const emi = loanEmi(amount, rate, tenure);
  const total = loanSchedule(amount, rate, tenure).reduce((s, r) => s + r.emi, 0);
  const share = limits.monthlyGross ? Math.round((emi / limits.monthlyGross) * 100) : 0;
  const over = emi > limits.maxEmi;
  const cell = 'rounded-xl border border-line p-3';
  return (
    <dl className="grid gap-3 sm:grid-cols-4" aria-label="Loan figures">
      <div className={cell}><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Monthly EMI</dt><dd className={`mt-1 text-xl font-bold tabular-nums ${over ? 'text-danger' : 'text-primary'}`}>{inr2.format(emi)}</dd></div>
      <div className={cell}><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Total interest</dt><dd className="mt-1 text-xl font-bold tabular-nums">{inr.format(total - amount)}</dd><dd className="text-xs text-muted">{rate}% a year</dd></div>
      <div className={cell}><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Total repayable</dt><dd className="mt-1 text-xl font-bold tabular-nums">{inr.format(total)}</dd></div>
      <div className={cell}><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Payroll impact</dt><dd className={`mt-1 text-xl font-bold tabular-nums ${over ? 'text-danger' : ''}`}>{share}%</dd><dd className="text-xs text-muted">of monthly gross{over ? ` · above your ${inr.format(limits.maxEmi)} limit` : ''}</dd></div>
    </dl>
  );
}

/** Eligibility & Simulator: see the EMI, cost and payroll impact before applying. */
export function Simulator({ limits, applyHref }: { limits: Limits; applyHref: string }) {
  const [kind, setKind] = useState<'loan' | 'advance'>('loan');
  const maxTenure = kind === 'advance' ? Math.min(3, limits.maxTenure) : limits.maxTenure;
  const [amount, setAmount] = useState(Math.min(50000, Math.max(1000, Math.round(limits.maxAmount / 2 / 1000) * 1000)));
  const [tenure, setTenure] = useState(Math.min(12, maxTenure));
  const t = Math.min(tenure, maxTenure);
  const a = Math.min(amount, limits.maxAmount);
  const rows = loanSchedule(a, kind === 'advance' ? 0 : limits.interestRate, t);
  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="radiogroup" aria-label="Type">
        {(['loan', 'advance'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${kind === k ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line'}`}>
            {k === 'loan' ? 'Personal loan' : 'Salary advance'}
          </button>
        ))}
      </div>
      <label className="block text-sm"><span className="flex justify-between"><span>Amount</span><span className="font-semibold tabular-nums">{inr.format(a)}</span></span>
        <input type="range" min={1000} max={Math.max(1000, limits.maxAmount)} step={1000} value={a} onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="Amount" className="mt-2 w-full accent-primary" /></label>
      <label className="block text-sm"><span className="flex justify-between"><span>Tenure</span><span className="font-semibold tabular-nums">{t} month{t === 1 ? '' : 's'}</span></span>
        <input type="range" min={1} max={maxTenure} step={1} value={t} onChange={(e) => setTenure(Number(e.target.value))}
          aria-label="Tenure (months)" className="mt-2 w-full accent-primary" /></label>
      <Figures kind={kind} amount={a} tenure={t} limits={limits} />
      <details className="rounded-xl border border-line"><summary className="cursor-pointer px-4 py-2 text-sm font-medium">Repayment schedule</summary>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm" aria-label="Simulated schedule">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-4 py-2">#</th><th className="px-3">Opening</th><th className="px-3">Principal</th><th className="px-3">Interest</th><th className="px-3">EMI</th></tr></thead>
            <tbody className="divide-y divide-line tabular-nums">
              {rows.map((r) => <tr key={r.seq}><td className="px-4 py-1.5">{r.seq}</td><td className="px-3">{inr2.format(r.opening)}</td><td className="px-3">{inr2.format(r.principal)}</td><td className="px-3">{inr2.format(r.interest)}</td><td className="px-3">{inr2.format(r.emi)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>
      <Link className="inline-flex rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${applyHref}&kind=${kind}&amount=${a}&tenure=${t}`}>Apply with these →</Link>
    </div>
  );
}

export function ApplyForm({ action, limits, defaults }: { action: Action; limits: Limits; defaults: { kind: string; amount: string; tenure: string } }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const [kind, setKind] = useState(v.kind ?? defaults.kind);
  const [amount, setAmount] = useState(v.amount ?? defaults.amount);
  const [tenure, setTenure] = useState(v.tenure ?? defaults.tenure);
  const maxTenure = kind === 'advance' ? Math.min(3, limits.maxTenure) : limits.maxTenure;
  const n = Number(amount); const m = Number(tenure);
  return (
    <form action={formAction} noValidate aria-label="Apply for a loan" className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField idPrefix="loan" name="kind" label="Type" options={[{ value: 'loan', label: 'Personal loan' }, { value: 'advance', label: 'Salary advance' }]}
          value={kind} onChange={(ev) => setKind(ev.target.value)} />
        <TextField idPrefix="loan" name="amount" label="Amount (₹)" inputMode="numeric" required value={amount} onChange={(ev) => setAmount(ev.target.value)}
          hint={`Up to ${inr.format(limits.maxAmount)}`} error={e.amount} />
        <TextField idPrefix="loan" name="tenure" label="Tenure (months)" inputMode="numeric" required value={tenure} onChange={(ev) => setTenure(ev.target.value)}
          hint={`1 to ${maxTenure}`} error={e.tenure} />
      </div>
      <TextField idPrefix="loan" name="purpose" label="Purpose" required placeholder="What the money is for" defaultValue={v.purpose ?? ''} error={e.purpose} />
      {n > 0 && m >= 1 && m <= 120 && <Figures kind={kind} amount={n} tenure={m} limits={limits} />}
      <p className="text-xs text-muted">EMIs are deducted from your salary each month, starting the month payroll sets when the money is paid.</p>
      <SubmitButton pendingLabel="Sending…">Apply</SubmitButton>
    </form>
  );
}

export function DisburseForm({ action, loanId, defaultMonth, minMonth }: { action: Action; loanId: string; defaultMonth: string; minMonth: string }) {
  return (
    <ActionForm action={action} label="Disburse loan" submit="Disburse" hidden={{ loanId }} className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <SelectField idPrefix="dis" name="mode" label="Paid by" options={[{ value: 'bank', label: 'Bank transfer' }, { value: 'payroll', label: 'With the next payroll run' }, { value: 'cash', label: 'Cash' }]}
            defaultValue={v.mode ?? 'bank'} />
          <TextField idPrefix="dis" name="reference" label="Bank reference" placeholder="UTR" defaultValue={v.reference ?? ''} error={e.reference} />
          <TextField idPrefix="dis" name="firstEmi" label="First EMI month" type="month" min={minMonth} required defaultValue={v.firstEmi ?? defaultMonth} error={e.firstEmi} />
        </>
      )}
    </ActionForm>
  );
}

export function ForecloseForm({ action, loanId }: { action: Action; loanId: string }) {
  return (
    <ActionForm action={action} label="Foreclose loan" submit="Close the loan" hidden={{ loanId }} variant="secondary" className="space-y-3 px-5 py-4">
      {(v, e) => <TextField idPrefix="fc" name="note" label="How was the balance settled?" required placeholder="Repaid by bank transfer, UTR…" defaultValue={v.note ?? ''} error={e.note} />}
    </ActionForm>
  );
}

export function LoanSettingsForm({ action, s }: {
  action: Action;
  s: { enabled: boolean; allow_multiple: boolean; interest_rate: number; max_amount: number; salary_multiple: number; max_tenure_months: number; max_emi_percent: number; min_service_months: number };
}) {
  const check = 'size-4 rounded border-line-strong accent-primary';
  return (
    <ActionForm action={action} label="Loan policy" submit="Save policy" className="space-y-4">
      {(v, e) => (
        <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={s.enabled} className={check} />Employees can apply for loans and salary advances</label>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField idPrefix="ls" name="interestRate" label="Interest rate (% a year)" inputMode="decimal" defaultValue={v.interestRate ?? String(s.interest_rate)} error={e.interestRate} hint="Advances are always interest-free." />
            <TextField idPrefix="ls" name="maxAmount" label="Most anyone can borrow (₹)" inputMode="numeric" defaultValue={v.maxAmount ?? String(s.max_amount)} error={e.maxAmount} />
            <TextField idPrefix="ls" name="salaryMultiple" label="…and at most × monthly gross" inputMode="decimal" defaultValue={v.salaryMultiple ?? String(s.salary_multiple)} error={e.salaryMultiple} />
            <TextField idPrefix="ls" name="maxTenure" label="Longest tenure (months)" inputMode="numeric" defaultValue={v.maxTenure ?? String(s.max_tenure_months)} error={e.maxTenure} />
            <TextField idPrefix="ls" name="maxEmiPercent" label="EMIs at most (% of gross)" inputMode="numeric" defaultValue={v.maxEmiPercent ?? String(s.max_emi_percent)} error={e.maxEmiPercent} />
            <TextField idPrefix="ls" name="minService" label="Minimum service (months)" inputMode="numeric" defaultValue={v.minService ?? String(s.min_service_months)} error={e.minService} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowMultiple" defaultChecked={s.allow_multiple} className={check} />Allow more than one open loan per person</label>
        </>
      )}
    </ActionForm>
  );
}

export function CancelLoanButton({ action, loanId }: { action: Action; loanId: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Withdraw application" className="inline-flex items-center gap-2">
      <input type="hidden" name="loanId" value={loanId} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant="ghost" pendingLabel="…">Withdraw</SubmitButton>
    </form>
  );
}
