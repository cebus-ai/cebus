/**
 * Session Store Sync
 *
 * Keeps the session store in sync with orchestration stream events.
 * Creates placeholder messages, appends tokens, and finalizes responses.
 */

import type { Message, CompletionMeta } from '../../core/types.js';
import type { AgentResponse } from '../types.js';
import { getMessages, addMessage, updateMessage } from '../../core/session.js';
import {
  createAssistantMessage,
  markMessageComplete,
  markMessageError,
  appendMessageContent,
} from '../../core/message.js';

/**
 * Create a placeholder assistant message in the session store.
 */
export function createPlaceholder(sessionId: string, participantId: string): Message {
  const message = createAssistantMessage(sessionId, participantId, '');
  addMessage(sessionId, message);
  return message;
}

/**
 * Append a streaming token to an existing message in the session store.
 */
export function appendToken(sessionId: string, messageId: string, token: string): void {
  const current = getMessages(sessionId).find(m => m.id === messageId);
  if (!current) return;
  const updated = appendMessageContent(current, token);
  updateMessage(sessionId, messageId, updated);
}

/**
 * Mark a message as complete with optional token usage metadata.
 */
export function finalizeResponse(
  sessionId: string,
  messageId: string,
  response: AgentResponse
): Message {
  const current = getMessages(sessionId).find(m => m.id === messageId);
  if (!current) {
    throw new Error(`Message ${messageId} not found in session ${sessionId}`);
  }

  const meta: CompletionMeta = {
    finishReason: 'stop',
    usage: response.tokenUsage
      ? {
          promptTokens: response.tokenUsage.inputTokens,
          completionTokens: response.tokenUsage.outputTokens,
          ...(response.tokenUsage.cacheReadTokens !== undefined &&
          response.tokenUsage.cacheReadTokens !== 0
            ? { cacheReadTokens: response.tokenUsage.cacheReadTokens }
            : {}),
          ...(response.tokenUsage.cacheWriteTokens !== undefined &&
          response.tokenUsage.cacheWriteTokens !== 0
            ? { cacheWriteTokens: response.tokenUsage.cacheWriteTokens }
            : {}),
          ...(response.tokenUsage.premiumRequests !== undefined &&
          response.tokenUsage.premiumRequests !== 0
            ? { premiumRequests: response.tokenUsage.premiumRequests }
            : {}),
        }
      : undefined,
    ...(response.estimatedCostUSD !== undefined
      ? { estimatedCostUSD: response.estimatedCostUSD }
      : {}),
  };

  const complete = markMessageComplete(current, meta);
  updateMessage(sessionId, messageId, complete);
  return complete;
}

/**
 * Mark a message as errored in the session store.
 */
export function finalizeError(
  sessionId: string,
  messageId: string,
  errorCode: string,
  errorMessage: string
): Message {
  const current = getMessages(sessionId).find(m => m.id === messageId);
  if (!current) {
    throw new Error(`Message ${messageId} not found in session ${sessionId}`);
  }

  const errored = markMessageError(current, {
    code: errorCode,
    message: errorMessage,
  });
  updateMessage(sessionId, messageId, errored);
  return errored;
}
