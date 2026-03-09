import { StateGraph, START, END, Send, Overwrite, type BaseCheckpointSaver } from '@langchain/langgraph';
import { HumanMessage, AIMessage, trimMessages } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { OrchestrationState } from './state.js';
import type { OrchestrationStateType } from './state.js';
import { createOrchestratorNode } from './orchestrator/index.js';
import { createAnalyzerNode, createEvaluatorNode, createTlDecisionNode } from './orchestrator/middleware.js';
import { createPlannerNode } from './orchestrator/planner.js';
import { detectUserInterrupt } from './orchestrator/user-interrupt.js';
import { deletePlanFile } from './orchestrator/plan-file.js';
import { debug } from '../core/debug-logger.js';
import { createWorker } from './worker/factory.js';
import { SessionManager } from './session/manager.js';
import { StructuredLogger } from './observability/logger.js';
import { generateTraceId } from './observability/tracer.js';
import type {
  TeamConfig,
  CompileOptions,
  OrchestrationGraph,
  OrchestrationInput,
  InvokeOptions,
  OrchestrationOutput,
  OrchestrationStreamEvent,
  StreamCallbackRef,
  ExecutionContext,
  RoutingDecision,
  AgentResponse,
  SessionStartResult,
  CircuitBreakerState,
  BudgetStatus,
  WorkerExecutor,
  OrchestrationLogger,
  ConversationHistoryEntry,
  SummaryAnchor,
} from './types.js';
import { OrchestrationError } from './types.js';
import type { CopilotWorker } from './worker/copilot-worker.js';
import { getModelTier, getTierTokenBudget, estimateTokens } from '../core/model-tiers.js';
import { getContextWindow } from '../core/model-pricing.js';
import { extractTextFromContent } from '../core/message.js';
import { getParticipant } from '../core/session.js';
import { compactMessages } from './session/compaction.js';
import { filterHistoryForAgent } from './worker/shared/history-filter.js';

interface CompileResult {
  graph: CompiledGraph;
  workers: Map<string, WorkerExecutor>;
  sessionManager: SessionManager;
  logger: OrchestrationLogger;
  /** Mutable ref container for the stream callback, shared with the graph impl */
  streamCallbackRef: StreamCallbackRef;
  /** Shared map of active AbortControllers keyed by agentId — enables cancel-from-UI */
  activeAbortControllers: Map<string, AbortController>;
}

/**
 * LangGraph SDK does not export the CompiledGraph type from `@langchain/langgraph`.
 * The compiled graph returned by `StateGraph.compile()` is typed as a complex generic
 * that cannot be referenced without `any`. This alias keeps the workaround localized.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompiledGraph = any;

/**
 * Compile a validated TeamConfig into a runnable LangGraph.
 */
