import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  Hash,
  Trash2,
  Settings,
  Sparkles,
  PanelLeft,
  PanelRight,
  X,
  Check,
  MessageCircle,
  Loader2,
} from 'lucide-react';
import { MessageBubble } from '../chat/MessageBubble';
import { MarkdownContent } from '../chat/MarkdownContent';
import { EmptyState } from '../chat/EmptyState';
import { MessageInput } from '../chat/MessageInput';
import { ChannelSettings } from '../settings/ChannelSettings';
import { ToolApprovalPrompt } from '../chat/ToolApprovalPrompt';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';
import type { TypingAgent, PendingApproval, PendingUserInput, OrchestratorPhase, OrchestratorRequest, OrchestratorStepResult, OrchestratorError } from '../../hooks/useStream';
import { OrchestratorStatusBar } from '../chat/OrchestratorStatusBar';
import { PlanCard } from '../chat/PlanCard';
import { resolveProviderStyle, ORCHESTRATOR_STYLE, PROVIDER_STYLES } from '../../lib/provider-styles';
import { AgentName } from '../shared/AgentName';

interface Agent {
  agentId: string;
  displayName: string;
  originalDisplayName?: string | undefined;
  displayNameOverride?: string | null | undefined;
  avatarLetter: string;
  avatarColor: string;
  provider?: string | undefined;
  model?: string | undefined;
  roleTemplate?: string | null | undefined;
  roleName?: string | null | undefined;
  roleInstructions?: string | null | undefined;
}

interface TokenUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
}

interface MessageMetadata {
  directedTo?: string[] | undefined;
  respondingTo?: string[] | undefined;
  excludedFromContext?: boolean | undefined;
  tokenUsage?: TokenUsage | undefined;
  estimatedCostUSD?: number | undefined;
  seenBy?: string[] | undefined;
  attachments?: Array<{ fileName: string; type: string }> | undefined;
  orchestratorEvent?: string | undefined;
  phase?: string | undefined;
  assignments?: Array<{ agentId: string; agentName: string; guidance: string }> | undefined;
  parallel?: boolean | undefined;
  plan?: { description: string; steps: Array<{ agentId: string; action: string; dependsOn?: number }>; estimatedRounds: number; estimatedCost: string } | undefined;
  awaitingApproval?: boolean | undefined;
}

interface Message {
  id: string;
  channelId: string;
  senderType: string;
  senderId: string;
  content: string;
  formatType: string;
  createdAt: string;
  replyToId: string | null;
  branchId: string | null;
  isHidden?: boolean | undefined;
  metadata?: MessageMetadata | null | undefined;
}

interface ChannelInfo {
  id: string;
  name: string;
  subject: string | null;
  instructions: string | null;
  chatMode: string;
  orchestratorEnabled: boolean;
  orchestratorModel: string | null;
  responseLength: string;
  contextLevel?: string | undefined;
  contextWindowSize?: number | undefined;
  includeSystemPrompt?: boolean | undefined;
  includeProjectContext?: boolean | undefined;
  includeModeGuidance?: boolean | undefined;
  includeTierGuidance?: boolean | undefined;
  includeRichComponents?: boolean | undefined;
  workingDir?: string | null | undefined;
}

function formatMessageTime(iso: string): string {
  try {
    const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
    return new Date(normalized).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function UserInputForm({ requestId, options, onSubmit }: { requestId: string; options?: string[] | undefined; onSubmit: (requestId: string, answer: string) => void }) {
  const [answer, setAnswer] = useState('');
  const [showFreeform, setShowFreeform] = useState(false);
  const { t } = useI18n();
  const hasOptions = options !== undefined && options.length > 0;

  if (hasOptions && !showFreeform) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onSubmit(requestId, opt)}
            className="rounded border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:border-indigo-500 hover:bg-zinc-700/80"
          >
            <span className="mr-2 text-xs font-medium text-zinc-500">{i + 1}.</span>
            {opt}
          </button>
        ))}
        <button
          onClick={() => setShowFreeform(true)}
          className="rounded border border-dashed border-zinc-700 px-3 py-1.5 text-left text-sm text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-300"
        >
          {t('userInput.otherOption')}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {hasOptions && (
        <button
          onClick={() => setShowFreeform(false)}
          className="self-start text-xs text-zinc-500 hover:text-zinc-300"
        >
          &larr; {t('userInput.backToOptions')}
        </button>
      )}
      <div className="flex gap-2">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && answer.trim()) {
              e.preventDefault();
              onSubmit(requestId, answer.trim());
              setAnswer('');
            }
            if (e.key === 'Escape' && hasOptions) {
              setShowFreeform(false);
            }
          }}
          placeholder={t('userInput.placeholder')}
          rows={4}
          className="min-w-0 flex-1 resize-y rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
          autoFocus
        />
        <button
          onClick={() => {
            if (answer.trim()) {
              onSubmit(requestId, answer.trim());
              setAnswer('');
            }
          }}
          disabled={!answer.trim()}
          className="self-end rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {t('userInput.send')}
        </button>
      </div>
    </div>
  );
}

