import { z } from 'zod';
import { defineAgent } from '../agent.ts';
import { untracedNumbers } from './reporting-copilot.ts';

/**
 * Workforce plan summary (tier 0) for HR and leadership. It restates the hiring plan the app computed
 * (packages/shared workforcePlan: headcount by department, attrition, growth target); it never computes figures, and
 * numbers in the summary that aren't in the plan are flagged.
 */

const row = z.object({
  department: z.string().max(80), now: z.number().int(), target: z.number().int(), expectedLeavers: z.number().int(),
  hires: z.number().int(), hiresPerMonth: z.number(),
});

const output = z.object({
  summary: z.string().min(10).max(900).describe('Three or four sentences: the overall hiring need and where it falls'),
  points: z.array(z.string().max(200)).max(6).describe('Risks and things to decide, most important first'),
});

export interface WorkforcePlanSummary {
  summary: string;
  points: string[];
  unverified: string[];
}

export const workforcePlanSummary = defineAgent({
  key: 'workforce_plan',
  promptVersion: 'workforce_plan/1.0.0',
  maxTier: 0,
  permission: null, // the plan is computed only from headcount the person can already see
  model: 'default',
  maxTokens: 800,
  input: z.object({
    months: z.number().int().min(1).max(36),
    growthPct: z.number(),
    attritionPct: z.number(),
    rows: z.array(row).max(60),
    total: row.omit({ department: true }),
  }),
  redactInput: [],
  output,
  outputDescription: 'Give the summary of the hiring plan.',
  tools: [],

  async load() {
    return {};
  },

  prompt(input) {
    return {
      system: [
        'You summarise a workforce plan for HR and leadership: how many people each department needs to hire to reach a growth target and replace expected leavers.',
        '',
        'Rules:',
        '- Use only the plan you are given. Quote figures exactly as they appear; never add, subtract or estimate new ones.',
        '- Say where most of the hiring falls and what the attrition rate means for it.',
        '- Point out risks a planner should weigh (a high hiring pace for a small team, high attrition, departments that shrink).',
        '- Plain language, no more than about 120 words in the summary.',
      ].join('\n'),
      content: [{ type: 'text', text: JSON.stringify(input) }],
    };
  },

  finalize(out, input): WorkforcePlanSummary {
    return { ...out, unverified: untracedNumbers([out.summary, ...out.points].join(' '), { toolCalls: [{ name: 'plan', input, output: null }] }) };
  },

  mock(input) {
    const top = input.rows[0];
    return {
      output: {
        summary: `Reaching ${input.total.target} people in ${input.months} months means hiring ${input.total.hires}: ${input.total.target - input.total.now} for growth and ${input.total.expectedLeavers} to replace leavers at ${input.attritionPct}% attrition.`
          + (top ? ` ${top.department} needs the most (${top.hires}).` : ''),
        points: input.rows.filter((r) => r.hiresPerMonth >= 2).map((r) => `${r.department}: ${r.hiresPerMonth} hires a month`).slice(0, 3),
      },
    };
  },
});
