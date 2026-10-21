import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { bankSettings, payouts, payrollPeople, payrollSettings, readiness } from '@/server/payroll-suite';
import { payoutAction, payoutImportAction } from '../suite-actions';
import { PayoutBoard, PayoutImportForm } from './forms';
import { Card, Figure, lakhs, qs, type TabProps } from './shared';

export async function PayoutTab({ ctx, slug, base, month, today, run, approves }: TabProps) {
  const m = month.slice(0, 7);
  const [bank, settings] = await Promise.all([bankSettings(ctx.org.id), payrollSettings(ctx.org.id)]);
  const integrated = Boolean(bank?.account_number && bank.ifsc);
  const setup = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-2xl">🏦</span>
        <div>
          <p className="font-semibold">Bank Integration Required</p>
          <p className="text-sm text-muted">Please set up the company’s debit account and bank file format. <Link href={qs(base, { tab: 'settings', month: m, view: 'bank' })} className="font-medium text-primary hover:underline">Click Here</Link></p>
        </div>
      </div>
      <span className="rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">Setup Required</span>
    </div>
  );
  if (!run || run.status !== 'locked') {
    return (
      <div className="space-y-4">
        {!integrated && setup}
        <Card><p className="text-sm text-muted">Payouts open once {month.slice(0, 7)} payroll is approved and locked. <Link className="font-medium text-primary hover:underline" href={qs(base, { tab: 'run', month: m })}>Go to Run Payroll →</Link></p></Card>
      </div>
    );
  }
  const [rows, people, ready] = await Promise.all([payouts(run.id), payrollPeople(ctx.org.id, month), readiness(ctx.org.id)]);
  const list = people.filter((p) => rows.has(p.id)).map((p) => {
    const po = rows.get(p.id)!;
    const r = ready.get(p.id);
    return { employeeId: p.id, code: p.code, name: p.name, bank: r?.bank ? `${r.bank} ••${r.last4}` : 'No bank details', amount: Number(po.amount), status: po.status, reference: po.reference, paidOn: po.paid_on, note: po.note, mode: po.mode };
  });
  const sum = (s: string) => list.filter((x) => x.status === s).reduce((a, x) => a + x.amount, 0);
  const count = (s: string) => list.filter((x) => x.status === s).length;
  const payDay = settings?.pay_day ? `${month.slice(0, 8)}${String(settings.pay_day).padStart(2, '0')}` : null;

  return (
    <div className="space-y-5">
      {!integrated && setup}
      <div className="grid gap-3 sm:grid-cols-4">
        <Figure label="To pay" value={lakhs(sum('pending') + sum('failed'))} tone="warning" note={`${count('pending') + count('failed')} employees${payDay ? ` · due ${formatDate(payDay)}` : ''}`} />
        <Figure label="Paid" value={lakhs(sum('paid'))} tone="success" note={`${count('paid')} employees`} />
        <Figure label="On hold" value={lakhs(sum('on_hold'))} note={`${count('on_hold')} employees`} />
        <Figure label="Failed" value={lakhs(sum('failed'))} tone={count('failed') ? 'danger' : 'fg'} note={`${count('failed')} employees`} />
      </div>
      <Card title="Payouts" action={approves && ctx.can('employee.bank.read', 'org') && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Bank advice">
          <span className="text-xs text-muted">Bank advice:</span>
          {[['icici', 'ICICI'], ['axis', 'AXIS'], ['hdfc', 'HDFC'], ['bob', 'BOB'], ['sbi', 'SBI'], ['generic', 'NEFT']].map(([f, l]) => (
            <a key={f} href={`/app/${slug}/payroll/${run.id}/bank-advice?format=${f}`} className={buttonClass(bank?.file_format === f ? 'primary' : 'secondary', 'sm')} download>⬇ {l}</a>
          ))}
        </div>
      )}>
        <p className="mb-3 text-xs text-muted">The bank advice includes pending and failed bank transfers only; cheque and cash payouts stay out. Upload it to your bank, then mark the payouts paid with the UTR reference, or import the bank’s report. Held salaries stay out until released.</p>
        <PayoutBoard action={payoutAction.bind(null, slug)} runId={run.id} rows={list} today={today} canEdit={approves} />
        {approves && <div className="mt-4 border-t border-line pt-4"><PayoutImportForm action={payoutImportAction.bind(null, slug)} runId={run.id} /></div>}
      </Card>
    </div>
  );
}
