import type { GoogleGenAI } from '@google/genai';
import type {
  ProviderAdapter,
  ContextMessage,
  CompletionOptions,
  CompletionResult,
  ModelInfo,
  GeminiSessionState,
} from './types';
import { ProviderErrorImpl } from './types';
import { logProvider, logProviderRequest } from '../core/debug-logger';
import { parseTimeToMs, ensureSession } from './shared/session-utils';
import { mapErrorByMessage } from './shared/error-mapper';
import { RequestTracker } from './shared/request-tracker';

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

function convertMessagesToGemini(messages: ContextMessage[]): {
  contents: GeminiContent[];
  systemInstruction: string | undefined;
} {
  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  const contents: GeminiContent[] = conversationMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const systemInstruction = systemMessage?.content;

  return { contents, systemInstruction };
}

const DEFAULT_SESSION_TIMEOUT_MS = 60 * 60 * 1000;

const GEMINI_MODELS: ModelInfo[] = [
  // Gemini 3.1 preview
  {
    id: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro Preview',
    defaultNickname: 'Gemini 3.1 Pro',
    capabilities: {
      streaming: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'gemini-3.1-flash-preview',
    displayName: 'Gemini 3.1 Flash Preview',
    defaultNickname: 'Gemini 3.1 Flash',
    capabilities: {
      streaming: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  // Gemini 3 preview models
  {
    id: 'gemini-3-pro-preview',
    displayName: 'Gemini 3 Pro Preview',
    defaultNickname: 'Gemini 3 Pro',
    capabilities: {
      streaming: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash Preview',
    defaultNickname: 'Gemini 3 Flash',
    capabilities: {
      streaming: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  // Gemini 2.5 models
  {
    id: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    defaultNickname: 'Gemini Pro',
    capabilities: {
      streaming: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    defaultNickname: 'Gemini Flash',
    capabilities: {
      streaming: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      supports: { vision: true },
    },
  },
  // Gemini 2.0 models
  {
    id: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    defaultNickname: 'Gemini 2.0',
    capabilities: {
      streaming: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 8192,
      functionCalling: true,
      supports: { vision: true },
    },
  },
];

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini';
  readonly displayName = 'Google Gemini';

  private client: GoogleGenAI | null = null;
  private requests = new RequestTracker();
  private sessionState: GeminiSessionState | null = null;
  private availableModels: ModelInfo[] = GEMINI_MODELS;

  constructor(
    private config: {
      apiKey?: string;
      timeout?: number;
    } = {}
  ) {}

  private createSession(modelId: string): GeminiSessionState {
    this.sessionState = {
      sessionId: crypto.randomUUID(),
      modelId,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      lastProcessedMessageIndex: 0,
      contextInitialized: false,
      providerId: 'gemini',
    };

    logProvider('gemini', 'session-created', {
      sessionId: this.sessionState.sessionId,
      modelId,
    });

    return this.sessionState;
  }

  getSessionState(): GeminiSessionState | null {
    return this.sessionState;
  }

  async isAvailable(): Promise<boolean> {
    const apiKey = this.config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) return false;

    // Check if the SDK is installed (optional dependency)
    try {
      await import('@google/genai');
    } catch {
      return false;
    }

    return true;
  }

  async initialize(): Promise<void> {
    const apiKey = this.config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;

    if (apiKey === undefined || apiKey.length === 0) {
      throw new ProviderErrorImpl({
        code: 'AUTH_FAILED',
        message:
          'Google API key not configured. Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable.',
        retryable: false,
      });
    }

    // Dynamically import Google Gemini SDK (may not be installed if using --no-optional)
    let GoogleGenAIConstructor: typeof GoogleGenAI;
    try {
      const module = await import('@google/genai');
      GoogleGenAIConstructor = module.GoogleGenAI;
    } catch {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Google Gemini SDK not installed. Install it with: npm install @google/genai',
        retryable: false,
      });
    }

    this.client = new GoogleGenAIConstructor({
      apiKey,
      httpOptions: { timeout: this.config.timeout ?? 60000 },
    });

    void this.refreshAvailableModels();
  }

  private async refreshAvailableModels(): Promise<void> {
    if (!this.client) return;

    try {
      const apiModels: ModelInfo[] = [];
      const hardcodedMap = new Map(GEMINI_MODELS.map(m => [m.id, m]));

      for await (const model of await this.client.models.list()) {
        const modelId = model.name?.replace(/^models\//, '');
        if (modelId === undefined || modelId.length === 0) continue;

        const lower = modelId.toLowerCase();
        if (
          !lower.startsWith('gemini-') ||
          lower.includes('image') ||
          lower.includes('tts') ||
          lower.includes('audio') ||
          lower.includes('embedding')
        ) {
          continue;
        }

        const hardcoded = hardcodedMap.get(modelId);

        if (hardcoded) {
          apiModels.push(hardcoded);
        } else {
          const namePart = modelId.replace(/^gemini-/i, '');
          const displayName = namePart
            .split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');

          apiModels.push({
            id: modelId,
            displayName: `Gemini ${displayName}`,
            defaultNickname: `Gemini ${displayName}`,
            capabilities: {
              streaming: true,
              maxContextTokens: 1000000,
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
        logProvider('gemini', 'models-discovered', {
          total: apiModels.length,
          known: apiModels.filter(m => hardcodedMap.has(m.id)).map(m => m.id),
          discovered: discoveredModels.map(m => m.id),
        });
      }
    } catch (error) {
      logProvider('gemini', 'models-discovery-failed', {
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
        message: 'Gemini client not initialized',
        retryable: false,
      });
    }

    if (modelId.toLowerCase().includes('gemma')) {
      throw new ProviderErrorImpl({
        code: 'INVALID_MODEL',
        message: `Model '${modelId}' is a Gemma model which doesn't support system messages and cannot be used for chat.`,
        retryable: false,
      });
    }

    const timeoutMs = parseTimeToMs(process.env.GEMINI_SESSION_TIMEOUT, DEFAULT_SESSION_TIMEOUT_MS);
    this.sessionState = ensureSession<GeminiSessionState>(
      this.sessionState,
      modelId,
      timeoutMs,
      mid => this.createSession(mid),
      'gemini'
    );

    const requestId = crypto.randomUUID();
    const controller = this.requests.track(requestId, options?.signal);

    const startTime = new Date();

    try {
      const { contents, systemInstruction } = convertMessagesToGemini(messages);

      const config: Record<string, unknown> = {
        maxOutputTokens: options?.maxTokens ?? 4096,
      };

      if (options?.temperature !== undefined) {
        config.temperature = options.temperature;
      }
      if (options?.stopSequences) {
        config.stopSequences = options.stopSequences;
      }
      if (systemInstruction !== undefined && systemInstruction.length > 0) {
        config.systemInstruction = systemInstruction;
      }

      const stream = await this.client.models.generateContentStream({
        model: modelId,
        contents,
        config,
      });

      let content = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          break;
        }

        const chunkText = chunk.text;
        if (chunkText !== undefined && chunkText.length > 0) {
          content += chunkText;
          onToken(chunkText);
        }

        // Track usage from chunk metadata if available
        if (chunk.usageMetadata !== undefined) {
          totalInputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
          totalOutputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
        }
      }

      if (this.sessionState !== null) {
        this.sessionState.contextInitialized = true;
        this.sessionState.lastProcessedMessageIndex = messages.length;
      }

      logProviderRequest('gemini', {
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
          promptTokens: totalInputTokens,
          completionTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
        },
        metadata: {
          sessionId: this.sessionState!.sessionId,
        },
      });

      return {
        content,
        finishReason: 'stop',
        model: modelId,
        usage: {
          promptTokens: totalInputTokens,
          completionTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
        },
      };
    } catch (error) {
      logProvider('gemini', 'request-error', {
        sessionId: this.sessionState?.sessionId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw mapErrorByMessage(error);
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
        message: 'Gemini client not initialized',
        retryable: false,
      });
    }

    const timeoutMs = parseTimeToMs(process.env.GEMINI_SESSION_TIMEOUT, DEFAULT_SESSION_TIMEOUT_MS);
    this.sessionState = ensureSession<GeminiSessionState>(
      this.sessionState,
      modelId,
      timeoutMs,
      mid => this.createSession(mid),
      'gemini'
    );

    const completeRequestId = crypto.randomUUID();
    const startTime = new Date();

    try {
      const { contents, systemInstruction } = convertMessagesToGemini(messages);

      const config: Record<string, unknown> = {
        maxOutputTokens: options?.maxTokens ?? 4096,
      };

      if (options?.temperature !== undefined) {
        config.temperature = options.temperature;
      }
      if (options?.stopSequences) {
        config.stopSequences = options.stopSequences;
      }
      if (systemInstruction !== undefined && systemInstruction.length > 0) {
        config.systemInstruction = systemInstruction;
      }

      const response = await this.client.models.generateContent({
        model: modelId,
        contents,
        config,
      });

      const content = response.text ?? '';

      if (this.sessionState !== null) {
        this.sessionState.contextInitialized = true;
        this.sessionState.lastProcessedMessageIndex = messages.length;
      }

      const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      logProviderRequest('gemini', {
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
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        metadata: {
          sessionId: this.sessionState!.sessionId,
        },
      });

      return {
        content,
        finishReason: 'stop',
        model: modelId,
        usage:
          response.usageMetadata !== undefined
            ? {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
              }
            : undefined,
      };
    } catch (error) {
      logProvider('gemini', 'request-error', {
        sessionId: this.sessionState?.sessionId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw mapErrorByMessage(error);
    }
  }

  cancelRequest(requestId: string): void {
    this.requests.cancel(requestId);
  }
}

export function createGeminiAdapter(config?: { apiKey?: string; timeout?: number }): GeminiAdapter {
  return new GeminiAdapter(config);
}
