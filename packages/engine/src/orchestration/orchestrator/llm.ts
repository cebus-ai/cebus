/**
 * OrchestratorLLM — thin abstraction over LangChain and Copilot SDK
 * so the orchestrator middleware can use either as its backing model.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AIRoutingConfig, TokenUsage } from '../types.js';
import { OrchestrationError } from '../types.js';
import { createRoutingLLM } from './dynamic.js';
import { debug } from '../../core/debug-logger.js';
import { resolveCopilotClientConnectionOptions } from '../../providers/shared/copilot-client-options.js';

/** Minimal interface used by the orchestrator middleware (analyzer, evaluator, conversation). */
export interface OrchestratorLLM {
  invoke(systemPrompt: string, userMessage: string): Promise<string>;
  stream(systemPrompt: string, userMessage: string): AsyncIterable<string>;
  invokeJSON(systemPrompt: string, userMessage: string): Promise<string>;
  dispose(): Promise<void>;
  /** Accumulated token usage across all calls. */
  readonly totalUsage: TokenUsage;
}

/** Extract token usage from a LangChain response_metadata object. */
function extractUsageFromMetadata(meta: Record<string, unknown>): { input: number; output: number; cacheRead: number } {
  const usage = (meta['usage'] ?? meta['token_usage'] ?? meta['tokenUsage'] ?? {}) as Record<string, unknown>;
  const input = Number(usage['prompt_tokens'] ?? usage['input_tokens'] ?? usage['promptTokens'] ?? 0) || 0;
  const output = Number(usage['completion_tokens'] ?? usage['output_tokens'] ?? usage['completionTokens'] ?? 0) || 0;
  const cacheRead = Number(usage['cache_read_input_tokens'] ?? usage['cacheReadTokens'] ?? 0) || 0;
  return { input, output, cacheRead };
}

/** Wraps a LangChain BaseChatModel behind the OrchestratorLLM interface. */
class LangChainOrchestratorLLM implements OrchestratorLLM {
  private _totalUsage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  };

  constructor(private readonly llm: BaseChatModel) {}

  get totalUsage(): TokenUsage {
    return {
      inputTokens: this._totalUsage.inputTokens,
      outputTokens: this._totalUsage.outputTokens,
      ...(this._totalUsage.cacheReadTokens > 0 ? { cacheReadTokens: this._totalUsage.cacheReadTokens } : {}),
    };
  }

  private accumulateUsage(meta: Record<string, unknown>): void {
    const u = extractUsageFromMetadata(meta);
    this._totalUsage.inputTokens += u.input;
    this._totalUsage.outputTokens += u.output;
    this._totalUsage.cacheReadTokens += u.cacheRead;
  }

  async invoke(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ]);
    if (response.response_metadata) {
      this.accumulateUsage(response.response_metadata as Record<string, unknown>);
    }
    return typeof response.content === 'string' ? response.content : '';
  }

  async *stream(systemPrompt: string, userMessage: string): AsyncIterable<string> {
    const stream = await this.llm.stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ]);
    let lastMeta: Record<string, unknown> | undefined;
    for await (const chunk of stream) {
      const token = typeof chunk.content === 'string' ? chunk.content : '';
      if (chunk.response_metadata && Object.keys(chunk.response_metadata).length > 0) {
        lastMeta = chunk.response_metadata as Record<string, unknown>;
      }
      if (token) yield token;
    }
    if (lastMeta) {
      this.accumulateUsage(lastMeta);
    }
  }

  async invokeJSON(systemPrompt: string, userMessage: string): Promise<string> {
    try {
      const response = await this.llm.invoke(
        [new SystemMessage(systemPrompt), new HumanMessage(userMessage)],
        { response_format: { type: 'json_object' } } as Record<string, unknown>,
      );
      if (response.response_metadata) {
        this.accumulateUsage(response.response_metadata as Record<string, unknown>);
      }
      return typeof response.content === 'string' ? response.content : '';
    } catch (err) {
      debug('orchestrator-llm', 'json-mode-unsupported-fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      const jsonEnforcedPrompt = systemPrompt +
        '\n\nCRITICAL: You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no text before or after the JSON. Start your response with { and end with }.';
      return this.invoke(jsonEnforcedPrompt, userMessage);
    }
  }

  async dispose(): Promise<void> {
    // LangChain models don't need explicit cleanup
  }
}

