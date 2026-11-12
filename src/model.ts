import { config, modelEndpoint, modelExtraBody } from './config.ts';

export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null;
  tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string; reasoning_details?: unknown[];
};
export type Complete = (messages: ChatMessage[], tools: ToolDefinition[], signal: AbortSignal) => Promise<ChatMessage>;

export class ModelRequestError extends Error {
  code: string;
  status?: number;
  retryable: boolean;
  constructor(code: 'http' | 'timeout' | 'network' | 'invalid_response', status?: number) {
    const message = code === 'timeout' ? 'The model took too long to respond. Please retry.'
      : code === 'network' ? 'Couldn’t connect to the model provider. Check the connection and retry.'
      : code === 'invalid_response' ? 'The model provider returned an incomplete response. Please retry.'
      : status === 401 || status === 403 ? 'The model provider rejected the API key or access. Check your model key in agent settings.'
      : status === 402 ? 'The model provider requires credits. Check your OpenRouter balance and API key spending limit.'
      : status === 429 ? 'The model provider is rate limiting requests. Wait a moment, then retry.'
      : status === 408 || (status && status >= 500) ? `The model provider is temporarily unavailable (HTTP ${status}). Please retry.`
      : `The model provider rejected this request (HTTP ${status}). Check the selected model and its tool support.`;
    super(message); this.name = 'ModelRequestError'; this.code = code; this.status = status;
    this.retryable = code === 'network' || code === 'timeout' || (code === 'http' && (status === 408 || Boolean(status && status >= 500)));
  }
}

// OpenAI-compatible wire format; defaults to Qwen weights hosted through OpenRouter.
export const complete: Complete = async (messages, tools, signal) => {
  try {
    const response = await fetch(modelEndpoint(), {
      method: 'POST', headers: { Authorization: `Bearer ${config.modelKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, messages, max_tokens: 1800, stream: false,
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}), ...modelExtraBody() }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), redirect: 'error',
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new ModelRequestError('http', response.status); }
    const data = await response.json() as { choices?: { message?: ChatMessage }[] };
    const message = data.choices?.[0]?.message;
    if (!message || (message.content != null && typeof message.content !== 'string') ||
      (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 8 ||
        message.tool_calls.some(call => !call || typeof call.id !== 'string' || call.type !== 'function' ||
          typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string')))) {
      throw new ModelRequestError('invalid_response');
    }
    // Retain reasoning_content for compatible providers that require it on tool turns.
    return { role: 'assistant', content: message.content || null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
      ...(typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}),
      ...(Array.isArray(message.reasoning_details) ? { reasoning_details: message.reasoning_details } : {}) };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ModelRequestError) throw error;
    if (error instanceof Error && error.name === 'TimeoutError') throw new ModelRequestError('timeout');
    if (error instanceof TypeError) throw new ModelRequestError('network');
    throw new ModelRequestError('invalid_response');
  }
};
