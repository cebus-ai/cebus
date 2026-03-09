import type React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { readFileSync } from 'fs';
import { extname } from 'path';
import type {
  Message,
  Participant,
  Attachment,
  OrchestrationStreamEvent,
  ConversationHistoryEntry,
  OrchestrationGraph,
  OrchestratorAnalysis,
} from '@cebus/engine';
import {
  getMessages,
  getSession,
  addMessage,
  updateMessage,
  createUserMessage,
  markMessageSent,
  parseMentions,
  getOrCompileGraph,
  createPlaceholder,
  logMessage,
  logChatMessage,
  detectUrls,
  findProjectRoot,
} from '@cebus/engine';
import type {
  PendingUrlConfirmation,
  PendingToolApproval,
  OrchestratorMessage,
  StaticEntry,
  StreamFlushBuffer,
  PendingPlanApproval,
  PlanProgress,
  AgentActivityEntry,
  PendingUserInput,
} from '../chat-types';

import {
  handleTokenEvent,
  handleStartEvent,
  handleCompleteEvent,
  handleErrorEvent,
  handleOrchestratorAnalysis,
  handleOrchestratorPlan,
  handleOrchestratorRound,
  handleOrchestratorDirect,
  handleOrchestratorComplete,
  handleOrchestratorPhase,
  handleOrchestratorRequest,
  handleOrchestratorStepResult,
  handleOrchestratorError,
  handleOrchestratorReasoning,
  handleApprovalRequired,
  handleApprovalResult,
  handleCompactionStatus,
  handleAgentActivity,
  handleReasoningDelta,
  handleReasoningComplete,
  handleUserInputRequest,
  handleTlRoutingPlan,
  handleTlMessage,
  handleTlPhaseChange,
  handleTlAwaitingInput,
  handleTlSummary,
  handleTlSynthesis,
  handleTlWarning,
  handleTlThinking,
  handleTlMetrics,
  handleTlInterrupt,
  type StreamHandlerContext,
} from './handlers';

