import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { HubTabs } from '@/components/ui/hub';
import { aiAvailable } from '@/server/ai';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { allCategories, claimRows, expenseSettings } from '@/server/expenses';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import { viewModeFor } from '@/server/view';
import { AnalyticsTab, CategoriesTab, ClaimsTab, HubTab, ReimbursementTab, SettingsTab, type AdminProps } from './_tabs/admin';
import { ApprovalsTab, MyClaims, MyHub } from './_tabs/mine';
import { monthLabel, shiftMonth } from './_tabs/shared';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Expenses' };

type Search = Record<string, string | undefined>;
const EXPENSE_FLOWS = new Set(['expense_claim', 'expense_claim_manager', 'expense_claim_finance']);

/**
 * Expenses (Kredily's Expense Admin and My Expenses). Finance: a pay cycle with hub, all claims, reimbursement
 * (payout queue, bank file, pay outside payroll, add an expense), categories, analytics and settings. Approvers
 * get an Approvals tab; everyone files and follows their own claims.
 */
export default async function ExpensesPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'expenses');
  const base = `/app/${slug}/expenses`;
  const today = todayIn(ctx.org.timezone);
  const view = await viewModeFor(ctx);
  const finance = ctx.can('expense.manage', 'org') && view === 'admin';
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const supabase = await createClient();
  const [pending, categories] = await Promise.all([
    supabase.rpc('my_pending_approvals', { p_org: ctx.org.id }).then((r) => (r.data ?? []).filter((a) => EXPENSE_FLOWS.has(a.subject_type))),
    allCategories(ctx.org.id),
  ]);
  const approver = pending.length > 0 || ctx.can('expense.approve', 'team') || ctx.can('expense.approve', 'org');
  const cats = new Map(categories.map((c) => [c.id, c.name]));

  if (!finance) {
    const [mine, settings] = await Promise.all([me ? claimRows(ctx.org.id, { employeeId: me.id }) : Promise.resolve([]), expenseSettings(ctx.org.id)]);
    const tabs = [{ key: 'hub', label: '✦ Hub' }, { key: 'mine', label: 'My Claims' }, ...(approver ? [{ key: 'approvals', label: 'Approvals', count: pending.length }] : [])];
    const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
    return (
      <>
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">My Expenses</h1></div>
            <p className="mt-1 text-sm text-muted">Claims are approved by your manager and finance, then paid with payroll.</p>
          </div>
          <Link href={`${base}?tab=mine`} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg">+ New Claim</Link>
        </header>
        <HubTabs base={base} label="Expense sections" tabs={tabs} current={tab} />
        {tab === 'hub' && <MyHub slug={slug} base={base} claims={mine} cats={cats} today={today} mileage={me && settings.mileage_enabled ? { rate: Number(settings.mileage_rate) } : null} />}
        {tab === 'mine' && <MyClaims slug={slug} base={base} claims={mine} cats={cats} sp={sp} />}
        {tab === 'approvals' && <ApprovalsTab ctx={ctx} slug={slug} items={pending} />}
      </>
    );
  }

  const cycle = /^\d{4}-\d{2}$/.test(sp.cycle ?? '') ? sp.cycle! : today.slice(0, 7);
  const [claims, structure, people, settings, ai] = await Promise.all([
    claimRows(ctx.org.id, { excludeDrafts: true }), getStructure(ctx.org.id),
    supabase.from('employees').select('id, employee_code, first_name, last_name, department_id, status').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
    expenseSettings(ctx.org.id), aiAvailable(ctx),
  ]);
  const tabs = [
    { key: 'hub', label: '✦ Hub' }, { key: 'claims', label: 'All Claims' }, { key: 'reimbursement', label: 'Reimbursement', count: claims.filter((c) => c.status === 'approved').length },
    { key: 'categories', label: 'Categories' }, { key: 'analytics', label: 'Analytics' }, { key: 'settings', label: 'Settings' },
    ...(pending.length ? [{ key: 'approvals', label: 'Approvals', count: pending.length }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const props: AdminProps = {
    ctx, slug, base, cycle, today, claims, sp, categories: categories.map((c) => ({ ...c, max_per_item: c.max_per_item === null ? null : Number(c.max_per_item) })),
    people: new Map(people.map((p) => [p.id, p])), departments: structure.departments.map((d) => ({ id: d.id, name: d.name })),
  };
  const cycleHref = (m: string) => `${base}?${new URLSearchParams({ tab, cycle: m }).toString()}`;

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Expense Admin</h1>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Reimagined</span></div>
          <p className="mt-1 text-sm text-muted">Cycle · <span className="font-medium text-fg">{monthLabel(cycle)}</span> · reimburse with payroll</p>
        </div>
        <nav aria-label="Cycle" className="flex flex-wrap items-center gap-2 text-sm">
          <Link className="rounded-lg border border-line bg-surface px-3 py-2 hover:bg-subtle" href={cycleHref(shiftMonth(cycle, -1))}>‹ Prev</Link>
          <span className="rounded-lg border border-line bg-surface px-3 py-2 font-medium">{monthLabel(cycle)}</span>
          {cycle < today.slice(0, 7) && <Link className="rounded-lg border border-line bg-surface px-3 py-2 hover:bg-subtle" href={cycleHref(shiftMonth(cycle, 1))}>Next ›</Link>}
          <Link className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-fg" href={`${base}?tab=reimbursement&cycle=${cycle}`}>▶ Run reimbursement</Link>
        </nav>
      </header>
      <HubTabs base={base} label="Expense sections" tabs={tabs} current={tab} extra={{ cycle }} />
      {tab === 'hub' && <HubTab {...props} />}
      {tab === 'claims' && <ClaimsTab {...props} />}
      {tab === 'reimbursement' && <ReimbursementTab {...props} />}
      {tab === 'categories' && <CategoriesTab {...props} />}
      {tab === 'analytics' && <AnalyticsTab {...props} />}
      {tab === 'settings' && <SettingsTab {...props} settings={{ ...settings, threshold: settings.threshold === null ? null : Number(settings.threshold), mileage_rate: Number(settings.mileage_rate) }} ai={ai} />}
      {tab === 'approvals' && <ApprovalsTab ctx={ctx} slug={slug} items={pending} />}
    </>
  );
}
