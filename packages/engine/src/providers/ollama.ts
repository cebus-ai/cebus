import type OpenAI from 'openai';
import type {
  ProviderAdapter,
  ContextMessage,
  CompletionOptions,
  CompletionResult,
  ModelInfo,
} from './types';
import { ProviderErrorImpl } from './types';
import { mapProviderError } from './shared/error-mapper';
import { RequestTracker } from './shared/request-tracker';

const OLLAMA_VISION_KEYWORDS = [
  'llava',
  'bakllava',
  'moondream',
  'minicpm-v',
  'llama-vision',
  'internvl',
  'cogvlm',
  'deepseek-vl',
];

function isOllamaVisionModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return OLLAMA_VISION_KEYWORDS.some(kw => lower.includes(kw));
}

export class OllamaAdapter implements ProviderAdapter {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';

  private client: OpenAI | null = null;
  private openaiModule: typeof import('openai') | null = null;
  private requests = new RequestTracker();
  private availableModels: ModelInfo[] = [];

  constructor(
    private config: {
      baseUrl?: string;
      timeout?: number;
    } = {}
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      // Dynamically import OpenAI SDK (used for Ollama compatibility)
      let OpenAIConstructor: typeof OpenAI;
      try {
        const module = await import('openai');
        OpenAIConstructor = module.default;
      } catch {
        return false; // SDK not installed
      }

      const baseUrl =
        this.config.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
      const testClient = new OpenAIConstructor({
        apiKey: 'ollama', // Ollama doesn't need a real API key
        baseURL: `${baseUrl}/v1`,
        timeout: 5000,
      });

      await testClient.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    const baseUrl = this.config.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

    // Dynamically import OpenAI SDK (used for Ollama compatibility)
    let OpenAIConstructor: typeof OpenAI;
    try {
      const module = await import('openai');
      this.openaiModule = module;
      OpenAIConstructor = module.default;
    } catch {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_UNAVAILABLE',
        message:
          'OpenAI SDK not installed (required for Ollama). Install it with: npm install openai',
        retryable: false,
      });
    }

    this.client = new OpenAIConstructor({
      apiKey: 'ollama',
      baseURL: `${baseUrl}/v1`,
      timeout: this.config.timeout ?? 120000,
    });

    await this.refreshAvailableModels();
  }

  async dispose(): Promise<void> {
    this.requests.cancelAll();
    this.client = null;
    this.availableModels = [];
  }

  private async refreshAvailableModels(): Promise<void> {
    if (!this.client) return;

    try {
      const apiModels: ModelInfo[] = [];

      for await (const model of this.client.models.list()) {
        const [modelName, tag] = model.id.split(':');

        const baseName = (modelName ?? model.id)
          .split('-')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        const displayName =
          tag !== undefined && tag.length > 0 && tag !== 'latest'
            ? `${baseName} (${tag})`
            : baseName;

        const nickname =
          tag !== undefined && tag.length > 0 && tag !== 'latest' ? `${baseName} ${tag}` : baseName;

        apiModels.push({
          id: model.id,
          displayName,
          defaultNickname: nickname,
          capabilities: {
            streaming: true,
            maxContextTokens: 8192, // Conservative default
            maxOutputTokens: 4096,
            functionCalling: false, // Most Ollama models don't support this yet
            supports: { vision: isOllamaVisionModel(model.id) },
          },
        });
      }

      if (apiModels.length > 0) {
        this.availableModels = apiModels;
      }
    } catch (error) {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_ERROR',
        message: `Failed to discover Ollama models: ${error instanceof Error ? error.message : 'Unknown error'}`,
        retryable: true,
        cause: error instanceof Error ? error : undefined,
      });
    }
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
        message: 'Ollama provider not initialized',
        retryable: false,
      });
    }

    const requestId = crypto.randomUUID();
    const controller = this.requests.track(requestId, options?.signal);

    try {
      const requestParams: OpenAI.ChatCompletionCreateParams = {
        model: modelId,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          ...(msg.name !== undefined && msg.name.length > 0 ? { name: msg.name } : {}),
        })) as OpenAI.ChatCompletionMessageParam[],
        stream: true,
        ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.stopSequences && { stop: options.stopSequences }),
      };

      const stream = await this.client.chat.completions.create(requestParams, {
        signal: controller.signal,
      });

      let fullContent = '';
      let finishReason: CompletionResult['finishReason'] = 'stop';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta !== undefined && delta !== null && delta.length > 0) {
          fullContent += delta;
          onToken(delta);
        }

        const finish = chunk.choices[0]?.finish_reason;
        if (finish !== undefined && finish !== null) {
          finishReason = finish === 'length' ? 'length' : 'stop';
        }
      }

      return {
        content: fullContent,
        finishReason,
        model: modelId,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          content: '',
          finishReason: 'cancelled',
          model: modelId,
        };
      }
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
        message: 'Ollama provider not initialized',
        retryable: false,
      });
    }

    const requestId = crypto.randomUUID();
    const controller = this.requests.track(requestId, options?.signal);

    try {
      const requestParams: OpenAI.ChatCompletionCreateParams = {
        model: modelId,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          ...(msg.name !== undefined && msg.name.length > 0 ? { name: msg.name } : {}),
        })) as OpenAI.ChatCompletionMessageParam[],
        stream: false,
        ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.stopSequences && { stop: options.stopSequences }),
      };

      const response = await this.client.chat.completions.create(requestParams, {
        signal: controller.signal,
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new ProviderErrorImpl({
          code: 'PROVIDER_ERROR',
          message: 'No response from Ollama',
          retryable: true,
        });
      }

      return {
        content: choice.message.content ?? '',
        finishReason: choice.finish_reason === 'length' ? 'length' : 'stop',
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        model: response.model,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          content: '',
          finishReason: 'cancelled',
          model: modelId,
        };
      }
      throw this.mapError(error);
    } finally {
      this.requests.remove(requestId);
    }
  }

  cancelRequest(requestId: string): void {
    this.requests.cancel(requestId);
  }

  private mapError(error: unknown): ProviderErrorImpl {
    return mapProviderError(error, err => {
      if (this.openaiModule && err instanceof this.openaiModule.default.APIError) {
        let message = err.message;

        // Provide helpful ollama pull instructions for 404 (model not found)
        if (err.status === 404) {
          const modelMatch = err.message.match(/model '([^']+)'/);
          const modelName = modelMatch?.[1];

          if (modelName !== undefined) {
            message = `Model '${modelName}' not found locally.\n\nTo install this model, run:\n  ollama pull ${modelName}\n\nTo see available models, run:\n  ollama list\n\nTo browse all models, visit:\n  https://ollama.com/library`;
          }
        }

        return {
          status: err.status,
          message,
          cause: err,
        };
      }
      return {
        message: err instanceof Error ? err.message : 'Unknown error',
        cause: err instanceof Error ? err : undefined,
      };
    }) as ProviderErrorImpl;
  }
}

/**
 * Create an Ollama adapter instance.
 */
export function createOllamaAdapter(config?: {
  baseUrl?: string;
  timeout?: number;
}): OllamaAdapter {
  return new OllamaAdapter(config);
}
