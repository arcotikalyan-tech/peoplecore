import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { HubTabs } from '@/components/ui/hub';
import { getOrgContext } from '@/server/context';
import { monthRun, shiftMonth } from '@/server/payroll-suite';
import { monthLabel } from './format';
import { ComplianceTab } from './_tabs/compliance';
import { DeclarationsTab } from './_tabs/declarations';
import { HubTab } from './_tabs/hub';
import { InsightsTab } from './_tabs/insights';
import { PayoutTab } from './_tabs/payout';
import { PeopleTab } from './_tabs/people';
import { RegisterTab } from './_tabs/register';
import { RunTab } from './_tabs/run';
import { SettingsTab } from './_tabs/settings';
import { cycleState } from './_tabs/shared';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Payroll' };

type Search = Record<string, string | undefined>;

/**
 * Payroll workspace (as Kredily): a month switcher, the cycle's state and nine tabs. Payroll staff only; everyone
 * else goes to their own payslips, salary and tax center.
 */
export default async function PayrollPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'payroll');
  const prepares = ctx.can('payroll.prepare', 'org');
  const approves = ctx.can('payroll.approve', 'org');
  if (!prepares && !approves) redirect(`/app/${slug}/payslips`);

  const today = todayIn(ctx.org.timezone);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? `${sp.month}-01` : `${today.slice(0, 7)}-01`;
  const base = `/app/${slug}/payroll`;
  const run = await monthRun(ctx.org.id, month);
  const state = cycleState(run);
  const tabs = [
    { key: 'hub', label: '✦ Hub' }, { key: 'run', label: 'Run Payroll' }, { key: 'register', label: 'Pay Register' }, { key: 'payout', label: 'Payout' },
    { key: 'people', label: 'People & Salaries' }, { key: 'declarations', label: 'Declarations' }, { key: 'compliance', label: 'Compliance' },
    { key: 'insights', label: 'Insights' }, { key: 'settings', label: 'Settings' },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const m = month.slice(0, 7);
  const link = (to: string, extra: Record<string, string> = {}) => `${base}?${new URLSearchParams({ tab, month: to.slice(0, 7), ...extra }).toString()}`;
  const p = { ctx, slug, base, month, today, run, prepares, approves, sp };

  return (
    <>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Payroll</h1>
          <span className="h-5 w-px bg-primary" aria-hidden="true" />
          <span className="text-xl font-semibold text-primary">{monthLabel(month).replace(/(\w{3})\w*/, '$1')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 rounded-full border border-warning/40 bg-warning-soft px-3 py-1 text-xs font-medium text-warning">
            <span aria-hidden="true">●</span> Cycle · {monthLabel(month)} <span className="font-semibold">{state.label}</span>
          </span>
          <Link href={link(shiftMonth(month, -1))} className={buttonClass('secondary', 'sm')}>‹ Prev</Link>
          <form action={base} className="flex">
            <input type="hidden" name="tab" value={tab} />
            <label className="sr-only" htmlFor="pay-month">Month</label>
            <input id="pay-month" type="month" name="month" defaultValue={m} className="h-8 rounded-md border border-line bg-surface px-2 text-sm" />
            <button className="sr-only">Go</button>
          </form>
          <Link href={link(shiftMonth(month, 1))} className={buttonClass('secondary', 'sm')}>Next ›</Link>
          <Link href={`${base}?tab=run&month=${m}`} className={buttonClass('primary', 'sm')}>▶ Run Payroll</Link>
        </div>
      </header>
      <HubTabs base={base} label="Payroll sections" tabs={tabs} current={tab} extra={{ month: m }} />
      {tab === 'hub' && <HubTab {...p} />}
      {tab === 'run' && <RunTab {...p} />}
      {tab === 'register' && <RegisterTab {...p} />}
      {tab === 'payout' && <PayoutTab {...p} />}
      {tab === 'people' && <PeopleTab {...p} />}
      {tab === 'declarations' && <DeclarationsTab {...p} />}
      {tab === 'compliance' && <ComplianceTab {...p} />}
      {tab === 'insights' && <InsightsTab {...p} />}
      {tab === 'settings' && <SettingsTab {...p} />}
    </>
  );
}
