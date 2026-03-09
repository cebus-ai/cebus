/**
 * Handle compaction_status stream events.
 * Shows a per-agent transient notice near the input area.
 */

import type { OrchestrationStreamEvent } from '@cebus/engine';
import type { StreamHandlerContext } from './types';

type CompactionStatusEvent = Extract<OrchestrationStreamEvent, { type: 'compaction_status' }>;

/** Handle 'compaction_status': show a per-agent transient compaction notice. */
export function handleCompactionStatus(
  event: CompactionStatusEvent,
  ctx: StreamHandlerContext
): void {
  const {
    totalMessages,
    windowSize,
    compactedMessages,
    summarized,
    source,
    contextUtilization,
    anchorReused,
  } = event;
  const name = event.agentName ?? event.agentId;

  // SDK-sourced event with actual compaction (from session.compaction_complete)

  if (source === 'sdk' && summarized) {
    ctx.setCompactionNotice(`✂ ${name}: SDK auto-compacted context`);
    return;
  }

  // Don't show when nothing was compacted
  if (compactedMessages === 0) return;

  // Build rich compaction display:
  // "✂ Claude: 47 total → 20 sent (summary + 15 recent) | 52% context | anchor reused ✓"
  const parts: string[] = [];

  // Message counts

  const sentDetail = summarized ? `(summary + ${windowSize} recent)` : `(truncated)`;
  parts.push(`${totalMessages} total → ${windowSize} sent ${sentDetail}`);

  // Context utilization
  if (contextUtilization !== undefined) {
    parts.push(`${contextUtilization}% context`);
  }

  // Anchor status
  if (anchorReused !== undefined) {
    parts.push(anchorReused ? 'anchor reused' : 'new summary');
  }

  ctx.setCompactionNotice(`✂ ${name}: ${parts.join(' | ')}`);
}
