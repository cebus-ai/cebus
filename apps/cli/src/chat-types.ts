import type { Message, PermissionKind, OrchestratorPlan, TaskCompletionSummary, OrchestratorPhase } from '@cebus/engine';

/** URL confirmation pending state. */
export interface PendingUrlConfirmation {
  content: string;
  directedTo?: string[];
  urls: string[];
}

/** MCP tool approval pending state. */
export interface PendingToolApproval {
  approvalId: string;
  agentName: string;
  permissionKind: PermissionKind;
  toolName: string;
  parameters: Record<string, unknown>;
}

/** Orchestrator message with type info for differentiated rendering. */
export interface OrchestratorMessage {
  kind: 'analysis' | 'direct' | 'round' | 'complete' | 'plan' | 'status' | 'phase' | 'request' | 'step_result' | 'error';
  content: string;
  timestamp: Date;
  taskSummary?: TaskCompletionSummary | undefined;
  phase?: OrchestratorPhase | undefined;
  summary?: string | undefined;
  stepStatus?: 'done' | 'failed' | 'skipped' | undefined;
  nextSummary?: string | undefined;
}

/** Static items rendered into the terminal scroll buffer (Ink's Static component). */
export type StaticEntry =
  | { id: string; kind: 'message'; message: Message }
  | { id: string; kind: 'stream-header'; senderId: string; timestamp: Date; guidance?: string | undefined }
  | { id: string; kind: 'stream-text'; content: string }
  | { id: string; kind: 'plan'; plan: OrchestratorPlan; approved: boolean }
  | { id: string; kind: 'tool-activity'; senderId: string; entries: AgentActivityEntry[] }
  | { id: string; kind: 'tl-message'; content: string; phase: string; timestamp: Date }
  | { id: string; kind: 'orchestrator-message'; content: string; timestamp: Date }
  | { id: string; kind: 'tl-routing-plan'; assignments: Array<{ agentId: string; agentName: string; guidance: string }>; parallel: boolean; timestamp: Date };

/** Per-participant streaming flush buffer. */
export interface StreamFlushBuffer {
  messageId: string;
  unflushed: string;
  chunkCounter: number;
  headerEmitted: boolean;
  inCodeBlock: boolean;
  codeBlockAccum: string;
  completed: boolean;
}

/** Orchestrator plan pending approval. */
export interface PendingPlanApproval {
  plan: OrchestratorPlan;
  analysis: import('@cebus/engine').OrchestratorAnalysis;
  originalMessage: string;
}

/** Plan execution progress. */
export interface PlanProgress {
  plan: OrchestratorPlan;
  completed: number;
  activeAgent: string | null;
}

/** A single activity entry for an agent (tool use with optional result). */
export interface AgentActivityEntry {
  activity: string;
  result?: string | undefined;
  progress?: string | undefined;
}

/** Copilot SDK user input request pending state. */
export interface PendingUserInput {
  requestId: string;
  agentName: string;
  prompt: string;
  participantId?: string | undefined;
  options?: string[] | undefined;
}

export type AppView = 'chat' | 'help' | 'participants';
