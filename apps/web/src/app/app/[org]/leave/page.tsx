import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { HubHeader, HubTabs } from '@/components/ui/hub';
import { EmptyState } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getInbox } from '@/server/inbox';
import { getLeaveSettings, leaveCycle } from '@/server/leave-ops';
import { viewModeFor } from '@/server/view';
import { AccrualsTab, AdminHub, ApprovalsTab, BalancesTab, RulesTab, SettingsTab } from './_tabs/admin';
import { MyAccruals, MyBalances, MyCalendar, MyHub, MyInsights, MyRequests, MyRules } from './_tabs/self';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Leave' };

type Search = Record<string, string | undefined>;

/**
 * Leave hub. HR and managers (admin view) get leave operations: hub, approvals, rules and assignments, balances,
 * the accrual ledger and settings. Everyone else (and anyone in the "Me" view) gets their own leave: hub,
 * calendar, requests, rules, balances, accrual history and insights. Tabs only shape the page; RLS decides what loads.
 */
export default async function LeavePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'leave');
  if (!ctx.can('leave.read')) notFound();
  const today = todayIn(ctx.org.timezone);
  const [me, view, settings] = await Promise.all([getMyEmployee(ctx.org.id, ctx.user.id), viewModeFor(ctx), getLeaveSettings(ctx.org.id)]);
  const base = `/app/${slug}/leave`;
  const seesOthers = ctx.can('leave.read', 'org') || ctx.can('leave.read', 'team');
  const manage = ctx.can('leave.manage', 'org');
  const admin = view === 'admin' && seesOthers;
  const cycle = leaveCycle(today, settings.year_start_month);
  const pending = admin ? (await getInbox(ctx.org.id, me?.id ?? null)).approvals.filter((a) => a.subject_type === 'leave_request').length : 0;

  const adminTabs = [
    { key: 'hub', label: '✦ Hub' }, { key: 'approvals', label: 'Approvals', count: pending },
    ...(manage ? [{ key: 'rules', label: 'Leave rules' }] : []),
    { key: 'balances', label: 'Balances' }, { key: 'accruals', label: 'Accruals' },
    ...(manage ? [{ key: 'settings', label: 'Settings' }] : []),
  ];
  const selfTabs = [
    { key: 'hub', label: '✦ Hub' }, { key: 'calendar', label: 'Calendar' }, { key: 'requests', label: 'Requests' },
    { key: 'rules', label: 'My leave rules' }, { key: 'balances', label: 'Balances' }, { key: 'accruals', label: 'Accrual history' },
    { key: 'insights', label: 'Insights' },
  ];
  const tabs = admin ? adminTabs : selfTabs;
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const month = /^\d{4}-\d{2}/.test(sp.month ?? '') ? `${sp.month!.slice(0, 7)}-01` : `${today.slice(0, 7)}-01`;
  const p = { ctx, slug, base, today };

  return (
    <>
      <HubHeader title={admin ? 'Leave operations' : 'My leave'} badge={admin ? undefined : `${cycle.label} cycle`}
        subtitle={admin ? (ctx.can('leave.read', 'org') ? 'Org-wide leave: approvals, rules, balances and accruals.' : 'Your reporting line’s leave.') : 'Plan smart breaks: balances, requests and your calendar.'}
        actions={admin ? (
          <>
            {manage && <Link className={buttonClass('secondary')} href={`${base}?tab=rules`}>✎ Edit leave rules</Link>}
            <a className={buttonClass('secondary')} href={`${base}/export?kind=requests&from=${cycle.start}`}>⬇ Export</a>
          </>
        ) : me && (
          <>
            <a className={buttonClass('secondary')} href={`${base}/export?kind=mine`}>⬇ Export</a>
            <a className={buttonClass('primary')} href={`${base}?tab=hub#apply`}>+ Apply leave</a>
          </>
        )} />
      <HubTabs base={base} label="Leave sections" tabs={tabs} current={tab} />

      {admin ? (
        <>
          {tab === 'hub' && <AdminHub {...p} />}
          {tab === 'approvals' && <ApprovalsTab {...p} sp={sp} />}
          {tab === 'rules' && <RulesTab {...p} view={sp.view ?? 'rules'} selected={sp.rule ?? ''} />}
          {tab === 'balances' && <BalancesTab {...p} q={sp.q ?? ''} employee={sp.employee ?? ''} />}
          {tab === 'accruals' && <AccrualsTab {...p} employee={sp.employee ?? ''} />}
          {tab === 'settings' && <SettingsTab {...p} />}
        </>
      ) : !me ? (
        <EmptyState title="No employee record" description="Your account isn’t linked to an employee record, so there’s no leave to show." />
      ) : (
        <>
          {tab === 'hub' && <MyHub {...p} me={me} action={sp.do ?? ''} />}
          {tab === 'calendar' && <MyCalendar {...p} me={me} month={month} who={sp.who ?? 'both'} />}
          {tab === 'requests' && <MyRequests {...p} me={me} status={sp.status ?? ''} type={sp.type ?? ''} />}
          {tab === 'rules' && <MyRules {...p} me={me} />}
          {tab === 'balances' && <MyBalances {...p} me={me} />}
          {tab === 'accruals' && <MyAccruals {...p} me={me} />}
          {tab === 'insights' && <MyInsights {...p} me={me} />}
        </>
      )}
    </>
  );
}