export async function compileGraph(
  config: TeamConfig,
  options?: CompileOptions,
  agentToParticipant?: ReadonlyMap<string, string>
): Promise<CompileResult> {
  const logger = new StructuredLogger(process.env['DEBUG'] === 'true');
  const sessionManager = new SessionManager(config);

  const streamCallbackRef: StreamCallbackRef = {
    current: options?.onStream,
  };

  const workers = new Map<string, WorkerExecutor>();
  for (const agent of config.agents) {
    const worker = await createWorker(agent, logger);
    workers.set(agent.id, worker);
  }

  const activeAbortControllers = new Map<string, AbortController>();

  const orchestratorFn = createOrchestratorNode(config, logger, activeAbortControllers);
  const graphBuilder = new StateGraph(OrchestrationState);

  graphBuilder.addNode('orchestrator', async (state: OrchestrationStateType) => {
    const traceId =
      state.currentTraceId !== null && state.currentTraceId.length > 0
        ? state.currentTraceId
        : generateTraceId();

    // When the orchestrator middleware has already selected agents,
    // pass through its decisions instead of running the routing strategy.
    // This preserves the analyzer's agent selection and orchestratorGuidance.
    // directedTo (@mentions) still takes priority — handled below.
    if (
      state.directedTo.length === 0 &&
      state.orchestratorAnalysis !== null &&
      state.orchestratorAnalysis !== undefined &&
      state.orchestratorAnalysis.selectedAgents.length > 0 &&
      state.activeAgentId !== null &&
      state.activeAgentId.length > 0
    ) {
      const analyzerAgents = state.orchestratorAnalysis.selectedAgents.filter(id =>
        config.agents.some(a => a.id === id)
      );

      const decision: RoutingDecision = {
        traceId,
        timestamp: Date.now(),
        mode: config.conversationMode,
        orchestrationMode: config.orchestrationMode,
        targetAgentIds: analyzerAgents,
        reason: `Orchestrator middleware: ${state.orchestratorAnalysis.intent}`,
        fallbackUsed: false,
      };

      return {
        routingDecisions: [decision],
        activeAgentId: analyzerAgents[0] ?? null,
        pendingAgents: analyzerAgents.slice(1),
        systemCommand: null,
        lastSpeakerIndex: state.lastSpeakerIndex,
        executionContexts: state.executionContexts,
        isComplete: analyzerAgents.length === 0,
      };
    }

    const result = await orchestratorFn(state, traceId);

    // If directedTo is set, override routing — only those agents respond
    let targetAgentIds = result.targetAgentIds;
    let executionContexts = result.executionContexts;
    if (state.directedTo.length > 0) {
      targetAgentIds = state.directedTo.filter(id => config.agents.some(a => a.id === id));
      const DEFAULT_TIMEOUT = 60000;
      const directedContexts: Record<string, ExecutionContext> = {};
      for (const agentId of targetAgentIds) {
        // eslint-disable-next-line security/detect-object-injection -- agentId from filtered config.agents
        if (executionContexts[agentId] !== undefined) {
          // eslint-disable-next-line security/detect-object-injection -- agentId from filtered config.agents
          directedContexts[agentId] = executionContexts[agentId]!;
        } else {
          const controller = new AbortController();
          activeAbortControllers.set(agentId, controller);
          // eslint-disable-next-line security/detect-object-injection -- agentId from filtered config.agents
          directedContexts[agentId] = {
            activeAgentId: agentId,
            allowedTools: ['*'],
            routingReason: 'Directed via @mention',
            timeoutBudget: DEFAULT_TIMEOUT,
            cancellationToken: controller.signal,
          };
        }
      }
      executionContexts = directedContexts;
    }

    return {
      routingDecisions: [result.routingDecision],
      activeAgentId: targetAgentIds[0] ?? null,
      pendingAgents: targetAgentIds.slice(1),
      systemCommand: result.systemCommand,
      lastSpeakerIndex: result.lastSpeakerIndex,
      executionContexts,
      isComplete: result.systemCommand !== null || targetAgentIds.length === 0,
    };
  });

  graphBuilder.addNode('worker', async (state: OrchestrationStateType) => {
    const agentId = state.activeAgentId;
    if (agentId === null || agentId.length === 0) {
      return { isComplete: true };
    }

    const worker = workers.get(agentId);
    if (worker === undefined) {
      return { isComplete: true };
    }

    const agentProfile = config.agents.find(a => a.id === agentId);
    if (!agentProfile) {
      return { isComplete: true };
    }

    const traceId =
      state.currentTraceId !== null && state.currentTraceId.length > 0
        ? state.currentTraceId
        : generateTraceId();
    // eslint-disable-next-line security/detect-object-injection -- agentId validated above
    const baseContext = state.executionContexts[agentId];

    if (!baseContext) {
      return { isComplete: true };
    }

    // The cancellationToken (AbortSignal) stored in state may have been serialized
    // through the LangGraph checkpointer, losing its EventTarget prototype and
    // connection to the original AbortController. Always use the live controller
    // from the shared map so cancelAll() works correctly.
    let liveSignal: AbortSignal | undefined;
    const liveController = activeAbortControllers.get(agentId);
    if (liveController) {
      liveSignal = liveController.signal;
    } else {
      const freshController = new AbortController();
      activeAbortControllers.set(agentId, freshController);
      liveSignal = freshController.signal;
    }

    const lastHumanMessage = [...state.messages].reverse().find(m => m._getType() === 'human');
    const messageContent = extractTextFromContent(lastHumanMessage?.content) || 'Hello';

    const agentNameMap = new Map(config.agents.map(a => [a.id, a.name]));

    // Separate prior history from same-turn AI responses (from earlier sequential agents).
    // Same-turn responses must appear AFTER the user message in chronological order.
    const lastHumanIdx = lastHumanMessage
      ? state.messages.indexOf(lastHumanMessage)
      : -1;

    // AI messages that came after the user's message in this turn (sequential agent responses)
    const sameTurnAIMessages =
      lastHumanIdx >= 0
        ? state.messages.slice(lastHumanIdx + 1).filter(m => m._getType() === 'ai')
        : [];
    const sameTurnSet = new Set(sameTurnAIMessages);

    // Prior history excludes the current user message AND same-turn responses
    // (same-turn responses are passed separately via context.sameTurnResponses)
    const allPriorMessages = state.messages.filter(
      m =>
        m !== lastHumanMessage &&
        !sameTurnSet.has(m) &&
        (m._getType() === 'human' || m._getType() === 'ai')
    );

    const mappedSameTurn =
      sameTurnAIMessages.length > 0
        ? sameTurnAIMessages
            .map(m => ({
              role: 'assistant' as const,
              content: extractTextFromContent(m.content),
              name:
                agentNameMap.get((m as AIMessage).name ?? '') ??
                (m as AIMessage).name ??
                undefined,
            }))
            .filter(m => m.content.length > 0)
        : undefined;

    const executionContext: ExecutionContext = {
      ...baseContext,
      cancellationToken: liveSignal,
      ...(state.attachments.length > 0 ? { attachments: state.attachments } : {}),
      ...(mappedSameTurn !== undefined && mappedSameTurn.length > 0
        ? { sameTurnResponses: mappedSameTurn }
        : {}),
    };

    const currentIsBroadcast = state.directedTo.length === 0;
    const filteredMessages = filterHistoryForAgent(agentId, allPriorMessages, currentIsBroadcast);

    const onStream: (event: OrchestrationStreamEvent) => void =
      streamCallbackRef.current ?? ((): void => {});

    const isCopilot = agentProfile.provider?.type === 'copilot';

    // Determine windowing mode:
    // - Copilot: skip all windowing/compaction (SDK has built-in Infinite Sessions)
    // - maxHistoryMessages set → message-count mode (backwards compat)
    // - Otherwise → token-budget mode via trimMessages
    let history: { role: string; content: string; name: string | undefined }[];
    let newAnchor: SummaryAnchor | undefined;

    if (isCopilot) {
      // Copilot path: SDK handles compaction natively — pass all messages through
      history = filteredMessages
        .map(m => ({
          role: m._getType() === 'human' ? 'user' : 'assistant',
          content: extractTextFromContent(m.content),
          name:
            m._getType() === 'ai'
              ? (agentNameMap.get((m as AIMessage).name ?? '') ??
                (m as AIMessage).name ??
                undefined)
              : undefined,
        }))
        .filter(m => m.content.length > 0);

      // Informational event — no actual compaction performed
      onStream({
        type: 'compaction_status',
        traceId,
        agentId,
        agentName: agentProfile.name,
        source: 'sdk',
        totalMessages: filteredMessages.length,
        windowSize: filteredMessages.length,
        compactedMessages: 0,
        summarized: false,
      });
    } else {
      // LangChain path
      const useMessageMode = config.compaction?.maxHistoryMessages !== undefined;

      let keptMessages: typeof filteredMessages;
      let overflowMessages: typeof filteredMessages;
      let windowSize: number;
      let totalTokens: number | undefined;
      let tokenBudget: number | undefined;
      let windowTokens: number | undefined;

      if (useMessageMode) {
        // Message-count mode (original behavior)
        const historyWindow = config.compaction!.maxHistoryMessages!;
        windowSize = historyWindow;
        if (filteredMessages.length > historyWindow) {
          overflowMessages = filteredMessages.slice(0, filteredMessages.length - historyWindow);
          keptMessages = filteredMessages.slice(-historyWindow);
        } else {
          overflowMessages = [];
          keptMessages = filteredMessages;
        }
      } else {
        // Token-budget mode via trimMessages
        const tier = getModelTier(agentProfile.model ?? '');
        const budget = config.compaction?.maxHistoryTokens ?? getTierTokenBudget(tier);
        tokenBudget = budget;

        const trimmed = await trimMessages(filteredMessages, {
          maxTokens: budget,
          tokenCounter: msgs =>
            msgs.reduce((acc, m) => acc + estimateTokens(extractTextFromContent(m.content)), 0),
          strategy: 'last',
        });

        keptMessages = trimmed as typeof filteredMessages;
        overflowMessages = filteredMessages.slice(0, filteredMessages.length - keptMessages.length);
        windowSize = keptMessages.length;

        // Compute token stats
        windowTokens = keptMessages.reduce(
          (acc, m) => acc + estimateTokens(extractTextFromContent(m.content)),
          0
        );
        totalTokens = filteredMessages.reduce(
          (acc, m) => acc + estimateTokens(extractTextFromContent(m.content)),
          0
        );
      }

      // Cache Anchor: frozen summary that stays static for multiple turns to maximize prompt caching.
      // Instead of recomputing the summary every turn (which breaks cache), we freeze it
      // and only regenerate when unanchored overflow exceeds a threshold.
      let compactionSummary: string | undefined;

      if (config.compaction?.enabled === true && overflowMessages.length > 0) {
        // eslint-disable-next-line security/detect-object-injection -- agentId validated above
        const existingAnchor = state.summaryAnchors[agentId];

        // Provider-aware threshold: local models don't benefit from prompt caching
        const providerType = agentProfile.provider?.type ?? 'openai';
        const isLocal = providerType === 'ollama';
        const anchorThreshold = isLocal ? 2 : (config.compaction.anchorRefreshThreshold ?? 5);

        const unanchoredCount =
          existingAnchor !== undefined
            ? overflowMessages.length - existingAnchor.cutoffIndex
            : Infinity;

        if (existingAnchor !== undefined && unanchoredCount < anchorThreshold) {
          // Reuse frozen anchor — [system + anchor] prefix stays identical → CACHED by provider
          compactionSummary = existingAnchor.text;
        } else {
          // Regenerate: summarize ALL overflow and freeze a new anchor
          const overflowTexts = overflowMessages
            .map(m => {
              const role = m._getType() === 'human' ? 'user' : 'assistant';
              const name =
                m._getType() === 'ai'
                  ? (agentNameMap.get((m as AIMessage).name ?? '') ??
                    (m as AIMessage).name ??
                    undefined)
                  : undefined;
              const content = extractTextFromContent(m.content);
              return name !== undefined
                ? `[${name}] (${role}): ${content}`
                : `(${role}): ${content}`;
            })
            .filter(t => t.length > 5);

          if (overflowTexts.length > 0) {
            const summary = await compactMessages(
              overflowTexts,
              config.compaction.summaryModel,
              config.compaction.summaryProvider
            );

            if (summary !== undefined && summary.length > 0) {
              compactionSummary = summary;
              newAnchor = {
                text: summary,
                cutoffIndex: overflowMessages.length,
                createdAt: new Date().toISOString(),
                tokenEstimate: estimateTokens(summary),
              };
            }
          }
        }
      }

      history = keptMessages
        .map(m => ({
          role: m._getType() === 'human' ? 'user' : 'assistant',
          content: extractTextFromContent(m.content),
          name:
            m._getType() === 'ai'
              ? (agentNameMap.get((m as AIMessage).name ?? '') ??
                (m as AIMessage).name ??
                undefined)
              : undefined,
        }))
        .filter(m => m.content.length > 0);

      // Prepend compaction summary as a context entry if available
      if (compactionSummary !== undefined && compactionSummary.length > 0) {
        history.unshift({
          role: 'user',
          content: `[Previous conversation summary]\n${compactionSummary}`,
          name: undefined,
        });
      }

      // Emit compaction status so the UI can show progress toward compaction
      // eslint-disable-next-line security/detect-object-injection -- agentId validated above
      const existingAnchorForMetrics = state.summaryAnchors[agentId];
      const ctxWindow = getContextWindow(agentProfile.model ?? '');
      const sentTokens =
        (compactionSummary !== undefined && compactionSummary.length > 0
          ? estimateTokens(compactionSummary)
          : 0) +
        (windowTokens ?? 0) +
        estimateTokens(messageContent);
      const contextUtilization =
        ctxWindow > 0 ? Math.round((sentTokens / ctxWindow) * 100) : undefined;
      onStream({
        type: 'compaction_status',
        traceId,
        agentId,
        agentName: agentProfile.name,
        source: 'custom',
        totalMessages: filteredMessages.length,
        windowSize,
        compactedMessages: overflowMessages.length,
        summarized: compactionSummary !== undefined,
        totalTokens,
        tokenBudget,
        windowTokens,
        anchorAge: existingAnchorForMetrics
          ? overflowMessages.length - existingAnchorForMetrics.cutoffIndex
          : 0,
        anchorReused:
          existingAnchorForMetrics !== undefined &&
          compactionSummary === existingAnchorForMetrics.text,
        contextUtilization,
      });
    }

    const nextAgent = state.pendingAgents[0] ?? null;
    const remainingAgents = state.pendingAgents.slice(1);

    try {
      let effectiveHistory = history;
      let response: AgentResponse;

      try {
        response = await worker.execute(
          agentProfile,
          messageContent,
          effectiveHistory,
          executionContext,
          onStream,
          traceId
        );
      } catch (execErr) {
        // Context overflow: halve history and retry once
        if (
          execErr instanceof OrchestrationError &&
          execErr.code === 'CONTEXT_OVERFLOW' &&
          effectiveHistory.length > 1
        ) {
          effectiveHistory = effectiveHistory.slice(Math.floor(effectiveHistory.length / 2));
          onStream({
            type: 'compaction_status',
            traceId,
            agentId: agentId!,
            agentName: agentProfile.name,
            source: 'emergency',
            totalMessages: filteredMessages.length,
            windowSize: effectiveHistory.length,
            compactedMessages: filteredMessages.length - effectiveHistory.length,
            summarized: false,
          });
          response = await worker.execute(
            agentProfile,
            messageContent,
            effectiveHistory,
            executionContext,
            onStream,
            traceId
          );
        } else {
          throw execErr;
        }
      }

      activeAbortControllers.delete(agentId);

      // Persist Copilot SDK sessionId for zero-cost resume on next session restore
      if (isCopilot && agentToParticipant) {
        const copilotWorker = worker as unknown as CopilotWorker;
        const copilotSid = copilotWorker.getSessionId();
        const participantId = agentToParticipant.get(agentId);
        if (
          copilotSid !== null &&
          copilotSid.length > 0 &&
          participantId !== undefined &&
          participantId.length > 0
        ) {
          const participant = getParticipant(state.sessionId, participantId);
          if (participant) {
            participant.providerSessionState = {
              sessionId: copilotSid,
              modelId: agentProfile.model ?? '',
              workingDir: agentProfile.allowedPaths?.[0],
              createdAt: participant.providerSessionState?.createdAt ?? new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              lastProcessedMessageIndex: 0,
              contextInitialized: true,
            };
          }
        }
      }

      // Persist provider session state for non-Copilot workers (LangChain + ProviderAdapter)
      if (!isCopilot && agentToParticipant) {
        const sessionWorker = worker as unknown as {
          getProviderSessionState?():
            | import('../providers/types.js').ProviderSessionState
            | import('../providers/types.js').ProviderSessionStateUnion
            | null;
        };
        if (typeof sessionWorker.getProviderSessionState === 'function') {
          const sessionState = sessionWorker.getProviderSessionState();
          const participantId = agentToParticipant.get(agentId);
          if (sessionState !== null && participantId !== undefined && participantId.length > 0) {
            const participant = getParticipant(state.sessionId, participantId);
            if (participant) {
              participant.providerSessionState = sessionState;
            }
          }
        }
      }

      const aiMessage = new AIMessage({
        content: response.content,
        name: agentId,
        additional_kwargs:
          state.directedTo.length > 0 ? { respondingTo: [...state.directedTo] } : {},
      });

      // When TL is enabled, omit isComplete entirely — TL owns the completion
      // decision and the worker must not overwrite it (last-write-wins reducer).
      // Without TL, mark complete when no agents are pending.
      return {
        messages: [aiMessage],
        activeAgentId: nextAgent,
        pendingAgents: remainingAgents,
        ...(hasTl ? {} : { isComplete: nextAgent === null }),
        ...(newAnchor ? { summaryAnchors: { [agentId]: newAnchor } } : {}),
      };
    } catch (err) {
      activeAbortControllers.delete(agentId);

      const errorCode = err instanceof OrchestrationError ? err.code : 'WORKER_EXECUTION';
      const errorMsg = err instanceof Error ? err.message : 'Unknown worker error';
      logger.workerError(traceId, agentId, errorMsg);

      onStream({
        type: 'error',
        agentId,
        traceId,
        error: {
          code: errorCode,
          message: errorMsg,
          agentId,
          recoverable: errorCode !== 'CANCELLED',
        },
      });

      const isCancelled = errorCode === 'CANCELLED';
      return {
        activeAgentId: isCancelled ? null : nextAgent,
        pendingAgents: isCancelled ? [] : remainingAgents,
        // TL owns completion — only set isComplete when not in TL mode, or on cancel
        ...(hasTl
          ? (isCancelled ? { isComplete: true } : {})
          : { isComplete: isCancelled || nextAgent === null }),
      };
    }
  });

  const hasOrchestrator = config.orchestrator !== undefined;
  const hasTl = config.teamLeader?.enabled === true && hasOrchestrator;

  if (hasOrchestrator) {
    const analyzerFn = createAnalyzerNode(config, streamCallbackRef, activeAbortControllers);
    const evaluatorFn = createEvaluatorNode(config, streamCallbackRef, activeAbortControllers);
    const plannerFn = createPlannerNode(config, streamCallbackRef, activeAbortControllers);

    graphBuilder.addNode('orchestrator_analyzer', async (state: OrchestrationStateType) => {
      return await analyzerFn(state);
    });

    graphBuilder.addNode('orchestrator_evaluator', async (state: OrchestrationStateType) => {
      return await evaluatorFn(state);
    });

    graphBuilder.addNode('orchestrator_planner', async (state: OrchestrationStateType) => {
      return await plannerFn(state);
    });

    // TL decision node — added when teamLeader is enabled
    if (hasTl) {
      const tlFn = createTlDecisionNode(config, streamCallbackRef, activeAbortControllers);

      graphBuilder.addNode('tl_decision', async (state: OrchestrationStateType) => {
        try {
        // Detect user interrupt before TL processes
        const lastHumanMsg = [...state.messages].reverse().find(m => m._getType() === 'human');
        if (lastHumanMsg) {
          const msgContent = typeof lastHumanMsg.content === 'string'
            ? lastHumanMsg.content
            : '';
          const userInterrupt = detectUserInterrupt(msgContent);
          if (userInterrupt !== null) {
            return {
              ...await tlFn({ ...state, userOverride: userInterrupt }),
            };
          }
        }
        return await tlFn(state);
        } catch (err) {
          debug('orchestrator', 'tl-decision-error', { error: String(err) });
          return { isComplete: true };
        }
      });
    }

    // When TL is enabled, skip the analyzer entirely — TL does its own analysis.
    // This eliminates a redundant LLM call per user message.
    if (hasTl) {
      graphBuilder.addEdge(START, 'tl_decision' as '__start__');
    } else {
      graphBuilder.addEdge(START, 'orchestrator_analyzer' as '__start__');
    }

    graphBuilder.addConditionalEdges(
      'orchestrator_analyzer' as '__start__',
      (state: OrchestrationStateType) => {
        if (state.isComplete) return END;
        if (state.systemCommand === 'await_approval') return END;

        // Plan just approved — analyzer already dispatched workers, go straight to them
        if (state.orchestratorPlanApproved && state.activeAgentId !== null && state.activeAgentId.length > 0) {
          // Parallel dispatch only in free_chat — sequential modes must loop
          if (state.pendingAgents.length > 0 && config.conversationMode === 'free_chat') {
            const allAgents = [state.activeAgentId, ...state.pendingAgents];
            return allAgents.map(
              agentId =>
                new Send('worker', {
                  ...state,
                  activeAgentId: agentId,
                  pendingAgents: [],
                  isComplete: false,
                })
            );
          }
          return 'worker';
        }

        const a = state.orchestratorAnalysis;
        // Already has inline plan — skip planner
        if (a?.plan) return 'orchestrator';
        // Complex → always plan
        if (a?.complexity === 'complex') return 'orchestrator_planner';
        // Moderate with 2+ agents → also plan
        if (a?.complexity === 'moderate' && (a?.selectedAgents.length ?? 0) > 1)
          return 'orchestrator_planner';
        return 'orchestrator';
      }
    );

    graphBuilder.addConditionalEdges(
      'orchestrator_planner' as '__start__',
      (state: OrchestrationStateType) => {
        if (state.systemCommand === 'await_approval') return END;
        return 'orchestrator';
      }
    );

    // TL decision routing — after TL decides, route to worker or loop or END
    // NOTE: TL always uses sequential worker dispatch (no Send fan-out), even in
    // free_chat mode.  LangGraph Send() creates parallel branches whose results
    // merge, but the post-merge routing back to tl_decision is unreliable in
    // LangGraph v1.x — the stream ends before the next tl_decision cycle completes.
    // Sequential dispatch avoids this: worker loops through pendingAgents, then
    // the single worker→tl_decision edge fires correctly for synthesis/review.
    if (hasTl) {
      graphBuilder.addConditionalEdges(
        'tl_decision' as '__start__',
        (state: OrchestrationStateType) => {
          if (state.activeAgentId !== null && state.activeAgentId.length > 0) {
            return 'worker';
          }
          if (state.isComplete) return END;
          return 'tl_decision';
        }
      );
    }

    graphBuilder.addConditionalEdges(
      'orchestrator' as '__start__',
      (state: OrchestrationStateType) => {
        if (state.isComplete) return END;
        if (state.activeAgentId === null || state.activeAgentId.length === 0) return END;

        if (config.conversationMode === 'free_chat') {
          const allAgents = [state.activeAgentId, ...state.pendingAgents];
          return allAgents.map(
            agentId =>
              new Send('worker', {
                ...state,
                activeAgentId: agentId,
                pendingAgents: [],
                isComplete: false,
              })
          );
        }

        return 'worker';
      }
    );

    // worker → tl_decision (if TL enabled) or orchestrator_evaluator
    graphBuilder.addConditionalEdges('worker' as '__start__', (state: OrchestrationStateType) => {
      // If there are pending agents queued, always run them regardless of isComplete.
      // TL greeting bypass sets isComplete + routes all agents — they must all execute.
      if (state.activeAgentId !== null && state.activeAgentId.length > 0)
        return 'worker';
      // All agents done — if TL already marked complete (e.g. greeting bypass),
      // skip the return trip to tl_decision — avoids unnecessary LLM call
      if (state.isComplete) return END;
      // No more pending — route back to TL or evaluator
      return hasTl ? 'tl_decision' : 'orchestrator_evaluator';
    });

    // evaluator → worker (next round) or END
    graphBuilder.addConditionalEdges(
      'orchestrator_evaluator' as '__start__',
      (state: OrchestrationStateType) => {
        if (state.isComplete) return END;
        if (state.activeAgentId !== null && state.activeAgentId.length > 0) return 'worker';
        return END;
      }
    );
  } else {
    // No orchestrator middleware — original flow

    // Wire edges: START → orchestrator
    graphBuilder.addEdge(START, 'orchestrator' as '__start__');

    // Conditional edge from orchestrator
    graphBuilder.addConditionalEdges(
      'orchestrator' as '__start__',
      (state: OrchestrationStateType) => {
        if (state.isComplete) return END;
        if (state.activeAgentId === null || state.activeAgentId.length === 0) return END;

        if (config.conversationMode === 'free_chat') {
          const allAgents = [state.activeAgentId, ...state.pendingAgents];
          return allAgents.map(
            agentId =>
              new Send('worker', {
                ...state,
                activeAgentId: agentId,
                pendingAgents: [],
                isComplete: false,
              })
          );
        }

        return 'worker';
      }
    );

    // Conditional edge from worker — loop back for pending agents
    graphBuilder.addConditionalEdges('worker' as '__start__', (state: OrchestrationStateType) => {
      if (state.activeAgentId !== null && state.activeAgentId.length > 0 && !state.isComplete)
        return 'worker';
      return END;
    });
  }

  // Compile
  const checkpointer = options?.checkpointer as BaseCheckpointSaver | undefined;
  const compiledGraph = graphBuilder.compile(checkpointer ? { checkpointer } : {});

  return {
    graph: compiledGraph,
    workers,
    sessionManager,
    logger,
    streamCallbackRef,
    activeAbortControllers,
  };
}

