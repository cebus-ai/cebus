/**
 * Provider Adapter Worker
 *
 * Alternative worker that delegates to our provider adapters (providers/*.ts)
 * instead of LangChain chat models.
 *
 * Set CEBUS_USE_PROVIDER_ADAPTER=true to use this instead of the default LangChain worker.
 */

import type {
  AgentProfile,
  AgentResponse,
  ExecutionContext,
  MCPInitResult,
  OrchestrationLogger,
  OrchestrationStreamEvent,
  WorkerExecutor,
} from '../types.js';
import { OrchestrationError } from '../types.js';
import type {
  ProviderAdapter,
  ContextMessage,
  ProviderSessionState,
  ProviderSessionStateUnion,
} from '../../providers/types.js';
import { isDebugEnabled, logProviderRequest } from '../../core/debug-logger.js';
import { calculateCost } from '../../core/model-pricing.js';
import { buildSystemPrompt } from './prompt-builder.js';
import { buildAttributedHistory } from './shared/message-attribution.js';
import { createTimeoutRace } from './shared/timeout-guard.js';

/** Subset of the adapter interface for session state access. */
interface SessionAwareAdapter {
  getSessionState(): ProviderSessionState | ProviderSessionStateUnion | null;
}

function hasSessionState(
  adapter: ProviderAdapter
): adapter is ProviderAdapter & SessionAwareAdapter {
  return typeof (adapter as unknown as Record<string, unknown>)['getSessionState'] === 'function';
}

export class ProviderAdapterWorker implements WorkerExecutor {
  private adapter: ProviderAdapter | null = null;
  private providerSessionState: ProviderSessionState | ProviderSessionStateUnion | null = null;

  constructor(
    private readonly profile: AgentProfile,
    private readonly logger?: OrchestrationLogger
  ) {}

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
      const adapter = await this.getOrCreateAdapter();
      const modelId = agentProfile.model ?? this.profile.model ?? '';
      const systemPrompt = buildSystemPrompt(agentProfile, context);

      // Build ContextMessage[] using shared attribution logic
      const attributed = buildAttributedHistory(agentProfile.name, conversationHistory);
      // Same-turn responses from earlier sequential agents — placed after user message
      const sameTurnMessages: ContextMessage[] =
        context.sameTurnResponses !== undefined && context.sameTurnResponses.length > 0
          ? buildAttributedHistory(agentProfile.name, context.sameTurnResponses)
          : [];

      const contextMessages: ContextMessage[] = [
        { role: 'system', content: systemPrompt },
        ...attributed,
        { role: 'user', content: message },
        ...sameTurnMessages,
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

      // Stream with timeout and cancellation
      const result = await this.streamWithTimeout(
        adapter,
        modelId,
        contextMessages,
        context,
        agentProfile.id,
        traceId,
        onStream,
        (token: string) => {
          fullContent += token;
          onStream({ type: 'token', agentId: agentProfile.id, traceId, token });
        }
      );

      fullContent = result.content;

      const tokenUsage = {
        inputTokens: result.promptTokens,
        outputTokens: result.completionTokens,
        ...(result.cacheReadTokens !== undefined &&
        result.cacheReadTokens !== 0 &&
        result.cacheReadTokens > 0
          ? { cacheReadTokens: result.cacheReadTokens }
          : {}),
        ...(result.cacheWriteTokens !== undefined &&
        result.cacheWriteTokens !== 0 &&
        result.cacheWriteTokens > 0
          ? { cacheWriteTokens: result.cacheWriteTokens }
          : {}),
      };

      const costEstimate = calculateCost(modelId, {
        inputTokens: result.promptTokens,
        outputTokens: result.completionTokens,
        cacheReadTokens: result.cacheReadTokens,
      });

      // Update session state from adapter (OpenAI tracks previousResponseId, Anthropic tracks cacheMetrics)
      if (hasSessionState(adapter)) {
        this.providerSessionState = adapter.getSessionState();
      }

      const endTime = new Date();
      const latencyMs = Date.now() - startTime;
      this.logger?.workerComplete(traceId, agentProfile.id, latencyMs);

      // Debug: dump full context window to per-model .md file
      if (isDebugEnabled()) {
        const providerType = this.profile.provider?.type ?? 'openai';
        logProviderRequest(providerType, {
          requestId: `${traceId}-${agentProfile.id}`,
          model: modelId,
          messages: contextMessages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.name !== undefined && m.name.length > 0 ? { name: m.name } : {}),
          })),
          response: fullContent,
          startTime: new Date(startTime),
          endTime,
          usage: {
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            totalTokens: result.promptTokens + result.completionTokens,
            ...(result.cacheReadTokens !== undefined &&
            result.cacheReadTokens !== 0 &&
            result.cacheReadTokens > 0
              ? { cacheReadTokens: result.cacheReadTokens }
              : {}),
            ...(result.cacheWriteTokens !== undefined &&
            result.cacheWriteTokens !== 0 &&
            result.cacheWriteTokens > 0
              ? { cacheWriteTokens: result.cacheWriteTokens }
              : {}),
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
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown worker error';
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
    return {
      serverId: 'none',
      status: 'connected',
      toolCount: 0,
    };
  }

