import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClass } from '@/components/ui/button';
import { Reveal } from './motion';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

/** A website page: header, an animated title band, the content, a closing call to action and the footer. */
export function PageFrame({ eyebrow, title, intro, children }: { eyebrow: string; title: ReactNode; intro: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-canvas text-fg">
      <SiteHeader />
      <section className="relative isolate border-b border-line">
        <div aria-hidden="true" className="pc-grid-bg absolute inset-0 -z-10" />
        <div aria-hidden="true" className="pc-blob pc-blob-a -z-10 left-[-12%] top-[-30%] size-[28rem] opacity-40" />
        <div aria-hidden="true" className="pc-blob pc-blob-b -z-10 right-[-10%] top-[-10%] size-[26rem] opacity-40" />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20">
          <p className="pc-rise text-sm font-medium text-primary">{eyebrow}</p>
          <h1 className="pc-rise mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl" style={{ animationDelay: '80ms' }}>{title}</h1>
          <p className="pc-rise mt-4 max-w-2xl text-lg text-muted" style={{ animationDelay: '160ms' }}>{intro}</p>
        </div>
      </section>
      {children}
      <section className="px-4 py-20 sm:px-6">
        <Reveal className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl border border-line bg-surface px-6 py-12 text-center sm:px-12">
          <div aria-hidden="true" className="pc-blob pc-blob-a -z-10 left-[-10%] top-[-40%] size-[20rem] opacity-35" />
          <div aria-hidden="true" className="pc-blob pc-blob-b -z-10 bottom-[-50%] right-[-10%] size-[20rem] opacity-35" />
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ready when you are.</h2>
          <p className="mx-auto mt-2 max-w-xl text-muted">Sign up and we’ll set up your workspace with you.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className={buttonClass('primary', 'md', 'h-11 px-6')}>Sign up</Link>
            <Link href="/login" className={buttonClass('secondary', 'md', 'h-11 px-6')}>Sign in</Link>
          </div>
        </Reveal>
      </section>
      <SiteFooter />
    </div>
  );
}
