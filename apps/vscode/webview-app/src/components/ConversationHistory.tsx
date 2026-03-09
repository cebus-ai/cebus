import React, { useEffect } from 'react';
import type { ConversationSummary } from '../hooks/useVSCodeMessages';

interface ConversationHistoryProps {
  conversations: ConversationSummary[];
  mascotUri: string | null;
  onNewChat: () => void;
  onLoadConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRefresh: () => void;
}

const MODE_LABELS: Record<string, string> = {
  free_chat: 'Free',
  sequential: 'Seq',
  tag_only: '@Tag',
  role_based: 'Role',
};

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function ConversationHistory({
  conversations,
  mascotUri,
  onNewChat,
  onLoadConversation,
  onDeleteConversation,
  onRefresh,
}: ConversationHistoryProps): React.ReactElement {
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

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
        </div>
        <button
          onClick={onNewChat}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          title="New Chat"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6 2v8M2 6h8" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-muted">
            {mascotUri ? (
              <img src={mascotUri} alt="Cebus" className="mb-4 h-20 w-20 opacity-40" />
            ) : (
              <div className="mb-3 text-4xl opacity-30">&#x1F4AC;</div>
            )}
            <p className="text-sm font-medium text-foreground">No conversations yet</p>
            <p className="mt-1 text-center text-[11px]">
              Start a new chat to begin a conversation with multiple AI models
            </p>
            <button
              onClick={onNewChat}
              className="mt-4 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Start your first chat
            </button>
          </div>
        ) : (
          <div className="p-2">
            <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted">
              Recent Conversations
            </div>
            {conversations.map(conv => (
              <div
                key={conv.id}
                className="group mb-1 flex items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-badge/30 cursor-pointer"
                onClick={() => onLoadConversation(conv.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {conv.title}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                    <span>{relativeTime(conv.updatedAt)}</span>
                    <span className="rounded bg-badge/60 px-1 py-px text-badge-fg">
                      {MODE_LABELS[conv.chatMode] ?? conv.chatMode}
                    </span>
                    <span>{conv.modelCount} model{conv.modelCount !== 1 ? 's' : ''}</span>
                    <span>{conv.messageCount} msg{conv.messageCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  className="flex-shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-error/10 hover:text-error group-hover:opacity-100"
                  title="Delete conversation"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5l.5-7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