interface ChatPanelProps {
  channel: ChannelInfo | null;
  channelAgents: Agent[];
  memberCount: number;
  messages: Message[];
  isLoading: boolean;
  onSend: (
    content: string,
    contextSize?: number | undefined,
    directedTo?: string[] | undefined,
    attachments?: File[] | undefined
  ) => void;
  isSending: boolean;
  onRemoveAgent?: ((agentId: string) => void) | undefined;
  onClearChat?: (() => void) | undefined;
  contextBoundaryIndex?: number | undefined;
  typingAgents?: TypingAgent[] | undefined;
  streamingContent?: Record<string, string> | undefined;
  leftPanelOpen?: boolean | undefined;
  rightPanelOpen?: boolean | undefined;
  onToggleLeftPanel?: (() => void) | undefined;
  onToggleRightPanel?: (() => void) | undefined;
  replyCounts?: Record<string, number> | undefined;
  onOpenThread?: ((messageId: string) => void) | undefined;
  pendingApprovals?: PendingApproval[] | undefined;
  onResolveApproval?: ((approvalId: string) => void) | undefined;
  onOpenDMInInbox?: ((agentId: string) => void) | undefined;
  onDropAgent?: ((agentId: string) => void) | undefined;
  isGenerating?: boolean | undefined;
  onCancelGeneration?: (() => void) | undefined;
  pendingUserInputs?: PendingUserInput[] | undefined;
  onRespondToUserInput?: ((requestId: string, answer: string) => void) | undefined;
  orchestratorPhase?: OrchestratorPhase | null | undefined;
  orchestratorRequest?: OrchestratorRequest | null | undefined;
  orchestratorStepResult?: OrchestratorStepResult | null | undefined;
  orchestratorError?: OrchestratorError | null | undefined;
}

