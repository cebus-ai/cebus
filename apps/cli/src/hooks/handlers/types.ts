import type React from 'react';
import type { Participant, Message, OrchestrationGraph } from '@cebus/engine';
import type {
  StaticEntry,
  StreamFlushBuffer,
  OrchestratorMessage,
  PendingToolApproval,
  PendingPlanApproval,
  PlanProgress,
  AgentActivityEntry,
  PendingUserInput,
} from '../../chat-types';

export interface StreamHandlerContext {
  sessionId: string;
  participants: Participant[];
  idMap: ReadonlyMap<string, string>;
  placeholders: Map<string, { id: string; senderId: string }>;
  startedAgents: Set<string>;
  streamFlushRef: React.MutableRefObject<Map<string, StreamFlushBuffer>>;
  streamingMessageIds: React.MutableRefObject<Set<string>>;
  streamedMessageIds: React.MutableRefObject<Set<string>>;
  streamingOrder: React.MutableRefObject<string[]>;
  guidanceRef: React.MutableRefObject<Map<string, string>>;
  staticIds: React.MutableRefObject<Set<string>>;
  modelResponseCount: React.MutableRefObject<number>;
  graphRef: React.MutableRefObject<OrchestrationGraph | null>;
  latestAnalysisRef: React.MutableRefObject<import('@cebus/engine').OrchestratorAnalysis | null>;
  agentActivityRef: React.MutableRefObject<Map<string, AgentActivityEntry[]>>;

  setStaticEntries: React.Dispatch<React.SetStateAction<StaticEntry[]>>;
  setStreamingParticipants: React.Dispatch<React.SetStateAction<string[]>>;
  setWaitingParticipants: React.Dispatch<React.SetStateAction<string[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setOrchestratorMessages: React.Dispatch<React.SetStateAction<OrchestratorMessage[]>>;
  setPendingToolApproval: React.Dispatch<React.SetStateAction<PendingToolApproval | null>>;
  setPendingPlanApproval: React.Dispatch<React.SetStateAction<PendingPlanApproval | null>>;
  setPlanProgress: React.Dispatch<React.SetStateAction<PlanProgress | null>>;
  setCompactionNotice: React.Dispatch<React.SetStateAction<string | null>>;
  setAgentActivity: React.Dispatch<React.SetStateAction<Map<string, AgentActivityEntry[]>>>;
  setReasoningContent: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setPendingUserInput: React.Dispatch<React.SetStateAction<PendingUserInput | null>>;
  setTlThinking: React.Dispatch<React.SetStateAction<boolean>>;

  markAgentStarted: (agentId: string, participantId: string) => void;
  prepareForNewRound: (agentIds: string[]) => void;
}
