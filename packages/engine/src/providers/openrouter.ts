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
import {
  OPENROUTER_FALLBACK_MODELS,
  SUPPORTED_OPENROUTER_PREFIXES,
} from './shared/openrouter-models';
import { registerModelPricing } from '../core/model-pricing.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterResolvedConfig {
  baseUrl: string;
  apiKey: string | undefined;
  headers: Record<string, string>;
  /** True when BYOK mode — Authorization header must be stripped from requests. */
  isBYOK: boolean;
}

/** Custom fetch that strips Authorization so the gateway injects the BYOK key. */
export function createBYOKFetch(): typeof globalThis.fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('Authorization');
    return globalThis.fetch(input, { ...init, headers });
  };
}

/**
 * Resolves OpenRouter config, accounting for Cloudflare AI Gateway proxy.
 *
 * Two modes:
 * 1. Direct: OPENROUTER_API_KEY set — key sent via Authorization header.
 * 2. Gateway BYOK: Only gateway vars set — no Authorization header sent;
 *    gateway injects the stored provider key via cf-aig-authorization + cf-aig-byok-alias.
 */
export function getOpenRouterConfig(overrides?: {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}): OpenRouterResolvedConfig {
  const gatewayUrl = process.env['CLOUDFLARE_AI_GATEWAY_URL'];
  const gatewayKey = process.env['CLOUDFLARE_GATEWAY_API_KEY'];
  const apiKey = overrides?.apiKey ?? process.env['OPENROUTER_API_KEY'];
  const isBYOK =
    (apiKey === undefined || apiKey.length === 0) &&
    gatewayUrl !== undefined &&
    gatewayUrl.length > 0 &&
    gatewayKey !== undefined &&
    gatewayKey.length > 0;

  const headers: Record<string, string> = {
    'HTTP-Referer': 'https://cebus.ai',
    'X-Title': 'Cebus.ai',
  };
  if (gatewayKey !== undefined && gatewayKey.length > 0)
    headers['cf-aig-authorization'] = `Bearer ${gatewayKey}`;
  const byokAlias = process.env['CLOUDFLARE_BYOK_ALIAS'];
  if (byokAlias !== undefined && byokAlias.length > 0) headers['cf-aig-byok-alias'] = byokAlias;

  return {
    baseUrl: overrides?.baseUrl ?? gatewayUrl ?? OPENROUTER_BASE_URL,
    apiKey,
    headers,
    isBYOK,
  };
}

const NON_CHAT_KEYWORDS = [
  'image',
  'audio',
  'tts',
  'whisper',
  'embedding',
  'moderation',
  'realtime',
  'dall-e',
  'vision-preview',
  'search-preview',
  'deep-research',
  'computer-use',
  'transcription',
] as const;

interface OpenRouterModelEntry {
  id: string;
  name: string;
  context_length: number;
  architecture?: { output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  top_provider?: { max_completion_tokens?: number };
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter';
  readonly displayName = 'OpenRouter';

  private client: OpenAI | null = null;
  private openaiModule: typeof import('openai') | null = null;
  private requests = new RequestTracker();
  private availableModels: ModelInfo[] = OPENROUTER_FALLBACK_MODELS;

  constructor(
    private config: {
      apiKey?: string;
      baseUrl?: string;
      timeout?: number;
    } = {}
  ) {}

  async isAvailable(): Promise<boolean> {
    const resolved = getOpenRouterConfig(this.config);
    if ((resolved.apiKey === undefined || resolved.apiKey.length === 0) && !resolved.isBYOK)
      return false;

    try {
      await import('openai');
    } catch {
      return false;
    }

    return true;
  }

  async initialize(): Promise<void> {
    const resolved = getOpenRouterConfig(this.config);

    if ((resolved.apiKey === undefined || resolved.apiKey.length === 0) && !resolved.isBYOK) {
      throw new ProviderErrorImpl({
        code: 'AUTH_FAILED',
        message:
          'OpenRouter not configured. Set OPENROUTER_API_KEY, or CLOUDFLARE_AI_GATEWAY_URL + CLOUDFLARE_GATEWAY_API_KEY for gateway BYOK.',
        retryable: false,
      });
    }

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
      apiKey: resolved.apiKey ?? 'byok',
      baseURL: resolved.baseUrl,
      timeout: this.config.timeout ?? 60000,
      defaultHeaders: resolved.headers,
      ...(resolved.isBYOK ? { fetch: createBYOKFetch() } : {}),
    });

