import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { listClaims } from '@/server/expenses';
import { namesFor } from '@/server/leave';
import { inr } from '../payroll/format';
import { createClaimAction } from './actions';
import { NewClaimForm } from './expense-forms';
import { CLAIM_TONE } from './tone';

export const metadata: Metadata = { title: 'Expenses' };

export default async function ExpensesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const finance = ctx.can('expense.manage', 'org');
  const [mine, all] = await Promise.all([
    me ? listClaims(ctx.org.id, { employeeId: me.id }) : Promise.resolve([]),
    finance ? listClaims(ctx.org.id) : Promise.resolve([]),
  ]);
  const others = all.filter((c) => c.employee_id !== me?.id && c.status !== 'draft');
  const names = await namesFor(ctx.org.id, others.map((c) => c.employee_id));
  const base = `/app/${slug}/expenses`;
  const table = (rows: typeof mine, withName: boolean, caption: string) => (
    <Table caption={caption}>
      <thead><tr>{withName && <Th>Employee</Th>}<Th>Claim</Th><Th>Total</Th><Th>Status</Th><Th>Created</Th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={withName ? 5 : 4} className="px-4 py-6 text-center text-sm text-muted">No claims yet.</td></tr>}
        {rows.map((c) => (
          <tr key={c.id}>
            {withName && <Td>{names.get(c.employee_id) ?? '—'}</Td>}
            <Td className="font-medium"><Link className="text-primary hover:underline" href={`${base}/${c.id}`}>{c.title}</Link></Td>
            <Td className="tabular-nums">{inr.format(Number(c.total))}</Td>
            <Td><Badge tone={CLAIM_TONE[c.status]}>{c.status}</Badge></Td>
            <Td className="text-muted">{formatDate(c.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader title="Expenses" description="Claims are approved by your manager, then finance, and paid with the next payroll." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {me && <Card><CardHeader title="Your claims" />{table(mine, false, 'Your claims')}</Card>}
          {finance && <Card><CardHeader title="All submitted claims" />{table(others, true, 'All submitted claims')}</Card>}
        </div>
        {me && <Card><CardHeader title="New claim" /><NewClaimForm action={createClaimAction.bind(null, slug)} /></Card>}
      </div>
    </>
  );
}
