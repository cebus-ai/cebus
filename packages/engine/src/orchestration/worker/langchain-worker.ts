import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type {
  AgentProfile,
  AgentResponse,
  Attachment,
  ExecutionContext,
  MCPInitResult,
  OrchestrationLogger,
  OrchestrationStreamEvent,
  WorkerExecutor,
} from '../types.js';
import { OrchestrationError } from '../types.js';
import type { ProviderSessionState, ProviderSessionStateUnion } from '../../providers/types.js';
import { getOpenRouterConfig, createBYOKFetch } from '../../providers/openrouter.js';
import { isDebugEnabled, logProviderRequest } from '../../core/debug-logger.js';
import { calculateCost } from '../../core/model-pricing.js';
import { buildSystemPrompt } from './prompt-builder.js';

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

const VISION_ERROR_PATTERNS = [
  'missing data required for image',
  'does not support image',
  'image_url is not supported',
  'does not support vision',
  'invalid image',
  'cannot process image',
];

function supportsVision(providerType: string, modelId: string | undefined): boolean {
  switch (providerType) {
    case 'openai':
    case 'anthropic':
    case 'gemini':
    case 'openrouter':
    case 'copilot':
      return true;
    case 'ollama': {
      if (modelId === undefined) return false;
      const lower = modelId.toLowerCase();
      return OLLAMA_VISION_KEYWORDS.some(kw => lower.includes(kw));
    }
    default:
      return true;
  }
}

function isVisionError(message: string): boolean {
  const lower = message.toLowerCase();
  return VISION_ERROR_PATTERNS.some(p => lower.includes(p));
}

export class LangChainWorker implements WorkerExecutor {
  private chatModel: BaseChatModel | null = null;
  private providerSessionState: ProviderSessionState | ProviderSessionStateUnion | null = null;

  constructor(
    private readonly profile: AgentProfile,
    private readonly logger?: OrchestrationLogger
  ) {}

  /** Get the current provider session state for persistence by the graph. */
  getProviderSessionState(): ProviderSessionState | ProviderSessionStateUnion | null {
    return this.providerSessionState;
  }

  /** Restore provider session state (e.g., from participant on graph recompile). */
  setProviderSessionState(state: ProviderSessionState | ProviderSessionStateUnion): void {
    this.providerSessionState = state;
  }

