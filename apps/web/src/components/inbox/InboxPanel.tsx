import { useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { useInboxConversations } from '../../hooks/useInboxConversations';
import { InboxConversationItem } from './InboxConversationItem';
import { InboxDMDetail } from './InboxDMDetail';
import type { TypingAgent } from '../../hooks/useStream';
import { resolveProviderStyle } from '../../lib/provider-styles';
import { useI18n } from '../../lib/i18n';

interface AgentInfo {
  agentId: string;
  displayName: string;
  avatarLetter: string;
  avatarColor: string;
  provider?: string | undefined;
  roleName?: string | null | undefined;
}

interface InboxPanelProps {
  selectedAgentId?: string | null | undefined;
  onSelectAgent?: ((agentId: string | null) => void) | undefined;
  channelId?: string | null | undefined;
  channelAgents?: AgentInfo[] | undefined;
  allAgents?: AgentInfo[] | undefined;
  onCreateGroupChatWithAgent?: ((agentId: string) => void) | undefined;
  onCancelDMGeneration?: ((agentId: string) => void) | undefined;
  dmTypingAgents?: TypingAgent[] | undefined;
  dmStreamingContent?: Record<string, string> | undefined;
}

export function InboxPanel({
  selectedAgentId,
  onSelectAgent,
  channelId,
  channelAgents,
  allAgents,
  onCreateGroupChatWithAgent,
  onCancelDMGeneration,
  dmTypingAgents,
  dmStreamingContent,
}: InboxPanelProps) {
  const { t } = useI18n();
  const [localSelectedAgent, setLocalSelectedAgent] = useState<string | null>(null);
  const { conversations, totalUnread, isLoading, markReadForAgent, deleteForAgent, clearAll } = useInboxConversations();

  const activeAgentId = selectedAgentId ?? localSelectedAgent;

  const selectAgent = useCallback((agentId: string | null) => {
    if (onSelectAgent) {
      onSelectAgent(agentId);
    } else {
      setLocalSelectedAgent(agentId);
    }
  }, [onSelectAgent]);

  // Resolve agent info: prefer inbox conversation, fall back to channel agent
  const selectedConversation = activeAgentId
    ? conversations.find(c => c.agentId === activeAgentId)
    : null;

  const channelAgent = activeAgentId
    ? (channelAgents?.find(a => a.agentId === activeAgentId)
      ?? allAgents?.find(a => a.agentId === activeAgentId))
    : null;

  const dmChannelId = selectedConversation?.lastChannelId ?? channelId;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-label={t('inbox.noDMs')}>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  // Detail view — show if we have either an inbox conversation OR a channel agent
  if (activeAgentId && dmChannelId && (selectedConversation || channelAgent)) {
    const displayName = selectedConversation?.displayName ?? channelAgent?.displayName ?? 'Agent';
    const avatarLetter = selectedConversation?.avatarLetter ?? channelAgent?.avatarLetter ?? 'A';
    const provider = selectedConversation?.provider ?? channelAgent?.provider;
    const model = selectedConversation?.model ?? null;
    const style = provider ? resolveProviderStyle(provider, model) : undefined;
    const avatarColor = style?.color ?? selectedConversation?.avatarColor ?? channelAgent?.avatarColor ?? '#8b5cf6';
    const roleName = (channelAgent as AgentInfo | null)?.roleName ?? null;

    const agentTyping = dmTypingAgents?.find(t => t.agentId === activeAgentId);
    const agentStreaming = dmStreamingContent?.[activeAgentId] ?? null;

    return (
      <InboxDMDetail
        agentId={activeAgentId}
        channelId={dmChannelId}
        displayName={displayName}
        roleName={roleName}
        avatarLetter={avatarLetter}
        avatarColor={avatarColor}
        avatarIcon={style?.icon}
        nameColor={style?.color}
        provider={provider}
        modelId={model}
        typing={agentTyping ?? null}
        streamingContent={agentStreaming}
        onBack={() => selectAgent(null)}
        onMarkRead={() => markReadForAgent({ agentId: activeAgentId })}
        onCreateGroupChat={
          onCreateGroupChatWithAgent
            ? () => onCreateGroupChatWithAgent(activeAgentId)
            : undefined
        }
        onCancelGeneration={
          onCancelDMGeneration
            ? () => onCancelDMGeneration(activeAgentId)
            : undefined
        }
      />
    );
  }

  // Master: conversation list
  if (conversations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        {t('inbox.noDMs')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-2">
        <span className="text-xs text-zinc-500">
          {totalUnread > 0 ? `${totalUnread} ${t('inbox.unread')}` : t('inbox.allRead')}
        </span>
        <button
          onClick={() => clearAll()}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Trash2 size={12} />
          {t('inbox.clearAll')}
        </button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {conversations.map((conv) => (
          <InboxConversationItem
            key={conv.agentId}
            conversation={conv}
            onClick={() => selectAgent(conv.agentId)}
            onDelete={() => deleteForAgent({ agentId: conv.agentId })}
          />
        ))}
      </div>
    </div>
  );
}