    await this.refreshAvailableModels();
  }

  private async refreshAvailableModels(): Promise<void> {
    const resolved = getOpenRouterConfig(this.config);

    try {
      const fetchHeaders: Record<string, string> = { ...resolved.headers };
      if (resolved.apiKey !== undefined && resolved.apiKey.length > 0)
        fetchHeaders['Authorization'] = `Bearer ${resolved.apiKey}`;
      const res = await fetch(`${resolved.baseUrl}/models`, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;

      const json = (await res.json()) as { data?: OpenRouterModelEntry[] };
      if (!json.data) return;

      const apiModels: ModelInfo[] = [];

      for (const model of json.data) {
        if (!SUPPORTED_OPENROUTER_PREFIXES.some(prefix => model.id.startsWith(prefix))) {
          continue;
        }

        if (model.id.includes(':')) {
          continue;
        }

        const outputModalities = model.architecture?.output_modalities ?? [];
        if (outputModalities.length > 0 && !outputModalities.includes('text')) {
          continue;
        }

        const lower = model.id.toLowerCase();
        if (NON_CHAT_KEYWORDS.some(kw => lower.includes(kw))) {
          continue;
        }

        const parts = model.id.split('/');
        const modelName = parts[1] ?? model.id;
        const ACRONYMS: Record<string, string> = { gpt: 'GPT', ai: 'AI', lm: 'LM' };
        const displayName = modelName
          .split('-')
          .map(w => {
            const lower = w.toLowerCase();
            // eslint-disable-next-line security/detect-object-injection -- key from known set
            return ACRONYMS[lower] ?? w.charAt(0).toUpperCase() + w.slice(1);
          })
          .join(' ');

        const contextTokens =
          model.context_length !== undefined && model.context_length !== 0
            ? model.context_length
            : 128000;
        const maxOutput = model.top_provider?.max_completion_tokens ?? 4096;
        const promptPrice =
          model.pricing?.prompt !== undefined && model.pricing.prompt.length > 0
            ? parseFloat(model.pricing.prompt)
            : undefined;
        const completionPrice =
          model.pricing?.completion !== undefined && model.pricing.completion.length > 0
            ? parseFloat(model.pricing.completion)
            : undefined;

        apiModels.push({
          id: model.id,
          displayName,
          defaultNickname:
            displayName.length > 30 ? displayName.substring(0, 30).trimEnd() : displayName,
          capabilities: {
            streaming: true,
            maxContextTokens: contextTokens,
            maxOutputTokens: maxOutput,
            functionCalling: true,
            ...(promptPrice !== undefined && completionPrice !== undefined
              ? {
                  pricing: {
                    promptPer1M: promptPrice * 1_000_000,
                    completionPer1M: completionPrice * 1_000_000,
                  },
                }
              : {}),
          },
        });
      }

      if (apiModels.length > 0) {
        this.availableModels = apiModels;

        const pricingEntries = apiModels
          .filter(m => m.capabilities.pricing)
          .map(m => ({
            modelId: m.id,
            inputPricePerMTok: m.capabilities.pricing!.promptPer1M,
            outputPricePerMTok: m.capabilities.pricing!.completionPer1M,
            cachedInputPricePerMTok: m.capabilities.pricing!.promptPer1M * 0.1,
            contextWindow: m.capabilities.maxContextTokens,
          }));
        if (pricingEntries.length > 0) {
          registerModelPricing(pricingEntries);
        }
      }
    } catch {
      // Keep fallback models on failure
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
        message: 'OpenRouter client not initialized',
        retryable: false,
      });
    }

    const requestId = crypto.randomUUID();
    const controller = this.requests.track(requestId, options?.signal);

    try {
      const requestParams: OpenAI.ChatCompletionCreateParams = {
        model: modelId,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.name !== undefined && m.name.length > 0
            ? { name: m.name.replace(/[^a-zA-Z0-9_]/g, '_') }
            : {}),
        })) as OpenAI.ChatCompletionMessageParam[],
        stream: true,
        ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.stopSequences ? { stop: options.stopSequences } : {}),
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

        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason === 'length' ? 'length' : 'stop';
        }
      }

      return { content, finishReason, model: modelId };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { content: '', finishReason: 'cancelled', model: modelId };
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
        message: 'OpenRouter client not initialized',
        retryable: false,
      });
    }

    const requestId = crypto.randomUUID();
    const controller = this.requests.track(requestId, options?.signal);

    try {
      const requestParams: OpenAI.ChatCompletionCreateParams = {
        model: modelId,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.name !== undefined && m.name.length > 0
            ? { name: m.name.replace(/[^a-zA-Z0-9_]/g, '_') }
            : {}),
        })) as OpenAI.ChatCompletionMessageParam[],
        ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.stopSequences ? { stop: options.stopSequences } : {}),
      };

      const response = await this.client.chat.completions.create(requestParams, {
        signal: controller.signal,
      });

      const choice = response.choices[0];

      return {
        content: choice?.message?.content ?? '',
        finishReason: choice?.finish_reason === 'length' ? 'length' : 'stop',
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
        return { content: '', finishReason: 'cancelled', model: modelId };
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
    }) as ProviderErrorImpl;
  }
}

export interface OpenRouterCredits {
  remaining: number;
  limit: number;
  usage: number;
  isFreeTier: boolean;
}

export async function fetchOpenRouterCredits(overrides?: {
  apiKey?: string | undefined;
}): Promise<OpenRouterCredits | null> {
  const resolved = getOpenRouterConfig(overrides);

  if ((resolved.apiKey === undefined || resolved.apiKey.length === 0) && !resolved.isBYOK)
    return null;

  try {
    const headers: Record<string, string> = { ...resolved.headers };

    let url: string;
    if (resolved.apiKey !== undefined && resolved.apiKey.length > 0) {
      url = 'https://openrouter.ai/api/v1/key';
      headers['Authorization'] = `Bearer ${resolved.apiKey}`;
    } else {
      url = `${resolved.baseUrl}/key`;
    }

    const res =
      resolved.isBYOK && (resolved.apiKey === undefined || resolved.apiKey.length === 0)
        ? await createBYOKFetch()(url, { headers, signal: AbortSignal.timeout(15000) })
        : await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: {
        limit_remaining?: number;
        limit?: number;
        usage?: number;
        is_free_tier?: boolean;
      };
    };
    if (!json.data) return null;

    return {
      remaining: json.data.limit_remaining ?? 0,
      limit: json.data.limit ?? 0,
      usage: json.data.usage ?? 0,
      isFreeTier: json.data.is_free_tier ?? false,
    };
  } catch {
    return null;
  }
}

export function createOpenRouterAdapter(config?: {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}): OpenRouterAdapter {
  return new OpenRouterAdapter(config);
}
