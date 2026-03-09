import { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Square, Plus } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc';
import { MessageBubble } from '../chat/MessageBubble';
import { MarkdownContent } from '../chat/MarkdownContent';
import type { TypingAgent } from '../../hooks/useStream';
import { AgentName } from '../shared/AgentName';

interface InboxDMDetailProps {
  agentId: string;
  channelId: string;
  displayName: string;
  roleName?: string | null | undefined;
  avatarLetter: string;
  avatarColor: string;
  avatarIcon?: string | undefined;
  nameColor?: string | undefined;
  provider?: string | undefined;
  modelId?: string | null | undefined;
  onBack: () => void;
  onMarkRead: () => void;
  onCreateGroupChat?: (() => void) | undefined;
  onCancelGeneration?: (() => void) | undefined;
  typing?: TypingAgent | null | undefined;
  streamingContent?: string | null | undefined;
}

export function InboxDMDetail({
  agentId,
  channelId,
  displayName,
  roleName,
  avatarLetter,
  avatarColor,
  avatarIcon,
  nameColor,
  provider,
  modelId,
  onBack,
  onMarkRead,
  onCreateGroupChat,
  onCancelGeneration,
  typing,
  streamingContent,
}: InboxDMDetailProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const markedRef = useRef(false);
  const { isRtl } = useI18n();

  const messagesQuery = trpc.message.listDM.useQuery(
    { channelId, agentId },
    { refetchInterval: 3000 },
  );

  const sendMutation = trpc.message.sendDM.useMutation({
    onSuccess: () => messagesQuery.refetch(),
    onError: (err) => {
      console.error('DM send failed:', err.message);
    },
  });

  const messages = messagesQuery.data?.messages ?? [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, typing, streamingContent]);

  useEffect(() => {
    if (!markedRef.current) {
      markedRef.current = true;
      onMarkRead();
    }
  }, [onMarkRead]);

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    const content = input.trim();
    setInput('');
    sendMutation.mutate(
      { channelId, agentId, content },
      { onError: () => setInput(content) },
    );
  }, [input, channelId, agentId, sendMutation]);

  const handleFormSend = useCallback((content: string) => {
    if (!content.trim()) return;
    sendMutation.mutate({ channelId, agentId, content: content.trim() });
  }, [channelId, agentId, sendMutation]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-2">
        <button
          onClick={onBack}
          className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          {isRtl ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
        </button>
        {avatarIcon ? (
          <span className="flex h-6 w-6 items-center justify-center text-base leading-none">{avatarIcon}</span>
        ) : (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ backgroundColor: avatarColor }}
          >
            {avatarLetter}
          </div>
        )}
        <span className={`flex-1 truncate text-sm font-semibold ${nameColor ? '' : 'text-zinc-100'}`} style={nameColor ? { color: nameColor } : undefined}>
          <AgentName displayName={displayName} provider={provider} modelId={modelId} />
          {roleName && (
            <span className="ms-1.5 text-[10px] font-normal text-indigo-400/60">{roleName}</span>
          )}
        </span>
        {onCreateGroupChat && (
          <button
            onClick={onCreateGroupChat}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="New Group Chat"
          >
            <Plus size={12} />
            Group
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {messages.length === 0 && !typing ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            Start a conversation with {displayName}
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                id={msg.id}
                senderType={msg.senderType}
                senderId={msg.senderId}
                content={msg.content}
                createdAt={msg.createdAt}
                senderName={msg.senderType === 'user' ? 'You' : displayName}
                roleName={msg.senderType === 'agent' ? roleName : undefined}
                avatarLetter={msg.senderType === 'user' ? 'U' : avatarLetter}
                avatarColor={msg.senderType === 'user' ? '#6366f1' : avatarColor}
                avatarIcon={msg.senderType === 'agent' ? avatarIcon : undefined}
                nameColor={msg.senderType === 'agent' ? nameColor : undefined}
                provider={msg.senderType === 'agent' ? provider : undefined}
                modelId={msg.senderType === 'agent' ? modelId : undefined}
                onSendMessage={handleFormSend}
              />
            ))}

            {/* Typing / streaming indicator */}
            {typing && (
              <div className="flex items-start gap-3 px-4 py-2">
                {avatarIcon ? (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center text-base leading-none">{avatarIcon}</span>
                ) : (
                  <div
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {avatarLetter}
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
                    <span className="text-[10px] text-zinc-600">
                      {typing.activity ?? (typing.status === 'thinking' ? 'thinking...' : 'writing...')}
                    </span>
                  </div>
                  <div className="mt-1">
                    {streamingContent ? (
                      <MarkdownContent content={streamingContent} />
                    ) : (
                      <div className="flex gap-1 py-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reply input */}
      <div className="px-4 py-3">
        <div className="flex items-end gap-2 rounded-xl border border-zinc-700/50 bg-zinc-900/80 px-3 py-2.5 transition-colors focus-within:border-indigo-500/50 focus-within:shadow-lg focus-within:shadow-indigo-500/5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && typing && onCancelGeneration) {
                e.preventDefault();
                onCancelGeneration();
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onInput={() => {
              const el = inputRef.current;
              if (!el) return;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            dir="auto"
            rows={1}
            placeholder={`Message ${displayName}...`}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          {typing && onCancelGeneration ? (
            <button
              onClick={onCancelGeneration}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white shadow-sm transition-all hover:bg-red-500"
              title="Stop generation"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || sendMutation.isPending}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-500/20 transition-all hover:shadow-md hover:shadow-indigo-500/30 disabled:opacity-30 disabled:shadow-none"
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
