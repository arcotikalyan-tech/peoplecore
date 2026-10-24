import { describe, expect, it } from 'vitest';
import { workforcePlan } from '../src/workforce-plan.ts';

describe('workforce plan', () => {
  it('hires to reach the target and replace expected leavers, per department, busiest first', () => {
    const plan = workforcePlan({
      departments: [{ name: 'Sales', headcount: 40 }, { name: 'Engineering', headcount: 60 }, { name: 'Empty', headcount: 0 }],
      leaversLast12Months: 15, averageHeadcount: 100, growthPct: 10, months: 6,
    });
    expect(plan.attritionPct).toBe(15);
    // Engineering: target 66, leavers 60 × 15% × ½ = 4.5 → 5 (rounded), hires 66 − 60 + 5 = 11.
    expect(plan.rows).toEqual([
      { department: 'Engineering', now: 60, target: 66, expectedLeavers: 5, hires: 11, hiresPerMonth: 1.8 },
      { department: 'Sales', now: 40, target: 44, expectedLeavers: 3, hires: 7, hiresPerMonth: 1.2 },
    ]);
    expect(plan.total).toEqual({ now: 100, target: 110, expectedLeavers: 8, hires: 18, hiresPerMonth: 3 });
  });

  it('shrinking never asks for negative hires; no history means no attrition', () => {
    const plan = workforcePlan({ departments: [{ name: 'Ops', headcount: 20 }], leaversLast12Months: 0, averageHeadcount: 0, growthPct: -25, months: 12 });
    expect(plan.rows[0]).toEqual({ department: 'Ops', now: 20, target: 15, expectedLeavers: 0, hires: 0, hiresPerMonth: 0 });
    expect(workforcePlan({ departments: [], leaversLast12Months: 1, averageHeadcount: 1, growthPct: 999, months: 99 })).toMatchObject({ months: 36, growthPct: 200 });
  });
});
