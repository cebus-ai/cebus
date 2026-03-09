/**
 * Hook that bridges postMessage between the WebView and extension host.
 *
 * Replaces useStream + useMessages from apps/web — receives
 * OrchestrationStreamEvent via window.addEventListener('message').
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Acquire VS Code API (available in WebView context)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() as
  | {
      postMessage: (msg: unknown) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    }
  | undefined;

export interface StreamToken {
  agentId: string;
  token: string;
}

export interface TokenUsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  premiumRequests?: number;
  estimatedCostUSD?: number;
}

export interface AgentMessage {
  id: string;
  agentId: string;
  displayName: string;
  content: string;
  complete: boolean;
  senderType: 'user' | 'agent';
  timestamp: number;
  providerId?: string;
  modelId?: string;
  tokenUsage?: TokenUsageInfo;
}

export interface ParticipantInfo {
  id: string;
  displayName: string;
  providerId?: string;
  modelId?: string;
}

export interface ProviderModelsInfo {
  providerId: string;
  providerName: string;
  models: Array<{ modelId: string; displayName: string }>;
}

export type CopilotStatus = 'stopped' | 'starting' | 'running' | 'adopted' | 'error';

export interface PendingApproval {
  approvalId: string;
  agentId: string;
  toolName: string;
  permissionKind: string;
  parameters: Record<string, unknown>;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  chatMode: string;
  modelCount: number;
  messageCount: number;
}

export interface FileAttachmentMeta {
  uri: string;
  fileName: string;
  language: string;
  lineCount: number;
  lineRange?: { start: number; end: number };
  isImage?: boolean;
}

export interface IdeActionResultData {
  action: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface UseVSCodeMessagesResult {
  sessionId: string | null;
  conversationId: string | null;
  participants: ParticipantInfo[];
  messages: AgentMessage[];
  isStreaming: boolean;
  copilotStatus: CopilotStatus;
  availableModels: ProviderModelsInfo[];
  modelsLoaded: boolean;
  error: string | null;
  pendingApprovals: PendingApproval[];
  viewMode: 'sidebar' | 'tab';
  mascotUri: string | null;
  conversations: ConversationSummary[];
  attachments: FileAttachmentMeta[];
  ideActionResult: IdeActionResultData | null;
  createSession: (
    models: Array<{ providerId: string; modelId: string; displayName: string }>,
    chatMode: string
  ) => void;
  sendMessage: (content: string) => void;
  cancelAll: () => void;
  requestModels: () => void;
  resolveApproval: (approvalId: string, approved: boolean, budget: number) => void;
  resetSession: () => void;
  listConversations: () => void;
  loadConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  requestFilePicker: () => void;
  attachActiveFile: () => void;
  removeAttachment: (uri: string) => void;
  openInTab: () => void;
  sendIdeAction: (action: string, params?: Record<string, unknown>) => void;
  attachByUri: (uri: string) => void;
  attachSelection: () => void;
  pasteImage: (dataUrl: string, fileName: string) => void;
  clearIdeActionResult: () => void;
}

interface PersistedState {
  sessionId: string | null;
  conversationId: string | null;
  participants: ParticipantInfo[];
  messages: AgentMessage[];
}

let msgCounter = 0;
function nextMsgId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = vscode?.getState() as PersistedState | undefined;
    if (raw?.sessionId) return raw;
  } catch { /* */ }
  return null;
}

function persistState(state: PersistedState): void {
  try { vscode?.setState(state); } catch { /* */ }
}

