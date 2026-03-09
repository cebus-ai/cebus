import React, { useRef, useEffect, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { ToolApprovalPrompt } from './ToolApprovalPrompt';
import type { AgentMessage, ParticipantInfo, PendingApproval, FileAttachmentMeta, IdeActionResultData } from '../hooks/useVSCodeMessages';
import { resolveProviderStyle } from '../lib/provider-styles';
import { IdeToolbar } from './IdeToolbar';

interface ChatPanelProps {
  messages: AgentMessage[];
  participants: ParticipantInfo[];
  isStreaming: boolean;
  error: string | null;
  pendingApprovals: PendingApproval[];
  attachments: FileAttachmentMeta[];
  mascotUri: string | null;
  viewMode: 'sidebar' | 'tab';
  ideActionResult: IdeActionResultData | null;
  onSend: (content: string) => void;
  onCancel: () => void;
  onResolveApproval: (approvalId: string, approved: boolean, budget: number) => void;
  onResetSession: () => void;
  onRequestFilePicker: () => void;
  onAttachActiveFile: () => void;
  onRemoveAttachment: (uri: string) => void;
  onOpenInTab: () => void;
  onIdeAction: (action: string, params?: Record<string, unknown>) => void;
  onClearIdeResult: () => void;
  onAttachByUri: (uri: string) => void;
  onAttachSelection?: () => void;
  onPasteImage?: (dataUrl: string, fileName: string) => void;
}

export function ChatPanel({
  messages,
  participants,
  isStreaming,
  error,
  pendingApprovals,
  attachments,
  mascotUri,
  viewMode,
  onSend,
  onCancel,
  onResolveApproval,
  onResetSession,
  onRequestFilePicker,
  onAttachActiveFile,
  onRemoveAttachment,
  onOpenInTab,
  ideActionResult,
  onIdeAction,
  onClearIdeResult,
  onAttachByUri,
  onAttachSelection,
  onPasteImage,
}: ChatPanelProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filterAgent, setFilterAgent] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const agentParticipants = participants.filter(p => p.id !== 'user');
  const filteredMessages = filterAgent
    ? messages.filter(m => m.agentId === filterAgent || m.senderType === 'user')
    : messages;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {mascotUri ? (
            <img src={mascotUri} alt="Cebus" className="h-5 w-5 rounded-full" />
          ) : (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">C</span>
          )}
          <span className="text-sm font-semibold">Cebus</span>
          <span className="rounded-full bg-badge px-1.5 py-px text-[10px] text-badge-fg">
            {agentParticipants.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {viewMode === 'sidebar' && (
            <button
              onClick={onOpenInTab}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-badge/40 hover:text-foreground"
              title="Open in Editor Tab"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M9 3L3 9M9 3H5M9 3V7" />
              </svg>
            </button>
          )}
          <button
            onClick={onResetSession}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-badge/40 hover:text-foreground"
            title="New Chat"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 2v8M2 6h8" />
            </svg>
            New Chat
          </button>
        </div>
      </div>

      {/* Participant filter tabs */}
      {agentParticipants.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          <button
            onClick={() => setFilterAgent(null)}
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
              filterAgent === null
                ? 'bg-primary/15 text-primary'
                : 'text-muted hover:text-foreground'
            }`}
          >
            All
          </button>
          {agentParticipants.map(p => {
            const style = p.providerId
              ? resolveProviderStyle(p.providerId, p.modelId)
              : undefined;
            const isActive = filterAgent === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setFilterAgent(isActive ? null : p.id)}
                className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  isActive ? 'text-foreground' : 'text-muted hover:text-foreground'
                }`}
                style={isActive ? { backgroundColor: `${style?.color ?? '#8b5cf6'}18` } : undefined}
              >
                {style?.icon && <span className="text-[10px] leading-none">{style.icon}</span>}
                <span style={isActive ? { color: style?.color } : undefined}>
                  {p.displayName}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {filteredMessages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center text-muted">
            {mascotUri ? (
              <img src={mascotUri} alt="Cebus" className="mb-3 h-16 w-16 opacity-50" />
            ) : (
              <div className="mb-2 text-3xl opacity-40">&#x1F4AC;</div>
            )}
            <p className="text-sm">Send a message to start the conversation</p>
            <p className="mt-1 text-[11px]">Use @ to mention a specific model</p>
          </div>
        )}
        {filteredMessages.map(msg => (
          <MessageBubble key={msg.id} message={msg} participants={participants} />
        ))}

        {/* Streaming indicator at bottom */}
        {isStreaming && filteredMessages.every(m => m.complete) && (
          <div className="flex items-center gap-2 py-2 text-xs text-muted">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-error/30 bg-error/10 p-2 text-sm text-error">
            {error}
          </div>
        )}
      </div>

      {/* Approval prompts */}
      {pendingApprovals.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {pendingApprovals.map(a => (
            <ToolApprovalPrompt key={a.approvalId} approval={a} onResolve={onResolveApproval} />
          ))}
        </div>
      )}

      {/* IDE Toolbar */}
      <IdeToolbar
        onIdeAction={onIdeAction}
        ideActionResult={ideActionResult}
        onClearResult={onClearIdeResult}
      />

      {/* Input */}
      <MessageInput
        onSend={onSend}
        onCancel={onCancel}
        disabled={false}
        isStreaming={isStreaming}
        participants={participants}
        attachments={attachments}
        onRequestFilePicker={onRequestFilePicker}
        onAttachActiveFile={onAttachActiveFile}
        onRemoveAttachment={onRemoveAttachment}
        onAttachByUri={onAttachByUri}
        onAttachSelection={onAttachSelection}
        onPasteImage={onPasteImage}
      />
    </div>
  );
}
