import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { NavLink } from '@/components/nav-link';
import { getOrgContext, isPlatformAdmin } from '@/server/context';
import { FlashMessage } from '@/components/flash-message';
import { readFlash } from '@/server/flash';
import { unreadNotificationCount } from '@/server/inbox';

export default async function OrgLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const [platformAdmin, unread, flashed] = await Promise.all([isPlatformAdmin(), unreadNotificationCount(ctx.org.id), readFlash()]);
  const base = `/app/${slug}`;

  // Navigation is filtered for usability only; every page re-checks, and RLS enforces.
  const nav = [
    { href: base, label: 'Dashboard', exact: true },
    { href: `${base}/inbox`, label: 'Inbox', count: unread },
    ...(ctx.can('employee.read') ? [{ href: `${base}/employees`, label: 'Employees' }] : []),
    ...(ctx.can('leave.read') ? [{ href: `${base}/leave`, label: 'Leave' }] : []),
    ...(ctx.can('attendance.read') ? [{ href: `${base}/attendance`, label: 'Attendance' }] : []),
    ...(ctx.can('recruitment.read') ? [{ href: `${base}/recruitment`, label: 'Recruitment' }] : []),
    ...(ctx.can('payroll.prepare', 'org') || ctx.can('payroll.approve', 'org') ? [{ href: `${base}/payroll`, label: 'Payroll' }] : []),
    { href: `${base}/payslips`, label: 'Payslips' },
    { href: `${base}/expenses`, label: 'Expenses' },
    ...(ctx.can('performance.read') ? [{ href: `${base}/performance`, label: 'Performance' }] : []),
    { href: `${base}/learning`, label: 'Learning' },
    ...(ctx.can('onboarding.manage', 'org') ? [{ href: `${base}/onboarding`, label: 'Onboarding' }] : []),
    { href: `${base}/policies`, label: 'Policies' },
    { href: `${base}/engagement`, label: 'Engagement' },
    { href: `${base}/helpdesk`, label: 'Helpdesk' },
    { href: `${base}/knowledge`, label: 'Knowledge base' },
    { href: `${base}/assets`, label: 'Assets' },
    { href: `${base}/grievances`, label: 'Grievances' },
    { href: `${base}/separations`, label: 'Separations' },
    ...(ctx.can('org.read') ? [{ href: `${base}/structure`, label: 'Organization' }] : []),
    ...(ctx.can('member.manage', 'org') ? [{ href: `${base}/members`, label: 'Members' }] : []),
    ...(ctx.can('workflow.manage', 'org') ? [{ href: `${base}/workflows`, label: 'Workflows' }] : []),
    ...(ctx.can('audit.read') ? [{ href: `${base}/audit`, label: 'Audit log' }] : []),
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)] print:block">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex print:hidden">
        <div className="border-b border-line px-5 py-4">
          <Brand />
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium" title={ctx.org.name}>{ctx.org.name}</span>
            <Link href="/app" className="shrink-0 text-xs text-muted hover:text-fg">Switch</Link>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((item) => <NavLink key={item.href} {...item} />)}
        </nav>
        <div className="space-y-2 border-t border-line p-4 text-sm">
          <p className="truncate text-muted" title={ctx.user.email ?? undefined}>{ctx.user.email}</p>
          <div className="flex items-center gap-4">
            {platformAdmin && <Link href="/platform" className="text-muted hover:text-fg">Platform</Link>}
            <form action="/auth/signout" method="post">
              <button className="text-muted hover:text-fg">Sign out</button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="border-b border-line bg-surface lg:hidden print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Brand />
            <form action="/auth/signout" method="post">
              <button className="text-sm text-muted hover:text-fg">Sign out</button>
            </form>
          </div>
          <div className="px-4 pb-2 text-sm font-medium">{ctx.org.name}</div>
          <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3">
            {nav.map((item) => <NavLink key={item.href} {...item} compact />)}
          </nav>
        </header>

        {ctx.org.is_demo && (
          <div role="note" className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-xs font-medium text-warning print:hidden">
            Demo organization — every person and record here is synthetic.
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {flashed && <FlashMessage key={flashed} message={flashed} />}
          {children}
        </main>
      </div>
    </div>
  );
}
