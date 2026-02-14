import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import { ChatEmptyState } from './components/ChatView';
import { MessageInput } from './components/MessageInput';
import { ParticipantList } from './components/ParticipantList';
import { ThinkingIndicator } from './components/StreamingMessage';
import { printExitSummary, type SessionStats } from './components/ExitSummary';
import { ToolApprovalPrompt } from './components/ToolApprovalPrompt';
import type { Message, Participant, ContextLevel } from '../core/types';
import { getSession, getMessages } from '../core/session';
import { logRender } from '../core/debug-logger';
import { saveSession } from '../core/session-persistence';

import wrapAnsi from 'wrap-ansi';
import { CONTENT_PADDING } from './ui/constants';
import { HelpView } from './components/chat/HelpView';
import { StatusBar } from './components/chat/StatusBar';
import { StaticEntryRenderer } from './components/chat/StaticEntryRenderer';
import {
  OrchestratorMessagesView,
  PlanProgressView,
  PlanApprovalView,
} from './components/chat/OrchestratorMessages';
import { UrlConfirmation } from './components/chat/UrlConfirmation';
import type { StaticEntry, AppView } from './chat-types';
import { useSessionData } from './hooks/useSessionData';
import { useMessageRefresh } from './hooks/useMessageRefresh';
import { useErrorTimeout } from './hooks/useErrorTimeout';
import { useCommands } from './hooks/useCommands';
import { useStreamProcessor } from './hooks/useStreamProcessor';
import { useTerminalResize } from './hooks/useTerminalResize';

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
  useTerminalResize();

  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentView, setCurrentView] = useState<AppView>('chat');
  const [selectedTarget] = useState<Participant | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [, setContextLevelState] = useState<ContextLevel>('minimal');

  const [staticEntries, setStaticEntries] = useState<StaticEntry[]>([]);
  const staticIds = useRef(new Set<string>());
  const [activityExpanded, setActivityExpanded] = useState(false);

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
  });

  const isStreaming =
    stream.streamingParticipants.length > 0 || stream.waitingParticipants.length > 0;

  // Promote completed messages to Static
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
    for (const msg of allMessages) {
      if (msg.completionMeta?.usage) {
        promptTokens += msg.completionMeta.usage.promptTokens ?? 0;
        completionTokens += msg.completionMeta.usage.completionTokens ?? 0;
        cacheReadTokens += msg.completionMeta.usage.cacheReadTokens ?? 0;
        cacheWriteTokens += msg.completionMeta.usage.cacheWriteTokens ?? 0;
      }
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
    };

    saveSession(sessionId);
    exit();
    setTimeout(() => {
      printExitSummary(stats);
      process.exit(0);
    }, 100);
  }, [exit, participants, sessionId]);

  const handleCommand = useCommands({
    sessionId,
    participants,
    handleExit,
    setCurrentView,
    setMessages,
    setParticipants,
    setError,
    setContextLevelState,
  });

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
        stream.setOrchestratorMessages(prev => [
          ...prev,
          { kind: 'status', content: 'Plan approved. Executing...', timestamp: new Date() },
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
  const terminalCols = process.stdout.columns ?? 120;
  const terminalRows = process.stdout.rows ?? 40;
  const compactUi = terminalCols < 90 || terminalRows < 24;
  const divider = '─'.repeat(Math.max(terminalCols - 2, 1));
  const currentSession = getSession(sessionId);
  const sessionChatMode = currentSession?.chatMode;
  const orchestratorModelId = currentSession?.orchestratorConfig?.enabled
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
    stream.pendingPlanApproval !== null;
  const isEmptyState =
    messages.length === 0 &&
    stream.streamingParticipants.length === 0 &&
    stream.waitingParticipants.length === 0;

  return (
    <Box flexDirection="column">
      {isEmptyState ? (
        <ChatEmptyState compact={compactUi} />
      ) : (
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
      )}

      {(() => {
        // Deduplicate: a participant may appear in both streaming and waiting lists
        const allActiveIds = [
          ...new Set([...stream.streamingParticipants, ...stream.waitingParticipants]),
        ];

        return allActiveIds.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {allActiveIds.map(pid => {
              const buf = stream.streamFlushRef.current.get(pid);
              const isWriting = buf && buf.headerEmitted;
              const participant = participants.find(p => p.id === pid);

              if (isWriting) {
                // Writing — show partial content with cursor
                const partial = buf.inCodeBlock
                  ? buf.codeBlockAccum + buf.unflushed
                  : buf.unflushed;
                return (
                  <Box key={pid} flexDirection="column" marginBottom={1}>
                    <Box paddingLeft={CONTENT_PADDING}>
                      <Text>
                        {wrapAnsi(partial, (process.stdout.columns ?? 80) - CONTENT_PADDING, {
                          trim: true,
                        })}
                        <Text color="yellow">▌</Text>
                      </Text>
                    </Box>
                  </Box>
                );
              }

              if (!participant) return null;

              // Single indicator for all non-writing states (waiting, thinking, tool calls).
              // Using one component avoids Ink ghost renders from swapping components.
              const isWaiting = !stream.streamingParticipants.includes(pid);
              return (
                <Box key={pid} marginBottom={1}>
                  <ThinkingIndicator
                    participants={[participant]}
                    agentActivity={stream.agentActivity}
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
        <Box flexDirection="column" width={25} borderStyle="single" borderColor="gray" paddingX={1}>
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

      {error && (
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

      {!compactUi && (
        <Box marginTop={1} paddingX={1}>
          <Text dimColor>{divider}</Text>
        </Box>
      )}
      <Box flexDirection="column" paddingX={1}>
        <StatusBar
          title={title}
          participantCount={participants.length}
          modelCount={modelCount}
          chatMode={sessionChatMode}
          orchestratorModelId={orchestratorModelId}
          isStreaming={isStreaming}
          compact={compactUi}
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
          compact={compactUi}
        />
      </Box>
    </Box>
  );
}

export default ChatApp;
