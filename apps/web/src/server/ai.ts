import 'server-only';
import { cache } from 'react';
import {
  GateRefusal, providerFromEnv, runAgent, type AgentDef, type AgentResult, type AiProvider, type DataPort, type Gate,
} from '@peoplecore/ai';
import type { Json } from '@peoplecore/db/types';
import type { PermissionKey } from '@peoplecore/shared';
import { sqlNull } from '@/lib/action-state';
import type { OrgContext } from './context';
import { createClient } from './supabase';

/**
 * AI on the server (ADR-009). The provider key is read here only, from the environment; without one every
 * assistant shows "AI isn't set up". Each run goes through the database gate and reads data as the signed-in
 * user (RLS), never with the secret key.
 */

let provider: AiProvider | null | undefined;
function aiProvider(): AiProvider | null {
  if (provider === undefined) {
    provider = providerFromEnv({
      NODE_ENV: process.env.NODE_ENV, AI_PROVIDER: process.env.AI_PROVIDER, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      AI_MODEL: process.env.AI_MODEL, AI_FAST_MODEL: process.env.AI_FAST_MODEL, AI_FALLBACK_MODEL: process.env.AI_FALLBACK_MODEL,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    });
  }
  return provider;
}

/** What the settings page shows about the server's configuration (never the key). */
export function aiServerStatus(): { configured: boolean; label: string } {
  const p = aiProvider();
  if (!p) return { configured: false, label: 'Not set up on this server' };
  if (p.name === 'mock') return { configured: true, label: 'Test provider (fixed answers, no model)' };
  return { configured: true, label: `Anthropic · ${p.models.default}` };
}

export interface AiSettings {
  enabled: boolean;
  monthly_token_budget: number;
  hourly_limit_per_user: number;
}

export const aiSettings = cache(async (orgId: string): Promise<AiSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('ai_settings')
    .select('enabled, monthly_token_budget, hourly_limit_per_user').eq('organization_id', orgId).maybeSingle();
  if (error) throw new Error('Failed to load AI settings');
  return data ?? { enabled: false, monthly_token_budget: 2_000_000, hourly_limit_per_user: 30 };
});

/**
 * Whether this person can use assistants here right now (for showing them; the gate decides). Used by the layout
 * on every page, so a failed read hides the assistants instead of breaking the page.
 */
export async function aiAvailable(ctx: OrgContext): Promise<boolean> {
  if (!ctx.can('ai.use')) return false;
  try {
    return (await aiSettings(ctx.org.id)).enabled;
  } catch {
    return false;
  }
}

export async function aiUsage(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ai_usage', { p_org: orgId });
  if (error) throw new Error('Failed to load AI usage');
  return data;
}

export async function runAi<I, C, O, R>(ctx: OrgContext, agent: AgentDef<I, C, O, R>, input: unknown): Promise<AgentResult<R>> {
  const supabase = await createClient();
  const gate: Gate = {
    async begin(agentKey, permission) {
      const { data, error } = await supabase.rpc('ai_begin_run', { p_org: ctx.org.id, p_agent: agentKey, p_permission: sqlNull(permission) });
      if (error?.code === '22023') throw new GateRefusal(error.message);
      if (error?.code === '42501') throw new GateRefusal('You don’t have permission to use this assistant.');
      if (error || !data) throw new Error('AI gate failed');
      return data;
    },
    async finish(runId, r) {
      const { error } = await supabase.rpc('ai_finish_run', {
        p_run: runId, p_status: r.status, p_model: sqlNull(r.model), p_prompt_version: r.promptVersion,
        p_input_tokens: r.inputTokens, p_output_tokens: r.outputTokens, p_latency_ms: r.latencyMs,
        p_redactions: r.redactions as Json, p_request: sqlNull(r.request as Json), p_response: sqlNull(r.response as Json), p_error: sqlNull(r.error),
      });
      if (error) throw new Error('Failed to record the AI run');
    },
  };
  const port: DataPort = {
    org: { id: ctx.org.id, name: ctx.org.name },
    async searchKnowledge(query) {
      const { data, error } = await supabase.rpc('search_knowledge', { p_org: ctx.org.id, p_query: query, p_limit: 6 });
      if (error) throw new Error('Knowledge search failed');
      return (data ?? []).map((h) => ({
        kind: h.source_kind === 'policy' ? 'policy' : 'article', id: h.source_id, title: h.title, body: h.body, updatedAt: h.updated_at, rank: h.rank,
      }));
    },
  };
  return runAgent(agent, input, { provider: aiProvider(), gate, port, can: (p) => ctx.can(p as PermissionKey) });
}

export async function rateAiRun(runId: string, helpful: boolean, feedback: string | null) {
  const supabase = await createClient();
  return supabase.rpc('rate_ai_run', { p_run: runId, p_helpful: helpful, p_feedback: sqlNull(feedback) });
}
