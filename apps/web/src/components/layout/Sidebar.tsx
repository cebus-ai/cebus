import { useState } from 'react';
import { LogOut, Radio, ListOrdered, AtSign, Users, MessageSquare, Sparkles, Settings } from 'lucide-react';
import { ChannelList } from '../sidebar/ChannelList';
import { AgentList } from '../sidebar/AgentList';
import { CreateChannelDialog } from '../sidebar/CreateChannelDialog';
import { WorkspaceSettings } from '../settings/WorkspaceSettings';
import { DirectionToggle } from '../settings/DirectionToggle';
import { ThemeToggle } from '../settings/ThemeToggle';
import { useI18n } from '../../lib/i18n';
import mascotAvatar from '../../assets/images/cebus-mascot-avatar-sq.png';

interface SidebarProps {
  channels: { id: string; name: string; status: string }[];
  selectedChannelId: string | null;
  chatMode?: string | null | undefined;
  orchestratorEnabled?: boolean | undefined;
  orchestratorModel?: string | null | undefined;
  unreadCounts?: Record<string, number> | undefined;
  onSelectChannel: (id: string) => void;
  onCreateChannel: (data: { name: string; subject?: string | undefined; chatMode?: string | undefined; orchestratorEnabled?: boolean | undefined; orchestratorModel?: string | undefined; workingDir?: string | null | undefined }) => void;
  onAddAgent?: ((agentId: string, roleTemplate?: string) => void) | undefined;
  onArchiveChannel?: ((channelId: string) => void) | undefined;
  onDeleteChannel?: ((channelId: string) => void) | undefined;
  onReorderChannels?: ((orderedIds: string[]) => void) | undefined;
  onOpenDM?: ((agentId: string) => void) | undefined;
  isCreating: boolean;
  userName?: string | undefined;
  onSignOut?: (() => void) | undefined;
}

/** Shorten a raw "provider/model-id-version" into a readable display name. */
function formatModelName(raw: string): string {
  // Strip all provider prefixes (e.g. "openrouter/anthropic/claude-opus-4-5-20251101" → "claude-opus-4-5-20251101")
  let modelId = raw.includes('/') ? raw.split('/').pop()! : raw;
  // Remove date suffixes like -20251101
  modelId = modelId.replace(/-\d{8,}$/, '');
  // If already a display name with spaces (e.g. "claude Sonnet 4.6"), just capitalize first letter
  if (modelId.includes(' ')) {
    return modelId.startsWith('gpt') ? 'GPT' + modelId.slice(3) : modelId.charAt(0).toUpperCase() + modelId.slice(1);
  }
  const ACRONYMS: Record<string, string> = { gpt: 'GPT', ai: 'AI', lm: 'LM' };
  // Capitalize and prettify: "claude-opus-4-5" → "Claude Opus 4.5"
  return modelId
    .split('-')
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      const lower = part.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ')
    // Collapse version numbers: "4 5" → "4.5", "3 pro" stays "3 Pro"
    .replace(/(\d) (\d)(?!\w)/g, '$1.$2');
}

const CHAT_MODE_ICONS: Record<string, typeof Radio> = {
  free_chat: Radio,
  sequential: ListOrdered,
  tag_only: AtSign,
  role_based: Users,
  raw: MessageSquare,
};

const CHAT_MODE_COLORS: Record<string, string> = {
  free_chat: 'text-emerald-400 bg-emerald-500/15',
  sequential: 'text-blue-400 bg-blue-500/15',
  tag_only: 'text-orange-400 bg-orange-500/15',
  role_based: 'text-violet-400 bg-violet-500/15',
  raw: 'text-zinc-400 bg-zinc-500/15',
};

export function Sidebar({
  channels,
  selectedChannelId,
  chatMode,
  orchestratorEnabled,
  orchestratorModel,
  unreadCounts,
  onSelectChannel,
  onCreateChannel,
  onAddAgent,
  onArchiveChannel,
  onDeleteChannel,
  onReorderChannels,
  onOpenDM,
  isCreating,
  userName,
  onSignOut,
}: SidebarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wsSettingsOpen, setWsSettingsOpen] = useState(false);
  const { t } = useI18n();

  return (
    <aside className="flex h-full shrink-0 flex-col border-e border-zinc-800/60 bg-zinc-950/95">
      {/* Brand header with gradient accent */}
      <div className="relative border-b border-zinc-800/60 px-4 py-3.5">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />
        <div className="flex items-center gap-2.5">
          <img
            src={mascotAvatar}
            alt="Cebus"
            className="h-14 w-14 rounded-full shadow-lg shadow-indigo-500/20"
          />
          <div>
            <div className="text-sm font-bold tracking-tight text-zinc-100">{t('brand.title')}</div>
            <div className="text-[10px] font-medium text-zinc-500">{t('brand.subtitle')}</div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-3">
        <ChannelList
          channels={channels}
          selectedId={selectedChannelId}
          unreadCounts={unreadCounts}
          onSelect={onSelectChannel}
          onCreateClick={() => setDialogOpen(true)}
          onArchive={onArchiveChannel}
          onDelete={onDeleteChannel}
          onReorder={onReorderChannels}
        />
        <AgentList channelId={selectedChannelId} onAddAgent={onAddAgent} onOpenDM={onOpenDM} />
      </div>

      {/* Chat mode indicator */}
      {chatMode && selectedChannelId && (() => {
        const ModeIcon = CHAT_MODE_ICONS[chatMode] ?? MessageSquare;
        const modeColor = CHAT_MODE_COLORS[chatMode] ?? 'text-zinc-400 bg-zinc-500/15';
        const modeKey = `mode.${chatMode === 'free_chat' ? 'freeChat' : chatMode === 'tag_only' ? 'tagOnly' : chatMode === 'role_based' ? 'roleBased' : chatMode}` as Parameters<typeof t>[0];
        return (
          <div className="border-t border-zinc-800/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${modeColor}`}>
                <ModeIcon size={11} />
                <span>{t(modeKey)}</span>
              </div>
              {orchestratorEnabled && (
                <div className="flex min-w-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400" title={orchestratorModel ? formatModelName(orchestratorModel) : undefined}>
                  <Sparkles size={9} className="shrink-0" />
                  <span className="truncate">{orchestratorModel ? formatModelName(orchestratorModel) : t('chat.orchestrator')}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* User profile + controls */}
      {userName && (
        <div className="border-t border-zinc-800/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white shadow-sm shadow-indigo-500/20">
              {userName.charAt(0).toUpperCase()}
            </div>
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{userName}</span>
            <button
              onClick={() => setWsSettingsOpen(true)}
              title={t('settings.workspaceDefaults')}
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              <Settings size={14} />
            </button>
            <DirectionToggle />
            <ThemeToggle />
            {onSignOut && (
              <button
                onClick={onSignOut}
                title={t('sidebar.signOut')}
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      <CreateChannelDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={(data) => {
          onCreateChannel(data);
          setDialogOpen(false);
        }}
        isCreating={isCreating}
      />
      <WorkspaceSettings open={wsSettingsOpen} onClose={() => setWsSettingsOpen(false)} />
    </aside>
  );
}
