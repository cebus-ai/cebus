import { useEffect, useRef, useState, useCallback } from 'react';

interface StreamMessage {
  id: string;
  channelId: string;
  senderType: string;
  senderId: string;
  content: string;
  formatType: string;
  createdAt: string;
  replyToId: string | null;
  branchId: string | null;
}

export interface AgentActivityEntry {
  activity: string;
  result?: string | undefined;
}

export interface TypingAgent {
  agentId: string;
  displayName: string;
  status: 'thinking' | 'generating';
  activity?: string | undefined;
  activities?: AgentActivityEntry[] | undefined;
  reasoning?: string | undefined;
}

export interface PendingApproval {
  approvalId: string;
  agentId: string;
  displayName: string;
  toolName: string;
  parameters: Record<string, unknown>;
  permissionKind: string;
}

export interface PendingUserInput {
  requestId: string;
  agentId: string;
  displayName: string;
  prompt: string;
  options?: string[] | undefined;
}

export interface TlMessage {
  content: string;
  phase: string;
  messageType: string;
  timestamp: Date;
}

export interface TlPhaseInfo {
  from: string | null;
  to: string;
  reason: string;
}

export interface TlSynthesis {
  contributors: string[];
  unified_output: string;
}

export interface TlWarning {
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface TlAwaitingInput {
  question: string;
  options?: string[] | undefined;
  inputType?: string | undefined;
}

export type OrchestratorPhase = 'idle' | 'analyzing' | 'planning' | 'executing' | 'reviewing' | 'complete';

export interface OrchestratorRequest {
  phase: OrchestratorPhase;
  target: string;
  summary: string;
  intent?: string | undefined;
  planStepIndex?: number | undefined;
}

export interface OrchestratorStepResult {
  stepIndex: number;
  status: 'done' | 'failed' | 'skipped';
  agentId: string;
  agentName: string;
  resultSummary: string;
  nextStepIndex?: number | undefined;
  nextStepSummary?: string | undefined;
}

export interface OrchestratorPlanData {
  description: string;
  steps: Array<{ agentId: string; action: string; dependsOn?: number }>;
  estimatedRounds: number;
  estimatedCost: string;
  awaitingApproval: boolean;
}

export interface OrchestratorError {
  phase: OrchestratorPhase;
  message: string;
  recoverable: boolean;
}

interface StreamEvent {
  type: string;
  message?: StreamMessage;
  messageId?: string;
  messageIds?: string[];
  agentIds?: string[];
  token?: string;
  agentId?: string;
  agentName?: string;
  displayName?: string;
  status?: string;
  reason?: string;
  approvalId?: string;
  toolName?: string;
  parameters?: Record<string, unknown>;
  permissionKind?: string;
  isDm?: boolean;
  isThread?: boolean;
  activity?: string;
  kind?: string;
  result?: string;
  delta?: string;
  requestId?: string;
  prompt?: string;
  // Orchestrator events
  phase?: string;
  detail?: string;
  target?: string;
  summary?: string;
  intent?: string;
  planStepIndex?: number;
  stepIndex?: number;
  resultSummary?: string;
  nextStepIndex?: number;
  nextStepSummary?: string;
  plan?: OrchestratorPlanData;
  awaitingApproval?: boolean;
  source?: string;
  // Orchestrator error fields
  recoverable?: boolean;
  // TL events
  content?: string;
  messageType?: string;
  from?: string;
  to?: string;
  question?: string;
  options?: string[];
  inputType?: string;
  recommendation?: string;
  contributors?: string[];
  unified_output?: string;
  severity?: string;
  tlCycle?: number;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  interruptType?: string;
}

interface UseStreamOptions {
  channelId: string | null;
  onMessageCreated: (msg: StreamMessage) => void;
  onThreadReply?: ((msg: StreamMessage) => void) | undefined;
  onRefetch: () => void;
  onMessagesSeen?: ((messageIds: string[], agentIds: string[]) => void) | undefined;
  onDMMessage?: ((msg: StreamMessage) => void) | undefined;
}

function applyActivityEvent(
  prev: TypingAgent[],
  data: StreamEvent,
): TypingAgent[] {
  const agentId = data.agentId!;
  const existing = prev.find((a) => a.agentId === agentId);
  const activities = [...(existing?.activities ?? [])];

  switch (data.kind) {
    case 'start':
      activities.push({ activity: data.activity ?? '' });
      break;
    case 'progress': {
      const last = activities[activities.length - 1];
      if (last) {
        last.result = data.activity;
      } else {
        activities.push({ activity: data.activity ?? '' });
      }
      break;
    }
    case 'complete': {
      const last = activities[activities.length - 1];
      if (last && data.result !== undefined && data.result.length > 0) {
        last.result = data.result;
      }
      break;
    }
    default:
      activities.push({ activity: data.activity ?? '' });
      break;
  }

  const entry: TypingAgent = {
    agentId,
    displayName: data.displayName ?? existing?.displayName ?? 'Agent',
    status: 'thinking',
    activity: data.activity,
    activities,
    reasoning: existing?.reasoning,
  };

  if (existing) return prev.map((a) => (a.agentId === agentId ? entry : a));
  return [...prev, entry];
}

export function useStream({ channelId, onMessageCreated, onThreadReply, onRefetch, onMessagesSeen, onDMMessage }: UseStreamOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [typingAgents, setTypingAgents] = useState<TypingAgent[]>([]);
  const [streamingContent, setStreamingContent] = useState<Record<string, string>>({});
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [pendingUserInputs, setPendingUserInputs] = useState<PendingUserInput[]>([]);
  const [dmTypingAgents, setDmTypingAgents] = useState<TypingAgent[]>([]);
  const [dmStreamingContent, setDmStreamingContent] = useState<Record<string, string>>({});
  const [orchestratorPhase, setOrchestratorPhase] = useState<OrchestratorPhase | null>(null);
  const [orchestratorRequest, setOrchestratorRequest] = useState<OrchestratorRequest | null>(null);
  const [orchestratorStepResult, setOrchestratorStepResult] = useState<OrchestratorStepResult | null>(null);
  const [orchestratorError, setOrchestratorError] = useState<OrchestratorError | null>(null);
  const [tlMessages, setTlMessages] = useState<TlMessage[]>([]);
  const [tlPhase, setTlPhase] = useState<TlPhaseInfo | null>(null);
  const [tlSynthesis, setTlSynthesis] = useState<TlSynthesis | null>(null);
  const [tlWarning, setTlWarning] = useState<TlWarning | null>(null);
  const [tlAwaitingInput, setTlAwaitingInput] = useState<TlAwaitingInput | null>(null);
  const [tlActive, setTlActive] = useState(false);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs so EventSource doesn't get recreated when callbacks change
  const onMessageCreatedRef = useRef(onMessageCreated);
  const onThreadReplyRef = useRef(onThreadReply);
  const onRefetchRef = useRef(onRefetch);
  const onMessagesSeenRef = useRef(onMessagesSeen);
  const onDMMessageRef = useRef(onDMMessage);
  onMessageCreatedRef.current = onMessageCreated;
  onThreadReplyRef.current = onThreadReply;
  onRefetchRef.current = onRefetch;
  onMessagesSeenRef.current = onMessagesSeen;
  onDMMessageRef.current = onDMMessage;

  const clearTyping = useCallback(() => {
    setTypingAgents([]);
    setStreamingContent({});
  }, []);

  const resolveApproval = useCallback((approvalId: string) => {
    setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  }, []);

  const resolveUserInput = useCallback((requestId: string) => {
    setPendingUserInputs((prev) => prev.filter((r) => r.requestId !== requestId));
  }, []);

  const clearTlState = useCallback(() => {
    setTlMessages([]);
    setTlPhase(null);
    setTlSynthesis(null);
    setTlWarning(null);
    setTlAwaitingInput(null);
    setTlActive(false);
  }, []);

  const resolveTlInput = useCallback(() => {
    setTlAwaitingInput(null);
  }, []);

  useEffect(() => {
    if (channelId === null || channelId.length === 0) {
      setTypingAgents([]);
      setStreamingContent({});
      setPendingApprovals([]);
      setPendingUserInputs([]);
      setDmTypingAgents([]);
      setDmStreamingContent({});
      setOrchestratorPhase(null);
      setOrchestratorRequest(null);
      setOrchestratorStepResult(null);
      setOrchestratorError(null);
      setTlMessages([]);
      setTlPhase(null);
      setTlSynthesis(null);
      setTlWarning(null);
      setTlAwaitingInput(null);
      setTlActive(false);
      return;
    }

    function createEventSource(id: string): EventSource {
      const es = new EventSource(`/api/stream/${id}`);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as StreamEvent;

          // Handle DM events for inbox/DM panel
          if (data.isDm) {
            if (data.type === 'agent_typing' && data.agentId) {
              setDmTypingAgents((prev) => {
                const entry: TypingAgent = {
                  agentId: data.agentId!,
                  displayName: data.displayName ?? 'Agent',
                  status: (data.status as 'thinking' | 'generating') ?? 'thinking',
                };
                const existing = prev.find((a) => a.agentId === data.agentId);
                if (existing) return prev.map((a) => (a.agentId === data.agentId ? entry : a));
                return [...prev, entry];
              });
            } else if (data.type === 'token' && data.agentId && data.token) {
              setDmStreamingContent((prev) => ({
                ...prev,
                [data.agentId!]: (prev[data.agentId!] ?? '') + data.token!,
              }));
            } else if (data.type === 'agent_typing_stop' && data.agentId) {
              setDmTypingAgents((prev) => prev.filter((a) => a.agentId !== data.agentId));
              setDmStreamingContent((prev) => {
                const next = { ...prev };
                delete next[data.agentId!];
                return next;
              });
            } else if (data.type === 'message_created' && data.message) {
              setDmTypingAgents((prev) => prev.filter((a) => a.agentId !== data.message!.senderId));
              setDmStreamingContent((prev) => {
                const next = { ...prev };
                delete next[data.message!.senderId];
                return next;
              });
              onDMMessageRef.current?.(data.message);
            } else if (data.type === 'agent_activity' && data.agentId) {
              setDmTypingAgents((prev) => applyActivityEvent(prev, data));
            } else if (data.type === 'reasoning_delta' && data.agentId && data.delta) {
              setDmTypingAgents((prev) => {
                const agentId = data.agentId!;
                const existing = prev.find((a) => a.agentId === agentId);
                const entry: TypingAgent = {
                  agentId,
                  displayName: existing?.displayName ?? 'Agent',
                  status: 'thinking',
                  activities: existing?.activities,
                  reasoning: (existing?.reasoning ?? '') + data.delta!,
                };
                if (existing) return prev.map((a) => (a.agentId === agentId ? entry : a));
                return [...prev, entry];
              });
            }
            return;
          }

          // For thread events, only handle message_created (to route to ThreadPanel)
          // Skip typing/token events so they don't show in the main chat
          if (data.isThread && data.type !== 'message_created') return;

          if (data.type === 'agent_typing' && data.agentId) {
            setTypingAgents((prev) => {
              const agentId = data.agentId!;
              const existing = prev.find((a) => a.agentId === agentId);
              const entry: TypingAgent = {
                agentId,
                displayName: data.displayName ?? 'Agent',
                status: (data.status as 'thinking' | 'generating') ?? 'thinking',
                activities: existing?.activities,
                reasoning: existing?.reasoning,
              };
              if (existing) {
                return prev.map((a) => (a.agentId === agentId ? entry : a));
              }
              return [...prev, entry];
            });
          } else if (data.type === 'token' && data.agentId && data.token) {
            setStreamingContent((prev) => ({
              ...prev,
              [data.agentId!]: (prev[data.agentId!] ?? '') + data.token!,
            }));
          } else if (data.type === 'agent_typing_stop' && data.agentId) {
            setTypingAgents((prev) => prev.filter((a) => a.agentId !== data.agentId));
            setStreamingContent((prev) => {
              const next = { ...prev };
              delete next[data.agentId!];
              return next;
            });
          } else if (data.type === 'message_created' && data.message) {
            if (data.message.senderType === 'agent') {
              setTypingAgents((prev) => prev.filter((a) => a.agentId !== data.message!.senderId));
              setStreamingContent((prev) => {
                const next = { ...prev };
                delete next[data.message!.senderId];
                return next;
              });
            }
            // Route thread replies separately — don't show in main chat
            if (data.message.replyToId) {
              onThreadReplyRef.current?.(data.message);
            } else {
              onMessageCreatedRef.current(data.message);
            }
          } else if (data.type === 'message_deleted' && data.messageId) {
            onRefetchRef.current();
          } else if (data.type === 'message_updated' && data.message) {
            onRefetchRef.current();
          } else if (data.type === 'message_complete') {
            onRefetchRef.current();
          } else if (data.type === 'tool_approval_required' && data.approvalId) {
            setPendingApprovals((prev) => [
              ...prev.filter((a) => a.approvalId !== data.approvalId),
              {
                approvalId: data.approvalId!,
                agentId: data.agentId ?? '',
                displayName: data.displayName ?? 'Agent',
                toolName: data.toolName ?? '',
                parameters: data.parameters ?? {},
                permissionKind: data.permissionKind ?? '',
              },
            ]);
          } else if (data.type === 'messages_seen' && data.messageIds && data.agentIds) {
            onMessagesSeenRef.current?.(data.messageIds, data.agentIds);
          } else if (data.type === 'agent_activity' && data.agentId) {
            setTypingAgents((prev) => applyActivityEvent(prev, data));
          } else if (data.type === 'reasoning_delta' && data.agentId && data.delta) {
            setTypingAgents((prev) => {
              const agentId = data.agentId!;
              const existing = prev.find((a) => a.agentId === agentId);
              const entry: TypingAgent = {
                agentId,
                displayName: existing?.displayName ?? 'Agent',
                status: 'thinking',
                activities: existing?.activities,
                reasoning: (existing?.reasoning ?? '') + data.delta!,
              };
              if (existing) return prev.map((a) => (a.agentId === agentId ? entry : a));
              return [...prev, entry];
            });
          } else if (data.type === 'user_input_request' && data.agentId && data.requestId) {
            setPendingUserInputs((prev) => [
              ...prev.filter((r) => r.requestId !== data.requestId),
              {
                requestId: data.requestId!,
                agentId: data.agentId!,
                displayName: data.displayName ?? 'Agent',
                prompt: data.prompt ?? '',
                options: Array.isArray(data.options) ? data.options as string[] : undefined,
              },
            ]);
          } else if (data.type === 'orchestrator_phase' && data.phase) {
            const phase = data.phase as OrchestratorPhase;
            setOrchestratorPhase(phase);
            if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
            if (phase === 'complete') {
              phaseTimerRef.current = setTimeout(() => {
                setOrchestratorPhase(null);
                setOrchestratorRequest(null);
                setOrchestratorStepResult(null);
              }, 3000);
            }
          } else if (data.type === 'orchestrator_request' && data.summary) {
            setOrchestratorRequest({
              phase: (data.phase as OrchestratorPhase) ?? 'executing',
              target: data.target ?? '',
              summary: data.summary,
              intent: data.intent,
              planStepIndex: data.planStepIndex,
            });
          } else if (data.type === 'orchestrator_step_result' && data.resultSummary) {
            setOrchestratorStepResult({
              stepIndex: data.stepIndex ?? 0,
              status: (data.status as 'done' | 'failed' | 'skipped') ?? 'done',
              agentId: data.agentId ?? '',
              agentName: data.agentName ?? '',
              resultSummary: data.resultSummary,
              nextStepIndex: data.nextStepIndex,
              nextStepSummary: data.nextStepSummary,
            });
          } else if (data.type === 'tl_message' && data.content) {
            setTlActive(true);
            setTlMessages((prev) => [
              ...prev,
              {
                content: data.content!,
                phase: data.phase ?? 'unknown',
                messageType: data.messageType ?? 'guidance',
                timestamp: new Date(),
              },
            ]);
          } else if (data.type === 'tl_phase_change' && data.to) {
            setTlActive(true);
            setTlPhase({
              from: data.from ?? null,
              to: data.to!,
              reason: data.reason ?? '',
            });
          } else if (data.type === 'tl_awaiting_input' && data.question) {
            setTlAwaitingInput({
              question: data.question!,
              options: data.options,
              inputType: data.inputType,
            });
          } else if (data.type === 'tl_summary' && data.recommendation) {
            setTlMessages((prev) => [
              ...prev,
              {
                content: data.recommendation!,
                phase: data.phase ?? 'summary',
                messageType: 'summary',
                timestamp: new Date(),
              },
            ]);
          } else if (data.type === 'tl_synthesis' && data.unified_output) {
            setTlSynthesis({
              contributors: data.contributors ?? [],
              unified_output: data.unified_output!,
            });
            setTlActive(false);
          } else if (data.type === 'tl_warning') {
            const rawMsg = (data as unknown as Record<string, unknown>)['message'] as string | undefined;
            setTlWarning({
              message: rawMsg ?? 'Unknown warning',
              severity: (data.severity as 'info' | 'warning' | 'error') ?? 'warning',
            });
          } else if (data.type === 'tl_metrics') {
            // Metrics are logged server-side; no UI action needed
          } else if (data.type === 'tl_interrupt' && data.interruptType) {
            setTlMessages((prev) => [
              ...prev,
              {
                content: `User interrupt: ${data.interruptType}${data.target ? ` → ${data.target}` : ''}`,
                phase: 'interrupt',
                messageType: 'interrupt',
                timestamp: new Date(),
              },
            ]);
          } else if (data.type === 'orchestrator_error') {
            const errData = data as unknown as { phase?: string; message?: string; recoverable?: boolean };
            setOrchestratorError({
              phase: (errData.phase as OrchestratorPhase) ?? 'idle',
              message: errData.message ?? 'Unknown error',
              recoverable: errData.recoverable ?? true,
            });
          }
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        es.close();
        // Reconnect quickly, then refetch to recover missed messages
        setTimeout(() => {
          if (eventSourceRef.current === es) {
            const reconnected = createEventSource(id);
            eventSourceRef.current = reconnected;
            onRefetchRef.current();
          }
        }, 1000);
      };

      return es;
    }

    const eventSource = createEventSource(channelId);
    eventSourceRef.current = eventSource;

    // Restore pending user inputs from server (survives page refresh)
    fetch(`/api/trpc/message.getPendingUserInputs?input=${encodeURIComponent(JSON.stringify({ channelId }))}`, {
      credentials: 'include',
    })
      .then(res => res.json())
      .then((json: { result?: { data?: PendingUserInput[] } }) => {
        const stored = json?.result?.data;
        if (Array.isArray(stored) && stored.length > 0) {
          setPendingUserInputs(stored);
        }
      })
      .catch(() => {
        // Non-critical — pending inputs just won't be restored
      });

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
      setTypingAgents([]);
      setStreamingContent({});
      setPendingApprovals([]);
      setPendingUserInputs([]);
      setDmTypingAgents([]);
      setDmStreamingContent({});
      setOrchestratorPhase(null);
      setOrchestratorRequest(null);
      setOrchestratorStepResult(null);
      setOrchestratorError(null);
      setTlMessages([]);
      setTlPhase(null);
      setTlSynthesis(null);
      setTlWarning(null);
      setTlAwaitingInput(null);
      setTlActive(false);
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, [channelId]); // Only re-subscribe when channelId changes

  return {
    typingAgents,
    streamingContent,
    clearTyping,
    pendingApprovals,
    resolveApproval,
    pendingUserInputs,
    resolveUserInput,
    dmTypingAgents,
    dmStreamingContent,
    orchestratorPhase,
    orchestratorRequest,
    orchestratorStepResult,
    orchestratorError,
    tlMessages,
    tlPhase,
    tlSynthesis,
    tlWarning,
    tlAwaitingInput,
    tlActive,
    clearTlState,
    resolveTlInput,
  };
}
