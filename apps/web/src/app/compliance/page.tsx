import type { Metadata } from 'next';
import { BadgeCheck, CalendarClock, FileCheck2, Landmark, MapPinned, Radar } from 'lucide-react';
import { CountUp, Reveal } from '@/components/marketing/motion';
import { PageFrame } from '@/components/marketing/page-frame';

export const metadata: Metadata = {
  title: 'Compliance',
  description: 'PF, ESI, PT, LWF, TDS, labour codes and state Shops & Establishment registers tracked with due dates and filed proof.',
  robots: { index: true, follow: true },
};

const STATES = ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Telangana', 'Andhra Pradesh', 'Delhi', 'Gujarat', 'West Bengal', 'Kerala', 'Uttar Pradesh', 'Haryana'];

export default function CompliancePage() {
  return (
    <PageFrame
      eyebrow="Compliance"
      title={<>Indian statutory compliance, <span className="pc-gradient-text">on one calendar.</span></>}
      intro="PeopleCore works out which forms apply to you, when they’re due and what’s missing, then keeps the filed proof. Your compliance advisor stays in charge; PeopleCore makes sure nothing slips."
    >
      <section className="mx-auto grid max-w-6xl grid-cols-2 gap-5 px-4 py-14 sm:px-6 lg:grid-cols-4">
        {[{ n: 160, l: 'forms, returns and registers catalogued' }, { n: 11, l: 'states with detailed packs' }, { n: 36, l: 'states and UTs with PT and LWF rules' }, { n: 5, l: 'years of filed proof kept' }].map((s, i) => (
          <Reveal key={s.l} delay={i * 90} className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-4xl font-semibold text-primary"><CountUp to={s.n} /></p>
            <p className="mt-2 text-sm text-muted">{s.l}</p>
          </Reveal>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: Radar, t: 'Knows what applies to you', b: 'From your headcount, establishments by state, PF, ESI and PT settings, contract labour and factory status, with the reason for every form.' },
            { icon: CalendarClock, t: 'Every due date, ahead of time', b: 'A month list and calendar of what’s due in the next 30 days and what’s overdue, simulated for future headcount too.' },
            { icon: FileCheck2, t: 'Filed, with proof', b: 'Render a return through Reports for the wage period, mark it filed with the acknowledgement and attach the proof.' },
            { icon: Landmark, t: 'Central acts covered', b: 'Codes on Wages, OSH and IR forms, EPF, ESI, income tax (Challan 281, 24Q, Form 16, 12BB), gratuity, bonus, maternity and CLRA.' },
            { icon: MapPinned, t: 'State rules built in', b: 'Shops & Establishment registers, holiday notices, professional tax and labour welfare fund for each state and UT.' },
            { icon: BadgeCheck, t: 'Payroll locked first', b: 'Statutory documents render only from a locked payroll run, so the numbers you file match the salaries you paid.' },
          ].map((c, i) => (
            <Reveal key={c.t} delay={(i % 3) * 100} className="pc-card-hover rounded-2xl border border-line bg-surface p-6">
              <c.icon className="size-6 text-primary" aria-hidden="true" />
              <h2 className="mt-4 font-semibold">{c.t}</h2>
              <p className="mt-2 text-sm text-muted">{c.b}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface/50 py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal><h2 className="text-2xl font-semibold tracking-tight">Detailed state packs</h2>
            <p className="mt-2 text-muted">Registers, notices, PT slabs and LWF for these states, with the rest of India covered for PT and LWF.</p></Reveal>
          <div className="mt-6 flex flex-wrap gap-2">
            {STATES.map((s, i) => (
              <Reveal key={s} delay={i * 40} as="span" className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm">{s}</Reveal>
            ))}
          </div>
          <p className="mt-8 text-xs text-muted">Statutory rules change. PeopleCore helps you track and prepare filings; it is not legal advice, and your payroll and compliance settings should be reviewed by a qualified professional.</p>
        </div>
      </section>
    </PageFrame>
  );
}
