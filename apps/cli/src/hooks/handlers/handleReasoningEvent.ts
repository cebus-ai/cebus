import type { OrchestrationStreamEvent } from '@cebus/engine';
import type { StreamHandlerContext } from './types';

type ReasoningDelta = Extract<OrchestrationStreamEvent, { type: 'reasoning_delta' }>;
type ReasoningComplete = Extract<OrchestrationStreamEvent, { type: 'reasoning_complete' }>;

export function handleReasoningDelta(event: ReasoningDelta, ctx: StreamHandlerContext): void {
  const participantId = ctx.idMap.get(event.agentId);
  if (participantId === undefined) return;

  ctx.setReasoningContent(prev => {
    const next = new Map(prev);
    const existing = next.get(participantId) ?? '';
    next.set(participantId, existing + event.delta);
    return next;
  });
}

export function handleReasoningComplete(event: ReasoningComplete, ctx: StreamHandlerContext): void {
  const participantId = ctx.idMap.get(event.agentId);
  if (participantId === undefined) return;

  ctx.setReasoningContent(prev => {
    const next = new Map(prev);
    next.set(participantId, event.content);
    return next;
  });
}
