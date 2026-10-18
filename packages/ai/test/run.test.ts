import { describe, expect, it } from 'vitest';
import { GateRefusal, MOCK_PROVIDER, NOT_CONFIGURED, policyAssistant, runAgent, type Gate, type RunDeps, type RunRecord } from '../src/index.ts';

const hit = { kind: 'policy' as const, id: 'pol-1', title: 'Leave policy', body: 'Casual leave: 12 days a year. It does not carry forward.', updatedAt: '2026-01-01', rank: 1 };

function deps(over: Partial<RunDeps> = {}) {
  const records: RunRecord[] = [];
  const begun: string[] = [];
  const gate: Gate = { begin: async (agent) => { begun.push(agent); return 'run-1'; }, finish: async (_id, r) => { records.push(r); } };
  return { records, begun, deps: { provider: MOCK_PROVIDER, gate, port: { org: { id: 'o', name: 'Example Co' }, searchKnowledge: async () => [hit] }, can: () => true, ...over } satisfies RunDeps };
}

describe('runAgent', () => {
  it('validates input before anything else', async () => {
    const d = deps();
    expect(await runAgent(policyAssistant, { question: 'x' }, d.deps)).toMatchObject({ ok: false, reason: 'invalid_input', message: 'Ask a question' });
    expect(d.begun).toEqual([]);
  });

  it('fails closed without a provider, without opening a run', async () => {
    const d = deps({ provider: null });
    expect(await runAgent(policyAssistant, { question: 'casual leave?' }, d.deps)).toEqual({ ok: false, reason: 'not_configured', message: NOT_CONFIGURED });
    expect(d.begun).toEqual([]);
  });

  it('passes on the gate’s refusal message', async () => {
    const d = deps({ gate: { begin: async () => { throw new GateRefusal('AI assistants are turned off for this organization.'); }, finish: async () => {} } });
    expect(await runAgent(policyAssistant, { question: 'casual leave?' }, d.deps))
      .toEqual({ ok: false, reason: 'refused', message: 'AI assistants are turned off for this organization.' });
  });

  it('answers with the mock provider and records the run', async () => {
    const d = deps();
    const result = await runAgent(policyAssistant, { question: 'How much casual leave? mail x@example.test' }, d.deps);
    expect(result).toMatchObject({ ok: true, runId: 'run-1', model: 'mock', modelCalls: 1, output: { answered: true, citations: [{ id: 'pol-1', label: 'S1', title: 'Leave policy' }] } });
    expect(d.records).toHaveLength(1);
    expect(d.records[0]).toMatchObject({ status: 'succeeded', promptVersion: 'policy_assistant/1.0.0', redactions: { email: 1 }, error: null });
    expect(JSON.stringify(d.records[0]!.request)).not.toContain('x@example.test');
  });

  it('records a provider failure without leaking it to the user', async () => {
    const d = deps({ provider: { name: 'anthropic', models: { default: 'm', fast: 'f' }, complete: async () => { throw new Error('Provider returned 500'); } } });
    expect(await runAgent(policyAssistant, { question: 'casual leave?' }, d.deps)).toMatchObject({ ok: false, reason: 'failed', runId: 'run-1' });
    expect(d.records[0]).toMatchObject({ status: 'failed', error: 'Provider returned 500' });
  });
});
