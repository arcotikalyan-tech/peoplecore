import { z } from 'zod';
import { defineAgent } from '../agent.ts';
import { untracedNumbers } from './reporting-copilot.ts';

/**
 * Payroll variance summary (tier 0) for the person approving a run. It only restates the variance table the
 * payroll engine computed (packages/payroll compareRuns): employee codes, not names, and amounts it must quote,
 * never compute (ADR-010). Numbers in the summary that aren't in the table are flagged.
 */

const variance = z.object({
  code: z.string().max(40),
  kind: z.enum(['joined', 'left', 'changed']),
  previousNet: z.number().nullable(),
  currentNet: z.number().nullable(),
  change: z.number().nullable(),
  changePct: z.number().nullable(),
  reasons: z.array(z.string().max(200)).max(6),
});

const output = z.object({
  summary: z.string().min(10).max(900).describe('Three or four sentences for the approver'),
  points: z.array(z.string().max(200)).max(6).describe('What to check before approving, most important first'),
});

export interface VarianceSummary {
  summary: string;
  points: string[];
  unverified: string[];
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export const payrollVariance = defineAgent({
  key: 'payroll_variance',
  promptVersion: 'payroll_variance/1.0.0',
  maxTier: 0,
  permission: null, // the variance table itself is only loaded for payroll staff
  model: 'default',
  maxTokens: 800,
  input: z.object({
    month: z.string().max(40),
    previousMonth: z.string().max(40),
    totals: z.object({
      previousNet: z.number(), currentNet: z.number(), change: z.number(), changePct: z.number().nullable(),
      previousEmployees: z.number().int(), currentEmployees: z.number().int(),
    }),
    steady: z.number().int(),
    variances: z.array(variance).max(60),
  }),
  redactInput: [],
  output,
  outputDescription: 'Give the summary for the approver.',
  tools: [],

  async load() {
    return {};
  },

  prompt(input) {
    return {
      system: [
        'You summarise what changed in a payroll run since the last locked run, for the person who approves it.',
        '',
        'Rules:',
        '- Use only the table you are given. Quote amounts and percentages exactly as they appear; never add, subtract or estimate.',
        '- Refer to employees by their codes. Explain each material change with the reasons listed for it.',
        '- Point out anything an approver should check: large changes, changes with no input explanation, joiners and leavers.',
        '- Plain language, no more than about 120 words in the summary.',
      ].join('\n'),
      content: [{ type: 'text', text: JSON.stringify(input) }],
    };
  },

  finalize(out, input): VarianceSummary {
    return { ...out, unverified: untracedNumbers([out.summary, ...out.points].join(' '), { toolCalls: [{ name: 'table', input, output: null }] }) };
  },

  mock(input) {
    const t = input.totals;
    const changed = input.variances.filter((v) => v.kind === 'changed');
    const unexplained = changed.filter((v) => v.reasons.some((r) => r.startsWith('No change in the inputs')));
    return {
      output: {
        summary: `Net pay for ${input.month} is ${inr(t.currentNet)} against ${inr(t.previousNet)} for ${input.previousMonth}${t.changePct === null ? '' : ` (${t.changePct}%)`}. `
          + `${changed.length} of ${t.currentEmployees} employees changed materially; ${input.steady} are steady.`,
        points: [
          ...changed.slice(0, 3).map((v) => `${v.code}: ${v.reasons.join('; ')}`),
          ...(unexplained.length ? [`Check ${unexplained.map((v) => v.code).join(', ')}: nothing in the inputs explains the change.`] : []),
        ],
      },
    };
  },
});
