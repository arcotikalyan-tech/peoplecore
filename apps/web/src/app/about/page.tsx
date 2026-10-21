import type { Metadata } from 'next';
import { Building2, Rocket, Upload, Users } from 'lucide-react';
import { Reveal } from '@/components/marketing/motion';
import { PageFrame } from '@/components/marketing/page-frame';

export const metadata: Metadata = {
  title: 'About',
  description: 'Who PeopleCore is for, how getting started works, and answers to common questions.',
  robots: { index: true, follow: true },
};

const STEPS = [
  { icon: Building2, t: 'Sign up', b: 'Tell us about your company. We create your workspace and your owner account.' },
  { icon: Upload, t: 'Bring your people', b: 'Import employees from a spreadsheet or add them one by one, then set up departments, locations and salary structures.' },
  { icon: Users, t: 'Set your rules', b: 'Attendance, leave, payroll and approval rules, with sensible defaults to start from.' },
  { icon: Rocket, t: 'Go live', b: 'Invite your team. They sign in on the web or the app, and your first payroll runs in PeopleCore.' },
];

const FAQ = [
  { q: 'Who is PeopleCore for?', a: 'Indian companies from a handful of people to a few thousand who want HR, payroll and compliance in one place instead of spreadsheets and several tools.' },
  { q: 'Can employees use it on their phone?', a: 'Yes. The Android app covers check-in, leave and payslips, and the website works on any phone browser. An iPhone app is coming.' },
  { q: 'Can we start with only some modules?', a: 'Yes. Owners switch modules on and off; switched-off modules disappear from everyone’s menu.' },
  { q: 'How do people get access?', a: 'HR invites them by email, or adds people who already have a PeopleCore sign-in. Each person sees only what their role allows.' },
  { q: 'Is our data shared with anyone?', a: 'No. Your company’s data is isolated from every other company’s, and PeopleCore’s own administrators can’t see inside your workspace.' },
];

export default function AboutPage() {
  return (
    <PageFrame
      eyebrow="About"
      title={<>HR software that respects <span className="pc-gradient-text">your people’s time.</span></>}
      intro="PeopleCore brings the whole employee lifecycle into one calm place, built around Indian payroll and labour law, so HR teams spend less time chasing and more time on people."
    >
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <Reveal><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Getting started</h2></Reveal>
        <ol className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.t} as="li" delay={i * 110} className="relative rounded-2xl border border-line bg-surface p-6">
              <span className="absolute right-5 top-5 text-4xl font-semibold text-line-strong">{i + 1}</span>
              <s.icon className="size-6 text-primary" aria-hidden="true" />
              <h3 className="mt-4 font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted">{s.b}</p>
            </Reveal>
          ))}
        </ol>
      </section>
      <section className="border-t border-line bg-surface/50 py-14">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Questions</h2></Reveal>
          <div className="mt-6 divide-y divide-line rounded-2xl border border-line bg-surface">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}<span aria-hidden="true" className="text-xl text-muted transition-transform duration-300 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-sm text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </PageFrame>
  );
}
