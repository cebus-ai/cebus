import type { BaseMessage } from '@langchain/core/messages';

/**
 * Filter conversation history so each agent only sees messages relevant to it.
 *
 * When the current message is a broadcast (no directedTo), the agent receives
 * ALL messages — this is the "lazy sync" that ensures nothing is permanently lost.
 *
 * When the current message is directed, the agent only sees:
 * - Broadcast messages (no directedTo metadata)
 * - Messages directed to this agent
 * - Its own responses
 * - Responses to broadcasts (no respondingTo metadata)
 */
export function filterHistoryForAgent(
  agentId: string,
  messages: readonly BaseMessage[],
  currentMessageIsBroadcast: boolean,
): BaseMessage[] {
  if (currentMessageIsBroadcast) {
    return [...messages];
  }

  return messages.filter((m) => {
    const type = m._getType();
    const kwargs = (m.additional_kwargs ?? {}) as Record<string, unknown>;

    if (type === 'human') {
      const directedTo = kwargs['directedTo'] as string[] | undefined;
      if (!directedTo || directedTo.length === 0) return true;
      return directedTo.includes(agentId);
    }

    if (type === 'ai') {
      const name = (m as { name?: string }).name;
      if (name === agentId) return true;

      const respondingTo = kwargs['respondingTo'] as string[] | undefined;
      if (!respondingTo || respondingTo.length === 0) return true;
      return respondingTo.includes(agentId);
    }

    return true;
  });
}
