import type { OrchestrationStreamEvent } from '@cebus/engine';
import type { StreamHandlerContext } from './types';

type UserInputRequest = Extract<OrchestrationStreamEvent, { type: 'user_input_request' }>;

export function handleUserInputRequest(
  event: UserInputRequest,
  ctx: StreamHandlerContext,
): void {
  const participantId = ctx.idMap.get(event.agentId);
  const participant = ctx.participants.find(p => p.id === participantId);
  const agentName = participant?.nickname ?? event.agentId;

  ctx.setPendingUserInput({
    requestId: event.requestId,
    agentName,
    prompt: event.prompt,
    participantId,
  });
}
