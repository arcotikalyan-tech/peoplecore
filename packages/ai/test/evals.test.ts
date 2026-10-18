import { describe, expect, it } from 'vitest';
import { AGENTS } from '../src/index.ts';
import { loadEvalCases, runEvalCase } from '../src/evals.ts';

/** Recorded-response regression: every case of every agent passes through the real pipeline. */
describe.each(Object.keys(AGENTS))('evals: %s', (key) => {
  const cases = loadEvalCases(key);

  it('has cases', () => expect(cases.length).toBeGreaterThan(0));

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const result = await runEvalCase(AGENTS[key]!, c);
    expect(result.failures).toEqual([]);
  });
});