export function ChatPanel({
  channel,
  channelAgents,
  memberCount: _memberCount,
  messages,
  isLoading,
  onSend,
  isSending,
  onRemoveAgent,
  onClearChat,
  contextBoundaryIndex = 0,
  typingAgents = [],
  streamingContent = {},
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeftPanel,
  onToggleRightPanel,
  replyCounts = {},
  onOpenThread,
  pendingApprovals = [],
  onResolveApproval,
  onOpenDMInInbox,
  onDropAgent,
  isGenerating,
  onCancelGeneration,
  pendingUserInputs = [],
  onRespondToUserInput,
  orchestratorPhase,
  orchestratorRequest,
  orchestratorStepResult,
  orchestratorError,
}: ChatPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | string>('all');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const RESPONSE_LENGTHS = [
    { value: 'free', label: t('response.free') },
    { value: 'short', label: t('response.short') },
    { value: 'medium', label: t('response.medium') },
    { value: 'detailed', label: t('response.detailed') },
  ] as const;

  const utils = trpc.useUtils();
  const updateLengthMutation = trpc.channel.update.useMutation({
    onSuccess: () => {
      if (channel) {
        void utils.channel.get.invalidate({ channelId: channel.id });
      }
    },
  });

  const archiveMutation = trpc.message.archive.useMutation({
    onSuccess: () => {
      if (channel) {
        void utils.message.list.invalidate({ channelId: channel.id });
      }
    },
  });
  const restoreMutation = trpc.message.restore.useMutation({
    onSuccess: () => {
      if (channel) {
        void utils.message.list.invalidate({ channelId: channel.id });
      }
    },
  });
  const regenerateMutation = trpc.message.regenerate.useMutation({
    onSuccess: () => {
      if (channel) {
        void utils.message.list.invalidate({ channelId: channel.id });
      }
    },
  });
  const retriggerMutation = trpc.message.retrigger.useMutation();
  const toggleContextMutation = trpc.message.toggleContext.useMutation({
    onSuccess: () => {
      if (channel) {
        void utils.message.list.invalidate({ channelId: channel.id });
      }
    },
  });
  const editAndResendMutation = trpc.message.editAndResend.useMutation({
    onSuccess: () => {
      if (channel) {
        void utils.message.list.invalidate({ channelId: channel.id });
      }
      setEditingMessageId(null);
      setEditContent('');
    },
  });
  const planApprovalMutation = trpc.message.respondToPlanApproval.useMutation();

  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Track whether user is near the bottom of the scroll area
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 80;
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Only auto-scroll if user is already near the bottom
  // useLayoutEffect prevents the visible flash/jump before scroll settles
  useLayoutEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages.length, typingAgents.length, pendingApprovals.length, streamingContent, scrollToBottom]);

  // Reset tab and scroll position on channel change
  useLayoutEffect(() => {
    setActiveTab('all');
    isNearBottomRef.current = true;
    scrollToBottom();
  }, [channel?.id, scrollToBottom]);

  const filteredMessages = useMemo(() => {
    if (activeTab === 'all') return messages;
    return messages.filter(m => m.senderType === 'user' || m.senderId === activeTab);
  }, [messages, activeTab]);

  const filteredContextBoundaryIndex = useMemo(() => {
    if (activeTab === 'all') return contextBoundaryIndex;
    if (contextBoundaryIndex === 0) return 0;
    const boundaryMsg = messages[contextBoundaryIndex];
    if (!boundaryMsg) return 0;
    const idx = filteredMessages.findIndex(m => m.id === boundaryMsg.id);
    return idx >= 0 ? idx : 0;
  }, [activeTab, contextBoundaryIndex, messages, filteredMessages]);

  const filteredTypingAgents = useMemo(() => {
    if (activeTab === 'all') return typingAgents;
    return typingAgents.filter(ta => ta.agentId === activeTab);
  }, [typingAgents, activeTab]);

  const filteredStreamingContent = useMemo(() => {
    if (activeTab === 'all') return streamingContent;
    const result: Record<string, string> = {};
    if (streamingContent[activeTab]) {
      result[activeTab] = streamingContent[activeTab];
    }
    return result;
  }, [streamingContent, activeTab]);

  const agentMap = useMemo(() => new Map(channelAgents.map(a => [a.agentId, a])), [channelAgents]);
  const agentNameMap = useMemo(() => new Map(channelAgents.map(a => [a.displayName, a])), [channelAgents]);

  const contextWindowSize = channel?.contextWindowSize ?? 10;

  // Estimate tokens per message (~4 chars per token)
  const tokenEstimates = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of messages) {
      if (!m.isHidden) {
        map.set(m.id, Math.ceil(m.content.length / 4));
      }
    }
    return map;
  }, [messages]);

  // Compute context position for each message (counting from most recent = 1)
  const contextInfo = useMemo(() => {
    const nonExcluded = messages.filter(m => !m.isHidden && !m.metadata?.excludedFromContext);
    const total = nonExcluded.length;
    const posMap = new Map<string, number>();
    nonExcluded.forEach((m, i) => {
      posMap.set(m.id, total - i); // 1 = most recent
    });
    const inContextCount = Math.min(total, contextWindowSize);

    // Sum tokens for messages that will be sent (the most recent `inContextCount`)
    const inContextMessages = nonExcluded.slice(-inContextCount);
    let inContextTokens = 0;
    let totalTokens = 0;
    for (const m of nonExcluded) {
      totalTokens += tokenEstimates.get(m.id) ?? 0;
    }
    for (const m of inContextMessages) {
      inContextTokens += tokenEstimates.get(m.id) ?? 0;
    }

    return { posMap, inContextCount, total, inContextTokens, totalTokens };
  }, [messages, contextWindowSize, tokenEstimates]);

  function getSenderInfo(msg: Message) {
    if (msg.senderType === 'user') {
      return {
        name: t('chat.you'),
        letter: 'U',
        color: '#6366f1',
        icon: undefined as string | undefined,
        nameColor: undefined as string | undefined,
        roleName: null as string | null,
        provider: undefined as string | undefined,
        model: undefined as string | null | undefined,
      };
    }
    if (msg.senderId === '__orchestrator__') {
      return {
        name: t('chat.orchestrator'),
        letter: '✦',
        color: ORCHESTRATOR_STYLE.color,
        icon: ORCHESTRATOR_STYLE.icon,
        nameColor: ORCHESTRATOR_STYLE.color,
        roleName: null as string | null,
        provider: undefined as string | undefined,
        model: undefined as string | null | undefined,
      };
    }
    const agent = agentMap.get(msg.senderId);
    const style = agent?.provider
      ? resolveProviderStyle(agent.provider, agent.model)
      : undefined;
    return {
      name: agent?.displayName ?? 'Agent',
      letter: agent?.avatarLetter ?? 'A',
      color: style?.color ?? agent?.avatarColor ?? '#8b5cf6',
      icon: style?.icon,
      nameColor: style?.color,
      roleName: agent?.roleName ?? null,
      provider: agent?.provider,
      model: agent?.model,
    };
  }

  if (!channel) {
    return (
      <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center">
        {/* Panel toggles even when no channel selected */}
        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-2 py-1.5">
          {onToggleLeftPanel && (
            <button
              onClick={onToggleLeftPanel}
              className={`rounded-md p-1 transition-colors ${leftPanelOpen ? 'text-zinc-600 hover:text-zinc-400' : 'text-zinc-400 hover:text-zinc-200'}`}
              title={leftPanelOpen ? t('panel.hideLeft') : t('panel.showLeft')}
            >
              <PanelLeft size={15} />
            </button>
          )}
          <div className="flex-1" />
          {onToggleRightPanel && (
            <button
              onClick={onToggleRightPanel}
              className={`rounded-md p-1 transition-colors ${rightPanelOpen ? 'text-zinc-600 hover:text-zinc-400' : 'text-zinc-400 hover:text-zinc-200'}`}
              title={rightPanelOpen ? t('panel.hideRight') : t('panel.showRight')}
            >
              <PanelRight size={15} />
            </button>
          )}
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20">
            <Hash size={24} className="text-indigo-400/60" />
          </div>
          <p className="text-sm text-zinc-500">{t('chat.selectChannel')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* Channel header with integrated panel toggles */}
      <div className="relative border-b border-zinc-800/60 px-2 py-2.5">
        <div className="flex items-center gap-1">
          {/* Left panel toggle */}
          {onToggleLeftPanel && (
            <button
              onClick={onToggleLeftPanel}
              className={`shrink-0 rounded-md p-1.5 transition-colors ${leftPanelOpen ? 'text-zinc-600 hover:text-zinc-400' : 'text-zinc-400 hover:text-zinc-200'}`}
              title={leftPanelOpen ? t('panel.hideLeft') : t('panel.showLeft')}
            >
              <PanelLeft size={15} />
            </button>
          )}

          {/* Channel info */}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800/80">
              <Hash size={13} className="text-zinc-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-zinc-200">{channel.name}</span>
                {channel.orchestratorEnabled && (
                  <div
                    className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5"
                    title={t('orchestrator.enabled')}
                  >
                    <Sparkles size={10} className="text-amber-400" />
                    <span className="text-[10px] font-medium text-amber-400/80">AI</span>
                  </div>
                )}
              </div>
              {channel.subject && (
                <p className="truncate text-[11px] text-zinc-500">{channel.subject}</p>
              )}
            </div>
          </div>

          {/* Right side controls */}
          <div className="flex shrink-0 items-center gap-1">
            <span className="hidden rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-500 sm:inline-block">
              {channelAgents.length}{' '}
              {channelAgents.length !== 1 ? t('chat.agents') : t('chat.agent')}
            </span>
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              title={t('chat.settings')}
            >
              <Settings size={14} />
            </button>
            {onClearChat && messages.length > 0 && (
              <button
                onClick={onClearChat}
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                title={t('chat.clearChat')}
              >
                <Trash2 size={13} />
              </button>
            )}

            {/* Right panel toggle */}
            {onToggleRightPanel && (
              <button
                onClick={onToggleRightPanel}
                className={`rounded-md p-1.5 transition-colors ${rightPanelOpen ? 'text-zinc-600 hover:text-zinc-400' : 'text-zinc-400 hover:text-zinc-200'}`}
                title={rightPanelOpen ? t('panel.hideRight') : t('panel.showRight')}
              >
                <PanelRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
        {channelAgents.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800/40 px-3 py-1.5">
            {channelAgents.length > 1 && (
              <button
                onClick={() => setActiveTab('all')}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  activeTab === 'all'
                    ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-400'
                    : 'border-zinc-800/60 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                }`}
              >
                All
              </button>
            )}
            {channelAgents.map(agent => {
              const isActive = activeTab === agent.agentId;
              return (
                <div
                  key={agent.agentId}
                  className={`group/chip flex items-center gap-1.5 rounded-full border py-0.5 ps-1 pe-1 text-xs transition-colors ${
                    isActive
                      ? 'border-indigo-500/40 bg-indigo-500/15'
                      : 'border-zinc-800/60 bg-zinc-900/50 hover:border-indigo-500/40 hover:bg-zinc-800/60'
                  }`}
                >
                  <button
                    onClick={() => {
                      if (channelAgents.length > 1) {
                        setActiveTab(isActive ? 'all' : agent.agentId);
                      }
                    }}
                    className="flex items-center gap-1.5 pe-1"
                  >
                    {(() => {
                      const chipStyle = agent.provider
                        ? resolveProviderStyle(agent.provider, agent.model)
                        : undefined;
                      return chipStyle?.icon ? (
                        <span className="flex h-4 w-4 items-center justify-center text-xs">{chipStyle.icon}</span>
                      ) : (
                        <div
                          className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white shadow-sm"
                          style={{ backgroundColor: chipStyle?.color ?? agent.avatarColor }}
                        >
                          {agent.avatarLetter}
                        </div>
                      );
                    })()}
                    <span
                      className={
                        isActive
                          ? 'text-indigo-400'
                          : 'group-hover/chip:text-zinc-300'
                      }
                      style={!isActive ? { color: (agent.provider ? resolveProviderStyle(agent.provider, agent.model).color : undefined) ?? '#a1a1aa' } : undefined}
                    >
                      <AgentName displayName={agent.displayName} provider={agent.provider} modelId={agent.model} />
                    </span>
                    {agent.roleName && (
                      <span className="text-[10px] text-indigo-400/60">{agent.roleName}</span>
                    )}
                  </button>
                  {onOpenDMInInbox && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onOpenDMInInbox(agent.agentId);
                      }}
                      className="rounded-full p-0.5 text-zinc-600 transition-colors hover:text-indigo-400 group-hover/chip:text-indigo-400/60"
                      title="Open DM"
                    >
                      <MessageCircle size={11} />
                    </button>
                  )}
                  {onRemoveAgent && (
                    <button
                      onClick={() => onRemoveAgent(agent.agentId)}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-600 opacity-0 transition-all hover:bg-zinc-700 hover:text-zinc-300 group-hover/chip:opacity-100"
                      title="Remove from channel"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

      {/* Messages area */}
      <div
        ref={scrollRef}
        className={`chat-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden transition-colors ${dragOver ? 'ring-2 ring-inset ring-indigo-500/50 bg-indigo-500/5' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/cebus-agent')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes('application/cebus-agent')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const agentId = e.dataTransfer.getData('application/cebus-agent');
          if (agentId && onDropAgent) {
            onDropAgent(agentId);
          }
        }}
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : filteredMessages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="py-2">
            {filteredMessages.map((msg, index) => {
              const sender = getSenderInfo(msg);
              const isOutOfContext =
                filteredContextBoundaryIndex > 0 && index < filteredContextBoundaryIndex;
              return (
                <div key={msg.id}>
                  {/* Context boundary divider */}
                  {filteredContextBoundaryIndex > 0 && index === filteredContextBoundaryIndex && (
                    <div className="my-2 flex items-center gap-2 px-4">
                      <div className="h-px flex-1 bg-amber-500/20" />
                      <span className="whitespace-nowrap text-[10px] text-amber-500/60">
                        {t('context.boundary')}
                      </span>
                      <div className="h-px flex-1 bg-amber-500/20" />
                    </div>
                  )}
                  <div className={isOutOfContext ? 'opacity-50' : undefined}>
                    {editingMessageId === msg.id ? (
                      <div className="flex gap-3 px-4 py-2">
                        {sender.icon ? (
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-xl">{sender.icon}</span>
                        ) : (
                          <div
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                            style={{ backgroundColor: sender.color }}
                          >
                            {sender.letter}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-sm font-semibold text-zinc-200">
                              {sender.name}
                            </span>
                            <span className="text-[10px] text-zinc-500">{t('chat.editing')}</span>
                          </div>
                          <textarea
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            className="w-full rounded border border-indigo-500/50 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                            rows={Math.max(2, editContent.split('\n').length)}
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Escape') {
                                setEditingMessageId(null);
                                setEditContent('');
                              } else if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (editContent.trim()) {
                                  editAndResendMutation.mutate({
                                    messageId: msg.id,
                                    content: editContent.trim(),
                                  });
                                }
                              }
                            }}
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (editContent.trim()) {
                                  editAndResendMutation.mutate({
                                    messageId: msg.id,
                                    content: editContent.trim(),
                                  });
                                }
                              }}
                              disabled={editAndResendMutation.isPending}
                              className="flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                            >
                              <Check size={12} />
                              {t('chat.saveAndResend')}
                            </button>
                            <button
                              onClick={() => {
                                setEditingMessageId(null);
                                setEditContent('');
                              }}
                              className="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                            >
                              <X size={12} />
                              {t('chat.cancel')}
                            </button>
                            <span className="text-[10px] text-zinc-600">
                              Esc {t('chat.toCancel')} · Enter {t('chat.toSend')}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : msg.metadata?.orchestratorEvent === 'routing_plan' && msg.metadata?.assignments?.length ? (
                      (() => {
                        const assignments = msg.metadata.assignments;
                        const prevMsg = index > 0 ? filteredMessages[index - 1] : undefined;
                        const isConsecutiveRoutingPlan = prevMsg?.metadata?.orchestratorEvent === 'routing_plan';
                        return (
                          <div>
                            {!isConsecutiveRoutingPlan && (
                              <>
                                <div className="mx-4 my-3 border-t border-violet-500/20" />
                                <div className="flex items-center gap-3 px-4 pb-1">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center text-xl">{ORCHESTRATOR_STYLE.icon}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold" style={{ color: ORCHESTRATOR_STYLE.color }}>{t('chat.orchestrator')}</span>
                                    <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                                      {t('orchestrator.dispatching')}
                                    </span>
                                    {msg.metadata.parallel && (
                                      <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-400/60">
                                        {t('orchestrator.parallel')}
                                      </span>
                                    )}
                                    <span className="text-[11px] text-zinc-600">{formatMessageTime(msg.createdAt)}</span>
                                  </div>
                                </div>
                              </>
                            )}
                            <div className="mx-4 mb-2 space-y-1.5">
                              {(() => {
                                const groups = new Map<string, typeof assignments>();
                                for (const a of assignments) {
                                  const existing = groups.get(a.guidance);
                                  if (existing) existing.push(a);
                                  else groups.set(a.guidance, [a]);
                                }
                                return [...groups.entries()].map(([guidance, agents], gi) => (
                                  <div key={gi} className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-3 py-2">
                                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                      {agents.map((a, ai) => {
                                        const agent = agentMap.get(a.agentId) ?? agentNameMap.get(a.agentName);
                                        const agentColor = agent?.provider ? resolveProviderStyle(agent.provider, agent.model).color : agent?.avatarColor ?? PROVIDER_STYLES['default']!.color;
                                        return (
                                          <div key={ai} className="flex items-center gap-1">
                                            <div
                                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                                              style={{ backgroundColor: agentColor }}
                                            >
                                              {agent?.avatarLetter ?? a.agentName.charAt(0)}
                                            </div>
                                            <span className="text-xs font-semibold">
                                              <AgentName displayName={a.agentName} provider={agent?.provider} modelId={agent?.model} />
                                            </span>
                                            {ai < agents.length - 1 && <span className="text-zinc-600">·</span>}
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <p dir="auto" className="text-[13px] leading-snug text-zinc-300">
                                      {guidance}
                                    </p>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        );
                      })()
                    ) : msg.metadata?.orchestratorEvent === 'tl_message' || msg.metadata?.orchestratorEvent === 'synthesis' || msg.metadata?.orchestratorEvent === 'routing_plan' ? (
                      (() => {
                        const evtType = msg.metadata!.orchestratorEvent!;
                        const isSynthesis = evtType === 'synthesis';
                        const isRouting = evtType === 'routing_plan';
                        const borderColor = isSynthesis ? 'border-emerald-500/20' : isRouting ? 'border-violet-500/20' : 'border-amber-500/20';
                        const bgColor = isSynthesis ? 'bg-emerald-500/5' : isRouting ? 'bg-violet-500/5' : 'bg-amber-500/5';
                        const accentColor = isSynthesis ? 'text-emerald-400' : isRouting ? 'text-violet-400' : 'text-amber-400';
                        const markerClass = isSynthesis ? '[&_li]:marker:text-emerald-400/70' : isRouting ? '[&_li]:marker:text-violet-400/70' : '[&_li]:marker:text-amber-400/70';
                        const label = isSynthesis ? t('orchestrator.synthesis') : isRouting ? t('orchestrator.dispatching') : t('orchestrator.guidance');
                        return (
                          <div>
                            <div className={`mx-4 my-3 border-t ${borderColor}`} />
                            <div className="flex items-center gap-3 px-4 pb-1">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center text-xl">{ORCHESTRATOR_STYLE.icon}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold" style={{ color: ORCHESTRATOR_STYLE.color }}>{t('chat.orchestrator')}</span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${accentColor} ${isSynthesis ? 'bg-emerald-500/10' : isRouting ? 'bg-violet-500/10' : 'bg-amber-500/10'}`}>
                                  {label}
                                </span>
                                {msg.metadata?.phase && !isSynthesis && !isRouting && (
                                  <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500/70">
                                    {msg.metadata.phase}
                                  </span>
                                )}
                                <span className="text-[11px] text-zinc-600">{formatMessageTime(msg.createdAt)}</span>
                              </div>
                            </div>
                            <div className={`mx-4 mb-2 rounded-lg border ${borderColor} ${bgColor} p-3`}>
                              <div className={`text-sm leading-relaxed text-zinc-300 ${markerClass}`}>
                                <MarkdownContent content={msg.content} />
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : msg.metadata?.orchestratorEvent === 'plan' && msg.metadata?.plan ? (
                      <PlanCard
                        description={msg.metadata.plan.description}
                        steps={msg.metadata.plan.steps}
                        estimatedRounds={msg.metadata.plan.estimatedRounds}
                        estimatedCost={msg.metadata.plan.estimatedCost}
                        awaitingApproval={msg.metadata.awaitingApproval ?? false}
                        onApprove={channel ? () => planApprovalMutation.mutate({ channelId: channel.id, approved: true }) : undefined}
                        onReject={channel ? () => planApprovalMutation.mutate({ channelId: channel.id, approved: false }) : undefined}
                      />
                    ) : (
                      <MessageBubble
                        id={msg.id}
                        senderType={msg.senderType}
                        senderId={msg.senderId}
                        content={msg.content}
                        createdAt={msg.createdAt}
                        senderName={sender.name}
                        roleName={sender.roleName}
                        avatarLetter={sender.letter}
                        avatarColor={sender.color}
                        avatarIcon={sender.icon}
                        nameColor={sender.nameColor}
                        provider={sender.provider}
                        modelId={sender.model}
                        isHidden={msg.isHidden}
                        onSendMessage={onSend}
                        replyCount={replyCounts[msg.id]}
                        onOpenThread={onOpenThread ? () => onOpenThread(msg.id) : undefined}
                        onArchive={() => archiveMutation.mutate({ messageId: msg.id })}
                        onRestore={() => restoreMutation.mutate({ messageId: msg.id })}
                        onRetry={
                          msg.senderType === 'agent'
                            ? () => regenerateMutation.mutate({ messageId: msg.id })
                            : msg.senderType === 'user'
                              ? () => retriggerMutation.mutate({ messageId: msg.id })
                              : undefined
                        }
                        onEdit={
                          msg.senderType === 'user'
                            ? () => {
                                setEditingMessageId(msg.id);
                                setEditContent(msg.content);
                              }
                            : undefined
                        }
                        directedToNames={
                          msg.senderType === 'user' && msg.metadata?.directedTo?.length
                            ? msg.metadata.directedTo
                                .map(id => {
                                  const agent = agentMap.get(id);
                                  if (!agent) return undefined;
                                  return agent.roleName
                                    ? `${agent.displayName} (${agent.roleName})`
                                    : agent.displayName;
                                })
                                .filter((n): n is string => n !== undefined)
                            : undefined
                        }
                        excludedFromContext={msg.metadata?.excludedFromContext}
                        onToggleContext={() => toggleContextMutation.mutate({ messageId: msg.id })}
                        tokenUsage={msg.metadata?.tokenUsage}
                        estimatedCostUSD={msg.metadata?.estimatedCostUSD}
                        contextPosition={contextInfo.posMap.get(msg.id)}
                        contextWindowSize={contextWindowSize}
                        estimatedTokens={tokenEstimates.get(msg.id)}
                        seenByAgents={
                          msg.metadata?.seenBy?.length
                            ? msg.metadata.seenBy
                                .filter(id => id !== msg.senderId)
                                .map(id => {
                                  const agent = agentMap.get(id);
                                  if (!agent) return undefined;
                                  const seenStyle = agent.provider
                                    ? resolveProviderStyle(agent.provider, agent.model)
                                    : undefined;
                                  return {
                                    id,
                                    displayName: agent.displayName,
                                    roleName: agent.roleName ?? null,
                                    avatarLetter: agent.avatarLetter,
                                    avatarColor: seenStyle?.color ?? agent.avatarColor,
                                    avatarIcon: seenStyle?.icon,
                                  };
                                })
                                .filter(
                                  (
                                    a
                                  ): a is {
                                    id: string;
                                    displayName: string;
                                    roleName: string | null;
                                    avatarLetter: string;
                                    avatarColor: string;
                                    avatarIcon: string | undefined;
                                  } => a !== undefined
                                )
                            : undefined
                        }
                        onOpenDM={
                          msg.senderType === 'agent' && onOpenDMInInbox
                            ? () => onOpenDMInInbox(msg.senderId)
                            : undefined
                        }
                        attachments={
                          msg.senderType === 'user' && msg.metadata?.attachments
                            ? (msg.metadata.attachments as Array<{ fileName: string; type: string }>)
                            : undefined
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {pendingApprovals.map(approval => (
              <ToolApprovalPrompt
                key={approval.approvalId}
                channelId={channel.id}
                approval={approval}
                onResolved={onResolveApproval ?? (() => {})}
              />
            ))}
            {orchestratorPhase && orchestratorPhase !== 'idle' && (
              <OrchestratorStatusBar
                phase={orchestratorPhase}
                request={orchestratorRequest ?? null}
                stepResult={orchestratorStepResult ?? null}
                error={orchestratorError}
              />
            )}
            {filteredTypingAgents.map(ta => {
              const isOrch = ta.agentId === '__orchestrator__';
              const agent = agentMap.get(ta.agentId);
              const typingStyle = isOrch
                ? ORCHESTRATOR_STYLE
                : agent?.provider
                  ? resolveProviderStyle(agent.provider, agent.model)
                  : undefined;
              const typingColor = typingStyle?.color ?? agent?.avatarColor ?? '#8b5cf6';
              const typingIcon = typingStyle?.icon;
              const letter = isOrch ? '✦' : (agent?.avatarLetter ?? 'A');
              const content = filteredStreamingContent[ta.agentId];
              const hasContent = content && content.length > 0;
              const hasActivities = ta.activities && ta.activities.length > 0;
              const lastActivityIdx = hasActivities ? ta.activities!.length - 1 : -1;
              const reasoningLines = ta.reasoning
                ? ta.reasoning.split('\n').filter(l => l.trim().length > 0).slice(-3)
                : [];
              return (
                <div key={ta.agentId} className="flex items-start gap-3 px-4 py-2">
                  {typingIcon ? (
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-xl">{typingIcon}</span>
                  ) : (
                    <div
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                      style={{ backgroundColor: typingColor }}
                    >
                      {letter}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold" style={{ color: typingColor }}>{isOrch ? t('chat.orchestrator') : ta.displayName}</span>
                      <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                        {t('chat.ai')}
                      </span>
                      {!hasContent && (
                        <>
                          <span className="text-[11px] text-zinc-600">
                            {reasoningLines.length > 0
                              ? t('chat.reasoning')
                              : ta.activity ?? (ta.status === 'thinking' ? t('chat.thinking') : t('chat.writing'))}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: '0ms' }} />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: '150ms' }} />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: '300ms' }} />
                          </span>
                        </>
                      )}
                    </div>
                    {hasContent ? (
                      <div className="mt-1">
                        <MarkdownContent content={content} isStreaming />
                        <span className="inline-block h-4 w-0.5 animate-pulse bg-indigo-400/70" />
                      </div>
                    ) : reasoningLines.length > 0 ? (
                      <div className="mt-1 space-y-0.5">
                        {reasoningLines.map((line, i) => (
                          <div key={i} className="truncate text-xs italic text-zinc-400" style={{ maxWidth: '80ch' }}>
                            {line}
                          </div>
                        ))}
                      </div>
                    ) : hasActivities ? (
                      <div className="mt-1">
                        {ta.activities!.length > 3 && (
                          <div className="mb-0.5 text-[10px] text-zinc-600">
                            {ta.activities!.length - 3} earlier steps
                          </div>
                        )}
                        <div className="max-h-20 space-y-0.5 overflow-y-auto">
                          {ta.activities!.slice(-3).map((entry, i) => {
                            const globalIdx = ta.activities!.length - 3 + i;
                            const actualIdx = globalIdx < 0 ? i : globalIdx;
                            const isLast = actualIdx === lastActivityIdx;
                            const isComplete = !isLast || entry.result !== undefined;
                            return (
                              <div key={actualIdx}>
                                <div className="flex items-center gap-1.5">
                                  {isComplete ? (
                                    <Check size={12} className="shrink-0 text-emerald-400" />
                                  ) : (
                                    <Loader2 size={12} className="shrink-0 animate-spin text-indigo-400" />
                                  )}
                                  <span className={`truncate text-[11px] ${isComplete ? 'text-zinc-500' : 'text-zinc-300'}`}>
                                    {entry.activity}
                                  </span>
                                </div>
                                {entry.result && (
                                  <div className="ms-5 truncate text-[10px] text-zinc-600">
                                    {entry.result.length > 80 ? entry.result.slice(0, 80) + '...' : entry.result}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {pendingUserInputs.map(req => {
              const isOrchestrator = req.agentId === '__orchestrator__';
              const agent = agentMap.get(req.agentId);
              const uiStyle = isOrchestrator
                ? ORCHESTRATOR_STYLE
                : agent?.provider
                  ? resolveProviderStyle(agent.provider, agent.model)
                  : undefined;
              const uiColor = uiStyle?.color ?? agent?.avatarColor ?? '#8b5cf6';
              const uiIcon = uiStyle?.icon;
              const uiLetter = agent?.avatarLetter ?? 'A';
              const displayName = isOrchestrator ? t('chat.orchestrator') : req.displayName;
              return (
                <div key={req.requestId} className="flex items-start gap-3 px-4 py-2">
                  {uiIcon ? (
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-xl">{uiIcon}</span>
                  ) : (
                    <div
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                      style={{ backgroundColor: uiColor }}
                    >
                      {uiLetter}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold" style={{ color: uiColor }}>{displayName}</span>
                      <span className="text-[11px] text-amber-400">
                        {t('chat.askingUser')}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-300">{req.prompt}</p>
                    {onRespondToUserInput && (
                      <UserInputForm
                        requestId={req.requestId}
                        options={req.options}
                        onSubmit={onRespondToUserInput}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Response length + credits + context counter + prompt indicators */}
      <div className="flex items-center justify-between border-t border-zinc-800/40 px-4 py-1">
        {/* Response length selector — follows locale direction */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-zinc-600">{t('response.label')}</span>
          {RESPONSE_LENGTHS.map(rl => (
            <button
              key={rl.value}
              onClick={() => {
                if (channel.responseLength !== rl.value) {
                  updateLengthMutation.mutate({ channelId: channel.id, responseLength: rl.value });
                }
              }}
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                channel.responseLength === rl.value
                  ? 'bg-indigo-500/20 text-indigo-400'
                  : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
              }`}
            >
              {rl.label}
            </button>
          ))}
        </div>
        {/* English technical indicators — always LTR */}
        <div dir="ltr" className="flex items-center gap-1.5">
          <span
            className={`text-[10px] ${
              contextInfo.inContextTokens > 64000
                ? 'text-red-400'
                : contextInfo.inContextTokens > 16000
                  ? 'text-amber-400'
                  : 'text-zinc-600'
            }`}
          >
            {contextInfo.inContextCount}/{contextInfo.total} (~
            {contextInfo.inContextTokens >= 1000
              ? `${(contextInfo.inContextTokens / 1000).toFixed(1)}K`
              : contextInfo.inContextTokens}
            t)
          </span>
          {contextInfo.inContextTokens > 64000 && (
            <span className="text-[9px] text-red-400/70">!</span>
          )}
          <span className="mx-1 text-zinc-800">|</span>
          {[
            { key: 'includeSystemPrompt', on: channel.includeSystemPrompt !== false, label: 'SYS' },
            {
              key: 'includeProjectContext',
              on: channel.includeProjectContext !== false,
              label: 'CTX',
            },
            {
              key: 'includeModeGuidance',
              on: channel.includeModeGuidance !== false,
              label: 'MODE',
            },
            {
              key: 'includeTierGuidance',
              on: channel.includeTierGuidance !== false,
              label: 'TIER',
            },
            {
              key: 'includeRichComponents',
              on: channel.includeRichComponents !== false,
              label: 'RICH',
            },
          ].map(b => (
            <button
              key={b.key}
              onClick={() => updateLengthMutation.mutate({ channelId: channel.id, [b.key]: !b.on })}
              className={`rounded px-1 py-px text-[9px] font-medium transition-colors ${
                b.on
                  ? 'bg-emerald-500/10 text-emerald-500/70 hover:bg-emerald-500/20'
                  : 'bg-zinc-800/60 text-zinc-600 line-through hover:bg-zinc-700/60'
              }`}
              title={`${b.label}: ${b.on ? 'enabled' : 'disabled'}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <MessageInput
        onSend={(content, ctxSize, directedTo, attachments) => {
          if (activeTab !== 'all') {
            const agent = agentMap.get(activeTab);
            if (agent && !content.includes(`@${agent.displayName}`)) {
              onSend(`@${agent.displayName} ${content}`, ctxSize, [agent.agentId], attachments);
              return;
            }
          }
          onSend(content, ctxSize, directedTo, attachments);
        }}
        isSending={isSending}
        agents={[
          ...(channel.orchestratorEnabled
            ? [
                {
                  id: '__orchestrator__',
                  displayName: t('chat.orchestrator'),
                  avatarLetter: '✦',
                  avatarColor: ORCHESTRATOR_STYLE.color,
                  avatarIcon: ORCHESTRATOR_STYLE.icon,
                },
              ]
            : []),
          ...channelAgents.map(a => {
            const s = a.provider ? resolveProviderStyle(a.provider, a.model) : undefined;
            return {
              id: a.agentId,
              displayName: a.displayName,
              avatarLetter: a.avatarLetter,
              avatarColor: s?.color ?? a.avatarColor,
              avatarIcon: s?.icon,
              roleName: a.roleName,
              provider: a.provider,
              model: a.model,
            };
          }),
        ]}
        chatMode={channel.chatMode}
        orchestratorEnabled={channel.orchestratorEnabled}
        defaultContextSize={contextWindowSize}
        isGenerating={isGenerating}
        onCancelGeneration={onCancelGeneration}
      />

      <ChannelSettings
        key={channel.id}
        channelId={channel.id}
        name={channel.name}
        subject={channel.subject}
        instructions={channel.instructions}
        chatMode={channel.chatMode}
        orchestratorEnabled={channel.orchestratorEnabled}
        orchestratorModel={channel.orchestratorModel}
        contextLevel={channel.contextLevel}
        contextWindowSize={contextWindowSize}
        includeSystemPrompt={channel.includeSystemPrompt}
        includeProjectContext={channel.includeProjectContext}
        includeModeGuidance={channel.includeModeGuidance}
        includeTierGuidance={channel.includeTierGuidance}
        includeRichComponents={channel.includeRichComponents}
        workingDir={channel.workingDir}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
