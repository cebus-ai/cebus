/**
 * Handle 'approval_required' and 'approval_result' stream events.
 */

import type { OrchestrationStreamEvent } from '@cebus/engine';
import type { StreamHandlerContext } from './types';

type ApprovalRequiredEvent = Extract<OrchestrationStreamEvent, { type: 'approval_required' }>;

/** Handle 'approval_required': prompt user for tool approval. */
export function handleApprovalRequired(
  event: ApprovalRequiredEvent,
  ctx: StreamHandlerContext
): void {
  const participantId = ctx.idMap.get(event.agentId);
  const sender =
    participantId !== undefined ? ctx.participants.find(p => p.id === participantId) : undefined;
  ctx.setPendingToolApproval({
    approvalId: event.approvalId,
    agentName: sender?.displayName ?? event.agentId,
    permissionKind: event.permissionKind,
    toolName: event.toolName,
    parameters: event.parameters,
  });
}

/** Handle 'approval_result': clear pending approval. */
export function handleApprovalResult(ctx: StreamHandlerContext): void {
  ctx.setPendingToolApproval(null);
}
