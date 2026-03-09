/**
 * SDK event types that indicate real progress (content production, tool activity).
 * Used to reset idle timeouts — other events (heartbeats, internal bookkeeping)
 * are ignored to prevent the timeout from never firing.
 *
 * Shared between CopilotWorker (orchestration) and CopilotAdapter (provider).
 */
export const COPILOT_PROGRESS_EVENTS = new Set([
  'assistant.turn_start',
  'assistant.message_delta',
  'assistant.message',
  'assistant.reasoning_delta',
  'assistant.reasoning',
  'assistant.streaming_delta',
  'assistant.usage',
  'assistant.turn_end',
  'tool.execution_start',
  'tool.execution_complete',
  'tool.execution_progress',
  'tool.execution_partial_result',
  'skill.invoked',
  'subagent.started',
  'subagent.completed',
  'subagent.failed',
  'session.plan_changed',
  'session.task_complete',
  'session.workspace_file_changed',
]);