/** Uses the Copilot SDK for orchestrator LLM calls (chat-only, no tools). */
class CopilotOrchestratorLLM implements OrchestratorLLM {
  private session: import('@github/copilot-sdk').CopilotSession | null = null;
  private client: Record<string, unknown> | null = null;

  get totalUsage(): TokenUsage {
    return { inputTokens: 0, outputTokens: 0 };
  }

  constructor(private readonly model: string) {}

  async invoke(systemPrompt: string, userMessage: string): Promise<string> {
    const session = await this.getOrCreateSession();
    const typedSession = session as { on: (handler: (event: { type: string; data: Record<string, unknown> }) => void) => () => void; send: (payload: Record<string, unknown>) => Promise<unknown>; destroy: () => Promise<void> };
    const prompt = `[System Instructions]\n${systemPrompt}\n\n[User Message]\n${userMessage}`;

    let fullContent = '';
    let resolved = false;

    return new Promise<string>((resolve, reject) => {
      // Assigned synchronously below — always set before any async callback fires
      // eslint-disable-next-line prefer-const -- definite assignment via pattern below
      let unsubscribe!: () => void;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          unsubscribe();
          reject(new OrchestrationError('TIMEOUT', 'Copilot orchestrator LLM timed out after 30s'));
        }
      }, 30000);

      unsubscribe = typedSession.on(event => {
        if (resolved) return;

        if (event.type === 'assistant.message_delta') {
          const delta = event.data['deltaContent'] as string | undefined;
          if (delta !== undefined && delta.length > 0) fullContent += delta;
        }

        if (event.type === 'assistant.message') {
          const content = event.data['content'] as string | undefined;
          if (content !== undefined && content.length > 0) fullContent = content;
        }

        if (event.type === 'session.idle') {
          clearTimeout(timer);
          unsubscribe();
          if (!resolved) {
            resolved = true;
            resolve(fullContent);
          }
        }

        if (event.type === 'session.error') {
          clearTimeout(timer);
          unsubscribe();
          if (!resolved) {
            resolved = true;
            const errMsg = event.data.message ?? 'Unknown Copilot error';
            if (fullContent.length > 0) {
              resolve(fullContent);
            } else {
              reject(
                new OrchestrationError(
                  'WORKER_EXECUTION',
                  `Copilot orchestrator LLM error: ${errMsg}`
                )
              );
            }
          }
        }
      });

