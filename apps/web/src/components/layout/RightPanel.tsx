import { useState, useEffect } from 'react';
import { Inbox, PenTool, Bug } from 'lucide-react';
import { InboxPanel } from '../inbox/InboxPanel';
import { LiveCanvas } from '../canvas/LiveCanvas';
import { DebugPanel } from '../debug/DebugPanel';
import { useInboxConversations } from '../../hooks/useInboxConversations';
import { useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc';
import type { TypingAgent } from '../../hooks/useStream';

type TabId = 'inbox' | 'canvas' | 'debug';

interface ChannelAgent {
  agentId: string;
  displayName: string;
  avatarLetter: string;
  avatarColor: string;
  provider?: string | undefined;
  model?: string | undefined;
  roleName?: string | null | undefined;
}

interface RightPanelProps {
  channelId?: string | null;
  channelAgents?: ChannelAgent[] | undefined;
  allAgents?: ChannelAgent[] | undefined;
  messages?: { content: string }[];
  inboxAgentId?: string | null | undefined;
  onInboxAgentChange?: ((agentId: string | null) => void) | undefined;
  onCreateGroupChatWithAgent?: ((agentId: string) => void) | undefined;
  onCancelDMGeneration?: ((agentId: string) => void) | undefined;
  dmTypingAgents?: TypingAgent[] | undefined;
  dmStreamingContent?: Record<string, string> | undefined;
}

export function RightPanel({
  channelId,
  channelAgents,
  allAgents,
  messages = [],
  inboxAgentId,
  onInboxAgentChange,
  onCreateGroupChatWithAgent,
  onCancelDMGeneration,
  dmTypingAgents,
  dmStreamingContent,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('inbox');
  const { t } = useI18n();
  const { totalUnread } = useInboxConversations();

  // Auto-switch to inbox when external agent selection arrives
  useEffect(() => {
    if (inboxAgentId) {
      setActiveTab('inbox');
    }
  }, [inboxAgentId]);

  const debugEnabled = trpc.debug.isEnabled.useQuery();

  const TABS: { id: TabId; label: string; icon: typeof Inbox; badge?: number | undefined }[] = [
    { id: 'inbox', label: t('panel.inbox'), icon: Inbox, ...(totalUnread > 0 ? { badge: totalUnread } : {}) },
    { id: 'canvas', label: t('panel.canvas'), icon: PenTool },
    ...(debugEnabled.data ? [{ id: 'debug' as const, label: t('debug.tab'), icon: Bug }] : []),
  ];

  return (
    <aside className="flex h-full flex-col border-s border-zinc-800/60 bg-zinc-950/95">
      <div role="tablist" className="flex border-b border-zinc-800/60">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-indigo-400'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
            {tab.badge && tab.badge > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold text-white">
                {tab.badge}
              </span>
            )}
            {activeTab === tab.id && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-indigo-500 to-violet-500" />
            )}
          </button>
        ))}
      </div>

      <div className={`flex-1 ${activeTab === 'inbox' && inboxAgentId ? 'overflow-hidden' : 'overflow-y-auto p-4'}`}>
        {activeTab === 'inbox' && (
          <InboxPanel
            selectedAgentId={inboxAgentId}
            onSelectAgent={onInboxAgentChange}
            channelId={channelId}
            channelAgents={channelAgents}
            allAgents={allAgents}
            onCreateGroupChatWithAgent={onCreateGroupChatWithAgent}
            onCancelDMGeneration={onCancelDMGeneration}
            dmTypingAgents={dmTypingAgents}
            dmStreamingContent={dmStreamingContent}
          />
        )}
        {activeTab === 'canvas' && <LiveCanvas messages={messages} />}
        {activeTab === 'debug' && <DebugPanel channelId={channelId} />}
      </div>
    </aside>
  );
}