/**
 * Convert prior conversation history entries into LangChain messages
 * for seeding the graph state (e.g. resumed sessions).
 */
function buildHistoryMessages(
  history: readonly ConversationHistoryEntry[] | undefined
): (HumanMessage | AIMessage)[] {
  if (history === undefined || history.length === 0) return [];

  return history.map(entry => {
    if (entry.role === 'user') {
      return new HumanMessage({
        content: entry.content,
        additional_kwargs:
          entry.directedTo !== undefined && entry.directedTo.length > 0
            ? { directedTo: entry.directedTo }
            : {},
      });
    }
    if (entry.name !== undefined && entry.name.length > 0) {
      return new AIMessage({ content: entry.content, name: entry.name });
    }
    return new AIMessage(entry.content);
  });
}

export class OrchestrationGraphImpl implements OrchestrationGraph {
  public readonly agentToParticipant: ReadonlyMap<string, string>;

  /** Shared ref for overriding the stream callback at runtime */
  private readonly streamCallbackRef: StreamCallbackRef;

  /** Shared map of active AbortControllers keyed by agentId */
  private readonly activeAbortControllers: Map<string, AbortController>;

  constructor(
    private readonly graph: CompiledGraph,
    private readonly config: TeamConfig,
    private readonly workers: Map<string, WorkerExecutor>,
    private readonly sessionManager: SessionManager,
    private readonly logger: OrchestrationLogger,
    agentToParticipant?: ReadonlyMap<string, string>,
    streamCallbackRef?: StreamCallbackRef,
    activeAbortControllers?: Map<string, AbortController>
  ) {
    this.agentToParticipant = agentToParticipant ?? new Map();
    this.streamCallbackRef = streamCallbackRef ?? { current: undefined };
    this.activeAbortControllers = activeAbortControllers ?? new Map();
  }

