import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import Spinner from 'ink-spinner';
import { ChatEmptyState } from './components/ChatView';
import { MessageInput } from './components/MessageInput';
import { ParticipantList } from './components/ParticipantList';
import { ThinkingIndicator } from './components/StreamingMessage';
import { printExitSummary, type SessionStats } from './components/ExitSummary';
import { ToolApprovalPrompt } from './components/ToolApprovalPrompt';
import { UserInputPrompt } from './components/UserInputPrompt';
import type { Message, Participant, ContextLevel } from '@cebus/engine';
import {
  getSession,
  getMessages,
  getParticipant,
  logRender,
  saveSession,
  calculateCost,
  fetchOpenRouterCredits,
  fetchCopilotQuota,
} from '@cebus/engine';
import type { CopilotQuota } from '@cebus/engine';

import { existsSync } from 'fs';
import wrapAnsi from 'wrap-ansi';
import { CONTENT_PADDING, MAX_ICON_WIDTH } from './ui/constants';
import { HelpView } from './components/chat/HelpView';
import { StatusBar } from './components/chat/StatusBar';
import { StaticEntryRenderer, getParticipantStyle } from './components/chat/StaticEntryRenderer';
import {
  OrchestratorMessagesView,
  PlanProgressView,
  PlanApprovalView,
} from './components/chat/OrchestratorMessages';
import { UrlConfirmation } from './components/chat/UrlConfirmation';
import type { StaticEntry, AppView } from './chat-types';
import { useTerminalResize } from './hooks/useTerminalResize';
import { useSessionData } from './hooks/useSessionData';
import { useMessageRefresh } from './hooks/useMessageRefresh';
import { useErrorTimeout } from './hooks/useErrorTimeout';
import { useCommands } from './hooks/useCommands';
import { useStreamProcessor } from './hooks/useStreamProcessor';

export interface ChatAppProps {
  /** Session ID to use */
  sessionId: string;

  /** Session title */
  title?: string | undefined;

  /** Whether to show participant sidebar */
  showSidebar?: boolean | undefined;

  /** Whether to show timestamps */
  showTimestamps?: boolean | undefined;

  /** Resume context mode */
  resumeMode?: 'full' | 'summary' | 'none' | undefined;

  /** Summary text (for 'summary' mode) */
  resumeSummary?: string | undefined;

  /** Thread ID override (for summary/none — new thread so checkpointer starts fresh) */
  resumeThreadId?: string | undefined;
}

