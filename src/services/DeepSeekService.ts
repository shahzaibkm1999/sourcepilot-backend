import { env } from '../config/env';

/**
 * DeepSeekService
 * ---------------
 * Thin wrapper around the DeepSeek Chat API (OpenAI-compatible).
 * Replaces the previous GeminiService.
 *
 * - Base URL:  https://api.deepseek.com/v1
 * - Endpoint:  /chat/completions
 * - Auth:      Bearer <DEEPSEEK_API_KEY>
 *
 * We keep the surface small on purpose (Article VI): no streaming,
 * no function-calling, no client-side rate-limit math. Retries and
 * concurrency live one layer up (DocumentOrchestrator) so MCP and
 * REST share the same retry policy.
 *
 * What this layer DOES own:
 *   - A hard request timeout (AbortController) so a hung fetch
 *     never leaves a row `pending` forever.
 *   - Classification of which errors are retryable. The
 *     orchestrator decides what to do with that signal.
 */

/**
 * Error type returned by `DeepSeekService.chat` when a call fails.
 * `retryable === true` means the orchestrator should back off and
 * retry (transient network / timeout / 429 / 5xx). `false` means
 * the failure is permanent (auth, bad request, empty response).
 */
export class DeepSeekError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, opts: { retryable: boolean; status?: number }) {
    super(message);
    this.name = 'DeepSeekError';
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekChatInput {
  /** The model name, e.g. "deepseek-v4-pro". Defaults to env.DEEPSEEK_MODEL. */
  model?: string;
  /** System prompt (role). Always placed first. */
  system?: string;
  /** The user message. */
  user: string;
  /** Sampling temperature. Defaults to 0.7. */
  temperature?: number;
  /** max_tokens for the *visible* completion. Must be generous — the
   *  reasoning model spends ~200–500 tokens on internal thinking before
   *  producing its final answer. */
  maxOutputTokens?: number;
}

export interface DeepSeekChatResult {
  /** The assistant's visible content. */
  content: string;
  /** The reasoning model may emit a `reasoning_content` field; we keep
   *  it for debugging but don't surface it to callers by default. */
  reasoningContent: string;
  /** Token usage as reported by DeepSeek. */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  };
  /** The actual model name returned by the server (may differ from
   *  the alias we sent — e.g. "deepseek-chat" → "deepseek-v4-flash"). */
  resolvedModel: string;
}

export class DeepSeekService {
  private readonly url = 'https://api.deepseek.com/v1/chat/completions';
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor() {
    this.apiKey = env.DEEPSEEK_API_KEY;
    this.defaultModel = env.DEEPSEEK_MODEL;
  }

  /**
   * Single-shot chat completion.
   * Throws `DeepSeekError` on any non-2xx response, network
   * failure, or timeout. The `retryable` flag tells the caller
   * whether a retry has a reasonable chance of succeeding:
   *   - true:  429, 5xx, network error, abort/timeout
   *   - false: 4xx (other), 401/403 auth, empty response
   */
  async chat(input: DeepSeekChatInput): Promise<DeepSeekChatResult> {
    if (!input.user || input.user.trim().length === 0) {
      throw new DeepSeekError(
        'DeepSeekService.chat: `user` message is required',
        { retryable: false },
      );
    }

    const messages: DeepSeekMessage[] = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.user });

    const body = {
      model: input.model ?? this.defaultModel,
      messages,
      temperature: input.temperature ?? 0.7,
      // Generous default so the reasoning model has room to think
      // and still leave tokens for the final structured answer.
      max_tokens: input.maxOutputTokens ?? 4096,
      // JSON mode would be nice but DeepSeek reasoning models handle
      // "first-line JSON, then markdown body" patterns reliably when
      // we tell them in the system prompt. So we don't force response_format.
    };

    // Hard timeout via AbortController. Without this a hung fetch
    // leaves the document `pending` indefinitely and the frontend
    // poller spins forever.
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      env.DEEPSEEK_TIMEOUT_MS,
    );

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // AbortError (timeout) or low-level network failure.
      // Both are retryable.
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.name === 'TimeoutError');
      const message = isAbort
        ? `DeepSeek API timeout after ${env.DEEPSEEK_TIMEOUT_MS}ms`
        : `DeepSeek API network error: ${err instanceof Error ? err.message : String(err)}`;
      throw new DeepSeekError(message, { retryable: true });
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      const retryable = res.status === 429 || res.status >= 500;
      throw new DeepSeekError(
        `DeepSeek API error (${res.status} ${res.statusText}): ${errText.slice(0, 500)}`,
        { retryable, status: res.status },
      );
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };

    const choice = json.choices?.[0];
    const content = (choice?.message?.content ?? '').toString();
    const reasoningContent = (choice?.message?.reasoning_content ?? '').toString();

    if (!content && !reasoningContent) {
      throw new DeepSeekError(
        'DeepSeekService.chat: empty response (no content and no reasoning). ' +
          'Model may have hit a length cap before producing any output.',
        { retryable: false },
      );
    }

    return {
      content,
      reasoningContent,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
        reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens,
      },
      resolvedModel: json.model ?? body.model,
    };
  }
}
