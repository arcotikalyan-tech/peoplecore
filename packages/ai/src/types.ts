/**
 * Provider-independent message types (ADR-009). Adapters translate these to and from a vendor API; nothing above
 * the adapter knows which vendor answered.
 */

export type MediaType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export type InputBlock =
  | { type: 'text'; text: string }
  /** A file the model reads directly (a resume, a receipt). Never stored with the run: only its type and size are. */
  | { type: 'file'; mediaType: MediaType; data: string; name?: string };

export interface ToolCall {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type Message =
  | { role: 'user'; content: Array<InputBlock | ToolResult> }
  | { role: 'assistant'; content: Array<{ type: 'text'; text: string } | ToolCall> };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  /** 'any' makes the model call one of the tools (structured output); never free text. */
  toolChoice: { type: 'any' } | { type: 'tool'; name: string };
  maxTokens: number;
}

export interface CompletionResponse {
  model: string;
  content: Array<{ type: 'text'; text: string } | ToolCall>;
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  /** 'anthropic', 'mock' (development and browser tests), 'recorded' (evals). */
  readonly name: string;
  /** The models to use, by purpose. */
  readonly models: { default: string; fast: string };
  complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse>;
}

/** Thrown by adapters after retries and the fallback model have failed. The message is safe to log, not to show. */
export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'ProviderError';
  }
}
