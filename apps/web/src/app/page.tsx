import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BadgeCheck, BarChart3, BookOpen, Briefcase, CalendarDays, Clock, FileSpreadsheet, Fingerprint, GraduationCap, HandCoins, Heart,
  IdCard, Laptop, LifeBuoy, Lock, Mail, MapPin, Megaphone, Receipt, Scale, ScrollText, ShieldCheck, Smartphone, Timer, TreePalm,
  Trophy, UserPlus, Users, Wallet, Workflow, type LucideIcon,
} from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { CountUp, Reveal } from '@/components/marketing/motion';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';

export const metadata: Metadata = {
  title: { absolute: 'PeopleCore · HR, payroll and compliance for Indian teams' },
  description: 'Attendance, leave, payroll, compliance, hiring, performance and more: every part of HR in one place, built for India.',
  robots: { index: true, follow: true },
};

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Clock, title: 'Attendance that checks itself', body: 'Check in from the web or the app with office network, geofence and selfie rules, shifts that rotate, and reminders before anyone forgets.' },
  { icon: TreePalm, title: 'Leave without the back-and-forth', body: 'Accrual, carry-forward, encashment and sandwich rules per leave type. Approvals land in one inbox, balances update themselves.' },
  { icon: Wallet, title: 'Payroll you can explain', body: 'Structures, revisions with arrears, loans, reimbursements and tax declarations flow into one run you lock, pay and report on.' },
  { icon: Scale, title: 'Compliance on a calendar', body: 'PF, ESI, PT, LWF, TDS and labour-code registers tracked per state, with due dates, filings and proof in one place.' },
  { icon: Briefcase, title: 'Hiring to day one', body: 'Jobs, pipelines, interviews, scorecards and offers, then onboarding checklists that hand new joiners everything they need.' },
  { icon: Heart, title: 'A culture people feel', body: 'Recognition with badges and points, pulse check-ins, learning journeys and performance reviews that are fair and on time.' },
];

const MODULES: { group: string; items: { icon: LucideIcon; name: string }[] }[] = [
  { group: 'People', items: [{ icon: Users, name: 'Directory & profiles' }, { icon: Mail, name: 'Letters' }, { icon: UserPlus, name: 'Onboarding' }, { icon: Briefcase, name: 'Hiring OS' }, { icon: IdCard, name: 'ID cards' }] },
  { group: 'Time', items: [{ icon: Clock, name: 'Attendance' }, { icon: TreePalm, name: 'Leave' }, { icon: CalendarDays, name: 'Holidays' }, { icon: Timer, name: 'Timesheets' }] },
  { group: 'Pay', items: [{ icon: Wallet, name: 'Payroll' }, { icon: Receipt, name: 'Expenses & mileage' }, { icon: HandCoins, name: 'Loans & advances' }, { icon: FileSpreadsheet, name: '36 reports' }] },
  { group: 'Grow', items: [{ icon: Trophy, name: 'Performance' }, { icon: GraduationCap, name: 'Learning' }, { icon: Heart, name: 'PeopleXP' }, { icon: Megaphone, name: 'Engagement' }] },
  { group: 'Workplace', items: [{ icon: LifeBuoy, name: 'Helpdesk' }, { icon: BookOpen, name: 'Knowledge base' }, { icon: Laptop, name: 'Assets' }, { icon: Workflow, name: 'Approval workflows' }] },
];

const MARQUEE = ['Attendance', 'Leave', 'Payroll', 'PF & ESI', 'Professional tax', 'TDS & Form 16', 'Expenses', 'Loans', 'Hiring', 'Onboarding', 'Performance', 'Learning', 'Recognition', 'Helpdesk', 'Assets', 'Letters', 'Timesheets', 'Insurance', 'Reports'];

const FILINGS = [
  { name: 'PF ECR', when: '15th', state: 'Central' },
  { name: 'ESI contribution', when: '15th', state: 'Central' },
  { name: 'Professional tax', when: '20th', state: 'Karnataka' },
  { name: 'TDS · Challan 281', when: '7th', state: 'Central' },
  { name: 'LWF (half-yearly)', when: '15 Jul', state: 'Maharashtra' },
];