export function useVSCodeMessages(): UseVSCodeMessagesResult {
  const saved = loadPersistedState();
  const [sessionId, setSessionId] = useState<string | null>(saved?.sessionId ?? null);
  const [conversationId, setConversationId] = useState<string | null>(saved?.conversationId ?? null);
  const [participants, setParticipants] = useState<ParticipantInfo[]>(saved?.participants ?? []);
  const [messages, setMessages] = useState<AgentMessage[]>(saved?.messages ?? []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus>('stopped');
  const [availableModels, setAvailableModels] = useState<ProviderModelsInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [viewMode, setViewMode] = useState<'sidebar' | 'tab'>('sidebar');
  const [mascotUri, setMascotUri] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [attachments, setAttachments] = useState<FileAttachmentMeta[]>([]);
  const [ideActionResult, setIdeActionResult] = useState<IdeActionResultData | null>(null);

  // Track in-progress agent buffers for the current streaming round
  const agentBuffers = useRef(new Map<string, AgentMessage>());
  const participantsRef = useRef<ParticipantInfo[]>(participants);
  participantsRef.current = participants;
  // Keep a ref of committed messages (before current streaming round)
  const committedMessagesRef = useRef<AgentMessage[]>(saved?.messages ?? []);

  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'config': {
          setViewMode(msg.viewMode);
          setMascotUri(msg.mascotUri);
          break;
        }

        case 'sessionCreated': {
          setSessionId(msg.sessionId);
          setConversationId(msg.conversationId);
          setParticipants(msg.participants);
          setMessages([]);
          committedMessagesRef.current = [];
          agentBuffers.current.clear();
          persistState({ sessionId: msg.sessionId, conversationId: msg.conversationId, participants: msg.participants, messages: [] });
          break;
        }

        case 'streamEvent': {
          const ev = msg.event;
          switch (ev.type) {
            case 'start': {
              setIsStreaming(true);
              const displayName =
                participantsRef.current.find(p => p.id === ev.agentId)?.displayName ??
                ev.agentId;
              agentBuffers.current.set(ev.agentId, {
                id: nextMsgId(),
                agentId: ev.agentId,
                displayName,
                content: '',
                complete: false,
                senderType: 'agent',
                timestamp: Date.now(),
              });
              setMessages([...committedMessagesRef.current, ...agentBuffers.current.values()]);
              break;
            }
            case 'token': {
              const buf = agentBuffers.current.get(ev.agentId);
              if (buf) {
                buf.content += ev.token;
                setMessages([...committedMessagesRef.current, ...agentBuffers.current.values()]);
              }
              break;
            }
            case 'complete': {
              const buf = agentBuffers.current.get(ev.agentId);
              if (buf) {
                if (ev.content) buf.content = ev.content;
                buf.complete = true;
                // Extract token usage from complete event
                if (ev.tokenUsage) {
                  buf.tokenUsage = {
                    inputTokens: ev.tokenUsage.inputTokens,
                    outputTokens: ev.tokenUsage.outputTokens,
                    premiumRequests: ev.tokenUsage.premiumRequests,
                    estimatedCostUSD: ev.estimatedCostUSD,
                  };
                }
                setMessages([...committedMessagesRef.current, ...agentBuffers.current.values()]);
              }
              break;
            }
            case 'error': {
              const displayName =
                participantsRef.current.find(p => p.id === ev.agentId)?.displayName ??
                ev.agentId;
              agentBuffers.current.set(ev.agentId, {
                id: nextMsgId(),
                agentId: ev.agentId,
                displayName,
                content: `Error: ${ev.error?.message ?? 'Unknown error'}`,
                complete: true,
                senderType: 'agent',
                timestamp: Date.now(),
              });
              setMessages([...committedMessagesRef.current, ...agentBuffers.current.values()]);
              break;
            }
            case 'approval_required': {
              setPendingApprovals(prev => {
                if (prev.some(a => a.approvalId === ev.approvalId)) return prev;
                return [
                  ...prev,
                  {
                    approvalId: ev.approvalId,
                    agentId: ev.agentId,
                    toolName: ev.toolName,
                    permissionKind: ev.permissionKind,
                    parameters: ev.parameters,
                  },
                ];
              });
              break;
            }
            case 'approval_result': {
              setPendingApprovals(prev =>
                prev.filter(a => a.approvalId !== ev.approvalId)
              );
              break;
            }
          }
          break;
        }

        case 'streamEnd': {
          for (const buf of agentBuffers.current.values()) {
            buf.complete = true;
          }
          const allMsgs = [...committedMessagesRef.current, ...agentBuffers.current.values()];
          committedMessagesRef.current = allMsgs;
          agentBuffers.current.clear();
          setMessages(allMsgs);
          setIsStreaming(false);
          persistState({ sessionId: sessionId ?? msg.sessionId, conversationId: conversationId ?? null, participants: participantsRef.current, messages: allMsgs });
          break;
        }

        case 'models':
          setAvailableModels(msg.available);
          setModelsLoaded(true);
          break;

        case 'copilotStatus':
          setCopilotStatus(msg.state);
          break;

        case 'sessionReset': {
          setSessionId(null);
          setConversationId(null);
          setParticipants([]);
          setMessages([]);
          committedMessagesRef.current = [];
          agentBuffers.current.clear();
          setError(null);
          setPendingApprovals([]);
          setIsStreaming(false);
          setAttachments([]);
          persistState({ sessionId: null, conversationId: null, participants: [], messages: [] });
          // Refresh conversation list
          vscode?.postMessage({ type: 'listConversations' });
          break;
        }

        case 'conversationList': {
          setConversations(msg.conversations);
          break;
        }

        case 'conversationLoaded': {
          const conv = msg.conversation;
          setSessionId(conv.sessionId);
          setConversationId(conv.id);
          setParticipants(conv.participants);
          const loadedMsgs: AgentMessage[] = conv.messages.map((m: AgentMessage) => ({
            id: m.id,
            agentId: m.agentId,
            displayName: m.displayName,
            content: m.content,
            complete: true,
            senderType: m.senderType,
            timestamp: m.timestamp,
            providerId: m.providerId,
            modelId: m.modelId,
          }));
          committedMessagesRef.current = loadedMsgs;
          agentBuffers.current.clear();
          setMessages(loadedMsgs);
          setError(null);
          setAttachments([]);
          break;
        }

        case 'conversationDeleted': {
          setConversations(prev => prev.filter(c => c.id !== msg.conversationId));
          break;
        }

        case 'fileAttached': {
          setAttachments(prev => {
            if (prev.some(a => a.uri === msg.attachment.uri)) return prev;
            return [...prev, msg.attachment];
          });
          break;
        }

        case 'ideActionResult': {
          setIdeActionResult({
            action: msg.action,
            success: msg.success,
            data: msg.data,
            error: msg.error,
          });
          break;
        }

        case 'error': {
          for (const buf of agentBuffers.current.values()) {
            buf.complete = true;
          }
          const allMsgs = [...committedMessagesRef.current, ...agentBuffers.current.values()];
          committedMessagesRef.current = allMsgs;
          agentBuffers.current.clear();
          setMessages(allMsgs);
          setError(msg.message);
          setIsStreaming(false);
          break;
        }
      }
    };

    window.addEventListener('message', handler);
    vscode?.postMessage({ type: 'ready' });
    // Request conversation list on mount
    vscode?.postMessage({ type: 'listConversations' });

    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createSession = useCallback(
    (
      models: Array<{ providerId: string; modelId: string; displayName: string }>,
      chatMode: string
    ) => {
      agentBuffers.current.clear();
      committedMessagesRef.current = [];
      setMessages([]);
      setError(null);
      setAttachments([]);
      vscode?.postMessage({ type: 'createSession', models, chatMode });
    },
    []
  );

  const sendMessage = useCallback(
    (content: string) => {
      if (!sessionId) return;
      // Add the user's message to the chat history
      const userMsg: AgentMessage = {
        id: nextMsgId(),
        agentId: 'user',
        displayName: 'You',
        content,
        complete: true,
        senderType: 'user',
        timestamp: Date.now(),
      };
      const updated = [...committedMessagesRef.current, userMsg];
      committedMessagesRef.current = updated;
      agentBuffers.current.clear();
      setMessages(updated);
      setError(null);
      setIsStreaming(true);

      // Include file attachments in the message
      const attachmentMetas = attachments.length > 0 ? attachments : undefined;
      vscode?.postMessage({ type: 'sendMessage', sessionId, content, attachments: attachmentMetas });
      setAttachments([]);
    },
    [sessionId, attachments]
  );

  const cancelAll = useCallback(() => {
    if (!sessionId) return;
    vscode?.postMessage({ type: 'cancelAll', sessionId });
    // Optimistically mark all in-flight buffers as complete and exit streaming.
    // The server will also send streamEnd via the finally block, but this gives
    // immediate UI feedback so the user doesn't feel stuck.
    for (const buf of agentBuffers.current.values()) {
      buf.complete = true;
    }
    const allMsgs = [...committedMessagesRef.current, ...agentBuffers.current.values()];
    committedMessagesRef.current = allMsgs;
    agentBuffers.current.clear();
    setMessages(allMsgs);
    setIsStreaming(false);
  }, [sessionId]);

  const requestModels = useCallback(() => {
    vscode?.postMessage({ type: 'getModels' });
  }, []);

  const resolveApproval = useCallback(
    (approvalId: string, approved: boolean, budget: number) => {
      setPendingApprovals(prev => prev.filter(a => a.approvalId !== approvalId));
      vscode?.postMessage({ type: 'resolveApproval', approvalId, approved, budget });
    },
    []
  );

  const resetSession = useCallback(() => {
    if (!sessionId) return;
    vscode?.postMessage({ type: 'resetSession', sessionId });
  }, [sessionId]);

  const listConversations = useCallback(() => {
    vscode?.postMessage({ type: 'listConversations' });
  }, []);

  const loadConversation = useCallback((id: string) => {
    vscode?.postMessage({ type: 'loadConversation', conversationId: id });
  }, []);

  const deleteConversation = useCallback((id: string) => {
    vscode?.postMessage({ type: 'deleteConversation', conversationId: id });
  }, []);

  const requestFilePicker = useCallback(() => {
    vscode?.postMessage({ type: 'requestFilePicker' });
  }, []);

  const attachActiveFile = useCallback(() => {
    vscode?.postMessage({ type: 'attachActiveFile' });
  }, []);

  const removeAttachment = useCallback((uri: string) => {
    setAttachments(prev => prev.filter(a => a.uri !== uri));
  }, []);

  const openInTab = useCallback(() => {
    vscode?.postMessage({ type: 'openInTab' });
  }, []);

  const sendIdeAction = useCallback((action: string, params?: Record<string, unknown>) => {
    setIdeActionResult(null);
    vscode?.postMessage({ type: 'ideAction', action, params });
  }, []);

  const attachByUri = useCallback((uri: string) => {
    vscode?.postMessage({ type: 'attachByUri', uri });
  }, []);

  const attachSelection = useCallback(() => {
    vscode?.postMessage({ type: 'attachSelection' });
  }, []);

  const pasteImage = useCallback((dataUrl: string, fileName: string) => {
    vscode?.postMessage({ type: 'pasteImage', dataUrl, fileName });
  }, []);

  const clearIdeActionResult = useCallback(() => {
    setIdeActionResult(null);
  }, []);

  return {
    sessionId,
    conversationId,
    participants,
    messages,
    isStreaming,
    copilotStatus,
    availableModels,
    modelsLoaded,
    error,
    pendingApprovals,
    viewMode,
    mascotUri,
    conversations,
    attachments,
    ideActionResult,
    createSession,
    sendMessage,
    cancelAll,
    requestModels,
    resolveApproval,
    resetSession,
    listConversations,
    loadConversation,
    deleteConversation,
    requestFilePicker,
    attachActiveFile,
    removeAttachment,
    openInTab,
    sendIdeAction,
    attachByUri,
    attachSelection,
    pasteImage,
    clearIdeActionResult,
  };
}
