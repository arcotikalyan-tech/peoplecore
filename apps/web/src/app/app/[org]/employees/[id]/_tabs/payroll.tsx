import Link from 'next/link';
import { SubTabs } from '@/components/ui/hub';
import { Badge, Card, CardHeader } from '@/components/ui/surface';
import { formatDate, humanize } from '@/lib/format';
import { listClaims } from '@/server/expenses';
import { getCompensation, getPayslips } from '@/server/payroll';
import type { BankSummary } from '@/server/sensitive';
import { setCompensationAction, setStatutoryAction } from '../../../payroll/actions';
import { CompensationForm, StatutoryForm } from '../../../payroll/payroll-forms';
import { revealBankAction, saveBankAccountAction } from '../actions';
import { BankPanel } from '../sensitive-panels';
import { Empty, inr, Panel, type ProfileProps } from './shared';

const monthName = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m.slice(0, 7)}-01T00:00:00Z`));

/** Payroll: payslips, salary structure (payroll staff change it here), bank account and reimbursements. */
export async function PayrollTab(p: ProfileProps & { bank: BankSummary | null }) {
  const { ctx, id, sp, href, base, isSelf, slug, allowed, today, bank } = p;
  const view = ['payslips', 'structure', 'bank', 'reimbursements'].includes(sp.view ?? '') ? sp.view! : 'payslips';
  const tabs = [{ key: 'payslips', label: 'Payslips' }, { key: 'structure', label: 'Salary Structure' }, { key: 'bank', label: 'Bank Account' }, { key: 'reimbursements', label: 'Reimbursements' }];
  const nav = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <SubTabs base={href('payroll').split('?')[0]!} extra={{ tab: 'payroll' }} tabs={tabs} current={view} label="Payroll sections" />
      {isSelf && <Link className="text-sm text-primary hover:underline" href={`${base}/payslips?tab=tax`}>Tax center →</Link>}
    </div>
  );
  const canComp = allowed('compensation.read') || ctx.can('compensation.update', 'org');

  if (view === 'payslips') {
    const slips = await getPayslips(ctx.org.id, id).catch(() => []);
    return (
      <>
        {nav}
        <Panel title="Payslips">
          {slips.length === 0 ? <Empty icon="🧾" title="No payslips yet" /> : (
            <ul className="divide-y divide-line" aria-label="Payslips">
              {slips.map((s) => (
                <li key={s.run_id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span><span className="font-medium">{monthName(s.period_month)}</span><span className="block text-xs text-muted">{Number(s.payable_days)} payable days{Number(s.lop_days) ? ` · ${Number(s.lop_days)} LOP` : ''}</span></span>
                  <span className="flex items-center gap-4">
                    <span className="text-right tabular-nums"><span className="block font-semibold">{inr.format(Number(s.net))}</span><span className="text-xs text-muted">net of {inr.format(Number(s.gross))}</span></span>
                    {isSelf && <Link className="text-primary hover:underline" href={`${base}/payslips/${s.run_id}`}>View</Link>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </>
    );
  }

  if (view === 'structure') {
    const compensation = canComp ? await getCompensation(ctx.org.id, id) : null;
    return (
      <>
        {nav}
        {!compensation ? <Panel title="Salary Structure"><Empty icon="🔒" title={isSelf ? 'Your salary structure is in My Pay.' : 'You can’t see this person’s salary.'}>
          {isSelf && <Link className="text-sm text-primary hover:underline" href={`${base}/payslips?tab=structure`}>Open My Pay →</Link>}</Empty></Panel> : (
          <Card>
            <CardHeader title="Compensation" description={compensation.current
              ? `${inr.format(Number(compensation.current.annual_ctc))} a year since ${formatDate(compensation.current.effective_from)}`
              : 'No compensation on record.'} />
            {compensation.lines.length > 0 && (
              <ul className="divide-y divide-line text-sm" aria-label="Salary components">
                {compensation.lines.map((l) => (
                  <li key={l.component_id} className="flex justify-between px-5 py-2">
                    <span>{compensation.components.find((c) => c.id === l.component_id)?.name ?? 'Component'}</span>
                    <span className="tabular-nums">{inr.format(Number(l.monthly_amount))} / month</span>
                  </li>
                ))}
              </ul>
            )}
            {ctx.can('compensation.update', 'org') && (
              <CompensationForm action={setCompensationAction.bind(null, slug)} employeeId={id} today={today}
                components={compensation.components.filter((c) => c.kind === 'earning').map((c) => ({ id: c.id, name: c.name }))}
                current={Object.fromEntries(compensation.lines.map((l) => [l.component_id, Number(l.monthly_amount)]))} />
            )}
            {ctx.can('payroll.prepare', 'org') && (
              <StatutoryForm action={setStatutoryAction.bind(null, slug)} employeeId={id}
                profile={{ pf: compensation.profile?.pf_applicable ?? true, esi: compensation.profile?.esi_applicable ?? null, ptState: compensation.profile?.pt_state ?? null }} />
            )}
          </Card>
        )}
      </>
    );
  }

  if (view === 'bank') {
    return (
      <>
        {nav}
        {bank ? (
          <Card>
            <CardHeader title="Bank account" description="Used for salary payments. Restricted access." />
            <BankPanel key={`bank:${bank.since ?? 'none'}`} summary={bank} reveal={revealBankAction.bind(null, slug, id)} save={saveBankAccountAction.bind(null, slug, id)} />
          </Card>
        ) : <Panel title="Bank details"><Empty icon="🏦" title={isSelf ? 'Bank details are managed by payroll.' : 'You can’t see this person’s bank details.'}>
          {isSelf && <Link className="text-sm text-primary hover:underline" href={`${base}/payslips?tab=bank`}>See them in My Pay →</Link>}</Empty></Panel>}
      </>
    );
  }

  const claims = (await listClaims(ctx.org.id, { employeeId: id }).catch(() => [])).filter((c) => ['approved', 'paid'].includes(c.status));
  return (
    <>
      {nav}
      <Panel title="Reimbursements">
        {claims.length === 0 ? <Empty icon="💳" title="No approved reimbursements" /> : (
          <ul className="divide-y divide-line" aria-label="Reimbursements">
            {claims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-medium">{c.title}</span>
                <span className="flex items-center gap-3"><span className="tabular-nums">{inr.format(Number(c.total))}</span><Badge tone={c.status === 'paid' ? 'success' : 'primary'}>{humanize(c.status)}</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