interface UseStreamProcessorParams {
  sessionId: string;
  participants: Participant[];
  resumeMode: 'full' | 'summary' | 'none' | undefined;
  resumeSummary: string | undefined;
  resumeThreadId: string | undefined;
  staticIds: React.MutableRefObject<Set<string>>;
  setStaticEntries: React.Dispatch<React.SetStateAction<StaticEntry[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

interface StreamProcessorResult {
  streamingParticipants: string[];
  waitingParticipants: string[];
  orchestratorMessages: OrchestratorMessage[];
  compactionNotice: string | null;
  planProgress: PlanProgress | null;
  pendingPlanApproval: PendingPlanApproval | null;
  agentActivity: Map<string, AgentActivityEntry[]>;
  reasoningContent: Map<string, string>;
  pendingUserInput: PendingUserInput | null;
  pendingAttachments: Array<string | Attachment>;
  pendingUrlConfirmation: PendingUrlConfirmation | null;
  pendingToolApproval: PendingToolApproval | null;
  graphRef: React.MutableRefObject<OrchestrationGraph | null>;
  streamFlushRef: React.MutableRefObject<Map<string, StreamFlushBuffer>>;
  streamingMessageIds: React.MutableRefObject<Set<string>>;
  streamedMessageIds: React.MutableRefObject<Set<string>>;
  streamingOrder: React.MutableRefObject<string[]>;
  threadIdRef: React.MutableRefObject<string | undefined>;
  userMessageCount: React.MutableRefObject<number>;
  modelResponseCount: React.MutableRefObject<number>;
  sessionStartTime: React.MutableRefObject<Date>;
  handleSubmit: (content: string, directedTo?: string[]) => void;
  handleUrlConfirmation: (fetchContent: boolean) => void;
  handleToolApproval: (approved: boolean, budget: number) => void;
  cancelAll: () => void;
  sendMessage: (
    content: string,
    directedTo?: string[],
    fetchWebContent?: boolean,
    approvedAnalysis?: OrchestratorAnalysis
  ) => Promise<void>;
  setOrchestratorMessages: React.Dispatch<React.SetStateAction<OrchestratorMessage[]>>;
  setPendingPlanApproval: React.Dispatch<React.SetStateAction<PendingPlanApproval | null>>;
  setPlanProgress: React.Dispatch<React.SetStateAction<PlanProgress | null>>;
  handleUserInputResponse: (requestId: string, answer: string) => void;
  cancelUserInput: () => void;
  addAttachment: (attachment: string | Attachment) => void;
  clearAttachments: () => void;
  orchestratorTokenUsage: React.MutableRefObject<{ inputTokens: number; outputTokens: number; cacheReadTokens: number }>;
  tlThinking: boolean;
}

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function resolveCliAttachments(items: Array<string | Attachment>): Attachment[] {
  return items.map(item => {
    if (typeof item !== 'string') return item;
    const ext = extname(item).toLowerCase();
    if (ext in EXT_TO_MIME) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- user-provided path for attachment
      const buf = readFileSync(item);
      return {
        type: 'image' as const,
        data: buf.toString('base64'),
        // eslint-disable-next-line security/detect-object-injection -- ext from known set
        mimeType: EXT_TO_MIME[ext] ?? 'image/png',
        path: item,
        displayName: item.split(/[\\/]/).pop(),
      };
    }
    return { type: 'file' as const, path: item };
  });
}

export function useStreamProcessor({
  sessionId,
  participants,
  resumeMode,
  resumeSummary,
  resumeThreadId,
  staticIds,
  setStaticEntries,
  setMessages,
  setError,
}: UseStreamProcessorParams): StreamProcessorResult {
  const [streamingParticipants, setStreamingParticipants] = useState<string[]>([]);
  const [waitingParticipants, setWaitingParticipants] = useState<string[]>([]);
  const [orchestratorMessages, setOrchestratorMessages] = useState<OrchestratorMessage[]>([]);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<PendingPlanApproval | null>(null);
  const [planProgress, setPlanProgress] = useState<PlanProgress | null>(null);
  const [pendingUrlConfirmation, setPendingUrlConfirmation] =
    useState<PendingUrlConfirmation | null>(null);
  const [pendingToolApproval, setPendingToolApproval] = useState<PendingToolApproval | null>(null);
  const [compactionNotice, setCompactionNotice] = useState<string | null>(null);
  const [agentActivity, setAgentActivity] = useState<Map<string, AgentActivityEntry[]>>(new Map());
  const [reasoningContent, setReasoningContent] = useState<Map<string, string>>(new Map());
  const [pendingUserInput, setPendingUserInput] = useState<PendingUserInput | null>(null);
  const [tlThinking, setTlThinking] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Array<string | Attachment>>([]);
  const [, setRenderTick] = useState(0);

  // Ref mirror so sendMessage always reads the latest attachments
  // without needing pendingAttachments in its dependency array.
  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;

  const graphRef = useRef<OrchestrationGraph | null>(null);
  const threadIdRef = useRef<string | undefined>(resumeThreadId);
  const latestAnalysisRef = useRef<OrchestratorAnalysis | null>(null);
  const streamingOrder = useRef<string[]>([]);
  const streamingMessageIds = useRef(new Set<string>());
  const streamedMessageIds = useRef(new Set<string>());
  const streamFlushRef = useRef(new Map<string, StreamFlushBuffer>());
  const guidanceRef = useRef(new Map<string, string>());
  const agentActivityRef = useRef(new Map<string, AgentActivityEntry[]>());
  const orchestratorTokenUsage = useRef({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  const summaryInjected = useRef(false);
  const sessionStartTime = useRef(new Date());
  const userMessageCount = useRef(0);
  const modelResponseCount = useRef(0);

  // Auto-clear compaction notice after 4 seconds
  useEffect(() => {
    if (compactionNotice === null) return;
    const timer = setTimeout(() => setCompactionNotice(null), 4000);
    return (): void => {
      clearTimeout(timer);
    };
  }, [compactionNotice]);

  // Re-render interval: forces the live area to update with latest streaming content.
  // Content stays in the live area during streaming; final rendering is handled by
  // the 'message' Static entry added in handleCompleteEvent.
  const isStreaming = streamingParticipants.length > 0 || waitingParticipants.length > 0;
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      setRenderTick(t => t + 1);
    }, 50);
    return (): void => {
      clearInterval(interval);
    };
  }, [isStreaming]);

  const sendMessage = useCallback(
    async (
      content: string,
      directedTo?: string[],
      fetchWebContent = false,
      approvedAnalysis?: OrchestratorAnalysis
    ) => {
      const user = participants.find(p => p.type === 'user');

      if (!user) return;

      let targetIds = directedTo;

      if (!approvedAnalysis) {
        if (!targetIds) {
          const parseResult = parseMentions(content, { participants });
          if (parseResult.type !== 'broadcast') {
            targetIds = parseResult.targetIds;
          }
        }

        const userMessage = createUserMessage(sessionId, user.id, content, targetIds);
        logMessage('create', userMessage.id, {
          type: 'user',
          targetIds,
        });
        const targetNames = targetIds
          ?.map(id => participants.find(p => p.id === id)?.displayName)
          .filter((n): n is string => n !== undefined);
        logChatMessage(user.displayName, content, true, targetNames);
        addMessage(sessionId, userMessage);

        const sentMessage = markMessageSent(userMessage);
        updateMessage(sessionId, userMessage.id, sentMessage);
        staticIds.current.add(userMessage.id);
        setStaticEntries(prev => [
          ...prev,
          { id: userMessage.id, kind: 'message' as const, message: sentMessage },
        ]);
        setMessages([...getMessages(sessionId)]);
        userMessageCount.current += 1;
      }

      // Reset streaming state
      setStreamingParticipants([]);
      setWaitingParticipants([]);

      if (!approvedAnalysis) {
        setOrchestratorMessages([] as OrchestratorMessage[]);
        setPlanProgress(null);
      }
      setPendingPlanApproval(null);

      // Show waiting indicators immediately using known participants
      // so the user sees "thinking..." before graph compilation completes.
      // Exclude orchestrator/TL participant — it's internal, not a chat model.
      const orchParticipantId = getSession(sessionId)?.orchestratorConfig?.participantId;
      const earlyTargets =
        targetIds && targetIds.length > 0
          ? targetIds.filter(id => id !== orchParticipantId)
          : participants.filter(p => p.type === 'model' && p.id !== orchParticipantId).map(p => p.id);
      setWaitingParticipants(earlyTargets);

      // Yield so Ink renders the user-message + waiting indicators before
      // the potentially slow graph compilation.
      await new Promise(resolve => setTimeout(resolve, 0));

      try {
        const graph = await getOrCompileGraph(sessionId, { workingDir: findProjectRoot() });
        graphRef.current = graph;
        const idMap = graph.agentToParticipant;

        const participantToAgent = new Map<string, string>();
        for (const [agentId, participantId] of idMap) {
          participantToAgent.set(participantId, agentId);
        }

        let directedAgentIds: string[] | undefined;
        if (targetIds && targetIds.length > 0) {
          directedAgentIds = targetIds
            .map(pid => participantToAgent.get(pid))
            .filter((id): id is string => id !== undefined);
        }

        const placeholders = new Map<string, ReturnType<typeof createPlaceholder>>();
        // Exclude orchestrator from targets in broadcast mode — it's an internal node.
        // But include it when the user explicitly @mentioned it.
        const orchestratorPid = idMap.get('__orchestrator__');
        const orchestratorMentioned = directedAgentIds?.includes('__orchestrator__') === true;
        const directedPids = directedAgentIds
          ? directedAgentIds
              .map(aid => idMap.get(aid))
              .filter((id): id is string => id !== undefined)
          : null;
        // Use directed participant IDs when available; fall back to earlyTargets
        // (from mention parsing) if the agent→participant mapping produced empty results;
        // only show all models for true broadcast (no @tag).
        const targetParticipantIds = (
          directedPids && directedPids.length > 0
            ? directedPids
            : directedAgentIds
              ? earlyTargets  // mapping failed — keep the mention-parsed targets
              : [...idMap.values()]
        ).filter(pid => orchestratorMentioned || pid !== orchestratorPid);

        // Replace early waiting indicators with actual graph-based targets
        setWaitingParticipants(targetParticipantIds);

        for (const pid of targetParticipantIds) {
          const placeholder = createPlaceholder(sessionId, pid);
          placeholders.set(pid, placeholder);
          streamingMessageIds.current.add(placeholder.id);
        }

        let conversationHistory: ConversationHistoryEntry[] | undefined;
        if (
          resumeMode === 'summary' &&
          resumeSummary !== undefined &&
          resumeSummary.length > 0 &&
          !summaryInjected.current
        ) {
          conversationHistory = [
            {
              role: 'user',
              content: `[Previous conversation summary]\n${resumeSummary}`,
            },
          ];
          summaryInjected.current = true;
        }

        const startedAgents = new Set<string>();
        const markAgentStarted = (agentId: string, participantId: string): void => {
          if (startedAgents.has(agentId)) return;
          startedAgents.add(agentId);
          setWaitingParticipants(prev => prev.filter(id => id !== participantId));
          setStreamingParticipants(prev =>
            prev.includes(participantId) ? prev : [...prev, participantId]
          );
          if (!streamingOrder.current.includes(participantId)) {
            streamingOrder.current.push(participantId);
          }
        };

        const prepareForNewRound = (agentIds: string[]): void => {
          const pids: string[] = [];
          for (const agentId of agentIds) {
            startedAgents.delete(agentId);
            const pid = idMap.get(agentId);
            if (pid === undefined) continue;
            pids.push(pid);
            // Clean up old buffer so new tokens render fresh
            streamFlushRef.current.delete(pid);
            // Create a new placeholder for this round
            const placeholder = createPlaceholder(sessionId, pid);
            placeholders.set(pid, placeholder);
            streamingMessageIds.current.add(placeholder.id);
          }
          if (pids.length > 0) {
            setWaitingParticipants(prev => [...new Set([...prev, ...pids])]);
          }
        };

        // Build shared handler context
        const ctx: StreamHandlerContext = {
          sessionId,
          participants,
          idMap,
          placeholders,
          startedAgents,
          streamFlushRef,
          streamingMessageIds,
          streamedMessageIds,
          streamingOrder,
          guidanceRef,
          agentActivityRef,
          staticIds,
          modelResponseCount,
          graphRef,
          latestAnalysisRef,
          setStaticEntries,
          setStreamingParticipants,
          setWaitingParticipants,
          setMessages,
          setOrchestratorMessages,
          setPendingToolApproval,
          setPendingPlanApproval,
          setPlanProgress,
          setCompactionNotice,
          setAgentActivity,
          setReasoningContent,
          setPendingUserInput,
          setTlThinking,
          markAgentStarted,
          prepareForNewRound,
        };

        const currentAttachments = pendingAttachmentsRef.current;
        const attachments =
          currentAttachments.length > 0 ? resolveCliAttachments(currentAttachments) : undefined;
        if (attachments) {
          setPendingAttachments([]);
        }

        for await (const event of graph.stream({
          message: content,
          sessionId,
          threadId: threadIdRef.current,
          directedTo: directedAgentIds,
          fetchUrls: fetchWebContent,
          conversationHistory,

          ...(approvedAnalysis ? { approvedAnalysis } : {}),
          ...(attachments ? { attachments } : {}),
        })) {
          const streamEvent = event as OrchestrationStreamEvent;

          switch (streamEvent.type) {
            case 'token':
              handleTokenEvent(streamEvent, ctx);
              break;
            case 'start':
              handleStartEvent(streamEvent, ctx);
              break;
            case 'complete':
              handleCompleteEvent(streamEvent, ctx);
              break;
            case 'error':
              handleErrorEvent(streamEvent, ctx);
              break;
            case 'approval_required':
              handleApprovalRequired(streamEvent, ctx);
              break;
            case 'approval_result':
              handleApprovalResult(ctx);
              break;
            case 'orchestrator_analysis':
              handleOrchestratorAnalysis(streamEvent, ctx);
              break;
            case 'orchestrator_plan':
              handleOrchestratorPlan(streamEvent, ctx, content);
              break;
            case 'orchestrator_round':
              handleOrchestratorRound(streamEvent, ctx);
              break;
            case 'orchestrator_direct':
              handleOrchestratorDirect(streamEvent, ctx);
              break;
            case 'orchestrator_complete':
              handleOrchestratorComplete(streamEvent, ctx);
              break;
            case 'orchestrator_phase':
              handleOrchestratorPhase(streamEvent, ctx);
              break;
            case 'orchestrator_request':
              handleOrchestratorRequest(streamEvent, ctx);
              break;
            case 'orchestrator_step_result':
              handleOrchestratorStepResult(streamEvent, ctx);
              break;
            case 'orchestrator_error':
              handleOrchestratorError(streamEvent, ctx);
              break;
            case 'orchestrator_reasoning':
              handleOrchestratorReasoning(streamEvent, ctx);
              break;
            case 'orchestrator_token_usage': {
              const u = streamEvent.tokenUsage;
              orchestratorTokenUsage.current.inputTokens += u.inputTokens;
              orchestratorTokenUsage.current.outputTokens += u.outputTokens;
              orchestratorTokenUsage.current.cacheReadTokens += u.cacheReadTokens ?? 0;
              break;
            }
            case 'compaction_status':
              handleCompactionStatus(streamEvent, ctx);
              break;
            case 'agent_activity':
              handleAgentActivity(streamEvent, ctx);
              break;
            case 'reasoning_delta':
              handleReasoningDelta(streamEvent, ctx);
              break;
            case 'reasoning_complete':
              handleReasoningComplete(streamEvent, ctx);
              break;
            case 'user_input_request':
              handleUserInputRequest(streamEvent, ctx);
              break;
            case 'tl_routing_plan':
              handleTlRoutingPlan(streamEvent, ctx);
              break;
            case 'tl_message':
              handleTlMessage(streamEvent, ctx);
              break;
            case 'tl_phase_change':
              handleTlPhaseChange(streamEvent, ctx);
              break;
            case 'tl_awaiting_input':
              handleTlAwaitingInput(streamEvent, ctx);
              break;
            case 'tl_summary':
              handleTlSummary(streamEvent, ctx);
              break;
            case 'tl_synthesis':
              handleTlSynthesis(streamEvent, ctx);
              break;
            case 'tl_warning':
              handleTlWarning(streamEvent, ctx);
              break;
            case 'tl_thinking':
              handleTlThinking(streamEvent, ctx);
              break;
            case 'tl_metrics':
              handleTlMetrics(streamEvent, ctx);
              break;
            case 'tl_interrupt':
              handleTlInterrupt(streamEvent, ctx);
              break;
            default:
              break;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        // Batch-add all completed messages to Static now that the live area
        // is about to be cleared. This avoids Ink's cursor positioning issues
        // that occur when adding Static entries during active streaming.
        const allMsgs = getMessages(sessionId);
        const newStaticEntries: StaticEntry[] = [];

        for (const pid of streamingOrder.current) {
          const buf = streamFlushRef.current.get(pid);
          if (!buf) continue;

          const activityEntries = agentActivityRef.current.get(pid);
          if (activityEntries && activityEntries.length > 0) {
            newStaticEntries.push({
              id: `${buf.messageId}-activity`,
              kind: 'tool-activity' as const,
              senderId: pid,
              entries: activityEntries.map(e => ({ ...e })),
            });
          }

          const msg = allMsgs.find(m => m.id === buf.messageId);
          if (msg && !staticIds.current.has(msg.id)) {
            staticIds.current.add(msg.id);
            newStaticEntries.push({ id: msg.id, kind: 'message' as const, message: msg });
          }
        }

        if (newStaticEntries.length > 0) {
          setStaticEntries(prev => [...prev, ...newStaticEntries]);
        }

        streamFlushRef.current.clear();
        guidanceRef.current.clear();
        agentActivityRef.current.clear();
        streamingMessageIds.current.clear();
        setStreamingParticipants([]);
        setWaitingParticipants([]);
        setTlThinking(false);
        setPendingToolApproval(null);
        setAgentActivity(new Map());
        setReasoningContent(new Map());
        streamingOrder.current = [];
        setMessages([...getMessages(sessionId)]);
      }
    },
    [sessionId, participants]
  );

  const handleSubmit = useCallback(
    (content: string, directedTo?: string[]) => {
      // If a plan is pending, treat typed text as feedback and reject the plan
      if (pendingPlanApproval !== null) {
        const planId = `plan-feedback-${Date.now()}`;
        setStaticEntries(prev => [
          ...prev,
          { id: planId, kind: 'plan' as const, plan: pendingPlanApproval.plan, approved: false },
        ]);
        setPendingPlanApproval(null);
        setOrchestratorMessages(prev => [
          ...prev,
          { kind: 'status', content: 'Plan revised — sending feedback to Team Leader.', timestamp: new Date() },
        ]);
        void sendMessage(content, directedTo, false);
        return;
      }

      const urls = detectUrls(content);
      if (urls.length > 0) {
        setPendingUrlConfirmation({
          content,
          ...(directedTo && { directedTo }),
          urls,
        });
      } else {
        void sendMessage(content, directedTo, false);
      }
    },
    [sendMessage, pendingPlanApproval, setStaticEntries, setPendingPlanApproval, setOrchestratorMessages]
  );

  const handleUrlConfirmation = useCallback(
    (fetchContent: boolean) => {
      if (!pendingUrlConfirmation) return;
      const { content, directedTo } = pendingUrlConfirmation;
      setPendingUrlConfirmation(null);
      void sendMessage(content, directedTo, fetchContent);
    },
    [pendingUrlConfirmation, sendMessage]
  );

  const handleToolApproval = useCallback(
    (approved: boolean, budget: number) => {
      if (!pendingToolApproval || !graphRef.current) return;
      const { approvalId } = pendingToolApproval;
      setPendingToolApproval(null);
      void graphRef.current.respondToApproval(approvalId, approved, budget);
    },
    [pendingToolApproval]
  );

  const cancelAll = useCallback(() => {
    graphRef.current?.cancelAll();
  }, []);

  const handleUserInputResponse = useCallback((requestId: string, answer: string) => {
    // Reset the streaming buffer for this agent so ThinkingIndicator shows
    // instead of the stale cursor from the previous content.
    if (pendingUserInput?.participantId !== undefined && pendingUserInput.participantId.length > 0) {
      const buf = streamFlushRef.current.get(pendingUserInput.participantId);
      if (buf) {
        buf.headerEmitted = false;
      }
    }
    setPendingUserInput(null);

    // TL questions end the graph — answer is submitted as next user message
    if (requestId.startsWith('tl-input-')) {
      void sendMessage(answer);
      return;
    }

    void graphRef.current?.respondToInputRequest(requestId, answer);
  }, [pendingUserInput?.participantId, sendMessage]);

  const cancelUserInput = useCallback(() => {
    setPendingUserInput(null);
  }, []);

  const addAttachment = useCallback((attachment: string | Attachment) => {
    setPendingAttachments(prev => {
      const key = typeof attachment === 'string' ? attachment : ('path' in attachment ? attachment.path : undefined);
      if (key !== undefined && prev.some(p => (typeof p === 'string' ? p : ('path' in p ? p.path : undefined)) === key)) {
        return prev;
      }
      return [...prev, attachment];
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  return {
    streamingParticipants,
    waitingParticipants,
    orchestratorMessages,
    compactionNotice,
    agentActivity,
    reasoningContent,
    pendingUserInput,
    pendingAttachments,
    planProgress,
    pendingPlanApproval,
    pendingUrlConfirmation,
    pendingToolApproval,
    graphRef,
    streamFlushRef,
    streamingMessageIds,
    streamedMessageIds,
    streamingOrder,
    threadIdRef,
    userMessageCount,
    modelResponseCount,
    sessionStartTime,
    handleSubmit,
    handleUrlConfirmation,
    handleToolApproval,
    cancelAll,
    sendMessage,
    setOrchestratorMessages,
    setPendingPlanApproval,
    setPlanProgress,
    handleUserInputResponse,
    cancelUserInput,
    addAttachment,
    clearAttachments,
    orchestratorTokenUsage,
    tlThinking,
  };
}
