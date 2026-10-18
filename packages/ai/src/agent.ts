import type { z } from 'zod';
import type { DataPort } from './port.ts';
import type { RedactionKind } from './redact.ts';
import type { InputBlock } from './types.ts';

/**
 * Risk tiers (docs/06-ai-architecture.md): 0 read or summarise, 1 draft, 2 low-risk write. Tier 3, consequential
 * actions (reject a candidate, change pay, approve leave…), has no value here on purpose: no agent or tool can be
 * declared with it, and `defineAgent` and the runner both refuse anything above the agent's own tier.
 */
export type RiskTier = 0 | 1 | 2;

export interface ToolContext {
  port: DataPort;
}

export interface ToolDef<I = never, O = unknown> {
  name: string;
  description: string;
  tier: RiskTier;
  /** Offered to the model only if the actor holds this permission, or one of these (the data functions check again, as the actor). */
  permission: string | readonly string[] | null;
  input: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<O>;
}

/** The tools an agent called during a run, in order, with what they returned. */
export interface RunTrace {
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
}

/** What the development/test provider does next: call a tool, or answer. */
export type MockStep<O> = { tool: string; input: unknown } | { output: O };

export interface AgentDef<I, C, O, R> {
  key: string;
  /** Bumped whenever the prompt, schema or post-processing changes; stored on every run. */
  promptVersion: string;
  maxTier: RiskTier;
  /** Module permission needed besides ai.use (checked by the database gate). */
  permission: string | null;
  model: 'default' | 'fast';
  maxTokens: number;
  /** Validates what the caller passes in. */
  input: z.ZodType<I>;
  /** Identifiers masked in every string of the input before the prompt is built. */
  redactInput: readonly RedactionKind[];
  /** The structured answer the model must give (the `respond` tool). */
  output: z.ZodType<O>;
  outputDescription: string;
  tools: Array<ToolDef<never, unknown>>;
  /** Loads what the task needs, as the actor. */
  load(input: I, port: DataPort): Promise<C>;
  /** An answer without calling the model (nothing to ground it on, say), or null. */
  answerWithoutModel?(input: I, context: C): R | null;
  prompt(input: I, context: C, port: DataPort): { system: string; content: InputBlock[] };
  /** Checks the model's answer against what it was given (citations, allowed fields, tool results) and shapes the result. */
  finalize(output: O, input: I, context: C, trace: RunTrace): R;
  /** Deterministic behaviour for the development/test provider. */
  mock(input: I, context: C, toolResults: Array<{ name: string; output: unknown }>): MockStep<O>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = AgentDef<any, any, any, any>;

export function assertToolAllowed(agent: Pick<AnyAgent, 'key' | 'maxTier'>, tool: Pick<ToolDef, 'name' | 'tier'>) {
  if (!Number.isInteger(tool.tier) || tool.tier < 0 || tool.tier > 2 || tool.tier > agent.maxTier) {
    throw new Error(`Tool ${tool.name} (tier ${tool.tier}) is not allowed for agent ${agent.key} (max tier ${agent.maxTier})`);
  }
}

export function defineAgent<I, C, O, R>(agent: AgentDef<I, C, O, R>): AgentDef<I, C, O, R> {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(agent.key)) throw new Error(`Invalid agent key ${agent.key}`);
  if (agent.maxTier > 2) throw new Error(`Agent ${agent.key}: tier 3 actions are never automated`);
  const names = new Set<string>();
  for (const tool of agent.tools) {
    assertToolAllowed(agent, tool);
    if (tool.name === 'respond' || names.has(tool.name)) throw new Error(`Agent ${agent.key}: duplicate tool ${tool.name}`);
    names.add(tool.name);
  }
  return agent;
}
