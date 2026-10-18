'use server';

import { reportingCopilot, type CopilotAnswer } from '@peoplecore/ai';
import { todayIn } from '@peoplecore/shared';
import type { ActionState } from '@/lib/action-state';
import { runAi } from '@/server/ai';
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
