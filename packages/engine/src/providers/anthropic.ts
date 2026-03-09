import type Anthropic from '@anthropic-ai/sdk';
import type {
  ProviderAdapter,
  ContextMessage,
  CompletionOptions,
  CompletionResult,
  ModelInfo,
  ProviderError,
  AnthropicSessionState,
  CacheMetrics,
} from './types';
import { ProviderErrorImpl } from './types';
import { logProvider, logProviderRequest } from '../core/debug-logger';
import { parseTimeToMs, ensureSession } from './shared/session-utils';
import { mapProviderError } from './shared/error-mapper';
import { RequestTracker } from './shared/request-tracker';
import { isDeprecatedModel } from './shared/deprecated-models';
import { withDeprecationCapture } from './shared/deprecation-warning';

type CacheControlBlock = { type: 'ephemeral' };

type TextBlockWithCache = Anthropic.TextBlockParam & {
  cache_control?: CacheControlBlock;
};

type SystemContentWithCache = Array<TextBlockWithCache>;

type FormattedMessage = { role: 'user' | 'assistant'; content: string | TextBlockWithCache[] };

function formatSystemWithCache(content: string): SystemContentWithCache {
  return [
    {
      type: 'text',
      text: content,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

function addCacheBreakpoint(messages: FormattedMessage[]): FormattedMessage[] {
  if (messages.length === 0) return messages;

  const result = [...messages];
  const lastIndex = result.length - 1;
  // eslint-disable-next-line security/detect-object-injection -- lastIndex from array length
  const lastMessage = result[lastIndex];

  if (!lastMessage) return result;

  const cacheControl: CacheControlBlock = { type: 'ephemeral' };

  if (typeof lastMessage.content === 'string') {
    // eslint-disable-next-line security/detect-object-injection -- lastIndex from array length
    result[lastIndex] = {
      role: lastMessage.role,
      content: [
        {
          type: 'text',
          text: lastMessage.content,
          cache_control: cacheControl,
        },
      ],
    };
  } else {
    const contentParts = [...lastMessage.content];
    const lastPart = contentParts[contentParts.length - 1];
    if (lastPart && lastPart.type === 'text') {
      contentParts[contentParts.length - 1] = {
        ...lastPart,
        cache_control: cacheControl,
      };
    }
    // eslint-disable-next-line security/detect-object-injection -- lastIndex from array length
    result[lastIndex] = { role: lastMessage.role, content: contentParts };
  }

  return result;
}

function extractCacheMetrics(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): CacheMetrics {
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const uncachedTokens = usage.input_tokens - cacheReadTokens;
  const totalInputTokens = usage.input_tokens + cacheReadTokens;

  return {
    cacheReadTokens,
    cacheWriteTokens,
    uncachedTokens,
    cacheHitRate: totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : 0,
    totalTokensSaved: cacheReadTokens,
  };
}

const SESSION_TIMEOUT_DEFAULT_MS = 5 * 60 * 1000;

const ANTHROPIC_MIN_CACHE_TOKENS: Record<string, number> = {
  'claude-opus-4-5-20251101': 4096,
  'claude-sonnet-4-5-20250929': 1024,
  'claude-sonnet-4-20250514': 1024,
  'claude-haiku-4-5-20251001': 4096,
  default: 1024,
};

const ANTHROPIC_MODELS: ModelInfo[] = [
  // Latest Claude 4.6 model
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    defaultNickname: 'Claude Opus 4.6',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  // Claude 4.5 models
  {
    id: 'claude-sonnet-4-5-20250929',
    displayName: 'Claude Sonnet 4.5',
    defaultNickname: 'Claude Sonnet 4.5',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    defaultNickname: 'Claude Haiku 4.5',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'claude-opus-4-5-20251101',
    displayName: 'Claude Opus 4.5',
    defaultNickname: 'Claude Opus 4.5',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    defaultNickname: 'Claude Sonnet 4',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
      supports: { vision: true },
    },
  },
];

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic';

  private client: Anthropic | null = null;
  private anthropicModule: typeof import('@anthropic-ai/sdk') | null = null;
  private requests = new RequestTracker();
  private sessionState: AnthropicSessionState | null = null;
  private availableModels: ModelInfo[] = ANTHROPIC_MODELS;

  constructor(
    private config: {
      apiKey?: string;
      baseUrl?: string;
      timeout?: number;
      enableCaching?: boolean;
    } = {}
  ) {}

  private createSession(modelId: string): AnthropicSessionState {
    const minCacheableTokens =
      // eslint-disable-next-line security/detect-object-injection -- modelId from internal provider config, not user input
      ANTHROPIC_MIN_CACHE_TOKENS[modelId] ?? ANTHROPIC_MIN_CACHE_TOKENS['default'] ?? 1024;

    // Check config first, then env var, default to true
    const cachingEnabled =
      this.config.enableCaching ?? process.env.ANTHROPIC_ENABLE_CACHING !== 'false';

    this.sessionState = {
      sessionId: crypto.randomUUID(),
      modelId,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      lastProcessedMessageIndex: 0,
      contextInitialized: false,
      providerId: 'anthropic',
      cacheMetrics: null,
      cachingEnabled,
      minCacheableTokens,
    };

    logProvider('anthropic', 'session-created', {
      sessionId: this.sessionState.sessionId,
      modelId,
      cachingEnabled,
      minCacheableTokens,
    });

    return this.sessionState;
  }

  getSessionState(): AnthropicSessionState | null {
    return this.sessionState;
  }

  private shouldEnableCaching(messageCount: number): boolean {
    if (this.sessionState?.cachingEnabled !== true) return false;
    return messageCount >= 3;
  }

  private getSessionTimeout(): number {
    return parseTimeToMs(process.env.ANTHROPIC_SESSION_TIMEOUT, SESSION_TIMEOUT_DEFAULT_MS);
  }

  private refreshSession(modelId: string): void {
    this.sessionState = ensureSession(
      this.sessionState,
      modelId,
      this.getSessionTimeout(),
      mid => this.createSession(mid),
      'anthropic'
    );
  }

  async isAvailable(): Promise<boolean> {
    const apiKey = this.config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) return false;

    // Check if the SDK is installed (optional dependency)
    try {
      await import('@anthropic-ai/sdk');
    } catch {
      return false;
    }

    return true;
  }

  async initialize(): Promise<void> {
    const apiKey = this.config.apiKey ?? process.env.ANTHROPIC_API_KEY;

    if (apiKey === undefined || apiKey.length === 0) {
      throw new ProviderErrorImpl({
        code: 'AUTH_FAILED',
        message: 'Anthropic API key not configured',
        retryable: false,
      });
    }

    // Dynamically import Anthropic SDK (may not be installed if using --no-optional)
    let AnthropicConstructor: typeof Anthropic;
    try {
      const module = await import('@anthropic-ai/sdk');
      this.anthropicModule = module;
      AnthropicConstructor = module.default;
    } catch {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Anthropic SDK not installed. Install it with: npm install @anthropic-ai/sdk',
        retryable: false,
      });
    }

    this.client = withDeprecationCapture(
      () =>
        new AnthropicConstructor({
          apiKey,
          baseURL: this.config.baseUrl,
          timeout: this.config.timeout ?? 60000,
        })
    );

    void this.refreshAvailableModels();
  }

  private async refreshAvailableModels(): Promise<void> {
    if (!this.client) return;

    try {
      const apiModels: ModelInfo[] = [];
      const hardcodedMap = new Map(ANTHROPIC_MODELS.map(m => [m.id, m]));

      for await (const model of this.client.models.list()) {
        if (isDeprecatedModel(model.id)) continue;

        const hardcoded = hardcodedMap.get(model.id);

        if (hardcoded) {
          apiModels.push(hardcoded);
        } else {
          apiModels.push({
            id: model.id,
            displayName: model.display_name,
            defaultNickname: model.display_name,
            capabilities: {
              streaming: true,
              maxContextTokens: 200000,
              maxOutputTokens: 8192,
              functionCalling: true,
              supports: { vision: true },
            },
          });
        }
      }

      if (apiModels.length > 0) {
        this.availableModels = apiModels;
        const discoveredModels = apiModels.filter(m => !hardcodedMap.has(m.id));
        logProvider('anthropic', 'models-discovered', {
          total: apiModels.length,
          known: apiModels.filter(m => hardcodedMap.has(m.id)).map(m => m.id),
          discovered: discoveredModels.map(m => m.id),
        });
      }
    } catch (error) {
      logProvider('anthropic', 'models-discovery-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async dispose(): Promise<void> {
    this.requests.cancelAll();
    this.client = null;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.availableModels;
  }

  async isModelAvailable(modelId: string): Promise<boolean> {
    return this.availableModels.some(m => m.id === modelId);
  }

  async streamCompletion(
    modelId: string,
    messages: ContextMessage[],
    onToken: (token: string) => void,
    options?: CompletionOptions
  ): Promise<CompletionResult> {
    if (!this.client) {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_ERROR',
        message: 'Anthropic client not initialized',
        retryable: false,
      });
    }

    // Initialize or update session state
    this.refreshSession(modelId);

    const requestId = crypto.randomUUID();
    const controller = this.requests.track(requestId, options?.signal);

    const startTime = new Date();

    try {
      // Extract system message if present
      const systemMessage = messages.find(m => m.role === 'system');
      const conversationMessages = messages.filter(m => m.role !== 'system');

      // Determine if caching should be enabled
      const enableCaching = this.shouldEnableCaching(messages.length);

      // Format messages with optional cache control
      let formattedMessages: FormattedMessage[] = conversationMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Add cache breakpoint at end of conversation if caching enabled
      if (enableCaching && formattedMessages.length > 0) {
        formattedMessages = addCacheBreakpoint(formattedMessages);
      }

      // Build request with optional cached system prompt
      const requestParams: Anthropic.MessageCreateParams = {
        model: modelId,
        max_tokens: options?.maxTokens ?? 4096,
        messages: formattedMessages as Anthropic.MessageParam[],
        ...(options?.stopSequences && { stop_sequences: options.stopSequences }),
      };

      // Add system prompt with cache control if caching enabled
      if (systemMessage?.content !== undefined && systemMessage.content.length > 0) {
        if (enableCaching) {
          (requestParams as unknown as Record<string, unknown>).system = formatSystemWithCache(
            systemMessage.content
          );
        } else {
          requestParams.system = systemMessage.content;
        }
      }

      const stream = withDeprecationCapture(() => this.client!.messages.stream(requestParams));

      let content = '';

      for await (const event of stream) {
        if (controller.signal.aborted) {
          break;
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const text = event.delta.text;
          content += text;
          onToken(text);
        }
      }

      const finalMessage = await stream.finalMessage();

      // Extract and store cache metrics
      const usage = finalMessage.usage as {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };

      if (enableCaching && this.sessionState) {
        this.sessionState.cacheMetrics = extractCacheMetrics(usage);
        this.sessionState.contextInitialized = true;
        this.sessionState.lastProcessedMessageIndex = messages.length;
      }

      // Log detailed request/response
      logProviderRequest('anthropic', {
        requestId,
        model: modelId,
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : '[multimodal content]',
          ...(m.name !== undefined && m.name.length > 0 ? { name: m.name } : {}),
        })),
        response: content,
        startTime,
        endTime: new Date(),
        usage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
        metadata: {
          sessionId: this.sessionState!.sessionId,
          cachingEnabled: enableCaching,
          cacheHitRate: this.sessionState?.cacheMetrics?.cacheHitRate ?? 0,
        },
      });

      return {
        content,
        finishReason: this.mapStopReason(finalMessage.stop_reason),
        model: modelId,
        usage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
        },
      };
    } catch (error) {
      logProvider('anthropic', 'request-error', {
        sessionId: this.sessionState?.sessionId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw this.mapError(error);
    } finally {
      this.requests.remove(requestId);
    }
  }

  async complete(
    modelId: string,
    messages: ContextMessage[],
    options?: CompletionOptions
  ): Promise<CompletionResult> {
    if (!this.client) {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_ERROR',
        message: 'Anthropic client not initialized',
        retryable: false,
      });
    }

    // Initialize or update session state
    this.refreshSession(modelId);

    const completeRequestId = crypto.randomUUID();
    const startTime = new Date();

    try {
      const systemMessage = messages.find(m => m.role === 'system');
      const conversationMessages = messages.filter(m => m.role !== 'system');

      const enableCaching = this.shouldEnableCaching(messages.length);

      let formattedMessages: FormattedMessage[] = conversationMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      if (enableCaching && formattedMessages.length > 0) {
        formattedMessages = addCacheBreakpoint(formattedMessages);
      }

      const requestParams: Anthropic.MessageCreateParams = {
        model: modelId,
        max_tokens: options?.maxTokens ?? 4096,
        messages: formattedMessages as Anthropic.MessageParam[],
        ...(options?.stopSequences && { stop_sequences: options.stopSequences }),
      };

      if (systemMessage?.content !== undefined && systemMessage.content.length > 0) {
        if (enableCaching) {
          (requestParams as unknown as Record<string, unknown>).system = formatSystemWithCache(
            systemMessage.content
          );
        } else {
          requestParams.system = systemMessage.content;
        }
      }

      const response = await this.client.messages.create(requestParams);

      const textContent = response.content.find(c => c.type === 'text');
      const content = textContent?.type === 'text' ? textContent.text : '';

      const usage = response.usage as {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };

      if (enableCaching && this.sessionState) {
        this.sessionState.cacheMetrics = extractCacheMetrics(usage);
        this.sessionState.contextInitialized = true;
        this.sessionState.lastProcessedMessageIndex = messages.length;
      }

      logProviderRequest('anthropic', {
        requestId: completeRequestId,
        model: modelId,
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : '[multimodal content]',
          ...(m.name !== undefined && m.name.length > 0 ? { name: m.name } : {}),
        })),
        response: content,
        startTime,
        endTime: new Date(),
        usage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
        metadata: {
          sessionId: this.sessionState!.sessionId,
          cachingEnabled: enableCaching,
          cacheHitRate: this.sessionState?.cacheMetrics?.cacheHitRate ?? 0,
        },
      });

      return {
        content,
        finishReason: this.mapStopReason(response.stop_reason),
        model: response.model,
        usage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
        },
      };
    } catch (error) {
      logProvider('anthropic', 'request-error', {
        sessionId: this.sessionState?.sessionId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw this.mapError(error);
    }
  }

  cancelRequest(requestId: string): void {
    this.requests.cancel(requestId);
  }

  private mapStopReason(reason: string | null): CompletionResult['finishReason'] {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      default:
        return 'stop';
    }
  }

  private mapError(error: unknown): ProviderError {
    return mapProviderError(error, err => {
      if (this.anthropicModule && err instanceof this.anthropicModule.default.APIError) {
        return {
          status: err.status,
          message: err.message,
          cause: err,
        };
      }
      return {
        message: err instanceof Error ? err.message : 'Unknown error',
        cause: err instanceof Error ? err : undefined,
      };
    });
  }
}

/**
 * Create an Anthropic adapter instance.
 */
export function createAnthropicAdapter(config?: {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}): AnthropicAdapter {
  return new AnthropicAdapter(config);
}
