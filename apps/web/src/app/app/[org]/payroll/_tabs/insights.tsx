import { BarChart, SplitBar } from '@/components/ui/charts';
import { lockedLineTotals, payrollPeople, recentRuns } from '@/server/payroll-suite';
import { Card, Figure, inr, lakhs, type TabProps } from './shared';

const short = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });

/** Payroll insights from locked runs: cost trends, split, departments, components and statutory totals. */
export async function InsightsTab({ ctx, month }: TabProps) {
  const [runs, people] = await Promise.all([recentRuns(ctx.org.id, 12), payrollPeople(ctx.org.id, month)]);
  const locked = runs.filter((r) => r.status === 'locked').reverse();
  if (locked.length === 0) {
    return <Card title="Payroll insights"><p className="text-sm text-muted">Insights appear once a payroll run is locked. Run payroll for a month to see cost trends, department split and statutory totals here.</p></Card>;
  }
  const lines = await lockedLineTotals(ctx.org.id, locked.map((r) => r.id));
  const latest = locked.at(-1)!;
  const latestLines = lines.filter((l) => l.run_id === latest.id);
  const sum = (ls: typeof lines, f: (l: (typeof lines)[number]) => boolean) => ls.filter(f).reduce((s, l) => s + l.amount, 0);
  const yearCost = locked.reduce((s, r) => s + Number(r.total_employer_cost), 0);
  const dept = new Map(people.map((p) => [p.id, p.department ?? 'No department']));
  const byDept = new Map<string, number>();
  for (const l of latestLines) if (l.kind !== 'deduction') byDept.set(dept.get(l.employee_id) ?? 'Former employees', (byDept.get(dept.get(l.employee_id) ?? 'Former employees') ?? 0) + l.amount);
  const byComponent = new Map<string, number>();
  for (const l of latestLines) if (l.kind === 'earning') byComponent.set(l.name, (byComponent.get(l.name) ?? 0) + l.amount);
  const prev = locked.at(-2);
  const change = prev ? ((Number(latest.total_net) - Number(prev.total_net)) / Math.max(1, Number(prev.total_net))) * 100 : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={`Cost · last ${locked.length} months`} value={lakhs(yearCost)} tone="primary" note="Gross + employer contributions" />
        <Figure label="Net pay · latest" value={lakhs(Number(latest.total_net))} tone="success" note={change === null ? 'First locked run' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% vs previous`} />
        <Figure label="Average net per employee" value={inr.format(Number(latest.total_net) / Math.max(1, latest.employee_count))} note={`${latest.employee_count} paid`} />
        <Figure label="TDS · latest" value={inr.format(sum(latestLines, (l) => l.code === 'TDS'))} tone="warning" note={`PF ${inr.format(sum(latestLines, (l) => l.code === 'PF'))} · ESI ${inr.format(sum(latestLines, (l) => l.code === 'ESI'))}`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="💰 Payroll spend" action={<span className="text-xs text-muted">Net pay · {locked.length} months</span>}>
          <BarChart label="Net pay by month" data={locked.map((r) => ({ label: short(r.period_month), value: Number(r.total_net) }))} format={lakhs} />
        </Card>
        <Card title="🏢 Employer cost" action={<span className="text-xs text-muted">Gross + PF/ESI employer share</span>}>
          <BarChart label="Employer cost by month" data={locked.map((r) => ({ label: short(r.period_month), value: Number(r.total_employer_cost) }))} format={lakhs} />
        </Card>
        <Card title="Where the money goes" action={<span className="text-xs text-muted">Latest run</span>}>
          <SplitBar label="Payroll split" parts={[
            { label: 'Net pay', value: Math.round(Number(latest.total_net)), tone: 'success' },
            { label: 'Income tax', value: Math.round(sum(latestLines, (l) => l.code === 'TDS')), tone: 'warning' },
            { label: 'Employee PF/ESI/PT', value: Math.round(sum(latestLines, (l) => ['PF', 'ESI', 'PT'].includes(l.code))), tone: 'info' },
            { label: 'Employer contributions', value: Math.round(sum(latestLines, (l) => l.kind === 'employer')), tone: 'muted' },
          ]} />
        </Card>
        <Card title="By department" action={<span className="text-xs text-muted">Cost · latest run</span>}>
          <ul className="space-y-2 text-sm">
            {[...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([d, v]) => {
              const max = Math.max(...byDept.values());
              return (
                <li key={d} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
                  <span className="truncate">{d}</span>
                  <span className="h-2 rounded-full bg-subtle"><span className="block h-2 rounded-full bg-primary" style={{ width: `${(v / max) * 100}%` }} /></span>
                  <span className="tabular-nums">{lakhs(v)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Earnings by component" action={<span className="text-xs text-muted">Latest run</span>} className="lg:col-span-2">
          <BarChart label="Earnings by component" data={[...byComponent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))} format={lakhs} />
        </Card>
      </div>
    </div>
  );
}