      typedSession.send({ prompt }).catch((err: unknown) => {
        clearTimeout(timer);
        unsubscribe();
        if (!resolved) {
          resolved = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  async invokeJSON(systemPrompt: string, userMessage: string): Promise<string> {
    return this.invoke(systemPrompt, userMessage);
  }

  async *stream(systemPrompt: string, userMessage: string): AsyncIterable<string> {
    const session = await this.getOrCreateSession();
    const typedSession = session as { on: (handler: (event: { type: string; data: Record<string, unknown> }) => void) => () => void; send: (payload: Record<string, unknown>) => Promise<unknown>; destroy: () => Promise<void> };
    const prompt = `[System Instructions]\n${systemPrompt}\n\n[User Message]\n${userMessage}`;

    type QueueItem = { token: string } | { done: true } | { error: Error };
    const queue: QueueItem[] = [];
    let resolver: (() => void) | null = null;
    let streamDone = false;

    const push = (item: QueueItem): void => {
      queue.push(item);
      resolver?.();
    };

    // eslint-disable-next-line prefer-const -- definite assignment via pattern below
    let unsubscribe!: () => void;

    const timer = setTimeout(() => {
      if (!streamDone) {
        streamDone = true;
        unsubscribe();
        push({
          error: new OrchestrationError(
            'TIMEOUT',
            'Copilot orchestrator LLM stream timed out after 30s'
          ),
        });
      }
    }, 30000);

    unsubscribe = typedSession.on(event => {
      if (streamDone) return;

      if (event.type === 'assistant.message_delta') {
        const delta = event.data['deltaContent'] as string | undefined;
        if (delta !== undefined && delta.length > 0) push({ token: delta });
      }

      if (event.type === 'session.idle') {
        clearTimeout(timer);
        unsubscribe();
        streamDone = true;
        push({ done: true });
      }

      if (event.type === 'session.error') {
        clearTimeout(timer);
        unsubscribe();
        if (!streamDone) {
          streamDone = true;
          const errMsg = (event.data['message'] as string) ?? 'Unknown Copilot error';
          push({
            error: new OrchestrationError(
              'WORKER_EXECUTION',
              `Copilot orchestrator LLM stream error: ${errMsg}`
            ),
          });
        }
      }
    });

    typedSession.send({ prompt }).catch((err: unknown) => {
      clearTimeout(timer);
      unsubscribe();
      if (!streamDone) {
        streamDone = true;
        push({ error: err instanceof Error ? err : new Error(String(err)) });
      }
    });

    while (true) {
      if (queue.length === 0) {
        await new Promise<void>(r => {
          resolver = r;
        });
        resolver = null;
      }
      const item = queue.shift();
      if (!item) continue;
      if ('done' in item) return;
      if ('error' in item) throw item.error;
      yield item.token;
    }
  }

  async dispose(): Promise<void> {
    if (this.session !== null && this.session !== undefined) {
      try {
        await this.session.destroy();
      } catch (error) {
        debug('orchestrator-llm', 'copilot-session-destroy-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.session = null;
    }
    if (this.client !== null && this.client !== undefined) {
      try {
        await (this.client as { stop(): Promise<void> }).stop();
      } catch (error) {
        debug('orchestrator-llm', 'copilot-client-stop-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.client = null;
    }
  }

  private async getOrCreateSession(): Promise<unknown> {
    if (this.session !== null && this.session !== undefined) return this.session;

    const copilotSdk = await import('@github/copilot-sdk');
    const CopilotClient =
      (copilotSdk as Record<string, unknown>)['CopilotClient'] ??
      (copilotSdk as Record<string, unknown>)['default'];

    if (CopilotClient === null || CopilotClient === undefined) {
      throw new OrchestrationError(
        'WORKER_EXECUTION',
        'Failed to import CopilotClient from @github/copilot-sdk'
      );
    }

    const clientOptions = {
      clientName: 'cebus',
      ...resolveCopilotClientConnectionOptions(process.env, message => {
        debug('orchestrator-llm', 'copilot-client-options-warning', { message });
      }),
    };
    this.client = new (CopilotClient as new (
      opts?: Record<string, unknown>
    ) => Record<string, unknown>)(clientOptions);

    await (this.client as { start(): Promise<void> }).start();

    const createSession = (this.client as Record<string, unknown>)['createSession'] as
      | ((config: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (!createSession) {
      throw new OrchestrationError(
        'WORKER_EXECUTION',
        'CopilotClient.createSession is not available'
      );
    }

    this.session = await createSession.call(this.client, {
      model: this.model,
      streaming: true,
      availableTools: [],
      onPermissionRequest: () => ({ kind: 'approved' }),
    }) as import('@github/copilot-sdk').CopilotSession;

    debug('orchestrator-llm', 'copilot-session-created', { model: this.model });
    return this.session;
  }
}

/**
 * Create an OrchestratorLLM from the middleware config.
 * Supports all LangChain providers + Copilot SDK.
 */
export async function createOrchestratorLLM(config?: AIRoutingConfig): Promise<OrchestratorLLM> {
  const providerType = config?.provider?.type ?? 'ollama';
  const modelId = config?.model ?? (providerType === 'copilot' ? 'gpt-4o' : 'llama3.2');
  debug('orchestrator-llm', 'creating', { provider: providerType, model: modelId });

  if (providerType === 'copilot') {
    const model = config?.model ?? 'gpt-4o';
    return new CopilotOrchestratorLLM(model);
  }

  // All other providers use LangChain
  const baseChatModel = await createRoutingLLM(config);
  return new LangChainOrchestratorLLM(baseChatModel);
}
