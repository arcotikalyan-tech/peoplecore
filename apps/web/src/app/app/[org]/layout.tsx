import { asScene, asTheme, asWeather, COOKIE } from '@/lib/theme';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { legalName } from '@peoplecore/shared';
import { AppShell } from '@/components/shell/app-shell';
import { pruneEmpty, type NavGroup, type NavItem } from '@/components/shell/nav-model';
import { FlashMessage } from '@/components/flash-message';
import { getOrgContext, isPlatformAdmin } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { REPORTS } from '@/lib/report-catalog';
import { canRun } from '@/server/reports';
import { readFlash } from '@/server/flash';
import { aiAvailable } from '@/server/ai';
import { unreadNotificationCount } from '@/server/inbox';
import { hasAdminView, viewModeFor } from '@/server/view';
import { searchPeopleAction } from './search-actions';

export default async function OrgLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const [platformAdmin, unread, flashed, ai, me, view, jar] = await Promise.all([
    isPlatformAdmin(), unreadNotificationCount(ctx.org.id), readFlash(), aiAvailable(ctx), getMyEmployee(ctx.org.id, ctx.user.id), viewModeFor(ctx), cookies(),
  ]);
  const base = `/app/${slug}`;
  const profileHref = me ? `${base}/employees/${me.id}` : null;
  const when = (ok: boolean, item: NavItem) => (ok ? [item] : []);
  const reports = REPORTS.some((r) => canRun(ctx, r.access));

  const home: NavGroup = { label: null, items: [
    { href: base, label: 'Dashboard', icon: 'home', exact: true },
    { href: `${base}/inbox`, label: 'Inbox', icon: 'inbox', count: unread },
  ] };

  const nav: NavGroup[] = view === 'admin' ? [
    home,
    { label: 'People', items: [
      ...when(ctx.can('employee.read'), { href: `${base}/employees`, label: 'People', icon: 'users' }),
      ...when(ctx.can('org.read'), { href: `${base}/company`, label: 'Company Profile', icon: 'building' }),
      ...(profileHref ? [{ href: profileHref, label: 'My Profile', icon: 'user' } as NavItem] : []),
      { href: `${base}/letters`, label: 'Letters', icon: 'mail' },
      ...when(ctx.can('recruitment.read'), { href: `${base}/recruitment`, label: 'Recruitment', icon: 'briefcase' }),
      ...when(ctx.can('onboarding.manage', 'org'), { href: `${base}/onboarding`, label: 'Onboarding', icon: 'user-plus' }),
      { href: `${base}/separations`, label: 'Separations', icon: 'log-out' },
    ] },
    { label: 'Time', items: [
      ...when(ctx.can('attendance.read'), { href: `${base}/attendance`, label: 'Attendance', icon: 'clock' }),
      ...when(ctx.can('leave.read'), { href: `${base}/leave`, label: 'Leave', icon: 'palm' }),
    ] },
    { label: 'Pay', items: [
      ...when(ctx.can('payroll.prepare', 'org') || ctx.can('payroll.approve', 'org'), { href: `${base}/payroll`, label: 'Payroll', icon: 'wallet' }),
      { href: `${base}/payslips`, label: 'My Pay', icon: 'receipt' },
      { href: `${base}/expenses`, label: 'Expenses', icon: 'card' },
      { href: `${base}/loans`, label: 'Loans', icon: 'coins' },
      ...when(reports, { href: `${base}/reports`, label: 'Reports', icon: 'sheet' }),
    ] },
    { label: 'Grow', items: [
      ...when(ctx.can('performance.read'), { href: `${base}/performance`, label: 'Performance', icon: 'trophy' }),
      { href: `${base}/learning`, label: 'Learning', icon: 'graduation' },
    ] },
    { label: 'Workplace', items: [
      { href: `${base}/engagement`, label: 'Engagement', icon: 'megaphone' },
      { href: `${base}/helpdesk`, label: 'Helpdesk', icon: 'lifebuoy' },
      { href: `${base}/knowledge`, label: 'Knowledge base', icon: 'book' },
      { href: `${base}/policies`, label: 'Policies', icon: 'file' },
      { href: `${base}/assets`, label: 'Assets', icon: 'laptop' },
      { href: `${base}/grievances`, label: 'Grievances', icon: 'shield' },
      ...when(ai, { href: `${base}/assistant`, label: 'Ask HR', icon: 'sparkles' }),
    ] },
    { label: 'Admin', items: [
      ...when(ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team'), { href: `${base}/insights`, label: 'Insights', icon: 'chart' }),
      ...when(reports, { href: `${base}/reports`, label: 'Reports', icon: 'sheet' }),
      ...when(ctx.can('member.manage', 'org'), { href: `${base}/members`, label: 'Members', icon: 'user-cog' }),
      ...when(ctx.can('workflow.manage', 'org'), { href: `${base}/workflows`, label: 'Workflows', icon: 'workflow' }),
      ...when(ctx.can('ai.manage', 'org'), { href: `${base}/ai`, label: 'AI assistants', icon: 'bot' }),
      ...when(ctx.can('audit.read'), { href: `${base}/audit`, label: 'Audit log', icon: 'scroll' }),
    ] },
  ] : [
    home,
    { label: 'Me', items: [
      ...(profileHref ? [{ href: profileHref, label: 'My Profile', icon: 'user' } as NavItem] : []),
      { href: `${base}/employees`, label: 'People', icon: 'users' },
      { href: `${base}/letters`, label: 'Letters', icon: 'mail' },
      ...when(ctx.can('attendance.read'), { href: `${base}/attendance`, label: 'Attendance', icon: 'clock' }),
      ...when(ctx.can('leave.read'), { href: `${base}/leave`, label: 'Leave', icon: 'palm' }),
      { href: `${base}/payslips`, label: 'My Pay', icon: 'receipt' },
      { href: `${base}/expenses`, label: 'Expenses', icon: 'card' },
      { href: `${base}/loans`, label: 'Loans', icon: 'coins' },
    ] },
    { label: 'Grow', items: [
      ...when(ctx.can('performance.read'), { href: `${base}/performance`, label: 'Performance', icon: 'trophy' }),
      { href: `${base}/learning`, label: 'Learning', icon: 'graduation' },
    ] },
    { label: 'Workplace', items: [
      { href: `${base}/engagement`, label: 'Engagement', icon: 'megaphone' },
      { href: `${base}/helpdesk`, label: 'Helpdesk', icon: 'lifebuoy' },
      { href: `${base}/knowledge`, label: 'Knowledge base', icon: 'book' },
      { href: `${base}/policies`, label: 'Policies', icon: 'file' },
      { href: `${base}/assets`, label: 'Assets', icon: 'laptop' },
      { href: `${base}/grievances`, label: 'Grievances', icon: 'shield' },
      { href: `${base}/separations`, label: 'Separations', icon: 'log-out' },
      ...when(ai, { href: `${base}/assistant`, label: 'Ask HR', icon: 'sparkles' }),
    ] },
  ];

  return (
    <AppShell
      base={base}
      nav={pruneEmpty(nav)}
      org={{ name: ctx.org.name, isDemo: ctx.org.is_demo }}
      user={{ name: me ? legalName(me) : (ctx.user.email ?? 'You'), email: ctx.user.email, profileHref }}
      unread={unread}
      view={view}
      canSwitchView={hasAdminView(ctx)}
      platformAdmin={platformAdmin}
      railInitially={jar.get('pc-nav')?.value !== 'full'}
      appearance={{ theme: asTheme(jar.get(COOKIE.theme)?.value), scene: asScene(jar.get(COOKIE.scene)?.value), weather: asWeather(jar.get(COOKIE.weather)?.value) }}
      search={searchPeopleAction.bind(null, slug)}
    >
      <FlashMessage message={flashed} />
      {children}
    </AppShell>
  );
}
