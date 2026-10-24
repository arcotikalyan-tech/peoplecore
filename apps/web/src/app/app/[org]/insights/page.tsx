import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { AiSummaryButton } from '@/components/ai-summary-button';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { aiAvailable } from '@/server/ai';
import { insights, planFrom } from '@/server/analytics';
import { getOrgContext } from '@/server/context';
import { rateAnswerAction } from '../assistant/actions';
import { askCopilotAction, learningPlanAction, planInputs, summarisePlanAction } from './actions';
import { CopilotForm } from './copilot-form';

export const metadata: Metadata = { title: 'Insights' };

const COVERS = { organization: 'the whole organization', reporting_line: 'your reporting line', self: 'your own records' } as const;
const month = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const fmt = (v: number) => v.toLocaleString('en-IN');

export default async function InsightsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ growth?: string; months?: string }> }) {
  const { org: slug } = await params;
  const { growthPct, months } = await planInputs(await searchParams);
  const ctx = await getOrgContext(slug);
  if (!ctx.can('employee.read', 'org') && !ctx.can('employee.read', 'team')) notFound();
  const today = todayIn(ctx.org.timezone);
  const [data, ai] = await Promise.all([insights(ctx.org.id, today), aiAvailable(ctx)]);
  const max = Math.max(1, ...data.departments.map((d) => d.headcount));
  const total = data.departments.reduce((s, d) => s + d.headcount, 0);
  const plan = planFrom(data, growthPct, months);

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
        <Card className="lg:col-span-2">
          <CardHeader title="Workforce plan"
            description={`Hires needed to reach a growth target and replace leavers at the last 12 months’ attrition (${plan.attritionPct}%).`} />
          <form method="get" className="flex flex-wrap items-end gap-3 px-5 pt-4" aria-label="Plan settings">
            <label className="text-sm"><span className="mb-1 block text-muted">Growth (%)</span>
              <input type="number" name="growth" min={-50} max={200} defaultValue={growthPct} className="h-9 w-24 rounded-md border border-line-strong bg-surface px-2 text-sm" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted">Over</span>
              <select name="months" defaultValue={String(months)} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm">
                {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} months</option>)}
              </select></label>
            <button className="h-9 rounded-md border border-line px-3 text-sm hover:bg-subtle">Update plan</button>
          </form>
          <Table caption="Workforce plan">
            <thead><tr><Th>Department</Th><Th>Now</Th><Th>Target</Th><Th>Expected leavers</Th><Th>Hires</Th><Th>Per month</Th></tr></thead>
            <tbody>
              {plan.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">No headcount to plan from yet.</td></tr>}
              {plan.rows.map((r) => (
                <tr key={r.department}><Td className="font-medium">{r.department}</Td><Td className="tabular-nums">{fmt(r.now)}</Td><Td className="tabular-nums">{fmt(r.target)}</Td>
                  <Td className="tabular-nums">{fmt(r.expectedLeavers)}</Td><Td className="tabular-nums font-semibold">{fmt(r.hires)}</Td><Td className="tabular-nums">{r.hiresPerMonth}</Td></tr>
              ))}
              {plan.rows.length > 1 && (
                <tr className="border-t-2 border-line"><Td className="font-semibold">Total</Td><Td className="tabular-nums">{fmt(plan.total.now)}</Td><Td className="tabular-nums">{fmt(plan.total.target)}</Td>
                  <Td className="tabular-nums">{fmt(plan.total.expectedLeavers)}</Td><Td className="tabular-nums font-semibold">{fmt(plan.total.hires)}</Td><Td className="tabular-nums">{plan.total.hiresPerMonth}</Td></tr>
              )}
            </tbody>
          </Table>
          {ai && plan.rows.length > 0 && (
            <AiSummaryButton action={summarisePlanAction.bind(null, slug)} label="Summarise the plan" button="Summarise the plan" title="The plan in brief"
              note="Restates the table above; the table is what counts." hidden={{ growth: String(growthPct), months: String(months) }} pointsLabel="To weigh" />
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Training gaps" description="Assigned courses, most overdue first" />
          <Table caption="Training gaps">
            <thead><tr><Th>Course</Th><Th>Assigned</Th><Th>Completed</Th><Th>Overdue</Th><Th>Complete</Th></tr></thead>
            <tbody>
              {data.courses.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No courses assigned yet.</td></tr>}
              {data.courses.map((c) => (
                <tr key={c.course}><Td className="font-medium">{c.course}</Td><Td className="tabular-nums">{fmt(c.assigned)}</Td><Td className="tabular-nums">{fmt(c.completed)}</Td>
                  <Td className={`tabular-nums ${c.overdue > 0 ? 'font-semibold text-danger' : ''}`}>{fmt(c.overdue)}</Td><Td className="tabular-nums">{c.completionPct}%</Td></tr>
              ))}
            </tbody>
          </Table>
          {ai && data.courses.length > 0 && (
            <AiSummaryButton action={learningPlanAction.bind(null, slug)} label="Suggest a catch-up plan" button="Suggest a catch-up plan" title="Catch-up plan"
              note="Uses the counts above (courses only, no names)." pointsLabel="Steps" />
          )}
        </Card>
      </div>
    </>
  );
}
