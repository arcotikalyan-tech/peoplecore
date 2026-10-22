import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { HubHeader, HubTabs } from '@/components/ui/hub';
import { EmptyState } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { viewModeFor } from '@/server/view';
import { AdminHub } from './_tabs/admin-hub';
import { AnalyticsTab, DevicesTab, SettingsTab } from './_tabs/admin-more';
import { ApprovalsTab } from './_tabs/approvals';
import { LogsTab } from './_tabs/logs';
import { RulesTab } from './_tabs/rules';
import { MyCalendar, MyHub, MyInsights, MyLogs, MyRule } from './_tabs/self';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Attendance' };

type Search = Record<string, string | undefined>;

/**
 * Attendance hub. HR and managers (in the admin view) get the organization's attendance: live hub, logs,
 * approvals, rules, analytics, devices and settings. Everyone else (and anyone in the "Me" view) gets their
 * own: today, calendar, logs, rule and insights. Tabs are hidden for usability only; RLS decides what loads.
 */
export default async function AttendancePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'attendance');
  if (!ctx.can('attendance.read')) notFound();
  const [me, view] = await Promise.all([getMyEmployee(ctx.org.id, ctx.user.id), viewModeFor(ctx)]);
  const today = todayIn(ctx.org.timezone);
  const orgBase = `/app/${slug}`;
  const base = `${orgBase}/attendance`;
  const seesOthers = ctx.can('attendance.read', 'org') || ctx.can('attendance.read', 'team');
  const admin = view === 'admin' && seesOthers;
  const manage = ctx.can('attendance.manage', 'org');
  const devices = manage || ctx.can('attendance.device.manage', 'org');
  const reviews = manage || ctx.can('attendance.approve');

  const adminTabs = [
    { key: 'hub', label: '✦ Hub' }, { key: 'logs', label: 'Logs' },
    ...(reviews || me ? [{ key: 'approvals', label: 'Approvals' }] : []),
    ...(manage ? [{ key: 'rules', label: 'Attendance Rules' }] : []),
    { key: 'analytics', label: 'Analytics' },
    ...(devices ? [{ key: 'devices', label: 'Devices' }] : []),
    ...(manage ? [{ key: 'settings', label: 'Settings' }] : []),
  ];
  const selfTabs = [
    { key: 'hub', label: 'Today' }, { key: 'calendar', label: 'Calendar' }, { key: 'logs', label: 'Punches' },
    { key: 'rule', label: 'My rule' }, { key: 'insights', label: 'My insights' },
  ];
  const tabs = admin ? adminTabs : selfTabs;
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const month = /^\d{4}-\d{2}/.test(sp.month ?? '') ? `${sp.month!.slice(0, 7)}-01` : `${today.slice(0, 7)}-01`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today;
  const page = Math.max(1, Number(sp.page) || 1);

  return (
    <>
      <HubHeader title={admin ? 'Attendance · Command Center' : 'Attendance'} badge={admin ? 'Live' : undefined}
        subtitle={admin ? (ctx.can('attendance.read', 'org') ? 'Real-time workforce presence · all locations · all shifts' : 'Your reporting line’s attendance, live.') : 'Check in and out, your month, and corrections.'}
        actions={admin && (
          <>
            <Link className={buttonClass('secondary', 'sm')} href={`${base}?tab=${tab}`}>↻ Refresh</Link>
            <a className={buttonClass('secondary', 'sm')} href={`${base}/export?date=${date}`}>⬇ Export</a>
            <details className="relative">
              <summary className={buttonClass('primary', 'sm', 'cursor-pointer list-none')}>+ Quick Action ▾</summary>
              <ul className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-line bg-raised p-1.5 text-sm shadow-xl">
                {[
                  ...(ctx.can('attendance.read', 'org') ? [[`${base}/summary`, 'Monthly summary']] : []),
                  [`${base}?tab=approvals`, 'Review approvals'],
                  [`${base}?tab=logs&view=daily`, 'Open the daily log'],
                  ...(manage ? [[`${base}?tab=logs&view=penalty`, 'Run penalties'], [`${base}?tab=rules&rule=new`, 'New attendance rule'],
                    [`${base}?tab=rules&view=workweek`, 'Assign a work week'], [`${base}?tab=devices`, 'Import device punches'], [`${base}?tab=settings`, 'Attendance settings']] : []),
                ].map(([href, label]) => <li key={href}><Link href={href!} className="block rounded-lg px-3 py-2 hover:bg-subtle">{label}</Link></li>)}
              </ul>
            </details>
          </>
        )} />
      <HubTabs base={base} label="Attendance sections" tabs={tabs} current={tab} />

      {admin ? (
        <>
          {tab === 'hub' && <AdminHub ctx={ctx} orgBase={orgBase} base={base} today={today} pulse={sp.pulse ?? 'all'} q={sp.q ?? ''} />}
          {tab === 'logs' && <LogsTab ctx={ctx} slug={slug} orgBase={orgBase} base={base} today={today}
            p={{ view: sp.view ?? 'daily', date, month, monthSet: /^\d{4}-\d{2}/.test(sp.month ?? ''), q: sp.q ?? '', dept: sp.dept ?? '', page }} />}
          {tab === 'approvals' && <ApprovalsTab ctx={ctx} slug={slug} orgBase={orgBase} base={base} view={sp.view ?? 'open'} myEmployeeId={me?.id ?? null} />}
          {tab === 'rules' && <RulesTab ctx={ctx} slug={slug} base={base} view={sp.view ?? 'rules'} selected={sp.rule ?? ''} />}
          {tab === 'analytics' && <AnalyticsTab ctx={ctx} today={today} />}
          {tab === 'devices' && <DevicesTab ctx={ctx} slug={slug} />}
          {tab === 'settings' && <SettingsTab ctx={ctx} slug={slug} />}
        </>
      ) : !me ? (
        <EmptyState title="No employee record" description="Your account isn’t linked to an employee record, so there’s no attendance to show." />
      ) : (
        <>
          {tab === 'hub' && <MyHub ctx={ctx} slug={slug} me={me} today={today} />}
          {tab === 'calendar' && <MyCalendar ctx={ctx} me={me} month={month} />}
          {tab === 'logs' && <MyLogs ctx={ctx} me={me} />}
          {tab === 'rule' && <MyRule ctx={ctx} me={me} today={today} />}
          {tab === 'insights' && <MyInsights ctx={ctx} me={me} today={today} />}
        </>
      )}
    </>
  );
}