export function ChatApp({
  sessionId,
  title,
  showSidebar = false,
  showTimestamps = true,
  resumeMode,
  resumeSummary,
  resumeThreadId,
}: ChatAppProps): React.ReactElement {
  const { exit } = useApp();

  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentView, setCurrentView] = useState<AppView>('chat');
  const selectedTarget: Participant | 'all' = 'all';
  const [error, setError] = useState<string | null>(null);
  const [, setContextLevelState] = useState<ContextLevel>('minimal');

  const [staticEntries, setStaticEntries] = useState<StaticEntry[]>([]);
  const staticIds = useRef(new Set<string>());
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [copilotQuota, setCopilotQuota] = useState<CopilotQuota | null>(null);

  useTerminalResize();

  useSessionData({
    sessionId,
    title,
    staticIds,
    setMessages,
    setParticipants,
    setStaticEntries,
    setError,
  });

  const stream = useStreamProcessor({
    sessionId,
    participants,
    resumeMode,
    resumeSummary,
    resumeThreadId,
    staticIds,
    setStaticEntries,
    setMessages,
    setError,
  });

  useMessageRefresh({
    sessionId,
    streamingParticipants: stream.streamingParticipants,
    setMessages,
    setParticipants,
  });

  const isStreaming =
    stream.streamingParticipants.length > 0 || stream.waitingParticipants.length > 0 || stream.tlThinking;

  const refreshCredits = useCallback(() => {
    void fetchCopilotQuota()
      .then(quota => {
        if (quota) setCopilotQuota(quota);
      })
      .catch(() => {
        /* Copilot quota check is non-critical */
      });
  }, []);

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) refreshCredits();
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, refreshCredits]);

  useEffect(() => {
    const newlyCompleted: Message[] = [];
    for (const message of messages) {
      if (staticIds.current.has(message.id)) continue;
      if (stream.streamingMessageIds.current.has(message.id)) continue;
      const isComplete =
        message.status === 'complete' || message.status === 'sent' || message.status === 'error';
      if (isComplete) {
        staticIds.current.add(message.id);
        newlyCompleted.push(message);
      }
    }
    if (newlyCompleted.length > 0) {
      newlyCompleted.sort((a, b) => {
        const orderA = stream.streamingOrder.current.indexOf(a.senderId);
        const orderB = stream.streamingOrder.current.indexOf(b.senderId);
        if (orderA === -1 && orderB === -1) {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        }
        if (orderA === -1) return -1;
        if (orderB === -1) return 1;
        return orderA - orderB;
      });
      setStaticEntries(prev => [
        ...prev,
        ...newlyCompleted.map(m => ({ id: m.id, kind: 'message' as const, message: m })),
      ]);
    }
  }, [messages]);

  const handleExit = useCallback(() => {
    const modelsUsed = participants.filter(p => p.type === 'model').map(p => p.nickname);
    const allMessages = getMessages(sessionId);
    let promptTokens = 0;
    let completionTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    // Per-model usage aggregation
    const perModelMap = new Map<
      string,
      {
        nickname: string;
        providerId: string;
        modelId: string;
        promptTokens: number;
        completionTokens: number;
        cacheTokens: number;
        premiumRequests: number;
      }
    >();

    for (const msg of allMessages) {
      if (msg.completionMeta?.usage) {
        promptTokens += msg.completionMeta.usage.promptTokens ?? 0;
        completionTokens += msg.completionMeta.usage.completionTokens ?? 0;
        cacheReadTokens += msg.completionMeta.usage.cacheReadTokens ?? 0;
        cacheWriteTokens += msg.completionMeta.usage.cacheWriteTokens ?? 0;
      }

      if (msg.type !== 'assistant' || !msg.completionMeta?.usage) continue;
      const participant = getParticipant(sessionId, msg.senderId);

      if (!participant || participant.type !== 'model') continue;

      // Skip orchestrator/TL participant — its usage is tracked separately via orchestratorTokenUsage
      const orchPid = getSession(sessionId)?.orchestratorConfig?.participantId;
      if (orchPid !== undefined && participant.id === orchPid) continue;

      const key = participant.id;
      const usage = msg.completionMeta.usage;
      const msgPremium = usage.premiumRequests ?? 0;
      const existing = perModelMap.get(key);
      if (existing) {
        existing.promptTokens += usage.promptTokens ?? 0;
        existing.completionTokens += usage.completionTokens ?? 0;
        existing.cacheTokens += usage.cacheReadTokens ?? 0;
        existing.premiumRequests += msgPremium;
      } else {
        perModelMap.set(key, {
          nickname: participant.nickname,
          providerId: participant.providerId ?? 'unknown',
          modelId: participant.modelId ?? 'unknown',
          promptTokens: usage.promptTokens ?? 0,
          completionTokens: usage.completionTokens ?? 0,
          cacheTokens: usage.cacheReadTokens ?? 0,
          premiumRequests: msgPremium,
        });
      }
    }

    // Calculate cost per model
    const perModelUsage = [...perModelMap.values()].map(m => ({
      nickname: m.nickname,
      providerId: m.providerId,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      cacheTokens: m.cacheTokens,
      premiumRequests: m.premiumRequests,
      estimatedCostUSD: calculateCost(m.modelId, {
        inputTokens: m.promptTokens,
        outputTokens: m.completionTokens,
        cacheReadTokens: m.cacheTokens,
      }).totalCost,
    }));

    // Add orchestrator/TL usage to breakdown (even if 0, so the user sees it's active)
    const orchConfig = getSession(sessionId)?.orchestratorConfig;
    if (orchConfig?.enabled === true) {
      const orchUsage = stream.orchestratorTokenUsage.current;
      const orchModelId = orchConfig.modelId ?? 'unknown';
      const orchProviderId = orchConfig.providerId ?? 'unknown';
      promptTokens += orchUsage.inputTokens;
      completionTokens += orchUsage.outputTokens;
      cacheReadTokens += orchUsage.cacheReadTokens;
      perModelUsage.push({
        nickname: `Team Leader (${orchModelId})`,
        providerId: orchProviderId,
        promptTokens: orchUsage.inputTokens,
        completionTokens: orchUsage.outputTokens,
        cacheTokens: orchUsage.cacheReadTokens,
        premiumRequests: 0,
        estimatedCostUSD: calculateCost(orchModelId, {
          inputTokens: orchUsage.inputTokens,
          outputTokens: orchUsage.outputTokens,
          cacheReadTokens: orchUsage.cacheReadTokens,
        }).totalCost,
      });
    }

    const stats: SessionStats = {
      startTime: stream.sessionStartTime.current,
      userMessageCount: stream.userMessageCount.current,
      modelResponseCount: stream.modelResponseCount.current,
      modelsUsed,
      sessionId,
      promptTokens,
      completionTokens,
      ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
      ...(perModelUsage.length > 0 ? { perModelUsage } : {}),
    };

    saveSession(sessionId);
    exit();

    void fetchOpenRouterCredits()
      .then(credits => credits?.remaining)
      .catch(() => undefined)
      .then((openRouterCredits: number | undefined) => {
        if (openRouterCredits !== undefined) {
          stats.openRouterCredits = openRouterCredits;
        }
        printExitSummary(stats);
        process.exit(0);
      });
  }, [exit, participants, sessionId]);

  const handleCommand = useCommands({
    sessionId,
    participants,
    handleExit,
    setCurrentView,
    setMessages,
    setParticipants,
    setStaticEntries,
    staticIds,
    setError,
    setContextLevelState,
    threadIdRef: stream.threadIdRef,
    addAttachment: stream.addAttachment,
    clearAttachments: stream.clearAttachments,
    pendingAttachments: stream.pendingAttachments,
  });

  const handleImagePaste = useCallback(
    (base64: string, mimeType: string) => {
      const data = base64.replace(/^data:image\/[^;]+;base64,/, '');
      stream.addAttachment({ type: 'image', data, mimeType });
    },
    [stream.addAttachment]
  );

  const handleFilePaste = useCallback(
    (filePath: string) => {
      if (!existsSync(filePath)) return;
      stream.addAttachment(filePath);
    },
    [stream.addAttachment]
  );

  // Toggle activity log expand/collapse with Tab while streaming
  useInput(
    (_input, key) => {
      if (key.tab) setActivityExpanded(prev => !prev);
    },
    { isActive: isStreaming }
  );

  // Auto-collapse when streaming ends
  useEffect(() => {
    if (!isStreaming) setActivityExpanded(false);
  }, [isStreaming]);

  useInput(
    (_input, key) => {
      if (key.escape) setCurrentView('chat');
    },
    { isActive: currentView !== 'chat' }
  );

  useInput(
    input => {
      const lower = input.toLowerCase();
      if (lower === 'y') stream.handleUrlConfirmation(true);
      else if (lower === 'n') stream.handleUrlConfirmation(false);
    },
    {
      isActive:
        stream.pendingUrlConfirmation !== null &&
        stream.pendingToolApproval === null &&
        stream.pendingPlanApproval === null,
    }
  );

  useInput(
    input => {
      const lower = input.toLowerCase();
      if (lower !== 'y' && lower !== 'n') return;

      const approval = stream.pendingPlanApproval;
      const approved = lower === 'y';

      if (approval) {
        const planId = `plan-${Date.now()}`;
        setStaticEntries(prev => [
          ...prev,
          { id: planId, kind: 'plan' as const, plan: approval.plan, approved },
        ]);
      }

      stream.setPendingPlanApproval(null);
      if (!approved) {
        stream.setOrchestratorMessages(prev => [
          ...prev,
          { kind: 'status', content: 'Plan rejected by user.', timestamp: new Date() },
        ]);
        stream.setPlanProgress(null);
      } else if (approval) {
        const stepsSummary = approval.plan.steps
          .map((s, i) => `${i + 1}. **${s.agentId}**: ${s.action}`)
          .join('\n');
        stream.setOrchestratorMessages(prev => [
          ...prev,
          { kind: 'status', content: `Plan approved:\n${stepsSummary}`, timestamp: new Date() },
        ]);
        stream.setPlanProgress({ plan: approval.plan, completed: 0, activeAgent: null });
        void stream.sendMessage(approval.originalMessage, undefined, false, approval.analysis);
      }
    },
    { isActive: stream.pendingPlanApproval !== null }
  );

  useErrorTimeout(error, setError);

  if (currentView === 'help') {
    return <HelpView onBack={() => setCurrentView('chat')} />;
  }

  if (currentView === 'participants') {
    return (
      <Box flexDirection="column">
        <ParticipantList participants={participants} showDetails />
        <Box marginTop={1}>
          <Text dimColor>Press Esc or type /back to return</Text>
        </Box>
      </Box>
    );
  }

  const modelCount = participants.filter(p => p.type === 'model').length;
  const currentSession = getSession(sessionId);
  const sessionChatMode = currentSession?.chatMode;
  const orchestratorModelId =
    currentSession?.orchestratorConfig?.enabled === true
      ? currentSession.orchestratorConfig.modelId
      : undefined;
  const participantMap = new Map(participants.map(p => [p.id, p]));
  const orchestratorParticipantId = currentSession?.orchestratorConfig?.participantId;

  logRender('ChatApp', 'render', {
    totalMessages: messages.length,
    streamingParticipants: stream.streamingParticipants.length,
  });

  const inputDisabled =
    stream.pendingUrlConfirmation !== null ||
    stream.pendingToolApproval !== null ||
    stream.pendingUserInput !== null;

  const isEmpty =
    messages.length === 0 &&
    staticEntries.length === 0 &&
    stream.streamingParticipants.length === 0 &&
    stream.waitingParticipants.length === 0;

  return (
    <Box flexDirection="column">
      {isEmpty ? (
        <ChatEmptyState />
      ) : (
        <>
          <Static items={staticEntries}>
            {entry => (
              <StaticEntryRenderer
                key={entry.id}
                entry={entry}
                participantMap={participantMap}
                orchestratorParticipantId={orchestratorParticipantId}
                showTimestamps={showTimestamps}
              />
            )}
          </Static>

          {stream.tlThinking && (
            <Box marginTop={1}>
              <Text color="yellow">
                <Spinner type="dots" /> <Text bold>Team Leader</Text>
              </Text>
              <Text dimColor> is thinking<Spinner type="simpleDots" /></Text>
            </Box>
          )}

          {((): React.ReactElement | null => {
            const allActiveIds = [
              ...new Set([...stream.streamingParticipants, ...stream.waitingParticipants]),
            ];

            return allActiveIds.length > 0 ? (
              <Box flexDirection="column" marginTop={1}>
                {allActiveIds.map(pid => {
                  const buf = stream.streamFlushRef.current.get(pid);
                  const isWriting = buf !== undefined && buf.headerEmitted;
                  const participant = participants.find(p => p.id === pid);

                  if (isWriting) {
                    if (buf.completed) return null;

                    // Resolve style for header display
                    const {
                      color: senderColor,
                      icon: senderIcon,
                      iconWidth,
                    } = getParticipantStyle(pid, false, participantMap, orchestratorParticipantId);
                    const iconPad = ' '.repeat(MAX_ICON_WIDTH - iconWidth);
                    const cols = (process.stdout.columns ?? 80) - CONTENT_PADDING;

                    // Show last portion of accumulated content
                    const raw = buf.unflushed;
                    const lines = raw.split('\n');
                    const MAX_LIVE_LINES = 20;
                    const truncated = lines.length > MAX_LIVE_LINES;
                    const visibleLines = truncated ? lines.slice(-MAX_LIVE_LINES) : lines;
                    const lastLine = visibleLines[visibleLines.length - 1] ?? '';
                    const earlierLines = visibleLines.slice(0, -1);

                    // Show agent activity / reasoning below cursor when model is paused mid-stream
                    const activityEntries = stream.agentActivity.get(pid);
                    const reasoning = stream.reasoningContent.get(pid);
                    const lastActivity = activityEntries?.[activityEntries.length - 1];
                    const hasActiveWork = lastActivity !== undefined && lastActivity.result === undefined;
                    const hasReasoning = reasoning !== undefined && reasoning.length > 0;
                    const showActivity = hasActiveWork || hasReasoning;

                    return (
                      <Box key={pid} flexDirection="column" marginBottom={1}>
                        <Box marginTop={1}>
                          <Text color={senderColor}>
                            {senderIcon}
                            {iconPad} <Text bold>{participant?.displayName ?? 'Unknown'}</Text>
                          </Text>
                        </Box>
                        <Box paddingLeft={CONTENT_PADDING} flexDirection="column">
                          {truncated && <Text dimColor>{'...'}</Text>}
                          {earlierLines.map((line, i) => (
                            <Text key={i}>
                              {wrapAnsi(line, cols, { trim: true })}
                            </Text>
                          ))}
                          <Text>
                            {wrapAnsi(lastLine, cols, { trim: true })}
                            <Text color="yellow">▌</Text>
                          </Text>
                        </Box>
                        {showActivity && (
                          <Box paddingLeft={CONTENT_PADDING}>
                            <Text dimColor>
                              <Spinner type="dots" />{' '}
                              {hasActiveWork
                                ? lastActivity.activity
                                : 'reasoning'}
                              <Spinner type="simpleDots" />
                            </Text>
                          </Box>
                        )}
                      </Box>
                    );
                  }

                  if (!participant) return null;

                  const isWaiting = !stream.streamingParticipants.includes(pid);
                  return (
                    <Box key={pid} marginBottom={1}>
                      <ThinkingIndicator
                        participants={[participant]}
                        agentActivity={stream.agentActivity}
                        reasoningContent={stream.reasoningContent}
                        waiting={isWaiting}
                        expanded={activityExpanded}
                      />
                    </Box>
                  );
                })}
                <Text dimColor>(Esc to cancel)</Text>
              </Box>
            ) : null;
          })()}

          {showSidebar && (
            <Box
              flexDirection="column"
              width={25}
              borderStyle="single"
              borderColor="gray"
              paddingX={1}
            >
              <ParticipantList participants={participants} compact />
            </Box>
          )}

          <OrchestratorMessagesView
            messages={stream.orchestratorMessages}
            orchestratorModelId={orchestratorModelId}
            showTimestamps={showTimestamps}
          />
          {stream.planProgress && <PlanProgressView planProgress={stream.planProgress} />}
          {stream.pendingPlanApproval && (
            <PlanApprovalView pendingPlanApproval={stream.pendingPlanApproval} />
          )}

          {error !== null && (
            <Box marginY={1}>
              <Text color="redBright" bold>
                Error: {error}
              </Text>
            </Box>
          )}

          {stream.pendingUrlConfirmation && (
            <UrlConfirmation confirmation={stream.pendingUrlConfirmation} />
          )}

          {stream.pendingToolApproval && (
            <ToolApprovalPrompt
              agentName={stream.pendingToolApproval.agentName}
              permissionKind={stream.pendingToolApproval.permissionKind}
              toolName={stream.pendingToolApproval.toolName}
              parameters={stream.pendingToolApproval.parameters}
              onRespond={stream.handleToolApproval}
            />
          )}

          {stream.pendingUserInput && (
            <UserInputPrompt
              agentName={stream.pendingUserInput.agentName}
              prompt={stream.pendingUserInput.prompt}
              options={stream.pendingUserInput.options}
              onSubmit={answer =>
                stream.handleUserInputResponse(stream.pendingUserInput!.requestId, answer)
              }
              onCancel={() => stream.cancelUserInput()}
            />
          )}
        </>
      )}

      {!stream.pendingUserInput && (
        <>
          <Box marginTop={isEmpty ? 0 : 1} paddingX={1}>
            <Text dimColor>{'─'.repeat(Math.max((process.stdout.columns ?? 120) - 2, 40))}</Text>
          </Box>
          <Box flexDirection="column" paddingX={1}>
            <StatusBar
              title={title}
              participantCount={participants.length}
              modelCount={modelCount}
              chatMode={sessionChatMode}
              orchestratorModelId={orchestratorModelId}
              isStreaming={isStreaming}
              thinkingNames={undefined}
              copilotQuota={copilotQuota ?? undefined}
            />
            <MessageInput
              onSubmit={stream.handleSubmit}
              onExit={handleExit}
              onCommand={handleCommand}
              participants={participants}
              selectedTarget={selectedTarget}
              disabled={inputDisabled}
              isStreaming={isStreaming}
              onCancelStream={stream.cancelAll}
              onImagePaste={handleImagePaste}
              onFilePaste={handleFilePaste}
              pendingAttachmentCount={stream.pendingAttachments.length}
            />
          </Box>
        </>
      )}
    </Box>
  );
}

export default ChatApp;