export default function Home() {
  return (
    <div className="min-h-dvh overflow-x-clip bg-canvas text-fg">
      <SiteHeader />

      {/* Hero */}
      <section className="relative isolate">
        <div aria-hidden="true" className="pc-grid-bg absolute inset-0 -z-10" />
        <div aria-hidden="true" className="pc-blob pc-blob-a -z-10 left-[-10%] top-[-12%] size-[34rem]" />
        <div aria-hidden="true" className="pc-blob pc-blob-b -z-10 right-[-12%] top-[10%] size-[30rem]" />
        <div aria-hidden="true" className="pc-blob pc-blob-c -z-10 bottom-[-20%] left-[30%] size-[26rem]" />

        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <p className="pc-rise inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-muted backdrop-blur">
              <span className="pc-live-dot size-2 rounded-full bg-primary" /> Built for Indian payroll and labour law
            </p>
            <h1 className="pc-rise mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl" style={{ animationDelay: '80ms' }}>
              Every part of HR, <span className="pc-gradient-text">in one calm place.</span>
            </h1>
            <p className="pc-rise mt-5 max-w-xl text-lg text-muted" style={{ animationDelay: '160ms' }}>
              Attendance, leave, payroll, compliance, hiring and growth for your whole team, from the first offer letter to the last
              payslip. Your people self-serve, and HR finally gets its week back.
            </p>
            <div className="pc-rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: '240ms' }}>
              <Link href="/signup" className={buttonClass('primary', 'md', 'h-12 px-6 text-base')}>Sign up for PeopleCore</Link>
              <Link href="/login" className={buttonClass('secondary', 'md', 'h-12 px-6 text-base')}>Sign in</Link>
            </div>
            <p className="pc-rise mt-4 text-sm text-muted" style={{ animationDelay: '320ms' }}>Web and Android app · Two-step sign-in · Your data, your rules</p>
          </div>

          <HeroPreview />
        </div>
      </section>

      {/* Module marquee */}
      <section aria-label="What PeopleCore covers" className="border-y border-line bg-surface/50 py-5">
        <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
          <div className="pc-marquee flex w-max gap-3">
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span key={i} aria-hidden={i >= MARQUEE.length} className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm text-muted">{m}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-16 sm:px-6 lg:grid-cols-4">
        {[
          { n: 25, suffix: '+', label: 'modules, one login' },
          { n: 160, suffix: '', label: 'statutory forms and registers tracked' },
          { n: 36, suffix: '', label: 'ready-made reports, Excel or CSV' },
          { n: 36, suffix: '', label: 'states and UTs with PT and LWF rules' },
        ].map((s, i) => (
          <Reveal key={s.label} delay={i * 90} className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-4xl font-semibold tracking-tight text-primary"><CountUp to={s.n} suffix={s.suffix} /></p>
            <p className="mt-2 text-sm text-muted">{s.label}</p>
          </Reveal>
        ))}
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <Reveal className="max-w-2xl">
          <p className="text-sm font-medium text-primary">Features</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Less chasing, more doing.</h2>
          <p className="mt-3 text-muted">Rules live in PeopleCore, not in someone’s head. Employees get answers themselves; managers approve in a tap.</p>
          <Link href="/features" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">See every feature →</Link>
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 110} className="pc-card-hover group rounded-2xl border border-line bg-surface p-6">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                <f.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="scroll-mt-20 relative isolate py-16">
        <div aria-hidden="true" className="pc-blob pc-blob-b -z-10 left-[-15%] top-1/3 size-[28rem] opacity-25" />
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="max-w-2xl">
            <p className="text-sm font-medium text-primary">Modules</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">The whole employee lifecycle.</h2>
            <p className="mt-3 text-muted">Switch on what you need today and the rest when you’re ready. Everything shares one employee record.</p>
            <Link href="/features" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">Explore the modules →</Link>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-5">
            {MODULES.map((g, i) => (
              <Reveal key={g.group} delay={i * 90} className="rounded-2xl border border-line bg-surface/80 p-5 backdrop-blur">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{g.group}</h3>
                <ul className="mt-4 space-y-3">
                  {g.items.map((m) => (
                    <li key={m.name} className="flex items-center gap-3 text-sm">
                      <span className="grid size-8 place-items-center rounded-lg bg-subtle text-fg"><m.icon className="size-4" aria-hidden="true" /></span>
                      {m.name}
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance */}
      <section id="compliance" className="scroll-mt-20 mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <Reveal>
          <p className="text-sm font-medium text-primary">Compliance</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Never miss a due date again.</h2>
          <p className="mt-3 text-muted">
            PeopleCore knows which forms apply to you from your headcount, states and payroll settings, puts every due date on a calendar,
            and keeps the filed proof for five years.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            {['Codes on Wages, OSH and IR registers', 'PF, ESI, PT, LWF, TDS, Form 16 and 24Q', 'State Shops & Establishment packs', 'Payroll locked before any filing renders'].map((t) => (
              <li key={t} className="flex items-center gap-3"><BadgeCheck className="size-5 text-success" aria-hidden="true" />{t}</li>
            ))}
          </ul>
          <Link href="/compliance" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">How compliance works →</Link>
        </Reveal>
        <Reveal delay={120} className="rounded-2xl border border-line bg-surface p-5 shadow-[0_30px_80px_-40px] shadow-primary/40">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Due this month</p>
            <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs text-warning">5 upcoming</span>
          </div>
          <ul className="mt-4 divide-y divide-line">
            {FILINGS.map((f, i) => (
              <li key={f.name} className="pc-reveal flex items-center justify-between py-3 text-sm" data-shown="true" style={{ transitionDelay: `${i * 80}ms` }}>
                <span className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-xs font-semibold text-primary">{f.when}</span>
                  <span>
                    <span className="block font-medium">{f.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted"><MapPin className="size-3" aria-hidden="true" />{f.state}</span>
                  </span>
                </span>
                <span className="text-xs text-muted">Ready to file</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* Security */}
      <section id="security" className="scroll-mt-20 border-y border-line bg-surface/50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="max-w-2xl">
            <p className="text-sm font-medium text-primary">Security</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Salaries are private. We built it that way.</h2>
            <Link href="/security" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">Read about security →</Link>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Lock, title: 'Permissions in the database', body: 'Who sees what is enforced on every row, not just hidden in the screen.' },
              { icon: Fingerprint, title: 'Two-step sign-in', body: 'HR, payroll and owners confirm with an authenticator app before they see anything sensitive.' },
              { icon: ScrollText, title: 'A complete audit trail', body: 'Every change to people, pay and permissions is recorded with who and when.' },
              { icon: ShieldCheck, title: 'Privacy requests built in', body: 'Employees can ask for optional data to be erased; HR decides and the record shows it.' },
            ].map((s, i) => (
              <Reveal key={s.title} delay={i * 90} className="pc-card-hover rounded-2xl border border-line bg-surface p-6">
                <s.icon className="size-6 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Mobile */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <Reveal className="order-2 lg:order-1 flex justify-center">
          <div className="relative w-64 rounded-[2.5rem] border border-line-strong bg-surface p-3 shadow-[0_40px_90px_-40px] shadow-accent/50">
            <div className="rounded-[2rem] bg-canvas p-5">
              <p className="text-xs text-muted">Today</p>
              <p className="mt-1 text-lg font-semibold">Hello, Priya</p>
              <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
                <p className="text-sm font-medium">Attendance</p>
                <div className="pc-live-dot mt-3 grid h-11 place-items-center rounded-xl bg-primary text-sm font-semibold text-primary-fg">Check in</div>
                <p className="mt-3 flex items-center gap-1 text-xs text-muted"><MapPin className="size-3" aria-hidden="true" />Inside the office geofence</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
                <div className="rounded-xl bg-subtle p-3"><p className="text-lg font-semibold">8</p><p className="text-muted">Leave left</p></div>
                <div className="rounded-xl bg-subtle p-3"><p className="text-lg font-semibold">₹</p><p className="text-muted">Payslips</p></div>
              </div>
            </div>
          </div>
        </Reveal>
        <Reveal delay={100} className="order-1 lg:order-2">
          <p className="text-sm font-medium text-primary">On the go</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Check in from your phone.</h2>
          <p className="mt-3 text-muted">The PeopleCore app puts check-in, leave and payslips in everyone’s pocket, with the same rules your office sets on the web.</p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm"><Smartphone className="size-4" aria-hidden="true" />Android today · iPhone coming soon</p>
        </Reveal>
      </section>

      {/* Call to action */}
      <section className="px-4 pb-20 sm:px-6">
        <Reveal className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl border border-line bg-surface px-6 py-14 text-center sm:px-12">
          <div aria-hidden="true" className="pc-blob pc-blob-a -z-10 left-[-10%] top-[-40%] size-[22rem] opacity-40" />
          <div aria-hidden="true" className="pc-blob pc-blob-b -z-10 right-[-10%] bottom-[-50%] size-[22rem] opacity-40" />
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bring your team to PeopleCore.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Tell us about your company and we’ll set up your workspace with you, from importing people to your first payroll.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className={buttonClass('primary', 'md', 'h-12 px-6 text-base')}>Sign up</Link>
            <Link href="/login" className={buttonClass('secondary', 'md', 'h-12 px-6 text-base')}>I already have an account</Link>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}

/** The animated product preview in the hero: a dashboard card, a live chart and floating notifications. */
function HeroPreview() {
  const bars = [42, 64, 55, 78, 70, 88, 96];
  return (
    <div className="pc-rise relative mx-auto w-full max-w-lg" style={{ animationDelay: '200ms' }} aria-hidden="true">
      <div className="rounded-3xl border border-line bg-surface/90 p-5 shadow-[0_40px_100px_-40px] shadow-primary/50 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">Good morning, Anita</p>
            <p className="text-lg font-semibold">Today at Acme India</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs text-success"><span className="pc-live-dot size-1.5 rounded-full bg-success" />Live</span>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { label: 'Present', values: ['142', '148', '151'] },
            { label: 'On leave', values: ['9', '8', '6'] },
            { label: 'Approvals', values: ['12', '7', '3'] },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-subtle p-3">
              <p className="text-xs text-muted">{s.label}</p>
              <div className="pc-ticker mt-1 h-7 overflow-hidden text-xl font-semibold">
                {[...s.values, s.values[0]].map((v, i) => <p key={i} className="h-7 leading-7">{v}</p>)}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-2xl border border-line p-4">
          <div className="flex items-center justify-between text-xs text-muted"><span>Check-ins this week</span><BarChart3 className="size-4" /></div>
          <div className="mt-3 flex h-28 items-end gap-2">
            {bars.map((h, i) => (
              <div key={i} className="pc-bar flex-1 rounded-t-md bg-gradient-to-t from-primary/40 to-primary" style={{ height: `${h}%`, animationDelay: `${300 + i * 90}ms` }} />
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-primary-soft p-3 text-sm">
          <span className="flex items-center gap-2"><Wallet className="size-4 text-primary" />October payroll</span>
          <span className="font-semibold text-primary">Locked ✓</span>
        </div>
      </div>

      <div className="pc-floaty absolute -left-10 top-[52%] hidden w-52 rounded-2xl border border-line bg-surface p-3 text-sm shadow-xl sm:block">
        <p className="flex items-center gap-2 font-medium"><TreePalm className="size-4 text-primary" />Leave approved</p>
        <p className="mt-1 text-xs text-muted">Rahul · 2 days casual leave</p>
      </div>
      <div className="pc-floaty pc-floaty-alt absolute -right-6 -bottom-6 hidden w-56 rounded-2xl border border-line bg-surface p-3 text-sm shadow-xl sm:block">
        <p className="flex items-center gap-2 font-medium"><Trophy className="size-4 text-warning" />Badge received</p>
        <p className="mt-1 text-xs text-muted">“Customer hero” from Meera · +50 points</p>
      </div>
    </div>
  );
}