  cancelAgent(agentId: string): void {
    const controller = this.activeAbortControllers.get(agentId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(agentId);
    }
    const worker = this.workers.get(agentId);
    if (worker?.abort) void worker.abort();
  }

  cancelAll(): string[] {
    const cancelled: string[] = [];
    for (const [agentId, controller] of this.activeAbortControllers) {
      controller.abort();
      const worker = this.workers.get(agentId);
      if (worker?.abort) void worker.abort();
      cancelled.push(agentId);
    }
    this.activeAbortControllers.clear();
    return cancelled;
  }

  async invoke(input: OrchestrationInput, options?: InvokeOptions): Promise<OrchestrationOutput> {
    const traceId = input.traceId ?? generateTraceId();

    const directed = input.directedTo ?? [];
    const graphInput: Record<string, unknown> = {
      messages: [
        ...buildHistoryMessages(input.conversationHistory),
        new HumanMessage({
          content: input.message,
          additional_kwargs: directed.length > 0 ? { directedTo: directed } : {},
        }),
      ],
      currentTraceId: traceId,
      sessionId: input.sessionId,
      directedTo: directed,
      attachments: input.attachments ?? [],
      // Reset transient state so stale checkpoint values don't short-circuit
      isComplete: false,
      activeAgentId: null,
      pendingAgents: [],
      executionContexts: {},
      systemCommand: null,
      // Clear stale routing decisions from previous checkpoint (bypass append reducer)
      routingDecisions: new Overwrite([]),
      // Orchestrator state: preserve approved analysis if provided, otherwise reset
      orchestratorAnalysis: input.approvedAnalysis ?? null,
      orchestratorRound: 0,
      orchestratorPlanApproved: input.approvedAnalysis ? true : null,
      // TL state: reset transient fields, preserve ledger path for continuity
      currentPhase: null,
      previousPhase: null,
      tlCycle: 0,
      budgets: null,
      userOverride: null,
    };

    const graphConfig: RunnableConfig = {
      configurable: { thread_id: input.threadId ?? input.sessionId },
    };

    if (options?.signal) {
      graphConfig.signal = options.signal;
    }

    // Run the graph
    const result = await (
      this.graph as {
        invoke: (
          input: Record<string, unknown>,
          config: RunnableConfig
        ) => Promise<Record<string, unknown>>;
      }
    ).invoke(graphInput, graphConfig);
    const state = result as unknown as OrchestrationStateType;

    // Extract routing decision
    const decisions = state.routingDecisions;
    const routingDecision = decisions[decisions.length - 1];

    if (!routingDecision) {
      throw new OrchestrationError('ROUTING_FAILURE', 'No routing decision was made', traceId);
    }

    // Extract agent responses from AI messages
    const responses: AgentResponse[] = [];
    const aiMessages = state.messages.filter(
      m => m._getType() === 'ai' && m.name !== undefined && m.name !== ''
    );

    for (const msg of aiMessages) {
      const agentLabel = msg.name ?? '';
      const agentProfile = this.config.agents.find(
        a => a.id === agentLabel || a.name === agentLabel
      );
      if (agentProfile) {
        responses.push({
          agentId: agentProfile.id,
          agentName: agentProfile.name,
          content: extractTextFromContent(msg.content),
          toolInvocations: [],
        });
      }
    }

    // Update session message count
    this.sessionManager.updateMessageCount(input.sessionId, state.messages.length);

    return {
      responses,
      routingDecision,
      traceId,
    };
  }

