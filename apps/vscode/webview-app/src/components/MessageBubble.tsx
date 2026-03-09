import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { AgentMessage, ParticipantInfo, TokenUsageInfo } from '../hooks/useVSCodeMessages';
import { resolveProviderStyle } from '../lib/provider-styles';

interface MessageBubbleProps {
  message: AgentMessage;
  participants: ParticipantInfo[];
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function MessageBubble({ message, participants }: MessageBubbleProps): React.ReactElement {
  const isUser = message.senderType === 'user';
  const participant = participants.find(p => p.id === message.agentId);
  const style = participant?.providerId
    ? resolveProviderStyle(participant.providerId, participant.modelId)
    : undefined;

  const avatarColor = style?.color ?? '#8b5cf6';
  const avatarIcon = style?.icon;
  const initial = message.displayName.charAt(0).toUpperCase();

  if (isUser) {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[85%]">
          <div className="mb-0.5 flex items-center justify-end gap-1.5">
            <span className="text-[10px] text-muted">{relativeTime(message.timestamp)}</span>
            <span className="text-xs font-medium text-muted">You</span>
          </div>
          <div className="rounded-lg rounded-tr-sm bg-primary/15 px-3 py-2">
            <div className="prose-sidebar text-sm text-foreground">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 flex gap-2">
      {/* Avatar */}
      <div
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs leading-none"
        style={{ backgroundColor: `${avatarColor}20`, color: avatarColor }}
      >
        {avatarIcon ?? initial}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="text-xs font-semibold" style={{ color: avatarColor }}>
            {message.displayName}
          </span>
          <span
            className="rounded-sm px-1 py-px text-[9px] font-medium uppercase leading-none"
            style={{ backgroundColor: `${avatarColor}18`, color: avatarColor }}
          >
            AI
          </span>
          <span className="text-[10px] text-muted">{relativeTime(message.timestamp)}</span>
        </div>

        {!message.complete && !message.content ? (
          <div className="flex items-center gap-1 py-1.5" style={{ color: avatarColor }}>
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        ) : (
          <div className="prose-sidebar text-sm text-foreground">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}

        {/* Token usage footer */}
        {message.complete && message.tokenUsage && (
          <UsageFooter usage={message.tokenUsage} />
        )}
      </div>
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function UsageFooter({ usage }: { usage: TokenUsageInfo }): React.ReactElement | null {
  const parts: string[] = [];
  if (usage.inputTokens !== undefined && usage.inputTokens > 0) {
    parts.push(`${formatTokenCount(usage.inputTokens)} in`);
  }
  if (usage.outputTokens !== undefined && usage.outputTokens > 0) {
    parts.push(`${formatTokenCount(usage.outputTokens)} out`);
  }
  if (parts.length === 0) return null;

  let costStr = '';
  if (usage.estimatedCostUSD !== undefined && usage.estimatedCostUSD > 0) {
    costStr = ` | $${usage.estimatedCostUSD < 0.01 ? usage.estimatedCostUSD.toFixed(4) : usage.estimatedCostUSD.toFixed(3)}`;
  }
  let premiumStr = '';
  if (usage.premiumRequests !== undefined && usage.premiumRequests > 0) {
    premiumStr = ` | ${usage.premiumRequests} premium`;
  }

  return (
    <div className="mt-1 text-[10px] text-muted">
      {parts.join(' / ')}{costStr}{premiumStr}
    </div>
  );
}
