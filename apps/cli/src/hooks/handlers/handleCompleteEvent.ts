/**
 * Handle 'complete' and 'error' stream events.
 *
 * Finalizes the message in the store, then uses a two-phase deferred cleanup:
 * Phase 1 (next tick): remove from live area (shrinks it).
 * Phase 2 (tick after): add to Static (Ink's cursor math is now correct).
 *
 * This avoids the Ink bug where Static entries added while a large live area
 * is active get their content overwritten by cursor repositioning.
 */

import {
  getMessages,
  updateMessage,
  logMessage,
  logChatMessage,
  finalizeResponse,
  finalizeError,
} from '@cebus/engine';
import type { OrchestrationStreamEvent } from '@cebus/engine';
import type { StreamHandlerContext } from './types';

type CompleteEvent = Extract<OrchestrationStreamEvent, { type: 'complete' }>;
type ErrorEvent = Extract<OrchestrationStreamEvent, { type: 'error' }>;

/**
 * Two-phase deferred transition from live area to Static.
 * Phase 1: remove from live area (streaming/waiting lists + buffer).
 * Phase 2: add to Static entries (after Ink re-renders with smaller live area).
 *
 * Guard: if `prepareForNewRound` replaced the placeholder between scheduling
 * and execution, Phase 1 skips the removal — the new round owns the streaming
 * state and removing would hide round 2 tokens.
 */
function deferToStatic(
  participantId: string,
  messageId: string,
  ctx: StreamHandlerContext
): void {
  // Phase 1: shrink the live area — but only if no new round replaced us
  setTimeout(() => {
    const currentPlaceholder = ctx.placeholders.get(participantId);
    const replacedByNewRound =
      currentPlaceholder !== undefined && currentPlaceholder.id !== messageId;

    if (!replacedByNewRound) {
      ctx.setStreamingParticipants(prev => prev.filter(id => id !== participantId));
      ctx.setWaitingParticipants(prev => prev.filter(id => id !== participantId));
    }

    // Phase 2: add to Static now that the live area is smaller
    // (always runs — the old message needs to be persisted regardless)
    setTimeout(() => {
      if (ctx.staticIds.current.has(messageId)) return;
      ctx.streamingMessageIds.current.delete(messageId);

      const activityEntries = ctx.agentActivityRef.current.get(participantId);
      const fullMessage = getMessages(ctx.sessionId).find(m => m.id === messageId);
      if (!fullMessage) return;

      ctx.staticIds.current.add(messageId);
      if (activityEntries && activityEntries.length > 0) {
        ctx.setStaticEntries(prev => [
          ...prev,
          {
            id: `${messageId}-activity`,
            kind: 'tool-activity' as const,
            senderId: participantId,
            entries: activityEntries.map(e => ({ ...e })),
          },
          { id: messageId, kind: 'message' as const, message: fullMessage },
        ]);
      } else {
        ctx.setStaticEntries(prev => [
          ...prev,
          { id: messageId, kind: 'message' as const, message: fullMessage },
        ]);
      }
    }, 0);
  }, 0);
}

/** Handle a 'complete' event: finalize in store, defer transition to Static. */
export function handleCompleteEvent(event: CompleteEvent, ctx: StreamHandlerContext): void {
  const participantId = ctx.idMap.get(event.agentId);
  if (participantId !== undefined) {
    const placeholder = ctx.placeholders.get(participantId);
    if (placeholder) {
      // Ensure a flush buffer exists for models that skip individual token events.
      let buf = ctx.streamFlushRef.current.get(participantId);
      if (!buf) {
        buf = {
          messageId: placeholder.id,
          unflushed: event.content ?? '',
          chunkCounter: 0,
          headerEmitted: true,
          inCodeBlock: false,
          codeBlockAccum: '',
          completed: false,
        };
        ctx.streamFlushRef.current.set(participantId, buf);
        if (!ctx.streamingOrder.current.includes(participantId)) {
          ctx.streamingOrder.current.push(participantId);
        }
      }

      // Sync content from the complete event to the store.
      if (event.content && event.content.length > 0) {
        updateMessage(ctx.sessionId, placeholder.id, { content: event.content });
      }

      // Finalize the message in the store (sets status to complete).
      const completeMsg = finalizeResponse(ctx.sessionId, placeholder.id, {
        agentId: event.agentId,
        agentName: event.agentId,
        content: event.content,
        toolInvocations: [],
        ...(event.tokenUsage ? { tokenUsage: event.tokenUsage } : {}),
      });

      // Mark buffer completed — live area will return null for this model.
      buf.completed = true;

      ctx.modelResponseCount.current += 1;
      logMessage('complete', participantId, { responseCount: ctx.modelResponseCount.current });
      const sender = ctx.participants.find(p => p.id === participantId);
      logChatMessage(sender?.displayName ?? 'Model', completeMsg.content, false);

      // Two-phase transition: shrink live area, then add to Static.
      deferToStatic(participantId, placeholder.id, ctx);
    } else {
      ctx.setStreamingParticipants(prev => prev.filter(id => id !== participantId));
      ctx.setWaitingParticipants(prev => prev.filter(id => id !== participantId));
    }
  }
  ctx.setMessages([...getMessages(ctx.sessionId)]);
}

/** Handle an 'error' event: finalize error in store, defer transition to Static. */
export function handleErrorEvent(event: ErrorEvent, ctx: StreamHandlerContext): void {
  const participantId = ctx.idMap.get(event.agentId);
  if (participantId !== undefined) {
    const placeholder = ctx.placeholders.get(participantId);
    if (placeholder) {
      let buf = ctx.streamFlushRef.current.get(participantId);
      if (buf) {
        buf.completed = true;
      }

      if (event.error.code === 'CANCELLED') {
        const current = getMessages(ctx.sessionId).find(m => m.id === placeholder.id);
        const partialContent = current?.content ?? '';
        const cancelledContent =
          partialContent.length > 0 ? `${partialContent}\n\n_(cancelled)_` : '_(cancelled)_';
        finalizeResponse(ctx.sessionId, placeholder.id, {
          agentId: event.agentId,
          agentName: event.agentId,
          content: cancelledContent,
          toolInvocations: [],
        });
      } else {
        finalizeError(ctx.sessionId, placeholder.id, event.error.code, event.error.message);
      }

      // Ensure a flush buffer exists for the two-phase transition.
      if (!buf) {
        buf = {
          messageId: placeholder.id,
          unflushed: '',
          chunkCounter: 0,
          headerEmitted: false,
          inCodeBlock: false,
          codeBlockAccum: '',
          completed: true,
        };
        ctx.streamFlushRef.current.set(participantId, buf);
        if (!ctx.streamingOrder.current.includes(participantId)) {
          ctx.streamingOrder.current.push(participantId);
        }
      }

      deferToStatic(participantId, placeholder.id, ctx);
    } else {
      ctx.setStreamingParticipants(prev => prev.filter(id => id !== participantId));
      ctx.setWaitingParticipants(prev => prev.filter(id => id !== participantId));
    }
    logMessage('error', participantId, {
      error: event.error,
      cancelled: event.error.code === 'CANCELLED',
    });
  }
  ctx.setMessages([...getMessages(ctx.sessionId)]);
}
