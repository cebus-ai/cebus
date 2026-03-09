import type OpenAI from 'openai';
import type {
  ProviderAdapter,
  ContextMessage,
  CompletionOptions,
  CompletionResult,
  ModelInfo,
  ProviderError,
  OpenAISessionState,
} from './types';
import { ProviderErrorImpl } from './types';
import { logProvider, logProviderRequest } from '../core/debug-logger';
import { parseTimeToMs, ensureSession } from './shared/session-utils';
import { mapProviderError } from './shared/error-mapper';
import { RequestTracker } from './shared/request-tracker';
import { isDeprecatedModel } from './shared/deprecated-models';

const SESSION_TIMEOUT_DEFAULT_MS = 30 * 60 * 1000;

const MODELS_WITH_NEW_TOKEN_PARAM = new Set([
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o1',
  'o1-mini',
  'o1-preview',
]);

const OPENAI_NON_CHAT_KEYWORDS = [
  'deep-research',
  'computer-use',
  'realtime',
  'audio',
  'dall-e',
  'chatgpt-image',
  'whisper',
  'tts',
  'embedding',
  'moderation',
  'search-preview',
  'babbage',
  'davinci',
  'curie',
  'ada',
] as const;

const OPENAI_NON_CHAT_TYPE_LABELS: Record<string, string> = {
  'deep-research': 'deep research (Responses API only)',
  'computer-use': 'computer use (Responses API only)',
  realtime: 'realtime audio/voice',
  audio: 'audio input/output',
  'dall-e': 'image generation',
  'chatgpt-image': 'image generation',
  'search-preview': 'experimental search (incompatible parameters)',
  whisper: 'audio transcription',
  tts: 'text-to-speech',
  embedding: 'text embedding',
  moderation: 'content moderation',
  babbage: 'legacy completions',
  davinci: 'legacy completions',
  curie: 'legacy completions',
  ada: 'legacy completions',
};

function isNonChatModel(modelId: string): string | undefined {
  const lower = modelId.toLowerCase();
  return OPENAI_NON_CHAT_KEYWORDS.find(kw => lower.includes(kw));
}

