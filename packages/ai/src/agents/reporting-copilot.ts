import { z } from 'zod';
import { defineAgent, type RunTrace, type ToolDef } from '../agent.ts';
import type { AnalyticsPort, AnalyticsScope, DataPort } from '../port.ts';
import { ALL_IDENTIFIERS } from '../redact.ts';

/**
 * HR reporting copilot (tier 0). It answers questions about the workforce with read-only tools over aggregate
 * functions that run as the person asking, so a manager's answer covers their reporting line and payroll totals
 * need payroll access. Tools return ready-made figures (rates included); the answer states its period and
 * limits, lists the queries it ran, and any number in it that can't be traced to the data is flagged.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const period = z.object({ from: date, to: date })
  .refine((p) => p.from <= p.to, 'from must be on or before to')
  .refine((p) => Date.parse(p.to) - Date.parse(p.from) <= 1100 * 86_400_000, 'At most three years');

const SCOPE_TEXT: Record<AnalyticsScope, string> = {
  organization: 'the whole organization',
  reporting_line: 'only the people in your reporting line',
  self: 'only your own records',
};

function analytics(port: DataPort): AnalyticsPort {
  if (!port.analytics) throw new Error('Analytics are not available here');
  return port.analytics;
}

async function scoped<T>(port: DataPort, data: T) {
  const s = await analytics(port).scope();
  return { covers: SCOPE_TEXT[s.scope], ...data };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const tool = <I>(t: ToolDef<I, unknown>) => t as unknown as ToolDef<never, unknown>;

export const COPILOT_TOOLS = [
  tool({
    name: 'headcount', tier: 0, permission: null,
    description: 'Number of people employed on a date (default today), grouped by department, location, designation or employment type.',
    input: z.object({ asOf: date.nullable().optional(), groupBy: z.enum(['department', 'location', 'designation', 'employment_type', 'everyone']) }),
    async run(i, { port }) {
      const groups = await analytics(port).headcount(i.asOf ?? null, i.groupBy);
      return scoped(port, { asOf: i.asOf ?? 'today', groupBy: i.groupBy, total: groups.reduce((n, g) => n + g.headcount, 0), groups });
    },
  }),
  tool({
    name: 'joiners_and_leavers', tier: 0, permission: null,
    description: 'Joiners, leavers and month-end headcount per month in a period, with the attrition rate (leavers ÷ average month-end headcount) for the period and annualised.',
    input: period,
    async run(i, { port }) {
      const months = await analytics(port).movements(i.from, i.to);
      const joiners = months.reduce((n, m) => n + m.joiners, 0);
      const leavers = months.reduce((n, m) => n + m.leavers, 0);
      const avg = months.length ? months.reduce((n, m) => n + m.headcountEnd, 0) / months.length : 0;
      return scoped(port, {
        from: i.from, to: i.to, months, joiners, leavers, averageHeadcount: round1(avg),
        attritionRatePct: avg ? round1((leavers / avg) * 100) : null,
        annualisedAttritionRatePct: avg && months.length ? round1((leavers / avg) * (12 / months.length) * 100) : null,
      });
    },
  }),
  tool({
    name: 'leave_taken', tier: 0, permission: null,
    description: 'Approved leave overlapping a period, by leave type: requests, days and people.',
    input: period,
    async run(i, { port }) {
      const types = await analytics(port).leave(i.from, i.to);
      return scoped(port, { from: i.from, to: i.to, types, totalDays: round1(types.reduce((n, t) => n + t.days, 0)) });
    },
  }),
  tool({
    name: 'attendance', tier: 0, permission: null,
    description: 'Attendance days in a period by status (present, absent, on leave…), with how many were late.',
    input: period,
    async run(i, { port }) {
      return scoped(port, { from: i.from, to: i.to, statuses: await analytics(port).attendance(i.from, i.to) });
    },
  }),
  tool({
    name: 'payroll_totals', tier: 0, permission: ['payroll.prepare', 'payroll.approve', 'compensation.read'],
    description: 'Totals of the latest approved or locked payroll runs (gross, deductions, net, employer cost, employees), newest first.',
    input: z.object({ months: z.number().int().min(1).max(24) }),
    async run(i, { port }) {
      return scoped(port, { runs: await analytics(port).payroll(i.months) });
    },
  }),
  tool({
    name: 'recruitment', tier: 0, permission: 'recruitment.read',
    description: 'Open requisitions and openings, applications on open requisitions by stage, and hires in the last 90 days.',
    input: z.object({}),
    async run(_i, { port }) {
      return scoped(port, await analytics(port).recruitment());
    },
  }),
  tool({
    name: 'helpdesk', tier: 0, permission: 'helpdesk.manage',
    description: 'Helpdesk tickets raised in a period by status, with SLA breaches and the median hours to resolve.',
    input: period,
    async run(i, { port }) {
      return scoped(port, { from: i.from, to: i.to, statuses: await analytics(port).helpdesk(i.from, i.to) });
    },
  }),
  tool({
    name: 'training', tier: 0, permission: null,
    description: 'Training by course: assigned, completed and overdue enrolments.',
    input: z.object({}),
    async run(_i, { port }) {
      return scoped(port, { courses: await analytics(port).learning() });
    },
  }),
];

const output = z.object({
  answered: z.boolean().describe('false if the tools cannot answer the question'),
  answer: z.string().min(1).max(2000).describe('Plain-language answer, or what data would be needed'),
  figures: z.array(z.object({ label: z.string().max(80), value: z.string().max(40) })).max(10).describe('The key numbers, as the tools gave them'),
  timeframe: z.string().max(160).describe('The exact dates the figures cover'),
  limitations: z.string().max(500).describe('What the figures do not cover, e.g. only your reporting line, current departments'),
});

export interface CopilotAnswer {
  answered: boolean;
  answer: string;
  figures: Array<{ label: string; value: string }>;
  timeframe: string;
  limitations: string;
  /** The queries the answer rests on. */
  queries: Array<{ tool: string; input: unknown }>;
  /** Numbers in the answer that don't appear in the data the tools returned. */
  unverified: string[];
}

