/**
 * Handle 'token' and 'start' stream events.
 *
 * Appends tokens to the store and manages per-participant flush buffers.
 * Content stays in the live area during streaming; final rendering is
 * handled by the 'message' Static entry added on completion.
 */

import { appendToken } from '@cebus/engine';
import type { OrchestrationStreamEvent } from '@cebus/engine';
import type { StreamFlushBuffer } from '../../chat-types';
import type { StreamHandlerContext } from './types';

type TokenEvent = Extract<OrchestrationStreamEvent, { type: 'token' }>;
type StartEvent = Extract<OrchestrationStreamEvent, { type: 'start' }>;

/** Handle a 'token' event: append token to store and accumulate in buffer. */
export function handleTokenEvent(event: TokenEvent, ctx: StreamHandlerContext): void {
  const participantId = ctx.idMap.get(event.agentId);
  if (participantId === undefined) return;
  const placeholder = ctx.placeholders.get(participantId);
  if (placeholder === undefined) return;

  ctx.markAgentStarted(event.agentId, participantId);
  ctx.streamedMessageIds.current.add(placeholder.id);
  appendToken(ctx.sessionId, placeholder.id, event.token);

  let buf = ctx.streamFlushRef.current.get(participantId);
  if (!buf) {
    buf = {
      messageId: placeholder.id,
      unflushed: '',
      chunkCounter: 0,
      headerEmitted: false,
      inCodeBlock: false,
      codeBlockAccum: '',
      completed: false,
    } satisfies StreamFlushBuffer;
    ctx.streamFlushRef.current.set(participantId, buf);
  }

  buf.headerEmitted = true;
  buf.unflushed += event.token;
}

/** Handle a 'start' event: record guidance and move from waiting → streaming.
 *  Moving the participant on 'start' (before the first token) separates the
 *  state transition from the Static header entry that handleTokenEvent adds,
 *  which prevents Ink ghost renders caused by simultaneous state + Static changes. */
export function handleStartEvent(event: StartEvent, ctx: StreamHandlerContext): void {
  const participantId = ctx.idMap.get(event.agentId);
  if (participantId !== undefined) {
    if (event.guidance !== undefined && event.guidance.length > 0) {
      ctx.guidanceRef.current.set(participantId, event.guidance);
    }
    ctx.markAgentStarted(event.agentId, participantId);
  }
}
