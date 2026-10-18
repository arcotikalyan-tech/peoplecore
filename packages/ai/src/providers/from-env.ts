import type { AiProvider } from '../types.ts';
import { anthropicProvider } from './anthropic.ts';

/**
 * The provider configured on this server, or null ("AI isn't set up"): the adapter fails closed and never
 * invents credentials. Keys come from the environment (or a secret store that fills it).
 *
 *   AI_PROVIDER         anthropic | mock   (default: anthropic when ANTHROPIC_API_KEY is set)
 *   ANTHROPIC_API_KEY   server only
 *   AI_MODEL            default claude-opus-5-5
 *   AI_FAST_MODEL       default claude-haiku-5-5   (extraction from documents)
 *   AI_FALLBACK_MODEL   default claude-sonnet-5-5  (tried once when the main model fails)
 *   ANTHROPIC_BASE_URL  optional (a gateway)
 *
 * `mock` answers deterministically without a model, for development and browser tests. It is refused in production.
 */
export const MOCK_PROVIDER: AiProvider = {
  name: 'mock',
  models: { default: 'mock', fast: 'mock' },
  complete() {
    throw new Error('The mock provider is driven by each agent (runAgent)');
  },
};

export function providerFromEnv(env: Record<string, string | undefined>): AiProvider | null {
  const kind = env.AI_PROVIDER?.trim() || (env.ANTHROPIC_API_KEY ? 'anthropic' : '');
  if (kind === 'mock') return env.NODE_ENV === 'production' ? null : MOCK_PROVIDER;
  if (kind === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return anthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL?.trim() || 'claude-opus-5-5',
      fastModel: env.AI_FAST_MODEL?.trim() || 'claude-haiku-5-5',
      fallbackModel: env.AI_FALLBACK_MODEL?.trim() || 'claude-sonnet-5-5',
      baseUrl: env.ANTHROPIC_BASE_URL?.trim() || undefined,
    });
  }
  return null;
}
