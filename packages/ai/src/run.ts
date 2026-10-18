import { z } from 'zod';
import { assertToolAllowed, type AgentDef, type MockStep, type RunTrace } from './agent.ts';
import type { DataPort } from './port.ts';
import { redactValue, type RedactionSummary } from './redact.ts';
import type { AiProvider, CompletionRequest, CompletionResponse, InputBlock, Message, ToolCall, ToolResult, ToolSpec } from './types.ts';

/**
 * The AI pipeline (docs/06-ai-architecture.md): policy gate → context (as the actor) → redaction → versioned prompt
 * → provider → validation (one repair attempt) → allowlisted tools → persisted run. Output is a suggestion: callers
 * show it in an AI container and write records only through the module's normal code path.
 */

/** The database gate (ai_begin_run / ai_finish_run). `begin` throws GateRefusal with a message for the user. */
export interface Gate {
  begin(agent: string, permission: string | null): Promise<string>;
  finish(runId: string, record: RunRecord): Promise<void>;
}

export class GateRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateRefusal';
  }
}

export interface RunRecord {
  status: 'succeeded' | 'failed';
  model: string | null;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  redactions: RedactionSummary;
  /** The redacted prompt with files replaced by a placeholder. */
  request: unknown;
  response: unknown;
  error: string | null;
}

export type AgentResult<R> =
  | { ok: true; runId: string; output: R; model: string | null; modelCalls: number; toolCalls: Array<{ name: string; input: unknown }> }
  | { ok: false; reason: 'invalid_input' | 'not_configured' | 'refused' | 'failed'; message: string; runId?: string };

export interface RunDeps {
  provider: AiProvider | null;
  gate: Gate;
  port: DataPort;
  /** Whether the actor holds a permission (to decide which tools to offer). */
  can(permission: string): boolean;
  now?: () => number;
  signal?: AbortSignal;
}

export const NOT_CONFIGURED = 'AI isn’t set up on this server yet. Ask your administrator.';
export const FAILED = 'The assistant couldn’t answer just now. Try again in a minute.';
const MAX_STEPS = 6;

function storable(content: Array<InputBlock | ToolResult>) {
  return content.map((b) =>
    b.type === 'file' ? { type: 'file', mediaType: b.mediaType, bytes: Math.floor((b.data.length * 3) / 4) } : b);
}

function respondSpec(agent: { outputDescription: string; output: z.ZodType }): ToolSpec {
  return { name: 'respond', description: agent.outputDescription, inputSchema: z.toJSONSchema(agent.output, { target: 'draft-7' }) as Record<string, unknown> };
}

/** The development/test provider: follows the agent's own deterministic `mock`. */
function mockProvider<I, C, O>(agent: AgentDef<I, C, O, unknown>, input: I, context: C): AiProvider {
  return {
    name: 'mock',
    models: { default: 'mock', fast: 'mock' },
    async complete(req): Promise<CompletionResponse> {
      const names = new Map<string, string>();
      const results: Array<{ name: string; output: unknown }> = [];
      for (const m of req.messages) {
        for (const c of m.content) {
          if (c.type === 'tool_use') names.set(c.id, c.name);
          if (c.type === 'tool_result' && !c.isError) results.push({ name: names.get(c.toolUseId) ?? '', output: JSON.parse(c.content) });
        }
      }
      const step: MockStep<O> = agent.mock(input, context, results);
      const call: ToolCall = 'output' in step
        ? { type: 'tool_use', id: `mock_${results.length}`, name: 'respond', input: step.output }
        : { type: 'tool_use', id: `mock_${results.length}`, name: step.tool, input: step.input };
      return { model: 'mock', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 }, content: [call] };
    },
  };
}

