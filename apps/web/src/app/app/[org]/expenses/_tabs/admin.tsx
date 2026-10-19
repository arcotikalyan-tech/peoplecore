import Link from 'next/link';
import { BarChart } from '@/components/ui/charts';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import type { ClaimRow } from '@/server/expenses';
import { createClient } from '@/server/supabase';
import {
  importCategoriesAction, importExpensesAction, payClaimsAction, recordExpenseAction, saveCategoryAction, saveExpenseSettingsAction, toggleCategoryAction,
} from '../admin-actions';
import { CategoryForm, ExpenseSettingsForm, ImportForm, PayoutQueue, RecordExpenseForm, SmallAction } from '../expense-admin-client';
import { claimState, Figure, filterClaims, inr, monthLabel, Panel, shiftMonth, STATE_FILTERS, STATE_TONE } from './shared';

type Person = { id: string; employee_code: string; first_name: string; last_name: string | null; department_id: string | null; status: string };
type Category = { id: string; code: string; name: string; requires_receipt: boolean; max_per_item: number | null; is_active: boolean; subcategories: string[]; description: string | null };

export interface AdminProps {
  ctx: OrgContext;
  slug: string;
  base: string;
  cycle: string;
  today: string;
  claims: ClaimRow[];
  people: Map<string, Person>;
  categories: Category[];
  departments: Array<{ id: string; name: string }>;
  sp: Record<string, string | undefined>;
}

const name = (p?: Person) => (p ? [p.first_name, p.last_name].filter(Boolean).join(' ') : 'Employee');
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