  async execute(
    agentProfile: AgentProfile,
    message: string,
    conversationHistory: ReadonlyArray<{
      role: string;
      content: string;
      name?: string | undefined;
    }>,
    context: ExecutionContext,
    onStream: (event: OrchestrationStreamEvent) => void,
    traceId: string
  ): Promise<AgentResponse> {
    const startTime = Date.now();
    this.logger?.workerStart(traceId, agentProfile.id);

    try {
      const model = await this.getOrCreateModel();

      // Pre-flight: strip images for non-vision models
      const providerType = this.profile.provider?.type ?? 'openai';
      const modelId = agentProfile.model ?? this.profile.model;
      const hasImages =
        context.attachments !== undefined &&
        context.attachments.some(a => a.type === 'image');
      let effectiveMessage = message;
      let effectiveAttachments = context.attachments;

      if (hasImages && !supportsVision(providerType, modelId)) {
        const imageCount = context.attachments!.filter(a => a.type === 'image').length;
        effectiveAttachments = context.attachments!.filter(a => a.type !== 'image');
        const notice = `[Note: This message included ${imageCount} image(s), but ${agentProfile.name} does not support image input. Responding to text only.]`;
        effectiveMessage = `${notice}\n\n${message}`;
      }

      const systemPrompt = buildSystemPrompt(agentProfile, context);

      // Build message list with proper attribution:
      // - User messages → HumanMessage
      // - THIS agent's own prior responses → AIMessage (model recognizes as its own)
      // - OTHER agents' responses → HumanMessage with [@Name] prefix
      //
      // IMPORTANT: We CANNOT use AIMessage with `name` field for other agents' responses.
      // Models ignore the `name` field and treat ALL AIMessage as their own prior output,
      // causing them to copy/repeat other models' answers verbatim.
      //
      // h.name is the agent's display name (e.g. "Claude claude-3-5-haiku-20241022"),
      // resolved from agentId by the graph worker node via config.agents.
      const myName = agentProfile.name;
      const isAnthropic = (this.profile.provider?.type ?? 'openai') === 'anthropic';

      const messages = [
        // Only include system message when there's actual content
        ...(systemPrompt
          ? [
              new SystemMessage({
                content: systemPrompt,
                // Anthropic: mark system prompt as cache breakpoint (always static)
                ...(isAnthropic
                  ? { additional_kwargs: { cache_control: { type: 'ephemeral' } } }
                  : {}),
              }),
            ]
          : []),
        ...conversationHistory.map((h, i) => {
          // Anthropic: mark the anchor message (frozen summary) as cache breakpoint.
          // The anchor is always the first history entry, prepended by graph.ts.
          const isAnchor =
            isAnthropic &&
            i === 0 &&
            h.role === 'user' &&
            h.content.startsWith('[Previous conversation summary]');
          const anchorKwargs = isAnchor
            ? { additional_kwargs: { cache_control: { type: 'ephemeral' } } }
            : {};

          if (h.role === 'user') {
            return new HumanMessage({ content: h.content, ...anchorKwargs });
          }
          // This agent's own prior response — model sees it as "my previous answer"
          if (h.name === myName) {
            return new AIMessage(h.content);
          }
          // Another agent's response — must be HumanMessage so model doesn't think it said this
          const senderLabel = h.name ?? 'Another model';
          return new HumanMessage(`[${senderLabel}]: ${h.content}`);
        }),
        buildUserMessage(effectiveMessage, effectiveAttachments),
        // Same-turn responses from earlier sequential agents — placed after the user message
        // so the model sees the correct chronological order: user → agent1 → agent2 → ...
        ...(context.sameTurnResponses ?? []).map(r => {
          if (r.name === myName) return new AIMessage(r.content);
          const label = r.name ?? 'Another model';
          return new HumanMessage(`[${label}]: ${r.content}`);
        }),
      ];

      onStream({
        type: 'start',
        agentId: agentProfile.id,
        traceId,
        ...(context.orchestratorGuidance !== undefined && context.orchestratorGuidance.length > 0
          ? { guidance: context.orchestratorGuidance }
          : {}),
      });

      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;

      // Build provider-specific call options for session management
      const callOptions: Record<string, unknown> = this.getSessionCallOptions();

      // Pass abort signal so LangChain cancels the underlying HTTP request
      const ct = context.cancellationToken;
      if (ct !== undefined && typeof ct.addEventListener === 'function') {
        callOptions['signal'] = ct;
      }

      // Stream with timeout and cancellation
      const streamPromise = this.streamWithTimeout(
        model,
        messages,
        context,
        agentProfile.id,
        traceId,
        onStream,
        callOptions
      );

      const result = await streamPromise;
      fullContent = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;

      const tokenUsage = {
        inputTokens,
        outputTokens,
        ...(result.cacheReadTokens > 0 ? { cacheReadTokens: result.cacheReadTokens } : {}),
        ...(result.cacheWriteTokens > 0 ? { cacheWriteTokens: result.cacheWriteTokens } : {}),
      };

      const costModelId = agentProfile.model ?? this.profile.model ?? 'unknown';
      const costEstimate = calculateCost(costModelId, {
        inputTokens,
        outputTokens,
        cacheReadTokens: result.cacheReadTokens,
      });

      const endTime = new Date();
      const latencyMs = Date.now() - startTime;
      this.logger?.workerComplete(traceId, agentProfile.id, latencyMs);

      // Debug: dump full context window to per-model .md file
      if (isDebugEnabled()) {
        const debugModelId = this.profile.model ?? 'unknown';
        logProviderRequest(providerType, {
          requestId: `${traceId}-${agentProfile.id}`,
          model: debugModelId,
          messages: messages.map(m => {
            if (m instanceof SystemMessage)
              return {
                role: 'system',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              };
            if (m instanceof AIMessage)
              return {
                role: 'assistant',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                name: myName,
              };
            return {
              role: 'user',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            };
          }),
          response: fullContent,
          startTime: new Date(startTime),
          endTime,
          usage: {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            ...(result.cacheReadTokens > 0 ? { cacheReadTokens: result.cacheReadTokens } : {}),
            ...(result.cacheWriteTokens > 0 ? { cacheWriteTokens: result.cacheWriteTokens } : {}),
          },
          metadata: { agentId: agentProfile.id, agentName: agentProfile.name },
        });
      }

      onStream({
        type: 'complete',
        agentId: agentProfile.id,
        traceId,
        content: fullContent,
        tokenUsage,
        estimatedCostUSD: costEstimate.totalCost,
      });

      return {
        agentId: agentProfile.id,
        agentName: agentProfile.name,
        content: fullContent,
        toolInvocations: [],
        tokenUsage,
        estimatedCostUSD: costEstimate.totalCost,
      };
    } catch (err) {
      // Detect context window overflow for upstream retry handling
      if (err instanceof Error && err.name === 'ContextOverflowError') {
        throw new OrchestrationError(
          'CONTEXT_OVERFLOW',
          `Worker ${agentProfile.id}: context window exceeded`,
          traceId,
          err
        );
      }

      const latencyMs = Date.now() - startTime;
      const rawMsg = err instanceof Error ? err.message : 'Unknown worker error';
      const errorMsg =
        isVisionError(rawMsg)
          ? `${agentProfile.name} does not support image input. Try a vision-capable model or send your message without images.`
          : rawMsg;
      this.logger?.workerError(traceId, agentProfile.id, errorMsg);

      const errorCode = err instanceof OrchestrationError ? err.code : 'WORKER_EXECUTION';

      onStream({
        type: 'error',
        agentId: agentProfile.id,
        traceId,
        error: {
          code: errorCode,
          message: errorMsg,
          agentId: agentProfile.id,
          recoverable: errorCode !== 'CANCELLED',
        },
      });

      throw new OrchestrationError(
        errorCode,
        `Worker ${agentProfile.id} failed after ${latencyMs}ms: ${errorMsg}`,
        traceId,
        err instanceof Error ? err : undefined
      );
    }
  }

