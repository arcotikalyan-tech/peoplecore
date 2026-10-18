import { describe, expect, it } from 'vitest';
import { anthropicProvider, providerFromEnv, type CompletionRequest } from '../src/index.ts';

const request: CompletionRequest = {
  model: 'main-model',
  system: 'Be brief.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Read this' }, { type: 'file', mediaType: 'application/pdf', data: 'JVBERi0=' }, { type: 'file', mediaType: 'image/png', data: 'iVBORw==' }] }],
  tools: [{ name: 'respond', description: 'Answer', inputSchema: { type: 'object' } }],
  toolChoice: { type: 'tool', name: 'respond' },
  maxTokens: 500,
};

const ok = (model: string) => new Response(JSON.stringify({
  model, stop_reason: 'tool_use', usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 10 },
  content: [{ type: 'text', text: 'thinking aloud' }, { type: 'tool_use', id: 'tu_1', name: 'respond', input: { a: 1 } }],
}), { status: 200 });

function fakeFetch(responses: Array<() => Response>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const make = (f: typeof fetch) =>
  anthropicProvider({ apiKey: 'test-key', model: 'main-model', fastModel: 'fast-model', fallbackModel: 'backup-model', fetch: f, sleep: async () => {} });

describe('anthropic adapter', () => {
  it('sends the Messages API format: files as document and image blocks, forced tool choice', async () => {
    const { fn, calls } = fakeFetch([() => ok('main-model')]);
    const res = await make(fn).complete(request);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.headers).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' });
    expect(calls[0]!.body).toEqual({
      model: 'main-model', max_tokens: 500, system: 'Be brief.',
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Read this' },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' } },
      ] }],
      tools: [{ name: 'respond', description: 'Answer', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'respond' },
    });
    expect(res).toEqual({
      model: 'main-model', stopReason: 'tool_use', usage: { inputTokens: 130, outputTokens: 30 },
      content: [{ type: 'text', text: 'thinking aloud' }, { type: 'tool_use', id: 'tu_1', name: 'respond', input: { a: 1 } }],
    });
  });

  it('retries overload, then falls back to the backup model', async () => {
    const { fn, calls } = fakeFetch([() => new Response('', { status: 529 }), () => new Response('', { status: 500 }), () => ok('backup-model')]);
    const res = await make(fn).complete(request);
    expect(calls.map((c) => c.body.model)).toEqual(['main-model', 'main-model', 'backup-model']);
    expect(res.model).toBe('backup-model');
  });

  it('does not retry a bad request', async () => {
    const { fn, calls } = fakeFetch([() => new Response('{"error":{}}', { status: 400 }), () => ok('main-model')]);
    await expect(make(fn).complete(request)).rejects.toThrow('Provider returned 400');
    expect(calls).toHaveLength(1);
  });

  it('gives up after the backup model fails too', async () => {
    const fail = () => new Response('', { status: 503 });
    const { fn, calls } = fakeFetch([fail, fail, fail, fail]);
    await expect(make(fn).complete(request)).rejects.toThrow('Provider returned 503');
    expect(calls).toHaveLength(4);
  });
});

describe('provider configuration', () => {
  it('fails closed without a key, and refuses the mock provider in production', () => {
    expect(providerFromEnv({})).toBeNull();
    expect(providerFromEnv({ AI_PROVIDER: 'anthropic' })).toBeNull();
    expect(providerFromEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'production' })).toBeNull();
    expect(providerFromEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'development' })?.name).toBe('mock');
    const p = providerFromEnv({ ANTHROPIC_API_KEY: 'k' });
    expect(p?.name).toBe('anthropic');
    expect(p?.models).toEqual({ default: 'claude-opus-5-5', fast: 'claude-haiku-5-5' });
    expect(providerFromEnv({ ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-sonnet-5-5' })?.models.default).toBe('claude-sonnet-5-5');
  });
});
