import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyAgent } from './agent.ts';
import { searchTerms } from './agents/policy-assistant.ts';
import { textPdf } from './pdf.ts';
import type { DataPort, KnowledgeHit } from './port.ts';
import { runAgent, type RunRecord } from './run.ts';
import type { AiProvider, CompletionResponse } from './types.ts';

/**
 * Eval suites: `evals/<agent>/*.jsonl`, one case per line. In CI each case replays a recorded model response
 * through the real pipeline (context, redaction, validation, post-processing); `pnpm eval:live` sends the same
 * cases to the configured model and scores them against a threshold.
 */

export interface EvalCase {
  name: string;
  input: unknown;
  org?: string;
  knowledge?: Array<Omit<KnowledgeHit, 'rank' | 'updatedAt'> & { updatedAt?: string }>;
  /** Tests the pipeline's own handling of a bad answer: replayed in CI, skipped in live runs. */
  recordedOnly?: boolean;
  /** The model's answers, in order (tool name and input). */
  recorded: Array<{ tool: string; input: unknown }>;
  expect: {
    ok?: boolean;
    modelCalls?: number;
    /** Subset of the final output that must match exactly. */
    output?: Record<string, unknown>;
    /** Source ids that must be cited. */
    cites?: string[];
    /** Text that must not reach the provider (redaction, data minimisation). */
    requestExcludes?: string[];
    requestIncludes?: string[];
    /** Case-insensitive text the final output must (not) contain. */
    outputIncludes?: string[];
    outputExcludes?: string[];
  };
}

export interface EvalResult {
  name: string;
  passed: boolean;
  failures: string[];
}

export const EVALS_DIR = new URL('../evals/', import.meta.url).pathname;

export function loadEvalCases(agentKey: string, dir = EVALS_DIR): EvalCase[] {
  const folder = join(dir, agentKey);
  return readdirSync(folder)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .flatMap((f) => readFileSync(join(folder, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => materialize(JSON.parse(l)) as EvalCase));
}

/** A `{ "pdfLines": [...] }` object in a case becomes a PDF file block (mediaType and base64 data). */
function materialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(materialize);
  if (value && typeof value === 'object') {
    const { pdfLines, ...rest } = value as Record<string, unknown>;
    if (Array.isArray(pdfLines)) return { ...rest, mediaType: 'application/pdf', data: textPdf(pdfLines as string[]).toString('base64') };
    return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, materialize(v)]));
  }
  return value;
}

/** A database search stand-in: same stems as app.ai_tsquery, ranked by matches. */
export function fixturePort(c: EvalCase): DataPort {
  return {
    org: { id: 'org', name: c.org ?? 'Example Co' },
    async searchKnowledge(query) {
      const terms = searchTerms(query);
      return (c.knowledge ?? [])
        .map((k) => {
          const words = `${k.title} ${k.body}`.toLowerCase().match(/[a-z0-9]+/g) ?? [];
          return { ...k, updatedAt: k.updatedAt ?? '2026-01-01T00:00:00Z', rank: words.filter((w) => terms.some((t) => w.startsWith(t))).length };
        })
        .filter((k) => k.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 6);
    },
  };
}

export function recordedProvider(steps: EvalCase['recorded']): AiProvider {
  let i = 0;
  return {
    name: 'recorded',
    models: { default: 'recorded', fast: 'recorded' },
    async complete(): Promise<CompletionResponse> {
      const step = steps[i++];
      if (!step) throw new Error('No recorded response left');
      return { model: 'recorded', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 }, content: [{ type: 'tool_use', id: `rec_${i}`, name: step.tool, input: step.input }] };
    },
  };
}

function subsetFailures(expected: Record<string, unknown>, actual: unknown, path = 'output'): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(expected)) {
    const a = (actual as Record<string, unknown> | null)?.[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...subsetFailures(v as Record<string, unknown>, a, `${path}.${k}`));
    else if (JSON.stringify(a) !== JSON.stringify(v)) out.push(`${path}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(a)}`);
  }
  return out;
}

/** Every string inside the stored request, so checks read the prompt as text rather than escaped JSON. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(textOf).join('\n');
  return '';
}

export async function runEvalCase(agent: AnyAgent, c: EvalCase, provider?: AiProvider): Promise<EvalResult> {
  let record: RunRecord | null = null;
  const result = await runAgent(agent, c.input, {
    provider: provider ?? recordedProvider(c.recorded),
    gate: { begin: async () => 'run', finish: async (_id, r) => { record = r; } },
    port: fixturePort(c),
    can: () => true,
  });
  const failures: string[] = [];
  const e = c.expect;
  if (result.ok !== (e.ok ?? true)) failures.push(`ok: expected ${e.ok ?? true}, got ${result.ok}${result.ok ? '' : ` (${result.message})`}`);
  if (result.ok) {
    if (e.modelCalls !== undefined && result.modelCalls !== e.modelCalls) failures.push(`modelCalls: expected ${e.modelCalls}, got ${result.modelCalls}`);
    if (e.output) failures.push(...subsetFailures(e.output, result.output));
    const json = JSON.stringify(result.output).toLowerCase();
    for (const s of e.outputIncludes ?? []) if (!json.includes(s.toLowerCase())) failures.push(`output should include “${s}”`);
    for (const s of e.outputExcludes ?? []) if (json.includes(s.toLowerCase())) failures.push(`output should not include “${s}”`);
    const cited = new Set(((result.output as { citations?: Array<{ id: string }> }).citations ?? []).map((x) => x.id));
    for (const id of e.cites ?? []) if (!cited.has(id)) failures.push(`should cite ${id}`);
  }
  const request = textOf((record as RunRecord | null)?.request ?? null);
  for (const s of e.requestExcludes ?? []) if (request.includes(s)) failures.push(`request should not contain “${s}”`);
  for (const s of e.requestIncludes ?? []) if (!request.includes(s)) failures.push(`request should contain “${s}”`);
  return { name: c.name, passed: failures.length === 0, failures };
}
