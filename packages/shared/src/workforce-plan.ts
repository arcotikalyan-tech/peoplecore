/**
 * Workforce planning (docs/06-ai-architecture.md, tier 0): how many people each department needs to hire over the
 * next months to reach a growth target while replacing expected leavers. Plain arithmetic on the headcount the
 * planner can see; the AI summary only restates these figures.
 */

export interface WorkforcePlanInput {
  departments: ReadonlyArray<{ name: string; headcount: number }>;
  /** Leavers over the last 12 months and the average headcount over them (for the attrition rate). */
  leaversLast12Months: number;
  averageHeadcount: number;
  /** Growth wanted over the horizon, in percent (negative to shrink). */
  growthPct: number;
  months: number;
}

export interface WorkforcePlanRow {
  department: string;
  now: number;
  target: number;
  expectedLeavers: number;
  hires: number;
  hiresPerMonth: number;
}

export interface WorkforcePlan {
  attritionPct: number;
  months: number;
  growthPct: number;
  rows: WorkforcePlanRow[];
  total: Omit<WorkforcePlanRow, 'department'>;
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

export function workforcePlan(input: WorkforcePlanInput): WorkforcePlan {
  const months = Math.min(36, Math.max(1, Math.round(input.months)));
  const growthPct = Math.min(200, Math.max(-50, input.growthPct));
  const attrition = input.averageHeadcount > 0 ? Math.min(1, input.leaversLast12Months / input.averageHeadcount) : 0;
  const rows = input.departments.filter((d) => d.headcount > 0).map((d) => {
    const target = Math.max(0, Math.round(d.headcount * (1 + growthPct / 100)));
    const expectedLeavers = Math.round(d.headcount * attrition * (months / 12));
    const hires = Math.max(0, target - d.headcount + expectedLeavers);
    return { department: d.name, now: d.headcount, target, expectedLeavers, hires, hiresPerMonth: oneDecimal(hires / months) };
  }).sort((a, b) => b.hires - a.hires || a.department.localeCompare(b.department));
  const sum = (k: 'now' | 'target' | 'expectedLeavers' | 'hires') => rows.reduce((s, r) => s + r[k], 0);
  const hires = sum('hires');
  return {
    attritionPct: oneDecimal(attrition * 100), months, growthPct, rows,
    total: { now: sum('now'), target: sum('target'), expectedLeavers: sum('expectedLeavers'), hires, hiresPerMonth: oneDecimal(hires / months) },
  };
}
