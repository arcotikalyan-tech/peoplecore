import { ProviderError, type AiProvider, type CompletionRequest, type CompletionResponse, type InputBlock, type Message, type ToolResult } from '../types.ts';

/**
 * Anthropic Messages API adapter (plain fetch, no SDK). Retries rate limits, overload and server errors with
 * backoff, then tries the fallback model once. Files go as document (PDF) or image blocks.
 */

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  fastModel: string;
  fallbackModel?: string;
  baseUrl?: string;
  /** Per attempt. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

type Block = Record<string, unknown>;

function inputBlock(b: InputBlock | ToolResult): Block {
  if (b.type === 'text') return { type: 'text', text: b.text };
  if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, is_error: b.isError ?? false };
  const source = { type: 'base64', media_type: b.mediaType, data: b.data };
  return b.mediaType === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
}

function toWire(m: Message): Block {
  if (m.role === 'user') return { role: 'user', content: m.content.map(inputBlock) };
  return {
    role: 'assistant',
    content: m.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'tool_use', id: c.id, name: c.name, input: c.input })),
  };
}

export function anthropicProvider(options: AnthropicOptions): AiProvider {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 90_000;

  async function attempt(req: CompletionRequest, model: string, signal?: AbortSignal): Promise<CompletionResponse> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await doFetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages.map(toWire),
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        tool_choice: req.toolChoice,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).catch((err: unknown) => {
      if (signal?.aborted) throw err;
      throw new ProviderError(`Network error: ${(err as Error).name}`, true);
    });
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const err = new ProviderError(`Provider returned ${res.status}`, RETRYABLE.has(res.status) || res.status === 404);
      (err as ProviderError & { retryAfterMs?: number }).retryAfterMs = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5000) : undefined;
      (err as ProviderError & { status?: number }).status = res.status;
      throw err;
    }
    const body = (await res.json()) as {
      model: string;
      stop_reason: string;
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    return {
      model: body.model,
      stopReason: body.stop_reason,
      usage: {
        inputTokens: body.usage.input_tokens + (body.usage.cache_read_input_tokens ?? 0) + (body.usage.cache_creation_input_tokens ?? 0),
        outputTokens: body.usage.output_tokens,
      },
      content: body.content.flatMap((c): CompletionResponse['content'] => {
        if (c.type === 'text') return [{ type: 'text' as const, text: c.text ?? '' }];
        if (c.type === 'tool_use') return [{ type: 'tool_use' as const, id: c.id ?? '', name: c.name ?? '', input: c.input }];
        return [];
      }),
    };
  }

  return {
    name: 'anthropic',
    models: { default: options.model, fast: options.fastModel },
    async complete(req, signal) {
      const models = [...new Set([req.model, options.fallbackModel].filter((m): m is string => !!m))];
      let last: unknown;
      for (const model of models) {
        for (let i = 0; i < 2; i++) {
          try {
            return await attempt(req, model, signal);
          } catch (err) {
            last = err;
            if (signal?.aborted) throw err;
            if (!(err instanceof ProviderError) || !err.retryable) throw err;
            if ((err as ProviderError & { status?: number }).status === 404) break; // unknown model: go to the fallback
            await sleep((err as ProviderError & { retryAfterMs?: number }).retryAfterMs ?? 500 * 3 ** i);
          }
        }
      }
      throw last instanceof Error ? last : new ProviderError('Provider failed', false);
    },
  };
}