  async *stream(
    input: OrchestrationInput,
    options?: InvokeOptions
  ): AsyncIterable<OrchestrationStreamEvent> {
    const traceId = input.traceId ?? generateTraceId();

    const directed = input.directedTo ?? [];
    const graphInput: Record<string, unknown> = {
      messages: [
        ...buildHistoryMessages(input.conversationHistory),
        new HumanMessage({
          content: input.message,
          additional_kwargs: directed.length > 0 ? { directedTo: directed } : {},
        }),
      ],
      currentTraceId: traceId,
      sessionId: input.sessionId,
      directedTo: directed,
      attachments: input.attachments ?? [],
      // Reset transient state so stale checkpoint values don't short-circuit
      isComplete: false,
      activeAgentId: null,
      pendingAgents: [],
      executionContexts: {},
      systemCommand: null,
      // Clear stale routing decisions from previous checkpoint (bypass append reducer)
      routingDecisions: new Overwrite([]),
      // Orchestrator state: preserve approved analysis if provided, otherwise reset
      orchestratorAnalysis: input.approvedAnalysis ?? null,
      orchestratorRound: 0,
      orchestratorPlanApproved: input.approvedAnalysis ? true : null,
      // TL state: reset transient fields, preserve ledger path for continuity
      currentPhase: null,
      previousPhase: null,
      tlCycle: 0,
      budgets: null,
      userOverride: null,
    };

    const graphConfig: RunnableConfig = {
      configurable: { thread_id: input.threadId ?? input.sessionId },
    };

    if (options?.signal) {
      graphConfig.signal = options.signal;
    }

    // Use a queue to collect events from workers
    const eventQueue: OrchestrationStreamEvent[] = [];
    let resolveWaiter: (() => void) | undefined;
    let done = false;

    // Set up the stream callback that pushes events into the queue
    const pushToQueue = (event: OrchestrationStreamEvent): void => {
      eventQueue.push(event);
      if (resolveWaiter) {
        const waiter = resolveWaiter;
        resolveWaiter = undefined;
        waiter();
      }
    };

    // Temporarily set the shared stream callback ref so workers push to the queue
    const prevCallback = this.streamCallbackRef.current;
    this.streamCallbackRef.current = pushToQueue;

    // Run graph in background, collecting stream events
    const graphPromise = (async (): Promise<void> => {
      try {
        const streamIterator = await (
          this.graph as {
            stream: (
              input: Record<string, unknown>,
              config: RunnableConfig
            ) => Promise<AsyncIterable<unknown>>;
          }
        ).stream(graphInput, graphConfig);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of streamIterator) {
          // State updates flow through — events are pushed to queue via pushToQueue
        }
      } catch (graphErr) {
        debug('orchestrator', 'graph-stream-error', { error: String(graphErr) });
      } finally {
        this.streamCallbackRef.current = prevCallback;
        done = true;
        if (resolveWaiter) {
          const waiter = resolveWaiter;
          resolveWaiter = undefined;
          waiter();
        }
      }
    })();