/** Every number in a value (numbers, numeric strings, the parts of dates). */
function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (typeof value === 'string') for (const m of value.match(/\d+(?:\.\d+)?/g) ?? []) out.push(Number(m));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

export function untracedNumbers(text: string, trace: RunTrace, extra: string[] = []): string[] {
  const known = numbersIn([trace.toolCalls.map((c) => [c.input, c.output]), extra]);
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const bad = found.filter((raw) => {
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n) || (Number.isInteger(n) && n <= 12)) return false; // small counts (months, days) are fine
    const decimals = raw.split('.')[1]?.length ?? 0;
    const f = 10 ** decimals;
    // Text carries no sign ("down 6,000", "−0.6%"), so compare magnitudes.
    return !known.some((k) => Math.round(Math.abs(k) * f) / f === n || Math.round(Math.abs(k)) === n);
  });
  return [...new Set(bad)];
}

export const reportingCopilot = defineAgent({
  key: 'reporting_copilot',
  promptVersion: 'reporting_copilot/1.0.0',
  maxTier: 0,
  permission: null,
  model: 'default',
  maxTokens: 1500,
  input: z.object({
    question: z.string().trim().min(3, 'Ask a question').max(600, 'Keep the question under 600 characters'),
    today: date,
  }),
  redactInput: ALL_IDENTIFIERS,
  output,
  outputDescription: 'Give your answer once you have the figures you need.',
  tools: COPILOT_TOOLS,

  async load() {
    return {};
  },

  prompt(input, _context, port) {
    return {
      system: [
        `You answer HR reporting questions for ${port.org.name} with the tools provided. Today is ${input.today}.`,
        '',
        'Rules:',
        '- Use only figures returned by the tools. Quote them as given; the tools already compute totals and rates. If you must work something out (a difference, a share), say how.',
        '- Every tool result says what it covers. When it is not the whole organization, say so in limitations.',
        '- Turn relative periods ("last quarter", "this year") into exact dates, use them in the tool calls, and state them in timeframe.',
        '- The tools return aggregates only. Never guess about individuals.',
        '- If the tools cannot answer (for example no tool covers it, or you have no access), set answered to false and say what data would be needed.',
        '- Keep the answer under about 120 words.',
      ].join('\n'),
      content: [{ type: 'text', text: input.question }],
    };
  },

  finalize(out, input, _context, trace): CopilotAnswer {
    const text = [out.answer, ...out.figures.map((f) => f.value)].join(' ');
    return {
      ...out,
      answered: out.answered && trace.toolCalls.length > 0,
      queries: trace.toolCalls.map((c) => ({ tool: c.name, input: c.input })),
      unverified: untracedNumbers(text, trace, [input.question, input.today, out.timeframe]),
    };
  },

  // Picks a tool from the question's words, then answers with its first figures.
  mock(input, _context, results) {
    const q = input.question.toLowerCase();
    const year = input.today.slice(0, 4);
    if (results.length === 0) {
      if (/attrition|leaver|joiner|turnover|resign/.test(q)) return { tool: 'joiners_and_leavers', input: { from: `${year}-01-01`, to: input.today } };
      if (/leave|holiday|absence/.test(q)) return { tool: 'leave_taken', input: { from: `${year}-01-01`, to: input.today } };
      if (/payroll|salary|salaries|cost/.test(q)) return { tool: 'payroll_totals', input: { months: 3 } };
      if (/hiring|recruit|requisition|candidate/.test(q)) return { tool: 'recruitment', input: {} };
      if (/training|course|learning/.test(q)) return { tool: 'training', input: {} };
      return { tool: 'headcount', input: { groupBy: /location|office/.test(q) ? 'location' : 'department' } };
    }
    const r = results[results.length - 1]!;
    const o = r.output as Record<string, unknown> & { covers?: string };
    const limitations = o.covers === 'the whole organization' ? 'Current departments and locations.' : `Covers ${o.covers}.`;
    if (r.name === 'headcount') {
      const groups = (o.groups as Array<{ label: string; headcount: number }>) ?? [];
      return { output: { answered: true, answer: `${o.total} people are employed (${o.covers}).`, figures: groups.slice(0, 6).map((g) => ({ label: g.label, value: String(g.headcount) })), timeframe: `As of ${input.today}`, limitations } };
    }
    if (r.name === 'joiners_and_leavers') {
      return { output: { answered: true, answer: `${o.joiners} joined and ${o.leavers} left between ${o.from} and ${o.to}.`, figures: [{ label: 'Joiners', value: String(o.joiners) }, { label: 'Leavers', value: String(o.leavers) }, { label: 'Attrition', value: o.attritionRatePct == null ? 'n/a' : `${o.attritionRatePct}%` }], timeframe: `${o.from} to ${o.to}`, limitations } };
    }
    return { output: { answered: true, answer: `Here is what ${r.name.replace(/_/g, ' ')} shows (${o.covers}).`, figures: [], timeframe: input.today, limitations } };
  },
});