  async dispose(): Promise<void> {
    if (this.adapter) {
      await this.adapter.dispose();
      this.adapter = null;
    }
  }

  /** Get the current provider session state for persistence by the graph. */
  getProviderSessionState(): ProviderSessionState | ProviderSessionStateUnion | null {
    return this.providerSessionState;
  }

  /** Restore provider session state (e.g., from participant on graph recompile). */
  setProviderSessionState(state: ProviderSessionState | ProviderSessionStateUnion): void {
    this.providerSessionState = state;
  }

  /**
   * Lazily create and initialize the appropriate provider adapter.
   * The adapter is cached on the worker instance and reused across calls.
   */
  private async getOrCreateAdapter(): Promise<ProviderAdapter> {
    if (this.adapter) return this.adapter;

    const providerType = this.profile.provider?.type ?? 'openai';
    const apiKey = this.profile.provider?.apiKey;
    const baseUrl = this.profile.provider?.baseUrl;

    switch (providerType) {
      case 'openai': {
        const { createOpenAIAdapter } = await import('../../providers/openai.js');
        this.adapter = createOpenAIAdapter({
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(baseUrl !== undefined ? { baseUrl } : {}),
        });
        break;
      }

      case 'anthropic': {
        const { createAnthropicAdapter } = await import('../../providers/anthropic.js');
        this.adapter = createAnthropicAdapter({
          ...(apiKey !== undefined ? { apiKey } : {}),
        });
        break;
      }

      case 'gemini': {
        const { createGeminiAdapter } = await import('../../providers/gemini.js');
        this.adapter = createGeminiAdapter({
          ...(apiKey !== undefined ? { apiKey } : {}),
        });
        break;
      }

      case 'ollama': {
        const { createOllamaAdapter } = await import('../../providers/ollama.js');
        this.adapter = createOllamaAdapter({
          ...(baseUrl !== undefined ? { baseUrl } : {}),
        });
        break;
      }

      case 'vscode-lm': {
        const { getProviderRegistry } = await import('../../providers/registry.js');
        const adapter = getProviderRegistry().get('vscode-lm');
        if (!adapter) {
          throw new OrchestrationError(
            'CONFIG_VALIDATION',
            'VS Code LM provider not registered. This provider is only available in VS Code extensions.'
          );
        }
        this.adapter = adapter;
        break;
      }

      default:
        throw new OrchestrationError(
          'CONFIG_VALIDATION',
          `Unsupported provider for adapter worker: ${providerType}`
        );
    }

    // Skip initialize() for vscode-lm — it's pre-initialized when registered
    if (providerType !== 'vscode-lm') {
      await this.adapter.initialize();
    }
    return this.adapter;
  }

  /**
   * Stream completion with timeout and cancellation support.
   * Wraps the adapter's streamCompletion() with the shared timeout guard.
   */
  private async streamWithTimeout(
    adapter: ProviderAdapter,
    modelId: string,
    messages: ContextMessage[],
    context: ExecutionContext,
    agentId: string,
    traceId: string,
    _onStream: (event: OrchestrationStreamEvent) => void,
    onToken: (token: string) => void
  ): Promise<{
    content: string;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  }> {
    const completionPromise = (async (): Promise<{
      content: string;
      promptTokens: number;
      completionTokens: number;
      cacheReadTokens?: number | undefined;
      cacheWriteTokens?: number | undefined;
    }> => {
      const ct = context.cancellationToken;
      const signal = ct && typeof ct.addEventListener === 'function' ? ct : undefined;
      const result = await adapter.streamCompletion(modelId, messages, onToken, {
        signal,
      });

      return {
        content: result.content,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        cacheReadTokens: (result as unknown as Record<string, unknown>)['cacheReadTokens'] as
          | number
          | undefined,
        cacheWriteTokens: (result as unknown as Record<string, unknown>)['cacheWriteTokens'] as
          | number
          | undefined,
      };
    })();

    const { promise } = createTimeoutRace(
      agentId,
      traceId,
      context.timeoutBudget,
      context.cancellationToken,
      completionPromise
    );
    return promise;
  }
}
