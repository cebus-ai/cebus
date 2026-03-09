import { Component, type ErrorInfo, memo, type ReactNode, useState } from 'react';
import { MessageSquareReply, EyeOff, Eye as EyeIcon, RefreshCw, Pencil, BookmarkMinus, Bookmark, Info, MessageCircle, Paperclip } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent';
import { useI18n } from '../../lib/i18n';
import { AgentName } from '../shared/AgentName';

class MarkdownErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('MarkdownContent render error:', error, info);
  }
  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

interface TokenUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  premiumRequests?: number | undefined;
}

interface MessageBubbleProps {
  id: string;
  senderType: string;
  senderId: string;
  content: string;
  createdAt: string;
  senderName?: string;
  roleName?: string | null | undefined;
  avatarLetter?: string;
  avatarColor?: string;
  avatarIcon?: string | undefined;
  nameColor?: string | undefined;
  provider?: string | undefined;
  modelId?: string | null | undefined;
  isHidden?: boolean | undefined;
  onSendMessage?: ((message: string) => void) | undefined;
  replyCount?: number | undefined;
  onOpenThread?: (() => void) | undefined;
  onArchive?: (() => void) | undefined;
  onRestore?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  directedToNames?: string[] | undefined;
  excludedFromContext?: boolean | undefined;
  onToggleContext?: (() => void) | undefined;
  tokenUsage?: TokenUsage | undefined;
  estimatedCostUSD?: number | undefined;
  contextPosition?: number | undefined;
  contextWindowSize?: number | undefined;
  estimatedTokens?: number | undefined;
  seenByAgents?: Array<{ id: string; displayName: string; roleName?: string | null | undefined; avatarLetter: string; avatarColor: string; avatarIcon?: string | undefined }> | undefined;
  onOpenDM?: (() => void) | undefined;
  attachments?: Array<{ fileName: string; type: string }> | undefined;
}

