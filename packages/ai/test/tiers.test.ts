import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AGENTS, assertToolAllowed, defineAgent, policyAssistant, runAgent, type RiskTier, type ToolDef } from '../src/index.ts';

const tool = (tier: number, name = 'do_it'): ToolDef<never, unknown> =>
  ({ name, description: 'test', tier: tier as RiskTier, permission: null, input: z.object({}) as never, run: async () => ({ done: true }) });

const agent = (maxTier: number, tools: Array<ToolDef<never, unknown>>) => ({
  ...policyAssistant, key: 'test_agent', maxTier: maxTier as RiskTier, tools,
});

describe('risk tiers: no agent can perform a tier-3 action', () => {
  it('every registered agent and tool stays at tier 2 or below, within its agent', () => {
    for (const a of Object.values(AGENTS)) {
      expect(a.maxTier).toBeLessThanOrEqual(2);
      for (const t of a.tools) expect(t.tier).toBeLessThanOrEqual(a.maxTier);
    }
  });

  it('defineAgent refuses tier-3 agents and tools above the agent’s tier', () => {
    expect(() => defineAgent(agent(3, []))).toThrow(/tier 3/);
    expect(() => defineAgent(agent(2, [tool(3)]))).toThrow(/not allowed/);
    expect(() => defineAgent(agent(0, [tool(1)]))).toThrow(/not allowed/);
    expect(() => defineAgent(agent(1, [tool(1, 'respond')]))).toThrow(/duplicate/);
    expect(() => defineAgent(agent(2, [tool(2)]))).not.toThrow();
    expect(() => assertToolAllowed({ key: 'a', maxTier: 2 }, { name: 't', tier: 2.5 as RiskTier })).toThrow();
  });

  it('the runner refuses a tool whose tier was raised after definition', async () => {
    const t = tool(1);
    let ran = false;
    t.run = async () => { ran = true; return {}; };
    const a = defineAgent({
      ...agent(1, [t]),
      answerWithoutModel: () => null,
      load: async () => ({ passages: [] }),
      mock: (_i: unknown, _c: unknown, results: Array<{ name: string }>) => (results.length ? { output: { answered: false, answer: 'x', citations: [] } } : { tool: 'do_it', input: {} }),
    });
    (t as { tier: number }).tier = 3;
    let record: { status: string; error: string | null } | null = null;
    const result = await runAgent(a, { question: 'anything at all' }, {
      provider: { name: 'mock', models: { default: 'm', fast: 'm' }, complete: async () => { throw new Error('unused'); } },
      gate: { begin: async () => 'run-1', finish: async (_id, r) => { record = r; } },
      port: { org: { id: 'o', name: 'Example Co' }, searchKnowledge: async () => [] },
      can: () => true,
    });
    expect(result.ok).toBe(false);
    expect(ran).toBe(false);
    expect(record).toMatchObject({ status: 'failed', error: expect.stringMatching(/tier 3/) });
  });
});
