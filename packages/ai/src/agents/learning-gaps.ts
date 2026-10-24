import { z } from 'zod';
import { defineAgent } from '../agent.ts';
import { untracedNumbers } from './reporting-copilot.ts';

/**
 * Learning gaps (tier 0) for HR: which assigned courses lag (completion and overdue counts from the learning
 * module, over the people the asker can see) and a short catch-up plan. It restates the counts, never computes new
 * ones; numbers that aren't in the table are flagged. Names never reach the model: courses only.
 */

const course = z.object({
  course: z.string().max(160), assigned: z.number().int().min(0), completed: z.number().int().min(0), overdue: z.number().int().min(0),
  completionPct: z.number().min(0).max(100),
});

const output = z.object({
  summary: z.string().min(10).max(700).describe('Two or three sentences on where training lags'),
  plan: z.array(z.string().max(220)).max(6).describe('Concrete catch-up steps, most urgent first'),
});

export interface LearningGapsPlan {
  summary: string;
  plan: string[];
  unverified: string[];
}

export const learningGaps = defineAgent({
  key: 'learning_gaps',
  promptVersion: 'learning_gaps/1.0.0',
  maxTier: 0,
  permission: null, // the counts come from analytics the person can already see
  model: 'fast',
  maxTokens: 700,
  input: z.object({ courses: z.array(course).min(1).max(40) }),
  redactInput: [],
  output,
  outputDescription: 'Give the summary and the catch-up plan.',
  tools: [],

  async load() {
    return {};
  },

  prompt(input) {
    return {
      system: [
        'You help HR close training gaps. You get the assigned courses with how many people completed them and how many are overdue.',
        '',
        'Rules:',
        '- Use only the table. Quote counts and percentages exactly; never compute new figures.',
        '- Start with the courses where most people are overdue, then the lowest completion.',
        '- Suggest practical steps (reminders, time set aside, a refresher session, checking whether a course is still needed). Do not name or blame individuals.',
        '- Plain language, short.',
      ].join('\n'),
      content: [{ type: 'text', text: JSON.stringify(input) }],
    };
  },

  finalize(out, input): LearningGapsPlan {
    return { ...out, unverified: untracedNumbers([out.summary, ...out.plan].join(' '), { toolCalls: [{ name: 'courses', input, output: null }] }) };
  },

  mock(input) {
    const worst = [...input.courses].sort((a, b) => b.overdue - a.overdue || a.completionPct - b.completionPct);
    return {
      output: {
        summary: `${worst[0]!.course} lags most: ${worst[0]!.overdue} overdue and ${worst[0]!.completionPct}% complete.`,
        plan: worst.filter((c) => c.overdue > 0).slice(0, 3).map((c) => `Remind the ${c.overdue} people overdue on ${c.course} and set aside time this week.`),
      },
    };
  },
});