function TokenCostPopover({ tokenUsage, estimatedCostUSD }: { tokenUsage: TokenUsage; estimatedCostUSD?: number | undefined }) {
  return (
    <div className="absolute bottom-full end-0 mb-1 min-w-[160px] rounded-lg border border-zinc-700/60 bg-zinc-800/95 p-2.5 text-[11px] shadow-xl backdrop-blur-sm">
      <div className="space-y-1">
        {tokenUsage.inputTokens !== undefined && (
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Input</span>
            <span className="font-mono text-zinc-300">{tokenUsage.inputTokens.toLocaleString()}</span>
          </div>
        )}
        {tokenUsage.outputTokens !== undefined && (
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Output</span>
            <span className="font-mono text-zinc-300">{tokenUsage.outputTokens.toLocaleString()}</span>
          </div>
        )}
        {tokenUsage.cacheReadTokens !== undefined && tokenUsage.cacheReadTokens > 0 && (
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Cache</span>
            <span className="font-mono text-zinc-300">{tokenUsage.cacheReadTokens.toLocaleString()}</span>
          </div>
        )}
        {tokenUsage.premiumRequests !== undefined && tokenUsage.premiumRequests > 0 && (
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Premium</span>
            <span className="font-mono text-amber-300">{tokenUsage.premiumRequests} req</span>
          </div>
        )}
        {estimatedCostUSD !== undefined && (
          <div className="flex justify-between gap-3 border-t border-zinc-700/50 pt-1">
            <span className="text-zinc-500">Cost</span>
            <span className="font-mono text-emerald-400">${estimatedCostUSD.toFixed(4)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  senderType,
  content,
  createdAt,
  senderName,
  roleName,
  avatarLetter,
  avatarColor,
  avatarIcon,
  nameColor,
  provider,
  modelId,
  isHidden,
  onSendMessage,
  replyCount,
  onOpenThread,
  onArchive,
  onRestore,
  onRetry,
  onEdit,
  directedToNames,
  excludedFromContext,
  onToggleContext,
  tokenUsage,
  estimatedCostUSD,
  contextPosition,
  contextWindowSize,
  estimatedTokens,
  seenByAgents,
  onOpenDM,
  attachments,
}: MessageBubbleProps) {
  const { t } = useI18n();
  const [showTokenInfo, setShowTokenInfo] = useState(false);
  const [showSeenBy, setShowSeenBy] = useState(false);
  const isUser = senderType === 'user';
  const displayName = senderName ?? (isUser ? t('chat.you') : 'Agent');
  const letter = avatarLetter ?? displayName.charAt(0).toUpperCase();
  const color = avatarColor ?? (isUser ? '#6366f1' : '#8b5cf6');
  const time = formatTime(createdAt);
  const isAgent = senderType === 'agent';

  // Collapsed/archived message — show as a minimal bar
  if (isHidden) {
    return (
      <div className="group flex items-center gap-2 px-4 py-1 transition-colors hover:bg-zinc-800/20">
        {avatarIcon ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm leading-none">{avatarIcon}</span>
        ) : (
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white/60"
            style={{ backgroundColor: color }}
          >
            {letter}
          </div>
        )}
        <span className={`text-[11px] ${nameColor ? '' : 'text-zinc-400'}`} style={nameColor ? { color: nameColor } : undefined}><AgentName displayName={displayName} provider={provider} modelId={modelId} /></span>
        <span className="text-[10px] italic text-zinc-700">hidden</span>
        <span className="text-[10px] text-zinc-700">{time}</span>
        {onRestore && (
          <button
            onClick={onRestore}
            className="ms-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-600 opacity-0 transition-all hover:bg-zinc-700/50 hover:text-zinc-400 group-hover:opacity-100"
            title="Restore message"
          >
            <EyeIcon size={10} />
            <span>Restore</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`group flex gap-3 px-4 py-2 transition-colors hover:bg-zinc-800/30 ${excludedFromContext ? 'opacity-40' : ''}`}>
      {avatarIcon ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-base leading-none">{avatarIcon}</span>
      ) : (
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {letter}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${nameColor ? '' : 'text-zinc-100'}`} style={nameColor ? { color: nameColor } : undefined}><AgentName displayName={displayName} provider={provider} modelId={modelId} /></span>
          {roleName && (
            <span className="rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400/70">
              {roleName}
            </span>
          )}
          {!isUser && (
            <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
              {t('chat.ai')}
            </span>
          )}
          <span className="text-[11px] text-zinc-600">{time}</span>
          {directedToNames && directedToNames.length > 0 && (
            <span className="text-[10px] text-zinc-600">
              &rarr; {directedToNames.join(', ')}
            </span>
          )}

          {/* Context position + token estimate with in/out arrows */}
          {contextPosition !== undefined && contextWindowSize !== undefined && (() => {
            const isInContext = contextPosition <= contextWindowSize && !excludedFromContext;
            const tokenLabel = estimatedTokens !== undefined && estimatedTokens > 0
              ? estimatedTokens >= 1000 ? `${(estimatedTokens / 1000).toFixed(1)}K` : `${estimatedTokens}`
              : null;
            const fmtTokens = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
            const hasUsage = isAgent && tokenUsage && (tokenUsage.inputTokens !== undefined || tokenUsage.outputTokens !== undefined);
            return (
              <span
                className={`inline-flex items-center gap-0.5 text-[9px] font-mono ${isInContext ? 'text-emerald-500/60' : 'text-zinc-600'}`}
                title={`#${contextPosition} — ${isInContext ? 'In context' : 'Out of context'}${tokenLabel ? ` (~${estimatedTokens!.toLocaleString()} tokens)` : ''}${hasUsage ? ` | ↑${tokenUsage!.inputTokens?.toLocaleString() ?? '?'} in ↓${tokenUsage!.outputTokens?.toLocaleString() ?? '?'} out` : ''}`}
              >
                <span>{isInContext ? '▸' : '▹'}</span>
                <span>#{contextPosition}</span>
                {tokenLabel && <span>~{tokenLabel}</span>}
                {hasUsage && (
                  <>
                    {tokenUsage!.inputTokens !== undefined && <span className="text-blue-400/50">↑{fmtTokens(tokenUsage!.inputTokens)}</span>}
                    {tokenUsage!.outputTokens !== undefined && <span className="text-orange-400/50">↓{fmtTokens(tokenUsage!.outputTokens)}</span>}
                  </>
                )}
              </span>
            );
          })()}

          {/* Action buttons — visible on hover */}
          <div className="ms-auto flex items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
            {/* Context toggle */}
            {onToggleContext && (
              <button
                onClick={onToggleContext}
                className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors ${
                  excludedFromContext
                    ? 'text-amber-500 hover:bg-amber-500/10 hover:text-amber-400'
                    : 'text-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-400'
                }`}
                title={excludedFromContext ? 'Include in context' : 'Exclude from context'}
              >
                {excludedFromContext ? <BookmarkMinus size={12} /> : <Bookmark size={12} />}
              </button>
            )}

            {/* Token cost info — agent messages only */}
            {isAgent && tokenUsage && (
              <div className="relative">
                <button
                  onClick={() => setShowTokenInfo(!showTokenInfo)}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-400"
                  title="Token usage"
                >
                  <Info size={12} />
                </button>
                {showTokenInfo && (
                  <TokenCostPopover tokenUsage={tokenUsage} estimatedCostUSD={estimatedCostUSD} />
                )}
              </div>
            )}

            {onEdit && (
              <button
                onClick={onEdit}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-400"
                title="Edit message"
              >
                <Pencil size={12} />
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-400"
                title="Retry"
              >
                <RefreshCw size={12} />
              </button>
            )}
            {onArchive && (
              <button
                onClick={onArchive}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-400"
                title="Hide message"
              >
                <EyeOff size={12} />
              </button>
            )}
            {onOpenDM && (
              <button
                onClick={onOpenDM}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-400"
                title="Direct message"
              >
                <MessageCircle size={12} />
              </button>
            )}
            {onOpenThread && (
              <button
                onClick={onOpenThread}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-400"
                title={t('thread.openThread')}
              >
                <MessageSquareReply size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1" onDoubleClick={onEdit}>
          <MarkdownErrorBoundary
            fallback={<div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{content}</div>}
          >
            <MarkdownContent content={content} onSendMessage={onSendMessage} />
          </MarkdownErrorBoundary>
        </div>

        {/* Attachment indicator */}
        {attachments && attachments.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Paperclip size={10} />
            <span>{attachments.map(a => a.fileName).join(', ')}</span>
          </div>
        )}

        {/* Thread reply count indicator */}
        {replyCount != null && replyCount > 0 && onOpenThread && (
          <button
            onClick={onOpenThread}
            className="mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-indigo-400 transition-colors hover:bg-indigo-500/10 hover:text-indigo-300"
          >
            <MessageSquareReply size={12} />
            <span>
              {replyCount} {replyCount === 1 ? t('thread.reply') : t('thread.replies')}
            </span>
          </button>
        )}

        {/* Seen-by indicator */}
        {seenByAgents && seenByAgents.length > 0 && (
          <div className="relative mt-1">
            <button
              onClick={() => setShowSeenBy(!showSeenBy)}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-400"
            >
              <EyeIcon size={10} />
              <span>{seenByAgents.length}</span>
            </button>
            {showSeenBy && (
              <div className="absolute bottom-full start-0 z-20 mb-1 min-w-[140px] rounded-lg border border-zinc-700/60 bg-zinc-800/95 p-2 text-[11px] shadow-xl backdrop-blur-sm">
                <div className="mb-1 text-[10px] font-medium text-zinc-500">Seen by</div>
                <div className="space-y-1">
                  {seenByAgents.map(agent => (
                    <div key={agent.id} className="flex items-center gap-1.5">
                      {agent.avatarIcon ? (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-xs">{agent.avatarIcon}</span>
                      ) : (
                        <div
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
                          style={{ backgroundColor: agent.avatarColor }}
                        >
                          {agent.avatarLetter}
                        </div>
                      )}
                      <span className="text-zinc-300">{agent.displayName}</span>
                      {agent.roleName && (
                        <span className="text-[9px] text-indigo-400/50">{agent.roleName}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function formatTime(iso: string): string {
  try {
    const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
    const date = new Date(normalized);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
