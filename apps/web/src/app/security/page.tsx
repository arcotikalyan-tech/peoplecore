import type { Metadata } from 'next';
import { Eye, Fingerprint, KeyRound, Lock, ScrollText, ServerCog, ShieldCheck, UserX } from 'lucide-react';
import { Reveal } from '@/components/marketing/motion';
import { PageFrame } from '@/components/marketing/page-frame';

export const metadata: Metadata = {
  title: 'Security',
  description: 'How PeopleCore protects salaries and personal data: database-level permissions, two-step sign-in, audit trail and private storage.',
  robots: { index: true, follow: true },
};

const ITEMS = [
  { icon: Lock, t: 'Permissions enforced in the database', b: 'Every row of every table checks who is asking: their company, role and scope (themselves, their team or everyone). Hiding a button is never the only protection.' },
  { icon: Fingerprint, t: 'Two-step sign-in for powerful roles', b: 'Owners, HR, payroll and auditors confirm with an authenticator app. Until they do, the database withholds those roles’ powers entirely.' },
  { icon: ScrollText, t: 'A complete audit trail', b: 'Changes to people, pay, roles and settings are recorded with who made them and when, and the log can’t be edited.' },
  { icon: KeyRound, t: 'Private documents', b: 'ID proofs, payslips, selfies and filings live in private storage and are opened only through short-lived links for people allowed to see them.' },
  { icon: Eye, t: 'Your data stays yours', b: 'Platform administrators can’t see inside your company. Support access exists only when an owner opens a time-limited window, and every look is logged.' },
  { icon: UserX, t: 'Privacy requests built in', b: 'Employees can ask for optional personal data to be erased. HR decides, records the reason, and records the law requires keeping stay intact.' },
  { icon: ShieldCheck, t: 'Hardened web app', b: 'A strict content security policy, HTTPS everywhere with HSTS, and protection against framing and content sniffing on every page.' },
  { icon: ServerCog, t: 'Separate tenants', b: 'Every company’s data is tagged and isolated, and links can’t be used to probe another company’s workspace.' },
];

export default function SecurityPage() {
  return (
    <PageFrame
      eyebrow="Security"
      title={<>Salaries are private. <span className="pc-gradient-text">We built it that way.</span></>}
      intro="HR data is some of the most sensitive data a company holds. PeopleCore protects it at every layer, not just on the screen."
    >
      <section className="mx-auto grid max-w-6xl gap-5 px-4 py-14 sm:px-6 md:grid-cols-2">
        {ITEMS.map((c, i) => (
          <Reveal key={c.t} delay={(i % 2) * 100} className="pc-card-hover flex gap-4 rounded-2xl border border-line bg-surface p-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><c.icon className="size-5" aria-hidden="true" /></span>
            <div>
              <h2 className="font-semibold">{c.t}</h2>
              <p className="mt-2 text-sm text-muted">{c.b}</p>
            </div>
          </Reveal>
        ))}
      </section>
    </PageFrame>
  );
}
