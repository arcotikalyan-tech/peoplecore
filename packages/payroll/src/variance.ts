import type { EmployeeInput } from './engine.ts';

/**
 * What changed since the last locked run, for the person approving payroll (deterministic, no I/O). Each
 * employee whose net pay moved by at least the thresholds, joined or left the run, is listed with the
 * reasons the inputs show: a salary change, loss of pay, one-off adjustments, reimbursements.
 */

export interface VarianceRow {
  employeeId: string;
  gross: number;
  net: number;
  lopDays: number;
  input: Pick<EmployeeInput, 'components' | 'reimbursements' | 'adjustments'>;
}

export interface VarianceThresholds {
  /** Smallest change in net pay worth listing, in rupees. */
  amount: number;
  /** ...and as a share of last month's net pay. */
  share: number;
}

export const VARIANCE_DEFAULTS: VarianceThresholds = { amount: 1000, share: 0.05 };

export interface Variance {
  employeeId: string;
  kind: 'joined' | 'left' | 'changed';
  previousNet: number | null;
  currentNet: number | null;
  change: number | null;
  changePct: number | null;
  reasons: string[];
}

export interface VarianceReport {
  variances: Variance[];
  totals: { previousNet: number; currentNet: number; change: number; changePct: number | null; previousEmployees: number; currentEmployees: number };
  /** Employees in both runs whose change is below the thresholds. */
  steady: number;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (change: number, base: number) => (base ? Math.round((change / base) * 1000) / 10 : null);
const monthlyEarnings = (r: VarianceRow) => r.input.components.filter((c) => c.kind === 'earning').reduce((s, c) => s + c.monthly, 0);
const oneOffs = (r: VarianceRow) => (r.input.adjustments ?? []).reduce((s, a) => s + (a.kind === 'earning' ? a.amount : -a.amount), 0);

function reasons(cur: VarianceRow, prev: VarianceRow): string[] {
  const out: string[] = [];
  const [was, now] = [monthlyEarnings(prev), monthlyEarnings(cur)];
  if (was !== now) out.push(`Monthly salary ${now > was ? 'up' : 'down'} from ${inr(was)} to ${inr(now)}`);
  if (cur.lopDays !== prev.lopDays) out.push(`Loss of pay ${cur.lopDays} day${cur.lopDays === 1 ? '' : 's'} (was ${prev.lopDays})`);
  const [adjWas, adjNow] = [oneOffs(prev), oneOffs(cur)];
  if (adjWas !== adjNow) out.push(adjNow ? `One-off adjustments ${adjNow > 0 ? '+' : '−'}${inr(Math.abs(adjNow))}${adjWas ? ` (was ${inr(adjWas)})` : ''}` : `No one-off adjustments (was ${inr(adjWas)})`);
  const [reWas, reNow] = [prev.input.reimbursements, cur.input.reimbursements];
  if (reWas !== reNow) out.push(`Reimbursements ${inr(reNow)} (was ${inr(reWas)})`);
  if (out.length === 0) out.push('No change in the inputs: tax or statutory deductions moved');
  return out;
}

export function compareRuns(current: VarianceRow[], previous: VarianceRow[], t: VarianceThresholds = VARIANCE_DEFAULTS): VarianceReport {
  const prevBy = new Map(previous.map((r) => [r.employeeId, r]));
  const curBy = new Map(current.map((r) => [r.employeeId, r]));
  const variances: Variance[] = [];
  let steady = 0;
  for (const cur of current) {
    const prev = prevBy.get(cur.employeeId);
    if (!prev) {
      variances.push({ employeeId: cur.employeeId, kind: 'joined', previousNet: null, currentNet: cur.net, change: null, changePct: null, reasons: ['Not in the last run (new joiner or newly on payroll)'] });
      continue;
    }
    const change = cur.net - prev.net;
    if (Math.abs(change) >= t.amount && Math.abs(change) >= t.share * Math.abs(prev.net)) {
      variances.push({ employeeId: cur.employeeId, kind: 'changed', previousNet: prev.net, currentNet: cur.net, change, changePct: pct(change, prev.net), reasons: reasons(cur, prev) });
    } else steady++;
  }
  for (const prev of previous) {
    if (!curBy.has(prev.employeeId)) {
      variances.push({ employeeId: prev.employeeId, kind: 'left', previousNet: prev.net, currentNet: null, change: null, changePct: null, reasons: ['In the last run, not in this one (left, or no salary this month)'] });
    }
  }
  const order = { changed: 0, joined: 1, left: 2 } as const;
  variances.sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) || a.employeeId.localeCompare(b.employeeId));
  const previousNet = previous.reduce((s, r) => s + r.net, 0);
  const currentNet = current.reduce((s, r) => s + r.net, 0);
  return {
    variances,
    totals: { previousNet, currentNet, change: currentNet - previousNet, changePct: pct(currentNet - previousNet, previousNet), previousEmployees: previous.length, currentEmployees: current.length },
    steady,
  };
}
