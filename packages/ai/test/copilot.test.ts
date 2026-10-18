import { describe, expect, it } from 'vitest';
import { MOCK_PROVIDER, reportingCopilot, runAgent, untracedNumbers, type AiProvider, type DataPort, type RunDeps } from '../src/index.ts';

const port: DataPort = {
  org: { id: 'o', name: 'Example Co' },
  searchKnowledge: async () => [],
  analytics: {
    scope: async () => ({ scope: 'reporting_line', employeesVisible: 3, today: '2026-10-18' }),
    headcount: async () => [{ label: 'Engineering', headcount: 2 }, { label: 'Not set', headcount: 1 }],
    movements: async () => [], leave: async () => [], attendance: async () => [], payroll: async () => [],
    recruitment: async () => ({ openRequisitions: 0, openings: 0, applicationsByStage: {}, hiredLast90Days: 0 }),
    helpdesk: async () => [], learning: async () => [],
  },
};
const gate = { begin: async () => 'run', finish: async () => {} };

describe('reporting copilot', () => {
  it('offers only the tools the person’s permissions allow', async () => {
    const offered: string[][] = [];
    const capture: AiProvider = {
      name: 'anthropic', models: { default: 'm', fast: 'm' },
      async complete(req) {
        offered.push(req.tools.map((t) => t.name));
        return { model: 'm', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
          content: [{ type: 'tool_use', id: 't', name: 'respond', input: { answered: false, answer: 'n/a', figures: [], timeframe: '', limitations: '' } }] };
      },
    };
    const deps = (perms: string[]): RunDeps => ({ provider: capture, gate, port, can: (p) => perms.includes(p) });
    await runAgent(reportingCopilot, { question: 'payroll cost?', today: '2026-10-18' }, deps(['employee.read']));
    await runAgent(reportingCopilot, { question: 'payroll cost?', today: '2026-10-18' }, deps(['compensation.read', 'recruitment.read', 'helpdesk.manage']));
    expect(offered[0]).toEqual(['headcount', 'joiners_and_leavers', 'leave_taken', 'attendance', 'training', 'respond']);
    expect(offered[1]).toEqual(['headcount', 'joiners_and_leavers', 'leave_taken', 'attendance', 'payroll_totals', 'recruitment', 'helpdesk', 'training', 'respond']);
  });

  it('answers with the test provider from a tool, saying what it covers', async () => {
    const r = await runAgent(reportingCopilot, { question: 'Headcount by department?', today: '2026-10-18' }, { provider: MOCK_PROVIDER, gate, port, can: () => true });
    expect(r).toMatchObject({
      ok: true, modelCalls: 2, toolCalls: [{ name: 'headcount', input: { groupBy: 'department' } }],
      output: {
        answered: true, answer: '3 people are employed (only the people in your reporting line).', unverified: [],
        figures: [{ label: 'Engineering', value: '2' }, { label: 'Not set', value: '1' }], limitations: 'Covers only the people in your reporting line.',
      },
    });
  });

  it('flags numbers that are not in the data, allowing rounding and small counts', () => {
    const trace = { toolCalls: [{ name: 'joiners_and_leavers', input: { from: '2026-01-01', to: '2026-09-30' }, output: { leavers: 4, attritionRatePct: 15.72, net: 1607600, change: -6000, changePct: -11.1 } }] };
    expect(untracedNumbers('4 left in 9 months: 15.7% (about 16%), ₹16,07,600 net, since 2026.', trace)).toEqual([]);
    expect(untracedNumbers('Net pay fell by ₹6,000 (−11.1%).', trace)).toEqual([]);
    expect(untracedNumbers('Attrition was 18.2%, with 140 leavers.', trace)).toEqual(['18.2', '140']);
  });
});
