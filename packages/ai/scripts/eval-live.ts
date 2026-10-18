/**
 * Runs the eval suites against the configured model (nightly; needs ANTHROPIC_API_KEY). Exits non-zero when an
 * agent scores below its threshold. Usage: corepack pnpm --filter @peoplecore/ai eval:live [agent…]
 */
import { AGENTS, providerFromEnv } from '../src/index.ts';
import { loadEvalCases, runEvalCase } from '../src/evals.ts';

const THRESHOLD = Number(process.env.AI_EVAL_THRESHOLD ?? '0.9');
const provider = providerFromEnv(process.env);
if (!provider || provider.name !== 'anthropic') {
  console.error('Set ANTHROPIC_API_KEY (and optionally AI_MODEL) to run live evals.');
  process.exit(2);
}

let failed = false;
for (const key of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(AGENTS)) {
  const agent = AGENTS[key];
  if (!agent) throw new Error(`Unknown agent ${key}`);
  const cases = loadEvalCases(key).filter((c) => !c.recordedOnly);
  let passed = 0;
  for (const c of cases) {
    const r = await runEvalCase(agent, c, provider);
    if (r.passed) passed++;
    else console.warn(`✗ ${key} · ${r.name}\n    ${r.failures.join('\n    ')}`);
  }
  const score = passed / cases.length;
  console.warn(`${score >= THRESHOLD ? '✓' : '✗'} ${key}: ${passed}/${cases.length} (${Math.round(score * 100)}%, threshold ${THRESHOLD * 100}%)`);
  if (score < THRESHOLD) failed = true;
}
process.exit(failed ? 1 : 0);
