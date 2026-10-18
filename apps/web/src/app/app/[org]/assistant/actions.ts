'use server';

import { policyAssistant, type PolicyAnswer } from '@peoplecore/ai';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { rateAiRun, runAi } from '@/server/ai';

export interface AskState extends ActionState {
  question?: string;
  answer?: PolicyAnswer;
  runId?: string;
}

export async function askAction(orgSlug: string, _prev: AskState, formData: FormData): Promise<AskState> {
  const ctx = await getOrgContext(orgSlug);
  const question = String(formData.get('question') ?? '');
  const result = await runAi(ctx, policyAssistant, { question });
  if (!result.ok) {
    return { ok: false, message: result.message, values: { question }, ...(result.reason === 'invalid_input' ? { fieldErrors: { question: result.message } } : {}) };
  }
  return { ok: true, question, answer: result.output, runId: result.runId };
}

export async function rateAnswerAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ runId: z.uuid(), helpful: z.enum(['yes', 'no']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Not found.' };
  const { error } = await rateAiRun(parsed.data.runId, parsed.data.helpful === 'yes', null);
  if (error) return { ok: false, message: toUserMessage(error) };
  return { ok: true, message: 'Thanks for the feedback.' };
}