    // Yield events as they arrive
    while (!done || eventQueue.length > 0) {
      if (eventQueue.length > 0) {
        const event = eventQueue.shift();
        if (event) yield event;
      } else if (!done) {
        await new Promise<void>(resolve => {
          resolveWaiter = resolve;
        });
      }
    }

    await graphPromise;

    yield { type: 'session_end', traceId, sessionId: input.sessionId };
  }

  async startSession(): Promise<SessionStartResult> {
    const result = this.sessionManager.startSession();
    this.logger.sessionStart(result.sessionId, result.teamId);
    return result;
  }

  async endSession(sessionId: string): Promise<void> {
    // Dispose all workers (destroys SDK sessions, not the shared client)
    for (const worker of this.workers.values()) {
      await worker.dispose();
    }

    deletePlanFile(sessionId);
    await this.sessionManager.endSession(sessionId);
    this.logger.sessionEnd(sessionId);
  }

  async resumeSession(sessionId: string): Promise<SessionStartResult> {
    return this.sessionManager.resumeSession(sessionId);
  }

  async getMCPHealth(): Promise<Record<string, CircuitBreakerState>> {
    // MCP health — implemented in Phase 5
    return {};
  }

  async getBudgetStatus(sessionId: string): Promise<BudgetStatus> {
    // Budget status — implemented in Phase 5b
    return {
      sessionId,
      agentUsage: {},
      totalTokens: 0,
      limits: {
        perAgentPerSession: this.config.budgets?.maxTokensPerAgentPerSession ?? null,
        perSession: this.config.budgets?.maxTokensPerSession ?? null,
        perMinute: this.config.budgets?.maxInvocationsPerMinute ?? null,
      },
    };
  }

  async respondToInputRequest(requestId: string, answer: string): Promise<void> {
    const match = /^(.+)-input-\d+$/.exec(requestId);
    if (match?.[1] === undefined || match[1].length === 0) {
      throw new OrchestrationError('WORKER_EXECUTION', `Invalid requestId format: ${requestId}`);
    }
    const agentId = match[1];

    const worker = this.workers.get(agentId);
    if (!worker) {
      throw new OrchestrationError('WORKER_EXECUTION', `Worker not found for agentId: ${agentId}`);
    }

    const copilotWorker = worker as unknown as CopilotWorker;
    if (typeof copilotWorker.resolveInputRequest !== 'function') {
      throw new OrchestrationError(
        'WORKER_EXECUTION',
        `Worker ${agentId} does not support input request resolution`
      );
    }

    copilotWorker.resolveInputRequest(requestId, answer);
  }

  async respondToApproval(approvalId: string, approved: boolean, budget?: number): Promise<void> {
    // Parse agentId from approvalId format: "{agentId}-perm-{N}"
    const permIndex = approvalId.lastIndexOf('-perm-');
    if (permIndex === -1) {
      throw new OrchestrationError('WORKER_EXECUTION', `Invalid approvalId format: ${approvalId}`);
    }
    const agentId = approvalId.slice(0, permIndex);

    const worker = this.workers.get(agentId);
    if (!worker) {
      throw new OrchestrationError('WORKER_EXECUTION', `Worker not found for agentId: ${agentId}`);
    }

    // CopilotWorker has a resolveApproval method
    const copilotWorker = worker as unknown as CopilotWorker;
    if (typeof copilotWorker.resolveApproval !== 'function') {
      throw new OrchestrationError(
        'WORKER_EXECUTION',
        `Worker ${agentId} does not support approval resolution`
      );
    }

    const response = { approved, budget: budget ?? (approved ? 1 : 0) };
    copilotWorker.resolveApproval(approvalId, response);

    // Emit approval_result event
    const onStream = this.streamCallbackRef.current;
    if (onStream) {
      onStream({
        type: 'approval_result',
        traceId: '',
        approvalId,
        approved,
      });
    }
  }
}
