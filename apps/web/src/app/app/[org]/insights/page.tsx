import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { aiAvailable } from '@/server/ai';
import { insights } from '@/server/analytics';
import { getOrgContext } from '@/server/context';
import { rateAnswerAction } from '../assistant/actions';
import { askCopilotAction } from './actions';
import { CopilotForm } from './copilot-form';

export const metadata: Metadata = { title: 'Insights' };

const COVERS = { organization: 'the whole organization', reporting_line: 'your reporting line', self: 'your own records' } as const;
const month = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const fmt = (v: number) => v.toLocaleString('en-IN');

export default async function InsightsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('employee.read', 'org') && !ctx.can('employee.read', 'team')) notFound();
  const today = todayIn(ctx.org.timezone);
  const [data, ai] = await Promise.all([insights(ctx.org.id, today), aiAvailable(ctx)]);
  const max = Math.max(1, ...data.departments.map((d) => d.headcount));
  const total = data.departments.reduce((s, d) => s + d.headcount, 0);

  return (
    <>
      <PageHeader title="Insights" description={`Workforce figures for ${COVERS[data.scope.scope]}, as of ${today}.`} />
      {ai && (
        <Card className="mb-6">
          <CardHeader title="Ask about your data" description="Answers use the same figures you can see here, and say which queries they rest on." />
          <CopilotForm action={askCopilotAction.bind(null, slug)} rate={rateAnswerAction.bind(null, slug)} />
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Headcount by department" description={`${fmt(total)} employed today`} />
          <ul className="space-y-2 px-5 py-4 text-sm" aria-label="Headcount by department">
            {data.departments.length === 0 && <li className="text-muted">No one to count.</li>}
            {data.departments.map((d) => (
              <li key={d.label} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3">
                <span className="truncate">{d.label}</span>
                <span className="h-2 rounded-full bg-subtle" aria-hidden="true"><span className="block h-2 rounded-full bg-primary" style={{ width: `${(d.headcount / max) * 100}%` }} /></span>
                <span className="text-right tabular-nums">{fmt(d.headcount)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Leave taken this year" description="Approved requests overlapping the year, by type" />
          <Table caption="Leave taken this year">
            <thead><tr><Th>Type</Th><Th>Requests</Th><Th>Days</Th><Th>People</Th></tr></thead>
            <tbody>
              {data.leave.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted">No approved leave yet this year.</td></tr>}
              {data.leave.map((l) => (
                <tr key={l.leaveType}><Td className="font-medium">{l.leaveType}</Td><Td className="tabular-nums">{fmt(l.requests)}</Td><Td className="tabular-nums">{fmt(l.days)}</Td><Td className="tabular-nums">{fmt(l.people)}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Joiners and leavers, last 12 months"
            description={`${fmt(data.joiners)} joined, ${fmt(data.leavers)} left${data.attritionPct != null ? ` · attrition ${data.attritionPct}% (leavers ÷ average month-end headcount)` : ''}`} />
          <Table caption="Joiners and leavers by month">
            <thead><tr><Th>Month</Th><Th>Joined</Th><Th>Left</Th><Th>Employed at month end</Th></tr></thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month}><Td>{month(m.month)}</Td><Td className="tabular-nums">{fmt(m.joiners)}</Td><Td className="tabular-nums">{fmt(m.leavers)}</Td><Td className="tabular-nums">{fmt(m.headcountEnd)}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
