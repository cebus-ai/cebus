/**
 * Session Summarizer
 *
 * Summarizes a session's messages using the routing LLM
 * for the "summary" resume mode.
 */

import { createRoutingLLM } from '../orchestration/orchestrator/dynamic.js';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { Message } from './types.js';

/**
 * Summarize a session's conversation history using the configured routing LLM.
 *
 * @param messages - All messages from the session
 * @param participantNames - Map of participantId → display name
 * @returns Summary text
 */
export async function summarizeSession(
  messages: Message[],
  participantNames: Map<string, string>
): Promise<string> {
  const llm = await createRoutingLLM();

  const transcript = messages
    .filter(m => m.status === 'sent' || m.status === 'complete')
    .map(m => `${participantNames.get(m.senderId) ?? 'Unknown'}: ${m.content}`)
    .join('\n');

  const result = await llm.invoke([
    new SystemMessage(
      'Summarize this conversation concisely. Focus on key topics discussed and any decisions made.'
    ),
    new HumanMessage(transcript),
  ]);

  return typeof result.content === 'string' ? result.content : '';
}
