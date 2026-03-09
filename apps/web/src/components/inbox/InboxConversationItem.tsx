import { memo } from 'react';
import { Clock, X } from 'lucide-react';
import { resolveProviderStyle } from '../../lib/provider-styles';
import { AgentName } from '../shared/AgentName';

interface InboxConversation {
  agentId: string;
  displayName: string;
  avatarLetter: string;
  avatarColor: string;
  provider: string;
  model: string;
  lastPreview: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface InboxConversationItemProps {
  conversation: InboxConversation;
  onClick: () => void;
  onDelete?: (() => void) | undefined;
}

export const InboxConversationItem = memo(function InboxConversationItem({ conversation, onClick, onDelete }: InboxConversationItemProps) {
  return (
    <div
      onClick={onClick}
      className="group/conv flex w-full cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-start transition-colors hover:border-zinc-700 hover:bg-zinc-800/60"
    >
      {(() => {
        const s = resolveProviderStyle(conversation.provider, conversation.model);
        return s.icon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center text-xl leading-none">{s.icon}</span>
        ) : (
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
            style={{ backgroundColor: s.color }}
          >
            {conversation.avatarLetter}
          </div>
        );
      })()}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold" style={{ color: resolveProviderStyle(conversation.provider, conversation.model).color }}>
            <AgentName displayName={conversation.displayName} provider={conversation.provider} modelId={conversation.model} />
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unreadCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold text-white">
                {conversation.unreadCount}
              </span>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="rounded p-0.5 text-zinc-600 opacity-0 transition-all hover:bg-zinc-700/50 hover:text-zinc-400 group-hover/conv:opacity-100"
                title="Delete conversation"
              >
                <X size={12} />
              </button>
            )}
            <div className="flex items-center gap-0.5 text-[10px] text-zinc-600">
              <Clock size={9} />
              <span>{formatRelativeTime(conversation.lastMessageAt)}</span>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-zinc-500">
          {conversation.provider}/{conversation.model}
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-zinc-400">
          {conversation.lastPreview}
        </p>
      </div>
    </div>
  );
});

function formatRelativeTime(iso: string): string {
  const ts = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
