import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { Alert, Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { KIND_LABEL, LOAN_STATUS } from '@/lib/loans';
import { getOrgContext } from '@/server/context';
import { employeeNames, getMyEmployee } from '@/server/employees';
import { listLoans, loanInstallments, loanProgress } from '@/server/loans';
import { createClient } from '@/server/supabase';
import { ApprovalsPanel } from '../../inbox/inbox-forms';
import { cancelLoanAction, decideLoanAction, disburseLoanAction, forecloseLoanAction } from '../actions';
import { CancelLoanButton, DisburseForm, ForecloseForm } from '../loans-client';
import { month, ScheduleTable } from '../schedule';

export const metadata: Metadata = { title: 'Loan' };
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/** One loan: terms, approval, disbursal (payroll), the repayment schedule and foreclosure. RLS decides who sees it. */
export default async function LoanPage({ params }: { params: Promise<{ org: string; loanId: string }> }) {
  const { org: slug, loanId } = await params;
  const ctx = await getOrgContext(slug);
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) notFound();
  const loan = (await listLoans(ctx.org.id)).find((l) => l.id === loanId);
  if (!loan) notFound();
  const supabase = await createClient();
  const [installments, names, pending, me] = await Promise.all([
    loanInstallments(ctx.org.id, [loan.id]), employeeNames(ctx.org.id, [loan.employee_id]),
    supabase.rpc('my_pending_approvals', { p_org: ctx.org.id }).then((r) => r.data ?? []),
    getMyEmployee(ctx.org.id, ctx.user.id),
  ]);
  const mine = me?.id === loan.employee_id;
  const myTurn = pending.find((a) => a.subject_id === loan.id);
  const p = loanProgress(installments).get(loan.id);
  const canPay = ctx.can('payroll.approve', 'org');
  const today = todayIn(ctx.org.timezone);
  const thisMonth = today.slice(0, 7);
  const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 7);
  const status = LOAN_STATUS[loan.status];
  const base = `/app/${slug}/loans`;

  return (
    <>
      <PageHeader eyebrow={<Link href={base} className="hover:text-fg">← Loans</Link>} title={`${KIND_LABEL[loan.kind]} · ${inr.format(loan.amount)}`}
        description={names.get(loan.employee_id) ?? undefined} actions={<Badge tone={status?.tone}>{status?.label ?? loan.status}</Badge>} />
      {loan.status === 'active' && (
        <div className="mb-6"><Alert tone="info" title={`Disbursed ${loan.disbursed_on ? formatDate(loan.disbursed_on) : ''}`}>
          {loan.disbursal_mode === 'bank' ? `By bank transfer (reference ${loan.disbursal_reference}).` : loan.disbursal_mode === 'cash' ? 'In cash.' : 'With the next payroll run.'}
          {' '}EMIs are deducted through payroll from {loan.first_emi_month ? month(loan.first_emi_month) : '—'}.</Alert></div>
      )}
      {loan.status === 'closed' && <div className="mb-6"><Alert tone="success" title="Closed">{loan.closure_note ?? 'Repaid.'}</Alert></div>}
      {myTurn && (
        <section aria-label="Your decision" className="mb-6 overflow-hidden rounded-xl border border-primary/40 bg-surface">
          <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Your decision · {myTurn.step_label}</h2>
          <ApprovalsPanel action={decideLoanAction.bind(null, slug)} items={[{ id: myTurn.id, summary: myTurn.summary, href: null, stepLabel: myTurn.step_label,
            meta: `From ${myTurn.requested_by_name}`, onBehalfOf: myTurn.via === 'delegation' ? (myTurn.on_behalf_of_name ?? 'a colleague') : null, escalated: myTurn.escalated }]} />
        </section>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Terms" />
            <div className="px-5 py-4">
              <DetailList items={[
                { label: 'Amount', value: inr.format(loan.amount) },
                { label: 'EMI', value: `${inr.format(loan.emi)} × ${loan.tenure_months} month${loan.tenure_months === 1 ? '' : 's'}` },
                { label: 'Interest', value: `${loan.interest_rate}% a year, reducing balance` },
                { label: 'Purpose', value: loan.purpose },
                { label: 'Applied', value: formatDate(loan.created_at.slice(0, 10)) },
                ...(p ? [{ label: 'Repaid', value: `${p.paid} of ${p.total} EMIs · ${inr.format(p.outstanding)} principal outstanding` }] : []),
              ]} />
            </div>
          </Card>
          {installments.length > 0 && (
            <Card>
              <CardHeader title="Repayment schedule" actions={<a className="text-sm text-primary hover:underline" href={`${base}/${loan.id}/statement`} download>⬇ Statement</a>} />
              <ScheduleTable rows={installments} />
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {loan.status === 'approved' && canPay && (
            <Card>
              <CardHeader title="Disburse" description="EMIs start in the month you choose and are deducted through payroll." />
              <DisburseForm action={disburseLoanAction.bind(null, slug)} loanId={loan.id} defaultMonth={next} minMonth={thisMonth} />
            </Card>
          )}
          {loan.status === 'approved' && !canPay && <Alert tone="info" title="Approved">Payroll will disburse it and set the first EMI month.</Alert>}
          {loan.status === 'active' && canPay && (
            <Card>
              <CardHeader title="Foreclose" description="Settle the remaining principal outside payroll; unpaid EMIs are cancelled." />
              <ForecloseForm action={forecloseLoanAction.bind(null, slug)} loanId={loan.id} />
            </Card>
          )}
          {loan.status === 'pending' && !myTurn && (
            <Card>
              <CardHeader title="In approval" description="The reporting manager approves first, then payroll." />
              {mine && <div className="px-5 py-4"><CancelLoanButton action={cancelLoanAction.bind(null, slug)} loanId={loan.id} /></div>}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