function ClaimsTable({ rows, people, cats, base, caption, empty }: { rows: ClaimRow[]; people: Map<string, Person>; cats: Map<string, string>; base: string; caption: string; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={caption}>
        <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
          <tr><th className="px-5 py-2">Employee ID</th><th className="px-3">Name</th><th className="px-3">Claim</th><th className="px-3">Category</th><th className="px-3 text-right">Amount</th><th className="px-3">Receipt</th><th className="px-3">Status</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">{empty}</td></tr>}
          {rows.map((c) => {
            const p = people.get(c.employee_id);
            const st = claimState(c);
            return (
              <tr key={c.id}>
                <td className="px-5 py-2 tabular-nums">{p?.employee_code ?? '—'}</td>
                <td className="px-3">{name(p)}</td>
                <td className="px-3"><Link className="font-medium text-primary hover:underline" href={`${base}/${c.id}`}>{c.title}</Link>{c.recorded_by_finance && <span className="ml-1 text-xs text-muted">· by finance</span>}</td>
                <td className="px-3">{c.categoryIds.length > 1 ? 'Multiple' : cats.get(c.categoryIds[0] ?? '') ?? '—'}</td>
                <td className="px-3 text-right tabular-nums">{inr.format(c.total)}</td>
                <td className="px-3">{c.items === 0 ? '—' : c.receipts === c.items ? '✓' : c.receipts > 0 ? `${c.receipts}/${c.items}` : '✗'}</td>
                <td className="px-3"><Badge tone={STATE_TONE[st]}>{st}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function HubTab({ base, cycle, claims, people, categories }: AdminProps) {
  const cats = new Map(categories.map((c) => [c.id, c.name]));
  const pending = claims.filter((c) => c.status === 'pending');
  const approved = claims.filter((c) => c.status === 'approved');
  const paidCycle = claims.filter((c) => c.status === 'paid' && (c.paid_at ?? '').startsWith(cycle));
  const decided = claims.filter((c) => c.submitted_at && c.decided_at && !c.recorded_by_finance && days(c.decided_at, new Date().toISOString()) <= 90);
  const avg = decided.length ? decided.reduce((a, c) => a + days(c.submitted_at!, c.decided_at!), 0) / decided.length : null;
  const filed = claims.filter((c) => (c.submitted_at ?? '').startsWith(cycle));
  const items = filed.reduce((a, c) => a + c.items, 0);
  const sum = (xs: ClaimRow[]) => xs.reduce((a, c) => a + c.total, 0);
  const stage = (label: string, n: number, note: string, tone: string) => (
    <li className="flex-1 rounded-xl border border-line p-3 text-center"><p className={`text-2xl font-bold tabular-nums ${tone}`}>{n}</p><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted">{note}</p></li>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Open claims" value={pending.length} note={`${inr.format(sum(pending))} value`} tone={pending.length ? 'warning' : undefined} />
        <Figure label="Approved · to pay" value={approved.length} note={inr.format(sum(approved))} tone={approved.length ? 'primary' : undefined} />
        <Figure label={`Reimbursed · ${monthLabel(cycle)}`} value={inr.format(sum(paidCycle))} note={`${paidCycle.length} claims`} tone="success" />
        <Figure label="Avg approval" value={avg === null ? '—' : `${avg < 1 ? Math.max(1, Math.round(avg * 24)) + 'h' : avg.toFixed(1) + 'd'}`} note="processing time, last 90 days" />
      </div>
      <Panel title="Approval pipeline">
        <ol className="flex flex-wrap gap-2 px-5 py-4" aria-label="Approval pipeline">
          {stage('Submitted', pending.filter((c) => !c.held_at).length, 'in approval chain', 'text-warning')}
          {stage('On hold', pending.filter((c) => c.held_at).length, 'needs info', 'text-warning')}
          {stage('Approved', approved.length, 'ready to pay', 'text-primary')}
          {stage('Reimbursed', paidCycle.length, `paid · ${monthLabel(cycle)}`, 'text-success')}
        </ol>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title="Recent claims" actions={<Link className="text-sm text-primary hover:underline" href={`${base}?tab=claims`}>All claims →</Link>}>
          <ClaimsTable rows={claims.slice(0, 8)} people={people} cats={cats} base={base} caption="Recent claims" empty="No claims yet." />
        </Panel>
        <Panel title={`This cycle · ${monthLabel(cycle)}`}>
          <dl className="space-y-3 px-5 py-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Claims filed</dt><dd className="font-semibold tabular-nums">{filed.length}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Total value</dt><dd className="font-semibold tabular-nums">{inr.format(sum(filed))}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Avg / claim</dt><dd className="font-semibold tabular-nums">{inr.format(filed.length ? sum(filed) / filed.length : 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">With receipt</dt><dd className="font-semibold tabular-nums">{items ? Math.round((filed.reduce((a, c) => a + c.receipts, 0) / items) * 100) : 0}%</dd></div>
          </dl>
          <p className="border-t border-line px-5 py-3 text-sm"><Link className="text-primary hover:underline" href={`${base}?tab=reimbursement&cycle=${cycle}`}>Run reimbursement →</Link></p>
        </Panel>
      </div>
    </div>
  );
}

export function ClaimsTab({ slug, base, claims, people, categories, departments, sp }: AdminProps) {
  const cats = new Map(categories.map((c) => [c.id, c.name]));
  const rows = filterClaims(claims, sp, people);
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== 'tab')).toString();
  const sel = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm';
  return (
    <Panel title={`All claims · ${rows.length}`} actions={<a className="text-sm text-primary hover:underline" href={`${base}/export?${qs}`} download>⬇ Export</a>}>
      <form method="get" action={base} className="flex flex-wrap items-end gap-2 px-5 py-3" aria-label="Filter claims">
        <input type="hidden" name="tab" value="claims" />
        <input name="q" defaultValue={sp.q} placeholder="Search name, ID, claim…" aria-label="Search claims" className={`${sel} w-56`} />
        <select name="state" defaultValue={sp.state ?? ''} aria-label="Status" className={sel}><option value="">All statuses</option>{STATE_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <select name="category" defaultValue={sp.category ?? ''} aria-label="Category" className={sel}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="department" defaultValue={sp.department ?? ''} aria-label="Department" className={sel}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select name="receipt" defaultValue={sp.receipt ?? ''} aria-label="Receipt" className={sel}><option value="">Any receipt</option><option value="with">With receipt</option><option value="without">No receipt</option></select>
        <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">⨁ Filter</button>
        {qs && <Link href={`${base}?tab=claims`} className="text-sm text-muted hover:text-fg">Clear</Link>}
      </form>
      <ClaimsTable rows={rows.slice(0, 500)} people={people} cats={cats} base={base} caption="All claims" empty="No claims for this view." />
      <div className="px-5 pt-3"><ImportForm action={importExpensesAction.bind(null, slug)} label="Import expenses" templateHref={`${base}/template?kind=expenses`} /></div>
    </Panel>
  );
}

export function ReimbursementTab({ ctx, slug, base, cycle, today, claims, people, categories }: AdminProps) {
  const cats = new Map(categories.map((c) => [c.id, c.name]));
  const approved = claims.filter((c) => c.status === 'approved');
  const paid = claims.filter((c) => c.status === 'paid' && (c.paid_at ?? '').startsWith(cycle));
  const end = new Date(Date.UTC(Number(cycle.slice(0, 4)), Number(cycle.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const away = Math.round(days(today, end));
  const sum = (xs: ClaimRow[]) => xs.reduce((a, c) => a + c.total, 0);
  const rows = [...approved, ...paid].map((c) => {
    const p = people.get(c.employee_id);
    return { id: c.id, employee: name(p), code: p?.employee_code ?? '', category: c.categoryIds.length > 1 ? 'Multiple' : cats.get(c.categoryIds[0] ?? '') ?? '—', amount: c.total,
      state: c.status === 'approved' ? 'Approved' : 'Paid', mode: c.payout_mode, reference: c.payout_reference, claimHref: `${base}/${c.id}` };
  });
  const active = [...people.values()].filter((p) => ['active', 'on_notice'].includes(p.status)).sort((a, b) => name(a).localeCompare(name(b)));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Ready to pay" value={approved.length} note="approved claims" tone={approved.length ? 'primary' : undefined} />
        <Figure label="Batch value" value={inr.format(sum(approved))} note="awaiting payout" />
        <Figure label="Next pay run" value={formatDate(end).replace(/ \d{4}$/, '')} note={away >= 0 ? `${away} day${away === 1 ? '' : 's'} away` : 'cycle ended'} />
        <Figure label="Paid so far" value={inr.format(sum(paid))} note={`${paid.length} entries · ${monthLabel(cycle)}`} tone="success" />
      </div>
      <Panel title={`Ready to reimburse · ${approved.length} approved claims · ${inr.format(sum(approved))}`}
        actions={<Link className="text-sm text-primary hover:underline" href={`/app/${slug}/payroll?tab=run`}>▶ Push to Payroll →</Link>}>
        <p className="px-5 text-sm text-muted">Approved claims are added to the next payroll run automatically and marked reimbursed when it is locked. To pay some now, select them, download the bank file and mark them paid.</p>
        <div className="px-5 py-3">
          <PayoutQueue rows={rows} bankHref={`${base}/bank-file`} pay={payClaimsAction.bind(null, slug)} canBank={ctx.can('employee.bank.read', 'org')} />
        </div>
      </Panel>
      <Panel title="＋ Add Expense">
        <p className="px-5 text-sm text-muted">Record an expense for someone (for example, a bill finance paid on their behalf). It is approved and goes into the payout queue.</p>
        <div className="px-5 py-3">
          <RecordExpenseForm action={recordExpenseAction.bind(null, slug)} today={today} people={active.map((p) => ({ value: p.id, label: `${name(p)} · ${p.employee_code}` }))}
            categories={categories.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, subcategories: c.subcategories }))} />
        </div>
      </Panel>
    </div>
  );
}

export function CategoriesTab({ slug, base, categories }: AdminProps) {
  return (
    <div className="space-y-5">
      <Panel title="Expense categories" actions={<a className="text-sm text-primary hover:underline" href={`${base}/template?kind=categories`} download>⬇ Template</a>}>
        <p className="px-5 text-sm text-muted">Categories &amp; sub-categories employees pick when filing a claim.</p>
        {categories.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">🗂️ No categories yet. Add a category to start receiving claims.</p> : (
          <ul className="divide-y divide-line" aria-label="Categories">
            {categories.map((c) => (
              <li key={c.id} className={`px-5 py-3 ${c.is_active ? '' : 'opacity-60'}`}>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                    <span><span className="font-medium">{c.name}</span> <span className="text-xs text-muted">{c.code}{c.requires_receipt ? ' · receipt required' : ' · no receipt needed'}{c.max_per_item ? ` · up to ${inr.format(Number(c.max_per_item))}` : ''}</span>
                      {c.subcategories.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{c.subcategories.map((s) => <span key={s} className="rounded-full bg-subtle px-2 py-0.5 text-xs">{s}</span>)}</span>}</span>
                    <span className="flex items-center gap-2">{!c.is_active && <Badge>Archived</Badge>}
                      <SmallAction action={toggleCategoryAction.bind(null, slug)} fields={{ categoryId: c.id, active: c.is_active ? 'no' : 'yes' }}
                        label={c.is_active ? 'Archive' : 'Restore'} aria={`${c.is_active ? 'Archive' : 'Restore'} ${c.name}`} /></span>
                  </summary>
                  <div className="mt-3"><CategoryForm action={saveCategoryAction.bind(null, slug)} category={{ ...c, max_per_item: c.max_per_item === null ? null : Number(c.max_per_item) }} /></div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="＋ Add category"><div className="px-5 py-3"><CategoryForm action={saveCategoryAction.bind(null, slug)} /></div></Panel>
        <Panel title="Import categories"><div className="px-5 py-3"><ImportForm action={importCategoriesAction.bind(null, slug)} label="Import categories" templateHref={`${base}/template?kind=categories`} /></div></Panel>
      </div>
    </div>
  );
}

export async function AnalyticsTab({ ctx, today, claims, people, categories, departments }: AdminProps) {
  const fyStart = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  const spent = claims.filter((c) => ['approved', 'paid'].includes(c.status) && (c.decided_at ?? c.created_at) >= fyStart);
  const decided = claims.filter((c) => ['approved', 'paid', 'rejected'].includes(c.status) && (c.decided_at ?? c.created_at) >= fyStart);
  const rejected = decided.filter((c) => c.status === 'rejected').length;
  const total = spent.reduce((a, c) => a + c.total, 0);
  const supabase = await createClient();
  const ids = spent.map((c) => c.id);
  const items: Array<{ claim_id: string; category_id: string; amount: number }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('expense_items').select('claim_id, category_id, amount').eq('organization_id', ctx.org.id).in('claim_id', ids.slice(i, i + 200));
    items.push(...(data ?? []).map((x) => ({ ...x, amount: Number(x.amount) })));
  }
  const byCat = new Map<string, number>();
  for (const it of items) byCat.set(it.category_id, (byCat.get(it.category_id) ?? 0) + it.amount);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const top = [...byCat].sort((a, b) => b[1] - a[1]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const byDept = new Map<string, number>();
  for (const c of spent) { const d = people.get(c.employee_id)?.department_id; const k = d ? (deptName.get(d) ?? '—') : '—'; byDept.set(k, (byDept.get(k) ?? 0) + c.total); }
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(today.slice(0, 7), i - 11));
  const bars = (xs: Array<[string, number]>, label: string) => xs.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No data yet.</p> : (
    <ul className="space-y-2 px-5 py-4 text-sm" aria-label={label}>
      {xs.slice(0, 8).map(([k, v]) => (
        <li key={k}><span className="flex justify-between"><span>{k}</span><span className="tabular-nums">{inr.format(v)}</span></span>
          <span className="mt-1 block h-1.5 rounded-full bg-subtle"><span className="block h-1.5 rounded-full bg-primary" style={{ width: `${(v / Math.max(...xs.map((x) => x[1]))) * 100}%` }} /></span></li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Total spend · YTD" value={inr.format(total)} note={`${spent.length} claims this financial year`} />
        <Figure label="Avg / claim" value={inr.format(spent.length ? total / spent.length : 0)} note="across all categories" />
        <Figure label="Top category" value={top[0] ? catName.get(top[0][0]) ?? '—' : '—'} note={top[0] ? inr.format(top[0][1]) : '—'} />
        <Figure label="Reimbursement rate" value={`${decided.length ? Math.round(((decided.length - rejected) / decided.length) * 100) : 0}%`} note={`${decided.length ? Math.round((rejected / decided.length) * 100) : 0}% rejected`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Spend by category">{bars(top.map(([k, v]) => [catName.get(k) ?? '—', v]), 'Spend by category')}</Panel>
        <Panel title="Top departments">{bars([...byDept].sort((a, b) => b[1] - a[1]), 'Spend by department')}</Panel>
      </div>
      <Panel title="Month-on-month spend">
        <div className="px-5 py-4"><BarChart label="Approved spend by month" format={(n) => inr.format(n)}
          data={months.map((m) => ({ label: monthLabel(m), value: claims.filter((c) => ['approved', 'paid'].includes(c.status) && (c.decided_at ?? '').startsWith(m)).reduce((a, c) => a + c.total, 0) }))} /></div>
      </Panel>
    </div>
  );
}

export async function SettingsTab({ slug, settings, ai }: AdminProps & { settings: Parameters<typeof ExpenseSettingsForm>[0]['s']; ai: boolean }) {
  return (
    <Panel title="Settings">
      <div className="px-5 py-4"><ExpenseSettingsForm action={saveExpenseSettingsAction.bind(null, slug)} s={settings} ai={ai} /></div>
    </Panel>
  );
}
