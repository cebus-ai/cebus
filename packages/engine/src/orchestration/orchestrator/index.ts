import type {
  TeamConfig,
  RoutingDecision,
  ExecutionContext,
  OrchestrationLogger,
} from '../types.js';
import type { OrchestrationStateType } from '../state.js';
import { TagOnlyStrategy } from './tag-only.js';
import { SequentialStrategy } from './sequential.js';
import { DynamicRoutingStrategy } from './dynamic.js';
import { FreeChatStrategy } from './free-chat.js';
import { extractTextFromContent } from '../../core/message.js';

const DEFAULT_TIMEOUT_PER_AGENT = 120000;

/**
 * Detect system commands before routing.
 */
function detectSystemCommand(message: string): string | null {
  const trimmed = message.trim().toLowerCase();
  if (trimmed === '/reset') return 'reset';
  if (trimmed === '/help') return 'help';
  return null;
}

/**
 * Generate help content listing available agents.
 */
function generateHelpContent(config: TeamConfig): string {
  const agentList = config.agents.map(a => `  @${a.id} — ${a.name}: ${a.role}`).join('\n');
  return `Available agents:\n${agentList}\n\nModes: ${config.conversationMode} (${config.orchestrationMode})`;
}

interface OrchestratorNodeResult {
  routingDecision: RoutingDecision;
  targetAgentIds: string[];
  executionContexts: Record<string, ExecutionContext>;
  systemCommand: string | null;
  helpContent?: string;
  lastSpeakerIndex: number;
}

/**
 * Create a orchestrator node function for the LangGraph.
 */
export function createOrchestratorNode(
  config: TeamConfig,
  logger?: OrchestrationLogger,
  abortControllers?: Map<string, AbortController>
): (
  state: OrchestrationStateType,
  traceId: string,
  signal?: AbortSignal,
  timeout?: number
) => Promise<OrchestratorNodeResult> {
  const tagOnlyStrategy = new TagOnlyStrategy();
  const sequentialStrategy = new SequentialStrategy();
  const dynamicStrategy = new DynamicRoutingStrategy(config, config.aiRouting);
  const freeChatStrategy = new FreeChatStrategy();

  return async (
    state: OrchestrationStateType,
    traceId: string,
    signal?: AbortSignal,
    timeout?: number
  ): Promise<OrchestratorNodeResult> => {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    const messageContent = extractTextFromContent(lastMessage?.content);

    // Check for system commands first
    const systemCommand = detectSystemCommand(messageContent);
    if (systemCommand === 'reset') {
      const decision: RoutingDecision = {
        traceId,
        timestamp: Date.now(),
        mode: config.conversationMode,
        orchestrationMode: config.orchestrationMode,
        targetAgentIds: [],
        reason: 'System command: /reset',
        fallbackUsed: false,
      };
      logger?.routing(decision);
      return {
        routingDecision: decision,
        targetAgentIds: [],
        executionContexts: {},
        systemCommand: 'reset',
        lastSpeakerIndex: 0,
      };
    }

    if (systemCommand === 'help') {
      const helpContent = generateHelpContent(config);
      const decision: RoutingDecision = {
        traceId,
        timestamp: Date.now(),
        mode: config.conversationMode,
        orchestrationMode: config.orchestrationMode,
        targetAgentIds: [],
        reason: 'System command: /help',
        fallbackUsed: false,
      };
      logger?.routing(decision);
      return {
        routingDecision: decision,
        targetAgentIds: [],
        executionContexts: {},
        systemCommand: 'help',
        helpContent,
        lastSpeakerIndex: state.lastSpeakerIndex,
      };
    }

    // Route based on conversation mode
    const routingState = {
      lastSpeakerIndex: state.lastSpeakerIndex,
      orchestrationMode: config.orchestrationMode,
      ...(config.defaultAgentId !== undefined ? { defaultAgentId: config.defaultAgentId } : {}),
    };

    let routingResult;
    switch (config.conversationMode) {
      case 'tag_only':
        routingResult = await tagOnlyStrategy.route(messageContent, config.agents, routingState);
        break;
      case 'sequential':
        routingResult = await sequentialStrategy.route(messageContent, config.agents, routingState);
        break;
      case 'dynamic':
        routingResult = await dynamicStrategy.route(messageContent, config.agents, routingState);
        break;
      case 'free_chat':
        routingResult = await freeChatStrategy.route(messageContent, config.agents, routingState);
        break;
    }

    // Handle help message (tag_only with no valid tags)
    if (routingResult.isHelpMessage === true) {
      const decision: RoutingDecision = {
        traceId,
        timestamp: Date.now(),
        mode: config.conversationMode,
        orchestrationMode: config.orchestrationMode,
        targetAgentIds: [],
        reason: routingResult.reason,
        tagsParsed: [],
        fallbackUsed: false,
      };
      logger?.routing(decision);
      return {
        routingDecision: decision,
        targetAgentIds: [],
        executionContexts: {},
        systemCommand: null,
        ...(routingResult.helpContent !== undefined
          ? { helpContent: routingResult.helpContent }
          : {}),
        lastSpeakerIndex: state.lastSpeakerIndex,
      };
    }

    // Each agent gets the full timeout budget — agents execute sequentially, not in parallel
    const perAgentTimeout = timeout ?? DEFAULT_TIMEOUT_PER_AGENT;
    const executionContexts: Record<string, ExecutionContext> = {};

    for (const agentId of routingResult.targetAgentIds) {
      const controller = new AbortController();
      abortControllers?.set(agentId, controller);
      // eslint-disable-next-line security/detect-object-injection -- agentId from routing result
      executionContexts[agentId] = {
        activeAgentId: agentId,
        allowedTools: ['*'],
        routingReason: routingResult.reason,
        timeoutBudget: perAgentTimeout,
        cancellationToken: signal ?? controller.signal,
      };
    }

    // Calculate new lastSpeakerIndex for sequential mode
    let newLastSpeakerIndex = state.lastSpeakerIndex;
    if (config.conversationMode === 'sequential') {
      const lastTargetId = routingResult.targetAgentIds[routingResult.targetAgentIds.length - 1];
      const idx = config.agents.findIndex(a => a.id === lastTargetId);
      if (idx !== -1) {
        newLastSpeakerIndex = idx;
      }
    }

    const decision: RoutingDecision = {
      traceId,
      timestamp: Date.now(),
      mode: config.conversationMode,
      orchestrationMode: config.orchestrationMode,
      targetAgentIds: routingResult.targetAgentIds,
      reason: routingResult.reason,
      ...(routingResult.confidence !== undefined ? { confidence: routingResult.confidence } : {}),
      ...(config.conversationMode === 'tag_only'
        ? { tagsParsed: routingResult.targetAgentIds }
        : {}),
      fallbackUsed: false,
    };

    logger?.routing(decision);

    return {
      routingDecision: decision,
      targetAgentIds: routingResult.targetAgentIds,
      executionContexts,
      systemCommand: null,
      lastSpeakerIndex: newLastSpeakerIndex,
    };
  };
}
