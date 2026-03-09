/**
 * LangGraph State Schema
 *
 * T008: Defines the OrchestrationState using LangGraph Annotation.Root.
 * This is the central data structure flowing through graph nodes.
 */

import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import type {
  TeamConfig,
  RoutingDecision,
  ExecutionContext,
  OrchestratorAnalysis,
  SummaryAnchor,
  Attachment,
  TlPhase,
  TlBudgets,
  TaskLedger,
  ProgressLedger,
  DiscussionHistory,
  Artifact,
  UserOverride,
} from './types.js';

/**
 * OrchestrationState — the runtime state managed by LangGraph.
 *
 * Uses LangGraph's Annotation system for typed state with reducers:
 * - messages: append reducer (MessagesAnnotation)
 * - routingDecisions: append reducer
 * - All other fields: overwrite (last write wins)
 */
export const OrchestrationState = Annotation.Root({
  // Conversation messages — uses LangGraph's built-in message accumulation
  ...MessagesAnnotation.spec,

  // Team configuration — set at compile time, immutable during execution
  teamConfig: Annotation<TeamConfig>,

  // Sequential index tracking (-1 = nobody spoke yet, start from agent 0)
  lastSpeakerIndex: Annotation<number>({
    default: () => -1,
    reducer: (_prev, next) => next,
  }),

  // Trace ID for the current invocation
  currentTraceId: Annotation<string>({
    default: () => '',
    reducer: (_prev, next) => next,
  }),

  // Audit trail of routing decisions — appends
  routingDecisions: Annotation<RoutingDecision[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),

  // Currently executing agent
  activeAgentId: Annotation<string | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // Agents pending execution (for sequential/multi-tag)
  pendingAgents: Annotation<string[]>({
    default: () => [],
    reducer: (_prev, next) => next,
  }),

  // Session identifier
  sessionId: Annotation<string>({
    default: () => '',
    reducer: (_prev, next) => next,
  }),

  // Whether the current invocation is complete
  isComplete: Annotation<boolean>({
    default: () => false,
    reducer: (_prev, next) => next,
  }),

  // System command detected (e.g., /reset, /help)
  systemCommand: Annotation<string | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // Execution contexts for pending agents
  executionContexts: Annotation<Record<string, ExecutionContext>>({
    default: () => ({}),
    reducer: (_prev, next) => next,
  }),

  // Directed routing override — when set, only these agent IDs respond
  directedTo: Annotation<string[]>({
    default: () => [],
    reducer: (_prev, next) => next,
  }),

  // Orchestrator middleware state
  orchestratorAnalysis: Annotation<OrchestratorAnalysis | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),
  orchestratorRound: Annotation<number>({
    default: () => 0,
    reducer: (_prev, next) => next,
  }),
  orchestratorMaxRounds: Annotation<number>({
    default: () => 3,
    reducer: (_prev, next) => next,
  }),
  orchestratorPlanApproved: Annotation<boolean | null>({
    default: () => null, // null = no plan, true = approved, false = rejected
    reducer: (_prev, next) => next,
  }),
  // Per-agent cache anchors for frozen compaction summaries (maximizes prompt caching)
  summaryAnchors: Annotation<Record<string, SummaryAnchor>>({
    default: () => ({}),
    reducer: (prev, next) => ({ ...prev, ...next }),
  }),

  // File attachments passed with the current message (e.g. images for vision)
  attachments: Annotation<ReadonlyArray<Attachment>>({
    default: () => [],
    reducer: (_prev, next) => next,
  }),

  // ─── Team Leader State Fields ───────────────────────────────────────

  // Current TL phase (null = TL not active)
  currentPhase: Annotation<TlPhase | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // Previous TL phase (for transition tracking)
  previousPhase: Annotation<TlPhase | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // TL decision cycle counter
  tlCycle: Annotation<number>({
    default: () => 0,
    reducer: (_prev, next) => next,
  }),

  // Path to the session ledger file on disk
  sessionLedgerPath: Annotation<string | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // TL budget tracking (separate from worker budgets)
  budgets: Annotation<TlBudgets | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // Magentic-One inspired task ledger — TL's working memory
  taskLedger: Annotation<TaskLedger | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // Progress tracking for TL orchestration steps
  progressLedger: Annotation<ProgressLedger | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // Multi-model discussion history
  discussionHistory: Annotation<DiscussionHistory | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // Tracked artifacts (append-only)
  artifacts: Annotation<Artifact[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),

  // User override command (transient — consumed once, not persisted across checkpoints)
  userOverride: Annotation<UserOverride | null>({
    default: () => null,
    reducer: (_prev, next) => next,
  }),

  // Number of messages TL had already seen at last decision cycle.
  // Used to detect whether new worker responses arrived since the last TL cycle.
  tlSeenMessageCount: Annotation<number>({
    default: () => 0,
    reducer: (_prev, next) => next,
  }),
});

export type OrchestrationStateType = typeof OrchestrationState.State;
