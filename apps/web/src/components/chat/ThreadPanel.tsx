import { useRef, useEffect, useCallback } from 'react';
import { X, MessageSquareReply } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { useThread } from '../../hooks/useThread';
import { useI18n } from '../../lib/i18n';
import { resolveProviderStyle, ORCHESTRATOR_STYLE } from '../../lib/provider-styles';

interface Agent {
  agentId: string;
  displayName: string;
  avatarLetter: string;
  avatarColor: string;
  provider?: string | undefined;
  model?: string | undefined;
  roleName?: string | null | undefined;
}

interface ThreadMessage {
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

interface ThreadPanelProps {
  channelId: string;
  parentMessageId: string;
  agents: Agent[];
  onClose: () => void;
  onSendMessage?: ((content: string) => void) | undefined;
  onRegisterStreamHandler?: ((handler: (msg: ThreadMessage) => void) => void) | undefined;
}

export function ThreadPanel({
  channelId,
  parentMessageId,
  agents,
  onClose,
  onSendMessage,
  onRegisterStreamHandler,
}: ThreadPanelProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    parentMessage,
    replies,
    isLoading,
    sendReply,
    isSending,
    appendStreamReply,
  } = useThread(parentMessageId, channelId);

  const agentMap = new Map(agents.map((a) => [a.agentId, a]));

  // Register stream handler so WorkspaceLayout can forward SSE thread replies
  useEffect(() => {
    if (!onRegisterStreamHandler) return;
    onRegisterStreamHandler((msg: ThreadMessage) => {
      if (msg.replyToId === parentMessageId) {
        appendStreamReply(msg);
      }
    });
    return () => {
      // Unregister on unmount by setting a no-op
      onRegisterStreamHandler(() => {});
    };
  }, [onRegisterStreamHandler, parentMessageId, appendStreamReply]);

  function getSenderInfo(msg: { senderType: string; senderId: string }) {
    if (msg.senderType === 'user') {
      return { name: t('chat.you'), letter: 'U', color: '#6366f1', icon: undefined as string | undefined, nameColor: undefined as string | undefined, roleName: null as string | null, provider: undefined as string | undefined, model: undefined as string | undefined };
    }
    if (msg.senderId === '__orchestrator__') {
      return { name: t('chat.orchestrator'), letter: '✦', color: ORCHESTRATOR_STYLE.color, icon: ORCHESTRATOR_STYLE.icon, nameColor: ORCHESTRATOR_STYLE.color, roleName: null as string | null, provider: undefined as string | undefined, model: undefined as string | undefined };
    }
    const agent = agentMap.get(msg.senderId);
    const style = agent?.provider
      ? resolveProviderStyle(agent.provider, agent.model)
      : undefined;
    return {
      name: agent?.displayName ?? 'Agent',
      letter: agent?.avatarLetter ?? 'A',
      color: style?.color ?? agent?.avatarColor ?? '#8b5cf6',
      icon: style?.icon,
      nameColor: style?.color,
      roleName: agent?.roleName ?? null,
      provider: agent?.provider,
      model: agent?.model,
    };
  }

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [replies.length, scrollToBottom]);

  const handleSend = useCallback(
    (content: string) => {
      sendReply(channelId, content);
    },
    [channelId, sendReply],
  );

  return (
    <div className="flex h-full w-80 flex-col border-s border-zinc-800/60 bg-zinc-950 xl:w-96">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquareReply size={14} className="text-indigo-400" />
          <span className="text-sm font-semibold text-zinc-200">{t('thread.title')}</span>
          {replies.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {replies.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <X size={14} />
        </button>
      </div>

      {/* Thread content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : (
          <div className="py-2">
            {/* Parent message */}
            {parentMessage && (
              <>
                <div className="border-b border-zinc-800/40 pb-2">
                  {(() => {
                    const sender = getSenderInfo(parentMessage);
                    return (
                      <MessageBubble
                        id={parentMessage.id}
                        senderType={parentMessage.senderType}
                        senderId={parentMessage.senderId}
                        content={parentMessage.content}
                        createdAt={parentMessage.createdAt}
                        senderName={sender.name}
                        roleName={sender.roleName}
                        avatarLetter={sender.letter}
                        avatarColor={sender.color}
                        avatarIcon={sender.icon}
                        nameColor={sender.nameColor}
                        provider={sender.provider}
                        modelId={sender.model}
                        onSendMessage={onSendMessage}
                      />
                    );
                  })()}
                </div>
                {replies.length > 0 && (
                  <div className="my-1.5 flex items-center gap-2 px-4">
                    <div className="h-px flex-1 bg-zinc-800/60" />
                    <span className="text-[10px] text-zinc-600">
                      {replies.length} {replies.length === 1 ? t('thread.reply') : t('thread.replies')}
                    </span>
                    <div className="h-px flex-1 bg-zinc-800/60" />
                  </div>
                )}
              </>
            )}

            {/* Thread replies */}
            {replies.map((msg) => {
              const sender = getSenderInfo(msg);
              return (
                <MessageBubble
                  key={msg.id}
                  id={msg.id}
                  senderType={msg.senderType}
                  senderId={msg.senderId}
                  content={msg.content}
                  createdAt={msg.createdAt}
                  senderName={sender.name}
                  roleName={sender.roleName}
                  avatarLetter={sender.letter}
                  avatarColor={sender.color}
                  avatarIcon={sender.icon}
                  nameColor={sender.nameColor}
                  provider={sender.provider}
                  modelId={sender.model}
                  onSendMessage={onSendMessage}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Thread input */}
      <MessageInput
        onSend={handleSend}
        isSending={isSending}
        placeholder={t('thread.replyPlaceholder')}
        agents={agents.map((a) => {
          const s = a.provider ? resolveProviderStyle(a.provider, a.model) : undefined;
          return {
            id: a.agentId,
            displayName: a.displayName,
            avatarLetter: a.avatarLetter,
            avatarColor: s?.color ?? a.avatarColor,
            avatarIcon: s?.icon,
            provider: a.provider,
            model: a.model,
          };
        })}
      />
    </div>
  );
}
