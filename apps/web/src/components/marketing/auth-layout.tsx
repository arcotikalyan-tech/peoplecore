import type { ReactNode } from 'react';
import { CalendarCheck, Scale, Wallet } from 'lucide-react';
import { SiteHeader } from './site-header';

/** Sign in and sign up: the website header, the form on one side and an animated brand panel on the other. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-fg">
      <SiteHeader />
      <div className="grid flex-1 lg:grid-cols-2">
        <main className="flex items-center justify-center px-4 py-12 sm:px-6">
          <div className="pc-rise w-full max-w-md">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm text-muted">{subtitle}</p>
            <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-[0_30px_70px_-45px] shadow-primary/40">{children}</div>
            {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
          </div>
        </main>
        <aside aria-hidden="true" className="relative isolate hidden overflow-hidden border-l border-line bg-surface lg:block">
          <div className="pc-grid-bg absolute inset-0 -z-10" />
          <div className="pc-blob pc-blob-a -z-10 left-[-10%] top-[5%] size-[26rem]" />
          <div className="pc-blob pc-blob-b -z-10 bottom-[-10%] right-[-15%] size-[28rem]" />
          <div className="flex h-full flex-col justify-center gap-5 px-14">
            <p className="text-3xl font-semibold leading-tight tracking-tight">
              Your whole team, <span className="pc-gradient-text">one login away.</span>
            </p>
            {[
              { icon: CalendarCheck, title: 'Leave approved', body: '2 days casual leave · balance updated', cls: 'pc-floaty' },
              { icon: Wallet, title: 'Payroll locked', body: 'October · 151 payslips published', cls: 'pc-floaty pc-floaty-alt ml-10' },
              { icon: Scale, title: 'PF ECR ready', body: 'Due on the 15th · nothing missing', cls: 'pc-floaty ml-4' },
            ].map((c) => (
              <div key={c.title} className={`${c.cls} w-72 rounded-2xl border border-line bg-surface/90 p-4 shadow-xl backdrop-blur`}>
                <p className="flex items-center gap-2 text-sm font-medium"><c.icon className="size-4 text-primary" />{c.title}</p>
                <p className="mt-1 text-xs text-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
