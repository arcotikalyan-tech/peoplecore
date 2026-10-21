import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { MODULE_GROUPS, SITE_MODULES } from '@/components/marketing/content';
import { Reveal } from '@/components/marketing/motion';
import { PageFrame } from '@/components/marketing/page-frame';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Every PeopleCore module in detail: people, hiring, attendance, leave, payroll, expenses, compliance, performance, learning and more.',
  robots: { index: true, follow: true },
};

export default function FeaturesPage() {
  return (
    <PageFrame
      eyebrow="Features"
      title={<>Everything HR runs on, <span className="pc-gradient-text">module by module.</span></>}
      intro="Switch on what you need. Every module shares one employee record, one approval inbox and one set of permissions."
    >
      <nav aria-label="Module groups" className="sticky top-16 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6">
          {MODULE_GROUPS.map((g) => (
            <Link key={g} href={`#${g.toLowerCase()}`} className="shrink-0 rounded-full border border-line bg-surface px-4 py-1.5 text-sm text-muted transition-colors hover:border-primary hover:text-fg">{g}</Link>
          ))}
        </div>
      </nav>
      {MODULE_GROUPS.map((group) => (
        <section key={group} id={group.toLowerCase()} className="scroll-mt-32 mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <Reveal><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{group}</h2></Reveal>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {SITE_MODULES.filter((m) => m.group === group).map((m, i) => (
              <Reveal key={m.id} delay={(i % 2) * 100} className="pc-card-hover group rounded-2xl border border-line bg-surface p-6">
                <article id={m.id} className="scroll-mt-32">
                  <div className="flex items-start gap-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                      <m.icon className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold">{m.name}</h3>
                      <p className="text-sm text-muted">{m.tagline}</p>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">For HR and admins</p>
                      <ul className="mt-2 space-y-2 text-sm">{m.hr.map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />{t}</li>)}</ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">For employees</p>
                      <ul className="mt-2 space-y-2 text-sm">{m.employees.map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />{t}</li>)}</ul>
                    </div>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </section>
      ))}
    </PageFrame>
  );
}
