import { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { ChatPanel } from './ChatPanel';
import { RightPanel } from './RightPanel';
import { ThreadPanel } from '../chat/ThreadPanel';
import { useChannel } from '../../hooks/useChannel';
import { useMessages } from '../../hooks/useMessages';
import { useStream } from '../../hooks/useStream';
import { trpc } from '../../lib/trpc';

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

interface WorkspaceLayoutProps {
  userName: string;
  onSignOut: () => void;
}

function PricingBanner() {
  const [dismissed, setDismissed] = useState(false);
  const statusQuery = trpc.workspace.pricingStatus.useQuery(undefined, { staleTime: Infinity });
  const refreshMutation = trpc.workspace.refreshPricing.useMutation({
    onSuccess: () => setDismissed(true),
  });

  if (dismissed || !statusQuery.data?.stale) return null;

  return (
    <div className="fixed bottom-4 end-4 z-50 flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 shadow-lg">
      <span className="text-sm text-zinc-300">Model pricing data is outdated.</span>
      <button
        className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        disabled={refreshMutation.isPending}
        onClick={() => refreshMutation.mutate()}
      >
        {refreshMutation.isPending ? 'Updating...' : 'Update'}
      </button>
      <button
        className="text-xs text-zinc-500 hover:text-zinc-300"
        onClick={() => setDismissed(true)}
      >
        Dismiss
      </button>
    </div>
  );
}

export function WorkspaceLayout({ userName, onSignOut }: WorkspaceLayoutProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [inboxAgentId, setInboxAgentId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [dragX, setDragX] = useState<number | null>(null);
  const draggingPanelRef = useRef<'left' | 'right' | null>(null);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingPanelRef.current) return;
      setDragX(e.clientX);
    }
    function onMouseUp(e: MouseEvent) {
      const panel = draggingPanelRef.current;
      if (!panel) return;
      draggingPanelRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragX(null);
      const rtl = document.documentElement.dir === 'rtl';
      if (panel === 'left') {
        const w = rtl ? window.innerWidth - e.clientX : e.clientX;
        setSidebarWidth(Math.min(Math.max(w, 160), window.innerWidth * 0.4));
      } else {
        const w = rtl ? e.clientX : window.innerWidth - e.clientX;
        setRightPanelWidth(Math.min(Math.max(w, 200), window.innerWidth * 0.4));
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  // Ref for forwarding thread SSE replies to the ThreadPanel
  const threadReplyHandlerRef = useRef<((msg: StreamMessage) => void) | null>(null);

  const allAgentsQuery = trpc.agent.list.useQuery();
  const allAgents = (allAgentsQuery.data ?? []).map(a => ({
    agentId: a.id,
    displayName: a.displayName,
    avatarLetter: a.avatarLetter,
    avatarColor: a.avatarColor,
    provider: a.provider,
    model: a.model,
  }));

  const {
    channels,
    selectedChannel,
    selectedChannelId,
    selectChannel,
    createChannel,
    addAgent,
    removeAgent,
    archiveChannel,
    deleteChannel,
    reorderChannels,
    isCreating,
    unreadCounts,
  } = useChannel();

  const {
    messages,
    isLoading: messagesLoading,
    sendMessage,
    isSending,
    refetch,
    appendStreamMessage,
    clearChat,
    contextBoundaryIndex,
    replyCounts,
  } = useMessages(selectedChannelId);

  const handleStreamMessage = useCallback(
    (msg: Parameters<typeof appendStreamMessage>[0]) => {
      appendStreamMessage(msg);
    },
    [appendStreamMessage],
  );

  const handleThreadReply = useCallback(
    (msg: StreamMessage) => {
      // Forward to ThreadPanel if it matches the active thread
      if (msg.replyToId && threadReplyHandlerRef.current) {
        threadReplyHandlerRef.current(msg);
      }
    },
    [],
  );

  const utils = trpc.useUtils();

  const handleRefetch = useCallback(() => {
    refetch();
    utils.channel.unreadCounts.invalidate();
  }, [refetch, utils.channel.unreadCounts]);
  const handleMessagesSeen = useCallback(() => {
    if (selectedChannelId) {
      utils.message.list.invalidate({ channelId: selectedChannelId });
    }
  }, [selectedChannelId, utils.message.list]);

  const handleDMMessage = useCallback(() => {
    // Invalidate DM message queries so InboxDMDetail picks up new messages instantly
    utils.message.listDM.invalidate();
    utils.inbox.conversations.invalidate();
  }, [utils.message.listDM, utils.inbox.conversations]);

  const { typingAgents, streamingContent, clearTyping, pendingApprovals, resolveApproval, pendingUserInputs, resolveUserInput, dmTypingAgents, dmStreamingContent, orchestratorPhase, orchestratorRequest, orchestratorStepResult, orchestratorError } = useStream({
    channelId: selectedChannelId,
    onMessageCreated: handleStreamMessage,
    onThreadReply: handleThreadReply,
    onRefetch: handleRefetch,
    onMessagesSeen: handleMessagesSeen,
    onDMMessage: handleDMMessage,
  });

  const handleSendWithAttachments = useCallback(
    async (
      content: string,
      contextSize?: number | undefined,
      directedTo?: string[] | undefined,
      attachments?: File[] | undefined
    ) => {
      let uploadedAttachments:
        | Array<{ type: 'file' | 'directory' | 'selection'; path: string; displayName?: string }>
        | undefined;
      if (attachments?.length && selectedChannelId) {
        const formData = new FormData();
        for (const file of attachments) formData.append('files', file);
        try {
          const res = await fetch(`/api/upload/${selectedChannelId}`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
          });
          if (res.ok) {
            const data = (await res.json()) as {
              files: Array<{ path: string; fileName: string }>;
            };
            uploadedAttachments = data.files.map(f => ({
              type: 'file' as const,
              path: f.path,
              displayName: f.fileName,
            }));
          }
        } catch {
          // Upload failed — send without attachments
        }
      }
      sendMessage(content, contextSize, directedTo, uploadedAttachments);
    },
    [selectedChannelId, sendMessage]
  );

  const cancelGenerationMutation = trpc.message.cancelGeneration.useMutation();
  const handleCancelGeneration = useCallback(() => {
    if (selectedChannelId) {
      clearTyping();
      cancelGenerationMutation.mutate({ channelId: selectedChannelId });
    }
  }, [selectedChannelId, cancelGenerationMutation, clearTyping]);

  const cancelDMMutation = trpc.message.cancelDM.useMutation();
  const handleCancelDMGeneration = useCallback((agentId: string) => {
    if (selectedChannelId) {
      cancelDMMutation.mutate({ channelId: selectedChannelId, agentId });
    }
  }, [selectedChannelId, cancelDMMutation]);

  const respondToUserInputMutation = trpc.message.respondToUserInput.useMutation();
  const handleRespondToUserInput = useCallback(
    (requestId: string, answer: string) => {
      if (!selectedChannelId) return;
      resolveUserInput(requestId);
      // TL questions end the graph — answer must be sent as a new message
      // (same pattern as the CLI handler)
      if (requestId.startsWith('tl-input-')) {
        sendMessage(answer);
        return;
      }
      respondToUserInputMutation.mutate({ channelId: selectedChannelId, requestId, answer });
    },
    [selectedChannelId, respondToUserInputMutation, resolveUserInput, sendMessage],
  );

  const handleCreateChannel = useCallback(
    (data: {
      name: string;
      subject?: string | undefined;
      instructions?: string | undefined;
      chatMode?: string | undefined;
      orchestratorEnabled?: boolean | undefined;
      orchestratorModel?: string | undefined;
      includeSystemPrompt?: boolean | undefined;
      includeProjectContext?: boolean | undefined;
      includeModeGuidance?: boolean | undefined;
      includeTierGuidance?: boolean | undefined;
      includeRichComponents?: boolean | undefined;
      workingDir?: string | null | undefined;
    }) => {
      createChannel({
        name: data.name,
        subject: data.subject,
        instructions: data.instructions,
        chatMode: data.chatMode as 'free_chat' | 'sequential' | 'tag_only' | 'raw' | undefined,
        orchestratorEnabled: data.orchestratorEnabled,
        orchestratorModel: data.orchestratorModel,
        includeSystemPrompt: data.includeSystemPrompt,
        includeProjectContext: data.includeProjectContext,
        includeModeGuidance: data.includeModeGuidance,
        includeTierGuidance: data.includeTierGuidance,
        includeRichComponents: data.includeRichComponents,
        workingDir: data.workingDir,
      });
    },
    [createChannel],
  );

  const handleAddAgent = useCallback(
    (agentId: string, roleTemplate?: string) => {
      if (!selectedChannelId) return;
      addAgent({ channelId: selectedChannelId, agentId, roleTemplate });
    },
    [selectedChannelId, addAgent],
  );

  const handleRemoveAgent = useCallback(
    (agentId: string) => {
      if (!selectedChannelId) return;
      removeAgent({ channelId: selectedChannelId, agentId });
    },
    [selectedChannelId, removeAgent],
  );

  const handleOpenDMInInbox = useCallback(
    (agentId: string) => {
      setInboxAgentId(agentId);
      setRightOpen(true);
    },
    [],
  );

  const handleCreateGroupChatWithAgent = useCallback(
    async (agentId: string) => {
      const agent = allAgents.find(a => a.agentId === agentId);
      const name = agent ? `Chat with ${agent.displayName}` : 'New chat';
      const channel = await createChannel({ name });
      await addAgent({ channelId: channel.id, agentId });
    },
    [createChannel, addAgent, allAgents],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950">
      {/* Left sidebar */}
      {leftOpen && (
        <div style={{ width: sidebarWidth }} className="relative shrink-0">
          <Sidebar
            channels={channels}
            selectedChannelId={selectedChannelId}
            chatMode={selectedChannel?.chatMode ?? null}
            orchestratorEnabled={selectedChannel?.orchestratorEnabled ?? false}
            orchestratorModel={selectedChannel?.orchestratorModel ?? null}
            unreadCounts={unreadCounts}
            onSelectChannel={(id) => { selectChannel(id); setActiveThreadId(null); }}
            onCreateChannel={handleCreateChannel}
            onAddAgent={handleAddAgent}
            onArchiveChannel={(id) => archiveChannel({ channelId: id })}
            onDeleteChannel={(id) => deleteChannel({ channelId: id })}
            onReorderChannels={reorderChannels}
            onOpenDM={handleOpenDMInInbox}
            isCreating={isCreating}
            userName={userName}
            onSignOut={onSignOut}
          />
        </div>
      )}
      {leftOpen && (
        <div
          className="relative flex h-full w-1 shrink-0 cursor-col-resize items-center justify-center before:absolute before:inset-y-0 before:w-px before:bg-zinc-800 hover:before:bg-indigo-500"
          onMouseDown={() => {
            draggingPanelRef.current = 'left';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />
      )}

      {/* Main chat area - no separate toolbar row */}
      <ChatPanel
        channel={selectedChannel ? {
          id: selectedChannel.id,
          name: selectedChannel.name,
          subject: selectedChannel.subject ?? null,
          instructions: selectedChannel.instructions ?? null,
          chatMode: selectedChannel.chatMode ?? 'free_chat',
          orchestratorEnabled: selectedChannel.orchestratorEnabled ?? false,
          orchestratorModel: selectedChannel.orchestratorModel ?? null,
          responseLength: selectedChannel.responseLength ?? 'free',
          contextLevel: selectedChannel.contextLevel ?? 'none',
          contextWindowSize: selectedChannel.contextWindowSize ?? 10,
          includeSystemPrompt: selectedChannel.includeSystemPrompt ?? true,
          includeProjectContext: selectedChannel.includeProjectContext ?? true,
          includeModeGuidance: selectedChannel.includeModeGuidance ?? true,
          includeTierGuidance: selectedChannel.includeTierGuidance ?? true,
          includeRichComponents: selectedChannel.includeRichComponents ?? true,
          workingDir: selectedChannel.workingDir ?? null,
        } : null}
        channelAgents={selectedChannel?.agents ?? []}
        memberCount={selectedChannel?.members?.length ?? 0}
        messages={messages}
        isLoading={messagesLoading}
        onSend={handleSendWithAttachments}
        isSending={isSending}
        onRemoveAgent={handleRemoveAgent}
        onClearChat={clearChat}
        contextBoundaryIndex={contextBoundaryIndex}
        typingAgents={typingAgents}
        streamingContent={streamingContent}
        leftPanelOpen={leftOpen}
        rightPanelOpen={rightOpen}
        onToggleLeftPanel={() => setLeftOpen(!leftOpen)}
        onToggleRightPanel={() => setRightOpen(!rightOpen)}
        replyCounts={replyCounts}
        onOpenThread={setActiveThreadId}
        pendingApprovals={pendingApprovals}
        onResolveApproval={resolveApproval}
        onOpenDMInInbox={handleOpenDMInInbox}
        onDropAgent={handleAddAgent}
        isGenerating={typingAgents.length > 0}
        onCancelGeneration={handleCancelGeneration}
        pendingUserInputs={pendingUserInputs}
        onRespondToUserInput={handleRespondToUserInput}
        orchestratorPhase={orchestratorPhase}
        orchestratorRequest={orchestratorRequest}
        orchestratorStepResult={orchestratorStepResult}
        orchestratorError={orchestratorError}
      />

      {/* Thread panel */}
      {activeThreadId && selectedChannelId && (
        <ThreadPanel
          channelId={selectedChannelId}
          parentMessageId={activeThreadId}
          agents={(selectedChannel?.agents ?? []).map((a) => ({
            agentId: a.agentId,
            displayName: a.displayName,
            avatarLetter: a.avatarLetter,
            avatarColor: a.avatarColor,
            provider: a.provider,
            model: a.model,
            roleName: a.roleName,
          }))}
          onClose={() => setActiveThreadId(null)}
          onSendMessage={sendMessage}
          onRegisterStreamHandler={(handler) => { threadReplyHandlerRef.current = handler; }}
        />
      )}

      {/* Right panel */}
      {rightOpen && (
        <div
          className="relative flex h-full w-1 shrink-0 cursor-col-resize items-center justify-center before:absolute before:inset-y-0 before:w-px before:bg-zinc-800 hover:before:bg-indigo-500"
          onMouseDown={() => {
            draggingPanelRef.current = 'right';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />
      )}
      {rightOpen && (
        <div style={{ width: rightPanelWidth }} className="h-full shrink-0">
          <RightPanel
            channelId={selectedChannelId}
            channelAgents={selectedChannel?.agents}
            allAgents={allAgents}
            messages={messages}
            inboxAgentId={inboxAgentId}
            onInboxAgentChange={setInboxAgentId}
            onCreateGroupChatWithAgent={handleCreateGroupChatWithAgent}
            onCancelDMGeneration={handleCancelDMGeneration}
            dmTypingAgents={dmTypingAgents}
            dmStreamingContent={dmStreamingContent}
          />
        </div>
      )}
      {dragX !== null && (
        <div className="pointer-events-none fixed inset-y-0 z-50 w-0.5 bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.5)]" style={{ left: dragX ?? undefined }} />
      )}
      <PricingBanner />
    </div>
  );
}