export async function runAgent<I, C, O, R>(agent: AgentDef<I, C, O, R>, rawInput: unknown, deps: RunDeps): Promise<AgentResult<R>> {
  const parsed = agent.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: 'invalid_input', message: parsed.error.issues[0]?.message ?? 'Check your input.' };
  if (!deps.provider) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED };

  let runId: string;
  try {
    runId = await deps.gate.begin(agent.key, agent.permission);
  } catch (err) {
    if (err instanceof GateRefusal) return { ok: false, reason: 'refused', message: err.message };
    throw err;
  }

  const now = deps.now ?? Date.now;
  const started = now();
  const redactions: RedactionSummary = {};
  const usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let modelCalls = 0;
  const messages: Message[] = [];
  const trace: RunTrace = { toolCalls: [] };
  const calledTools = () => trace.toolCalls.map(({ name, input }) => ({ name, input }));
  let lastResponse: unknown = null;

  const finish = (status: RunRecord['status'], error: string | null, response: unknown) =>
    deps.gate.finish(runId, {
      status, model, promptVersion: agent.promptVersion, ...usage, latencyMs: Math.max(0, now() - started), redactions,
      request: messages.length ? messages.map((m) => ({ role: m.role, content: m.role === 'user' ? storable(m.content) : m.content })) : null,
      response, error,
    });

  try {
    const input = redactValue(parsed.data, agent.redactInput, redactions);
    const context = await agent.load(input, deps.port);
    const direct = agent.answerWithoutModel?.(input, context) ?? null;
    if (direct !== null) {
      await finish('succeeded', null, { direct: true });
      return { ok: true, runId, output: direct, model: null, modelCalls: 0, toolCalls: [] };
    }

    const { system, content } = agent.prompt(input, context, deps.port);
    const provider = deps.provider.name === 'mock' ? mockProvider(agent, input, context) : deps.provider;
    const tools = agent.tools.filter((t) => t.permission === null || (typeof t.permission === 'string' ? [t.permission] : t.permission).some((p) => deps.can(p)));
    const specs: ToolSpec[] = [
      ...tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input, { target: 'draft-7' }) as Record<string, unknown> })),
      respondSpec(agent),
    ];
    messages.push({ role: 'user', content });
    let repaired = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      const req: CompletionRequest = {
        model: provider.models[agent.model], system, messages, tools: specs,
        toolChoice: tools.length ? { type: 'any' } : { type: 'tool', name: 'respond' }, maxTokens: agent.maxTokens,
      };
      const res = await provider.complete(req, deps.signal);
      modelCalls++;
      model = res.model;
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      lastResponse = res.content;
      const calls = res.content.filter((c): c is ToolCall => c.type === 'tool_use');
      if (calls.length === 0) throw new Error(`No tool call (stop: ${res.stopReason})`);
      messages.push({ role: 'assistant', content: res.content });

      const results: ToolResult[] = [];
      for (const call of calls) {
        if (call.name === 'respond') {
          const out = agent.output.safeParse(call.input);
          if (out.success) {
            const result = agent.finalize(out.data, input, context, trace);
            await finish('succeeded', null, call.input);
            return { ok: true, runId, output: result, model, modelCalls, toolCalls: calledTools() };
          }
          if (repaired) throw new Error('Invalid output after a repair attempt');
          repaired = true;
          results.push({
            type: 'tool_result', toolUseId: call.id, isError: true,
            content: `Your answer did not match the schema: ${out.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}. Call respond again with a corrected answer.`,
          });
          continue;
        }
        const tool = tools.find((t) => t.name === call.name);
        if (!tool) {
          results.push({ type: 'tool_result', toolUseId: call.id, isError: true, content: `Unknown tool ${call.name}.` });
          continue;
        }
        assertToolAllowed(agent, tool); // also at definition; checked again in case a registry was altered at runtime
        const toolInput = tool.input.safeParse(call.input);
        if (!toolInput.success) {
          results.push({ type: 'tool_result', toolUseId: call.id, isError: true, content: `Invalid input: ${toolInput.error.issues[0]?.message}` });
          continue;
        }
        try {
          const out = await tool.run(toolInput.data as never, { port: deps.port });
          trace.toolCalls.push({ name: tool.name, input: toolInput.data, output: out });
          results.push({ type: 'tool_result', toolUseId: call.id, content: JSON.stringify(out) });
        } catch {
          results.push({ type: 'tool_result', toolUseId: call.id, isError: true, content: 'The tool failed.' });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    throw new Error('Too many steps');
  } catch (err) {
    await finish('failed', (err as Error).message?.slice(0, 300) ?? 'Failed', lastResponse).catch(() => undefined);
    return { ok: false, reason: 'failed', message: FAILED, runId };
  }
}
