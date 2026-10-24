'use server';

import { learningGaps, reportingCopilot, workforcePlanSummary, type CopilotAnswer } from '@peoplecore/ai';
import { todayIn } from '@peoplecore/shared';
import type { ActionState } from '@/lib/action-state';
import type { AiSummaryState } from '@/components/ai-summary-button';
import { runAi } from '@/server/ai';
import { insights, planFrom } from '@/server/analytics';
import { getOrgContext } from '@/server/context';

export interface CopilotState extends ActionState {
  question?: string;
  answer?: CopilotAnswer;
  runId?: string;
}

export async function askCopilotAction(orgSlug: string, _prev: CopilotState, formData: FormData): Promise<CopilotState> {
  const ctx = await getOrgContext(orgSlug);
  const question = String(formData.get('question') ?? '');
  const result = await runAi(ctx, reportingCopilot, { question, today: todayIn(ctx.org.timezone) });
  if (!result.ok) {
    return { ok: false, message: result.message, values: { question }, ...(result.reason === 'invalid_input' ? { fieldErrors: { question: result.message } } : {}) };
  }
  return { ok: true, question, answer: result.output, runId: result.runId };
}

/** Plan inputs from the form, held to sensible ranges (the page uses the same). */
export async function planInputs(raw: { growth?: unknown; months?: unknown }) {
  const growth = Number(raw.growth ?? 10);
  const months = Number(raw.months ?? 12);
  return { growthPct: Number.isFinite(growth) ? Math.min(200, Math.max(-50, Math.round(growth))) : 10, months: [3, 6, 12, 24].includes(months) ? months : 12 };
}

/** An AI summary of the hiring plan; the plan is recomputed here from what the person can see, never taken from the form. */
export async function summarisePlanAction(orgSlug: string, _prev: AiSummaryState, formData: FormData): Promise<AiSummaryState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('employee.read', 'org') && !ctx.can('employee.read', 'team')) return { ok: false, message: 'You don’t have permission to do that.' };
  const { growthPct, months } = await planInputs({ growth: formData.get('growth'), months: formData.get('months') });
  const plan = planFrom(await insights(ctx.org.id, todayIn(ctx.org.timezone)), growthPct, months);
  if (plan.rows.length === 0) return { ok: false, message: 'There is no headcount to plan from yet.' };
  const result = await runAi(ctx, workforcePlanSummary, { months: plan.months, growthPct: plan.growthPct, attritionPct: plan.attritionPct, rows: plan.rows, total: plan.total });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, summary: result.output };
}

/** An AI catch-up plan for the courses that lag, from the training counts the person can see (courses only, no names). */
export async function learningPlanAction(orgSlug: string, _prev: AiSummaryState): Promise<AiSummaryState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('employee.read', 'org') && !ctx.can('employee.read', 'team')) return { ok: false, message: 'You don’t have permission to do that.' };
  const { courses } = await insights(ctx.org.id, todayIn(ctx.org.timezone));
  if (courses.length === 0) return { ok: false, message: 'No courses are assigned yet.' };
  const result = await runAi(ctx, learningGaps, { courses });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, summary: { summary: result.output.summary, points: result.output.plan, unverified: result.output.unverified } };
}