const OPENAI_MODELS: ModelInfo[] = [
  // Latest GPT-5 models
  {
    id: 'gpt-5.4',
    displayName: 'GPT-5.4',
    defaultNickname: 'GPT 5.4',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'gpt-5.3-codex',
    displayName: 'GPT-5.3 Codex',
    defaultNickname: 'GPT 5.3 Codex',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'gpt-5.2',
    displayName: 'GPT-5.2',
    defaultNickname: 'GPT 5.2',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'gpt-5.1',
    displayName: 'GPT-5.1',
    defaultNickname: 'GPT 5.1',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  // GPT-4.1 models
  {
    id: 'gpt-4.1',
    displayName: 'GPT-4.1',
    defaultNickname: 'GPT 4.1',
    capabilities: {
      streaming: true,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    defaultNickname: 'GPT 4.1 Mini',
    capabilities: {
      streaming: true,
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
      functionCalling: true,
      supports: { vision: true },
    },
  },
];

export class OpenAIAdapter implements ProviderAdapter {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';

  private client: OpenAI | null = null;
  private openaiModule: typeof import('openai') | null = null;
  private requests = new RequestTracker();
  private sessionState: OpenAISessionState | null = null;
  private availableModels: ModelInfo[] = OPENAI_MODELS;

  constructor(
    private config: {
      apiKey?: string;
      baseUrl?: string;
      timeout?: number;
      enableServerState?: boolean;
    } = {}
  ) {}

  private createSession(modelId: string): OpenAISessionState {
    // Check config first, then env var, default to true
    const serverStateEnabled =
      this.config.enableServerState ?? process.env.OPENAI_ENABLE_SERVER_STATE !== 'false';

    this.sessionState = {
      sessionId: crypto.randomUUID(),
      modelId,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      lastProcessedMessageIndex: 0,
      contextInitialized: false,
      providerId: 'openai',
      serverStateEnabled,
    };

    logProvider('openai', 'session-created', {
      sessionId: this.sessionState.sessionId,
      modelId,
      serverStateEnabled,
    });

    return this.sessionState;
  }

  getSessionState(): OpenAISessionState | null {
    return this.sessionState;
  }

  private getSessionTimeout(): number {
    return parseTimeToMs(process.env.OPENAI_SESSION_TIMEOUT, SESSION_TIMEOUT_DEFAULT_MS);
  }

  async isAvailable(): Promise<boolean> {
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) return false;

    // Check if the SDK is installed (optional dependency)
    try {
      await import('openai');
    } catch {
      return false;
    }

    return true;
  }

  async initialize(): Promise<void> {
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY;

    if (apiKey === undefined || apiKey.length === 0) {
      throw new ProviderErrorImpl({
        code: 'AUTH_FAILED',
        message: 'OpenAI API key not configured',
        retryable: false,
      });
    }

    // Dynamically import OpenAI SDK (may not be installed if using --no-optional)
    let OpenAIConstructor: typeof OpenAI;
    try {
      const module = await import('openai');
      this.openaiModule = module;
      OpenAIConstructor = module.default;
    } catch {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'OpenAI SDK not installed. Install it with: npm install openai',
        retryable: false,
      });
    }

    this.client = new OpenAIConstructor({
      apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout ?? 60000,
    });

    void this.refreshAvailableModels();
  }

  private async refreshAvailableModels(): Promise<void> {
    if (!this.client) return;

    try {
      const apiModels: ModelInfo[] = [];
      const hardcodedMap = new Map(OPENAI_MODELS.map(m => [m.id, m]));

      for await (const model of this.client.models.list()) {
        if (!/^(gpt-|o[1-9]|chatgpt-4o)/i.test(model.id)) {
          continue;
        }

        if (isNonChatModel(model.id) !== undefined) {
          continue;
        }

        if (isDeprecatedModel(model.id)) continue;

        const hardcoded = hardcodedMap.get(model.id);

        if (hardcoded) {
          apiModels.push(hardcoded);
        } else {
          apiModels.push({
            id: model.id,
            displayName: model.id.replace(/^gpt/i, 'GPT'),
            defaultNickname: model.id.split('-').slice(0, 2).join(' ').toUpperCase(),
            capabilities: {
              streaming: true,
              maxContextTokens: 128000,
              maxOutputTokens: 4096,
              functionCalling: true,
              supports: { vision: true },
            },
          });
        }
      }

      if (apiModels.length > 0) {
        this.availableModels = apiModels;
        const discoveredModels = apiModels.filter(m => !hardcodedMap.has(m.id));
        logProvider('openai', 'models-discovered', {
          total: apiModels.length,
          known: apiModels.filter(m => hardcodedMap.has(m.id)).map(m => m.id),
          discovered: discoveredModels.map(m => m.id),
        });
      }
    } catch (error) {
      logProvider('openai', 'models-discovery-failed', {
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
    if (isNonChatModel(modelId) !== undefined) {
      return false;
    }
    return this.availableModels.some(m => m.id === modelId);
  }

  private rejectNonChatModel(modelId: string): void {
    const matchedKeyword = isNonChatModel(modelId);
    if (matchedKeyword !== undefined) {
      // eslint-disable-next-line security/detect-object-injection -- matchedKeyword from known constant array
      const modelType = OPENAI_NON_CHAT_TYPE_LABELS[matchedKeyword] ?? 'non-chat';
      throw new ProviderErrorImpl({
        code: 'INVALID_MODEL',
        message: `Model '${modelId}' is a ${modelType} model and cannot be used for chat. Please remove it with: /remove ${modelId}`,
        retryable: false,
      });
    }
  }

  private refreshSession(modelId: string): void {
    this.sessionState = ensureSession(
      this.sessionState,
      modelId,
      this.getSessionTimeout(),
      mid => this.createSession(mid),
      'openai'
    );
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
        message: 'OpenAI client not initialized',
        retryable: false,
      });
    }

    this.rejectNonChatModel(modelId);
    this.refreshSession(modelId);

    const requestId = crypto.randomUUID();
    const controller = this.requests.track(requestId, options?.signal);
    const startTime = new Date();

    try {
      // Newer models use max_completion_tokens instead of max_tokens
      const useNewTokenParam = MODELS_WITH_NEW_TOKEN_PARAM.has(modelId);
      const tokenParam =
        options?.maxTokens !== undefined
          ? useNewTokenParam
            ? { max_completion_tokens: options.maxTokens }
            : { max_tokens: options.maxTokens }
          : {};

      // Build request params with optional server state storage
      const requestParams: OpenAI.ChatCompletionCreateParams = {
        model: modelId,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          // OpenAI requires name to be alphanumeric with underscores only (no spaces/dots)
          ...(m.name !== undefined && m.name.length > 0
            ? { name: m.name.replace(/[^a-zA-Z0-9_]/g, '_') }
            : {}),
        })) as OpenAI.ChatCompletionMessageParam[],
        stream: true,
        ...tokenParam,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.stopSequences && { stop: options.stopSequences }),
        // Enable server-side state storage for implicit caching
        ...(this.sessionState?.serverStateEnabled === true ? { store: true } : {}),
      };

      const stream = await this.client.chat.completions.create(requestParams);

      let content = '';
      let finishReason: CompletionResult['finishReason'] = 'stop';

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          finishReason = 'cancelled';
          break;
        }

        const delta = chunk.choices[0]?.delta?.content;
        if (delta !== undefined && delta !== null && delta.length > 0) {
          content += delta;
          onToken(delta);
        }

        if (
          chunk.choices[0]?.finish_reason !== undefined &&
          chunk.choices[0]?.finish_reason !== null
        ) {
          finishReason = this.mapFinishReason(chunk.choices[0].finish_reason);
        }
      }

      if (this.sessionState) {
        this.sessionState.contextInitialized = true;
        this.sessionState.lastProcessedMessageIndex = messages.length;
      }

      // Log detailed request/response
      logProviderRequest('openai', {
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
        metadata: {
          sessionId: this.sessionState!.sessionId,
          serverStateEnabled: this.sessionState!.serverStateEnabled,
        },
      });

      return {
        content,
        finishReason,
        model: modelId,
      };
    } catch (error) {
      logProvider('openai', 'request-error', {
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
        message: 'OpenAI client not initialized',
        retryable: false,
      });
    }

    this.rejectNonChatModel(modelId);
    this.refreshSession(modelId);

    const completeRequestId = crypto.randomUUID();
    const startTime = new Date();

    try {
      const useNewTokenParam = MODELS_WITH_NEW_TOKEN_PARAM.has(modelId);
      const tokenParam =
        options?.maxTokens !== undefined
          ? useNewTokenParam
            ? { max_completion_tokens: options.maxTokens }
            : { max_tokens: options.maxTokens }
          : {};

      const requestParams: OpenAI.ChatCompletionCreateParams = {
        model: modelId,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.name !== undefined && m.name.length > 0
            ? { name: m.name.replace(/[^a-zA-Z0-9_]/g, '_') }
            : {}),
        })) as OpenAI.ChatCompletionMessageParam[],
        ...tokenParam,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.stopSequences && { stop: options.stopSequences }),
        ...(this.sessionState?.serverStateEnabled === true ? { store: true } : {}),
      };

      const response = await this.client.chat.completions.create(requestParams);

      const choice = response.choices[0];
      const content = choice?.message?.content ?? '';

      if (this.sessionState) {
        this.sessionState.contextInitialized = true;
        this.sessionState.lastProcessedMessageIndex = messages.length;
      }

      // Log detailed request/response
      const cachedTokens = (
        response.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined
      )?.prompt_tokens_details?.cached_tokens;
      logProviderRequest('openai', {
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
        ...(response.usage
          ? {
              usage: {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
                ...(cachedTokens !== undefined ? { cachedTokens } : {}),
              },
            }
          : {}),
        metadata: {
          sessionId: this.sessionState!.sessionId,
          serverStateEnabled: this.sessionState!.serverStateEnabled,
        },
      });

      return {
        content,
        finishReason: this.mapFinishReason(choice?.finish_reason),
        model: response.model,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      logProvider('openai', 'request-error', {
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

  private mapFinishReason(reason: string | null | undefined): CompletionResult['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      default:
        return 'stop';
    }
  }

  private mapError(error: unknown): ProviderError {
    return mapProviderError(error, err => {
      if (this.openaiModule && err instanceof this.openaiModule.default.APIError) {
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
 * Create an OpenAI adapter instance.
 */
export function createOpenAIAdapter(config?: {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}): OpenAIAdapter {
  return new OpenAIAdapter(config);
}