  async initializeMCP(_agentProfile: AgentProfile): Promise<MCPInitResult> {
    // MCP integration handled in Phase 5 (T029-T036)
    return {
      serverId: 'none',
      status: 'connected',
      toolCount: 0,
    };
  }

  async dispose(): Promise<void> {
    this.chatModel = null;
  }

  private async getOrCreateModel(): Promise<BaseChatModel> {
    if (this.chatModel) return this.chatModel;
    this.chatModel = await createChatModel(this.profile);
    return this.chatModel;
  }

  /** Build provider-specific call options (currently none — caching is per-message). */
  private getSessionCallOptions(): Record<string, unknown> {
    return {};
  }

  private async streamWithTimeout(
    model: BaseChatModel,
    messages: (HumanMessage | SystemMessage | AIMessage)[],
    context: ExecutionContext,
    agentId: string,
    traceId: string,
    onStream: (event: OrchestrationStreamEvent) => void,
    callOptions?: Record<string, unknown>
  ): Promise<{
    content: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }> {
    let content = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    // Check if already cancelled before starting
    const cancelToken = context.cancellationToken;
    if (cancelToken !== undefined && 'aborted' in cancelToken && cancelToken.aborted) {
      throw new OrchestrationError('CANCELLED', `Worker ${agentId} was cancelled`, traceId);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new OrchestrationError(
            'TIMEOUT',
            `Worker ${agentId} exceeded timeout of ${context.timeoutBudget}ms`,
            traceId
          )
        );
      }, context.timeoutBudget);

      // Guard: cancellationToken may lose its prototype after state serialization
      const token = context.cancellationToken;
      if (token !== undefined && typeof token.addEventListener === 'function') {
        if (token.aborted) {
          clearTimeout(timer);
          reject(new OrchestrationError('CANCELLED', `Worker ${agentId} was cancelled`, traceId));
          return;
        }
        token.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new OrchestrationError('CANCELLED', `Worker ${agentId} was cancelled`, traceId));
          },
          { once: true }
        );
      }
    });

    const streamingPromise = (async (): Promise<{
      content: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    }> => {
      const stream = await model.stream(messages, callOptions);

      for await (const chunk of stream) {
        if (
          context.cancellationToken !== undefined &&
          'aborted' in context.cancellationToken &&
          context.cancellationToken.aborted
        ) {
          throw new OrchestrationError(
            'CANCELLED',
            `Worker ${agentId} was cancelled during streaming`,
            traceId
          );
        }

        const token = typeof chunk.content === 'string' ? chunk.content : '';
        if (token) {
          content += token;
          onStream({ type: 'token', agentId, traceId, token });
        }

        // Reasoning/thinking content (Anthropic extended thinking, OpenAI o-series)
        const chunkAny = chunk as unknown as Record<string, unknown>;
        // Anthropic: chunk.content array may contain {type: "thinking", thinking: "..."}
        if (Array.isArray(chunk.content)) {
          for (const block of chunk.content) {
            const typed = block as Record<string, unknown>;
            if (typed['type'] === 'thinking' && typeof typed['thinking'] === 'string') {
              onStream({
                type: 'reasoning_delta',
                traceId,
                agentId,
                delta: typed['thinking'] as string,
              });
            }
          }
        }
        // OpenAI: chunk.additional_kwargs?.reasoning_content
        const additionalKwargs = chunkAny['additional_kwargs'] as Record<string, unknown> | undefined;
        const reasoningContent = additionalKwargs?.['reasoning_content'] as string | undefined;
        if (reasoningContent !== undefined && reasoningContent.length > 0) {
          onStream({
            type: 'reasoning_delta',
            traceId,
            agentId,
            delta: reasoningContent,
          });
        }

        // Extract token usage from chunk metadata if available
        const usage = (chunk as unknown as Record<string, unknown>)['usage_metadata'] as
          | {
              input_tokens?: number;
              output_tokens?: number;
              input_token_details?: { cache_read?: number; cache_creation?: number };
            }
          | undefined;
        if (usage) {
          inputTokens = usage.input_tokens ?? inputTokens;
          outputTokens = usage.output_tokens ?? outputTokens;
          if (usage.input_token_details) {
            cacheReadTokens = usage.input_token_details.cache_read ?? cacheReadTokens;
            cacheWriteTokens = usage.input_token_details.cache_creation ?? cacheWriteTokens;
          }
        }
      }

      return { content, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
    })();

    try {
      return await Promise.race([streamingPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildUserMessage(
  message: string,
  attachments?: ReadonlyArray<Attachment> | undefined
): HumanMessage {
  const images = (attachments ?? []).filter(
    (a): a is Extract<Attachment, { type: 'image' }> => a.type === 'image'
  );
  if (images.length === 0) return new HumanMessage(message);
  return new HumanMessage({
    content: [
      { type: 'text', text: message },
      ...images.map(img => ({
        type: 'image_url' as const,
        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
      })),
    ],
  });
}

/**
 * Factory: Create the appropriate LangChain chat model based on provider type.
 *
 * Follows Open/Closed Principle: Add new providers by adding a case.
 */

/** Provider → OpenRouter model prefix mapping for fallback routing. */
const OPENROUTER_PREFIX: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
};

/**
 * When a native provider key is missing, attempt to route through OpenRouter.
 * Returns a ChatOpenAI configured for OpenRouter, or null if OpenRouter is not available.
 */
async function tryOpenRouterFallback(
  providerType: string,
  model: string | undefined
): Promise<BaseChatModel | null> {
  // eslint-disable-next-line security/detect-object-injection -- providerType from known provider config
  const prefix = OPENROUTER_PREFIX[providerType];
  if (prefix === undefined || prefix.length === 0) return null;

  const resolved = getOpenRouterConfig();
  if ((resolved.apiKey === undefined || resolved.apiKey.length === 0) && !resolved.isBYOK)
    return null;

  const { ChatOpenAI } = await import('@langchain/openai');
  const openRouterModel =
    model !== undefined && model.length > 0 ? `${prefix}/${model}` : undefined;

  return new ChatOpenAI({
    ...(openRouterModel !== undefined ? { model: openRouterModel } : {}),
    apiKey: resolved.apiKey ?? 'byok',
    configuration: {
      baseURL: resolved.baseUrl,
      defaultHeaders: resolved.headers,
      ...(resolved.isBYOK ? { fetch: createBYOKFetch() } : {}),
    },
  });
}

/** OpenAI model IDs that are NOT chat models and will fail with /v1/chat/completions. */
const NON_CHAT_KEYWORDS = [
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

const NON_CHAT_TYPE_LABELS: Record<string, string> = {
  'deep-research': 'deep research (Responses API only)',
  'computer-use': 'computer use (Responses API only)',
  realtime: 'realtime audio/voice',
  audio: 'audio input/output',
  'dall-e': 'image generation',
  'chatgpt-image': 'image generation',
  'search-preview': 'experimental search (incompatible parameters)',
  whisper: 'audio transcription',
  tts: 'text-to-speech',
  embedding: 'embedding',
  moderation: 'content moderation',
  babbage: 'legacy completions',
  davinci: 'legacy completions',
  curie: 'legacy completions',
  ada: 'legacy completions',
};

async function createChatModel(profile: AgentProfile): Promise<BaseChatModel> {
  const providerType = profile.provider?.type ?? 'openai';
  const model = profile.model;
  const apiKey = profile.provider?.apiKey;
  const baseUrl = profile.provider?.baseUrl;

  // Validate OpenAI model is a chat model (not realtime, embedding, etc.)
  if (providerType === 'openai' && model !== undefined && model.length > 0) {
    const matched = NON_CHAT_KEYWORDS.find(kw => model.toLowerCase().includes(kw));
    if (matched) {
      // eslint-disable-next-line security/detect-object-injection -- matched from known constant array
      const typeLabel = NON_CHAT_TYPE_LABELS[matched] ?? matched;
      throw new OrchestrationError(
        'CONFIG_VALIDATION',
        `Model "${model}" is a ${typeLabel} model and cannot be used as a chat model. Use a chat-compatible model like gpt-4o or gpt-4o-mini instead.`
      );
    }
  }

  switch (providerType) {
    case 'openai': {
      const openaiKey = apiKey ?? process.env['OPENAI_API_KEY'];
      if (openaiKey === undefined || openaiKey.length === 0) {
        const fallback = await tryOpenRouterFallback(providerType, model);
        if (fallback) return fallback;
      }
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({
        ...(model !== undefined ? { model } : {}),
        ...(openaiKey !== undefined ? { apiKey: openaiKey } : {}),
        ...(baseUrl !== undefined && baseUrl.length > 0
          ? { configuration: { baseURL: baseUrl } }
          : {}),
        // Wire reasoning effort for o-series and GPT-5+ models
        ...(profile.reasoningEffort !== undefined
          ? { reasoning: { effort: profile.reasoningEffort } }
          : {}),
      });
    }

    case 'anthropic': {
      const anthropicKey = apiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (anthropicKey === undefined || anthropicKey.length === 0) {
        const fallback = await tryOpenRouterFallback(providerType, model);
        if (fallback) return fallback;
      }
      const { ChatAnthropic } = await import('@langchain/anthropic');
      return new ChatAnthropic({
        ...(model !== undefined ? { model } : {}),
        ...(anthropicKey !== undefined ? { apiKey: anthropicKey } : {}),
        // Adaptive thinking: model decides when to reason (reasoning_delta streaming already wired)
        thinking: { type: 'adaptive' },
      });
    }

    case 'gemini': {
      const geminiKey = apiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY'];
      if (geminiKey === undefined || geminiKey.length === 0) {
        const fallback = await tryOpenRouterFallback(providerType, model);
        if (fallback) return fallback;
      }
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      // Enable thinking for Gemini 2.5+ models (reasoning_delta streaming is already wired)
      const supportsThinking = model !== undefined && /gemini[- ]?(2\.5|3)/i.test(model);
      return new ChatGoogleGenerativeAI({
        model: model ?? 'gemini-2.0-flash',
        ...(geminiKey !== undefined ? { apiKey: geminiKey } : {}),
        ...(supportsThinking ? { thinkingConfig: { includeThoughts: true } } : {}),
      });
    }

    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama');
      return new ChatOllama({
        ...(model !== undefined ? { model } : {}),
        baseUrl: baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
      });
    }

    case 'openrouter': {
      const { ChatOpenAI } = await import('@langchain/openai');
      const resolved = getOpenRouterConfig({ apiKey, baseUrl });
      return new ChatOpenAI({
        ...(model !== undefined ? { model } : {}),
        apiKey: resolved.apiKey ?? 'byok',
        configuration: {
          baseURL: resolved.baseUrl,
          defaultHeaders: resolved.headers,
          ...(resolved.isBYOK ? { fetch: createBYOKFetch() } : {}),
        },
      });
    }

    default:
      throw new OrchestrationError(
        'CONFIG_VALIDATION',
        `Unsupported provider for LangChain worker: ${providerType}`
      );
  }
}
