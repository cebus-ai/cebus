import type { ProviderSessionState, ProviderSessionStateUnion } from '../providers/types.js';
import { z } from 'zod';

/** Reserved agent ID for the orchestrator participant in the orchestration graph. */
export const ORCHESTRATOR_AGENT_ID = '__orchestrator__';

// ─── Team Leader Types ───────────────────────────────────────────────

/** Phases the TL can transition through during orchestration. */
export type TlPhase = 'clarify' | 'plan' | 'deliberate' | 'execute' | 'review' | 'synthesize' | 'ask_user';

/** Context tier determined by model context window size. Controls prompt trimming. */
export type ContextTier = 'not_supported' | 'minimal' | 'lite' | 'standard' | 'full' | 'extended';

/** A target for parallel routing with per-agent guidance. */
export interface ParallelTarget {
  readonly agentId: string;
  readonly guidance: string;
}

/** User override command detected from interrupt keywords. Transient (UntrackedValue). */
export interface UserOverride {
  readonly type: 'skip_phase' | 'force_phase' | 'switch_agent' | 'stop' | 'restart';
  readonly target?: string | undefined;
}

/** A single step in the TL's task ledger. */
export interface TaskStep {
  readonly index: number;
  readonly agentId: string;
  readonly action: string;
  readonly acceptanceCriteria: string[];
  readonly dependsOn: number | null;
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
}

/** Magentic-One inspired task ledger — the TL's working memory for the current task. */
export interface TaskLedger {
  goal: string;
  facts: string[];
  unknowns: string[];
  steps: TaskStep[];
  agreedApproach: string | null;
  userPreferences: string[];
  decisions: DecisionRecord[];
}

/** Machine-readable record of a decision made during TL orchestration. */
export interface DecisionRecord {
  readonly id: string;
  readonly decision: string;
  readonly rationale: string;
  readonly alternatives: string[];
  readonly source: 'tl' | 'user' | 'vote' | 'model';
  readonly binding: boolean;
  readonly timestamp: number;
}

/** A tracked artifact produced during TL orchestration. */
export interface Artifact {
  readonly id: string;
  readonly type: 'proposal' | 'plan' | 'implementation' | 'review' | 'synthesis';
  readonly author: string;
  readonly status: 'draft' | 'approved' | 'rejected' | 'superseded';
  readonly createdAt: number;
  readonly contentRef: string;
}

/** Progress tracking for TL orchestration steps. */
export interface ProgressLedger {
  completedSteps: number[];
  currentStepIndex: number;
  stalled: boolean;
  reviewRound: number;
}

/** Separate budgets for TL, worker, and review cycles. */
export interface TlBudgets {
  readonly maxTlCycles: number;
  readonly maxWorkerRounds: number;
  readonly maxReviewRounds: number;
  usedTlCycles: number;
  usedWorkerRounds: number;
  usedReviewRounds: number;
}

/** Discussion history tracking for multi-model deliberation. */
export interface DiscussionHistory {
  proposals: Record<string, string>;
  critiques: Record<string, string>;
  userFeedback: string[];
  votes: Record<string, string>;
}

// ─── TlResponse Schema (TL LLM output) ──────────────────────────────

const TlPhaseSchema = z.enum(['clarify', 'plan', 'deliberate', 'execute', 'review', 'synthesize', 'ask_user']);

const ParallelTargetSchema = z.object({
  agentId: z.string().max(64),
  guidance: z.string().max(2000),
});

export const TlActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), content: z.string().max(5000), phase: TlPhaseSchema }),
  z.object({ type: z.literal('question'), content: z.string().max(2000), options: z.array(z.string().max(200)).max(5).optional(), inputType: z.enum(['choice', 'freeform']) }),
  z.object({ type: z.literal('summary'), progress: z.string().max(2000), nextStep: z.string().max(500) }),
  z.object({ type: z.literal('vote_request'), topic: z.string().max(500), options: z.array(z.string().max(200)).min(2).max(5) }),
  z.object({ type: z.literal('route_agent'), targetAgent: z.string().max(64), guidance: z.string().max(2000), phase: TlPhaseSchema }),
  z.object({ type: z.literal('parallel_route'), targets: z.array(ParallelTargetSchema).min(2).max(10), mergeStrategy: z.enum(['synthesize', 'compare', 'vote']).catch('synthesize'), timeoutMs: z.number().int().min(5000).max(300000).optional(), proceedOnPartial: z.boolean().default(true) }),
  z.object({ type: z.literal('request_review'), targetAgent: z.string().max(64), criteria: z.array(z.string().max(500)).min(1).max(10) }),
  z.object({ type: z.literal('synthesize'), scope: z.enum(['proposals', 'execution', 'full']) }),
  z.object({ type: z.literal('complete'), stopReason: z.string().max(500), deliverSynthesis: z.boolean() }),
  z.object({ type: z.literal('pause'), reason: z.string().max(500), needsUserInput: z.boolean() }),
  z.object({ type: z.literal('inspect_history'), query: z.string().max(500) }),
]);

export const TlResponseSchema = z.object({
  version: z.literal(1).default(1),
  actions: z.array(TlActionSchema).min(1).max(5),
});

export type TlAction = z.infer<typeof TlActionSchema>;
export type TlResponse = z.infer<typeof TlResponseSchema>;

// ─── Team Leader Config ──────────────────────────────────────────────

/** Configuration for the Team Leader within the orchestrator. */
export interface TeamLeaderConfig {
  readonly enabled: boolean;
  readonly model?: string | undefined;
  readonly provider?: ProviderConfig | undefined;
  readonly verbosity?: 'minimal' | 'normal' | 'verbose' | undefined;
  readonly timeout?: number | undefined;
}

/** Whether routing decisions are made by an AI model or by deterministic rules. */
export type OrchestrationMode = 'ai' | 'deterministic';

/** Current phase of the orchestrator middleware lifecycle. */
export type OrchestratorPhase = 'idle' | 'analyzing' | 'planning' | 'executing' | 'reviewing' | 'complete';

/** Metadata for a temp plan file written to disk. */
export interface OrchestratorPlanFile {
  readonly path: string;
  readonly sessionId: string;
  readonly createdAt: string;
}

/** Source of orchestrator debug reasoning output. */
export type OrchestratorReasoningSource = 'analyzer' | 'planner' | 'evaluator';

/** Mutable ref shared between compile-time closures and runtime stream callbacks. */
export interface StreamCallbackRef {
  current: ((event: OrchestrationStreamEvent) => void) | undefined;
}

/**
 * How messages are routed to agents within the orchestration graph.
 * Maps from the session-level {@link ChatMode} during config building.
 */
export type ConversationMode = 'dynamic' | 'tag_only' | 'sequential' | 'free_chat';

/** Transport type for connecting to an MCP server. */
export type MCPTransportType = 'local' | 'http' | 'streamable_http';

/** Circuit breaker states for MCP server health tracking. */
export type CircuitState = 'closed' | 'open' | 'half_open';

/** Lifecycle status of an orchestration session. */
export type SessionStatus = 'active' | 'ended' | 'suspended';

/** Configuration for connecting to an MCP (Model Context Protocol) server. */
export interface MCPServerConfig {
  readonly id: string;
  readonly type: MCPTransportType;
  readonly command?: string;
  readonly args?: string[];
  readonly url?: string;
  readonly headers?: Record<string, string>;
  readonly tools?: string[];
  readonly timeout?: number;
  readonly env?: Record<string, string>;
}

/** Provider connection settings (type, API key, base URL). */
export interface ProviderConfig {
  readonly type: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'copilot' | 'openrouter' | 'vscode-lm';
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly byok?: {
    readonly providerType: 'openai' | 'anthropic' | 'ollama';
    readonly baseUrl?: string | undefined;
    readonly apiKey?: string | undefined;
  } | undefined;
}

/** Configuration for message compaction (reducing long conversation histories). */
export interface CompactionConfig {
  readonly enabled: boolean;
  readonly checkpointInterval: number;
  /** Override the per-agent history window size. When unset, tier-aware defaults apply. */
  readonly maxHistoryMessages?: number | undefined;
  /** Override per-agent history window by token budget. Ignored if maxHistoryMessages is set. */
  readonly maxHistoryTokens?: number | undefined;
  /** Model ID to use for summarizing compacted messages. Uses a budget model by default. */
  readonly summaryModel?: string | undefined;
  /** Provider config for the summary model. */
  readonly summaryProvider?: ProviderConfig | undefined;
  /** Number of new overflow messages before regenerating the cache anchor (default: 5). */
  readonly anchorRefreshThreshold?: number | undefined;
}

/** A frozen conversation summary that stays static for multiple turns to maximize prompt caching. */
export interface SummaryAnchor {
  readonly text: string;
  readonly cutoffIndex: number;
  readonly createdAt: string;
  readonly tokenEstimate: number;
}

/** Configuration for persisting session state to disk. */
export interface PersistenceConfig {
  readonly enabled: boolean;
  readonly directory: string;
}

/** Configuration for AI-driven routing (which model to use for routing decisions). */
export interface AIRoutingConfig {
  readonly provider?: ProviderConfig;
  readonly model?: string;
}

/**
 * Configuration for MCP tool approval workflows.
 * Categorizes tools by risk level: read-only, write, or dangerous.
 */
export interface ToolApprovalConfig {
  readonly enabled: boolean;
  readonly readOnly?: string[];
  readonly write?: string[];
  readonly dangerous?: string[];
}

/** Token and rate limits for budget enforcement. */
export interface BudgetConfig {
  readonly maxTokensPerAgentPerSession?: number | null;
  readonly maxTokensPerSession?: number | null;
  readonly maxInvocationsPerMinute?: number | null;
}

/**
 * Profile for an agent in the orchestration graph.
 * Defines the agent's identity, role, instructions, and tool access.
 */
export interface AgentProfile {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly instructions: string[];
  readonly skills?: string[];
  readonly mcpServers?: MCPServerConfig[];
  readonly model?: string;
  readonly provider?: ProviderConfig;
  /** Restricts built-in tools for SDK-native agents (e.g. Copilot). Empty = chat-only. */
  readonly availableTools?: string[];
  /** Restricts filesystem access to these paths only (SDK-native agents). Empty = no access. */
  readonly allowedPaths?: string[];
  /** Stored Copilot SDK session ID for zero-cost resume via resumeSession(). */
  readonly copilotSessionId?: string | undefined;
  /** Provider session state for stateful conversations (OpenAI Responses API, Anthropic caching, etc.) */
  readonly providerSessionState?: ProviderSessionState | ProviderSessionStateUnion | undefined;
  /** Reasoning effort level for models that support extended thinking. */
  readonly reasoningEffort?: 'low' | 'medium' | 'high' | undefined;
  /** Custom agents to inject into SDK-native sessions (e.g. Copilot). */
  readonly customAgents?: ReadonlyArray<{
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly prompt: string;
  }> | undefined;
  /** Directories containing skill definitions for SDK-native sessions (e.g. Copilot). */
  readonly skillDirectories?: readonly string[] | undefined;
  /** Skill names to disable for SDK-native sessions (e.g. Copilot). */
  readonly disabledSkills?: readonly string[] | undefined;
}

/** Configuration for the orchestrator middleware LLM (model, provider, round limits). */
export interface OrchestratorMiddlewareConfig {
  readonly model?: string;
  readonly provider?: ProviderConfig;
  readonly maxRounds?: number;
}

/**
 * Top-level configuration for an orchestration team.
 * Defines agents, routing mode, budgets, tool approval, and orchestrator settings.
 * Built from session participants by {@link ConfigBuilder}.
 */
export interface TeamConfig {
  readonly teamId: string;
  readonly mission: string;
  readonly orchestrationMode: OrchestrationMode;
  readonly conversationMode: ConversationMode;
  readonly agents: AgentProfile[];
  readonly defaultAgentId?: string;
  readonly orchestratorInstructions?: string[];
  readonly orchestratorContext?: string[];
  readonly aiRouting?: AIRoutingConfig;
  readonly toolApproval?: ToolApprovalConfig;
  readonly budgets?: BudgetConfig;
  readonly compaction?: CompactionConfig;
  readonly sessionPersistence?: PersistenceConfig;
  /** Orchestrator middleware configuration — when present, enables AI-powered message analysis */
  readonly orchestrator?: OrchestratorMiddlewareConfig | undefined;
  /** Team Leader configuration — when enabled, TL manages multi-model orchestration */
  readonly teamLeader?: TeamLeaderConfig | undefined;
  /** Project context summary for TL awareness (tech stack, structure, etc.) */
  readonly projectContext?: string | undefined;
}

/** A recorded routing decision with target agents, confidence, and trace metadata. */
export interface RoutingDecision {
  readonly traceId: string;
  readonly timestamp: number;
  readonly mode: ConversationMode;
  readonly orchestrationMode: OrchestrationMode;
  readonly targetAgentIds: string[];
  readonly reason: string;
  readonly confidence?: number;
  readonly tagsParsed?: string[];
  readonly fallbackUsed: boolean;
}

/** A recorded MCP tool invocation with timing, result, and error details. */
export interface MCPToolInvocation {
  readonly traceId: string;
  readonly timestamp: number;
  readonly agentId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly parameters: Record<string, unknown>;
  readonly result?: unknown;
  readonly status: 'success' | 'error' | 'timeout';
  readonly latencyMs: number;
  readonly error?: string;
}

/** Current state of a circuit breaker for an MCP server. */
export interface CircuitBreakerState {
  readonly serverId: string;
  readonly state: CircuitState;
  readonly failureCount: number;
  readonly lastFailureAt: number | null;
  readonly nextRetryAt: number | null;
}

/** A file or directory attachment to pass to workers. */
export type Attachment =
  | { readonly type: 'file'; readonly path: string; readonly displayName?: string | undefined }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string; readonly path?: string | undefined; readonly displayName?: string | undefined }
  | { readonly type: 'directory'; readonly path: string; readonly displayName?: string | undefined }
  | {
      readonly type: 'selection';
      readonly filePath: string;
      readonly displayName?: string | undefined;
      readonly selection: {
        readonly start: { readonly line: number; readonly character: number };
        readonly end: { readonly line: number; readonly character: number };
      };
      readonly text?: string | undefined;
    };

/** Runtime context passed to a worker during agent execution. */
export interface ExecutionContext {
  readonly activeAgentId: string;
  readonly allowedTools: string[];
  readonly routingReason: string;
  readonly timeoutBudget: number;
  readonly cancellationToken: AbortSignal;
  /** Per-message guidance injected by the orchestrator middleware */
  readonly orchestratorGuidance?: string | undefined;
  /** File attachments to pass to the worker (e.g. images for vision models). */
  readonly attachments?: ReadonlyArray<Attachment> | undefined;
  /** Same-turn responses from earlier sequential agents (placed after user message). */
  readonly sameTurnResponses?: ReadonlyArray<{ role: string; content: string; name?: string | undefined }> | undefined;
}

/** Token usage counters for a single completion (input, output, cache). */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number | undefined;
  readonly cacheWriteTokens?: number | undefined;
  readonly premiumRequests?: number | undefined;
}

/** Current budget status for a session, including per-agent usage and limits. */
export interface BudgetStatus {
  readonly sessionId: string;
  readonly agentUsage: Record<string, TokenUsage>;
  readonly totalTokens: number;
  readonly limits: {
    readonly perAgentPerSession: number | null;
    readonly perSession: number | null;
    readonly perMinute: number | null;
  };
}

/** Mutable budget tracking state for a session. */
export interface BudgetState {
  readonly sessionId: string;
  agentTokenUsage: Record<string, { input: number; output: number }>;
  totalTokens: number;
  invocationTimestamps: Record<string, number[]>;
  /** Tokens reserved by in-flight requests (prevents concurrent overspend in free_chat mode). */
  reservedTokens: Record<string, number>;
}

/** A single step in a orchestrator-generated execution plan. */
export interface OrchestratorPlanStep {
  readonly agentId: string;
  readonly action: string; // "draft implementation", "review code", "test changes"
  readonly dependsOn?: number | undefined; // step index this depends on
}

/** A orchestrator-generated plan for handling a complex user request. */
export interface OrchestratorPlan {
  readonly description: string; // human-readable plan summary
  readonly steps: OrchestratorPlanStep[];
  readonly estimatedRounds: number;
  readonly estimatedCost: 'low' | 'medium' | 'high';
}

/**
 * The orchestrator's analysis of a user message.
 * Determines intent, complexity, selected agents, and optional execution plan.
 */
export interface OrchestratorAnalysis {
  readonly intent: string; // what the user is asking
  readonly complexity: 'simple' | 'moderate' | 'complex';
  readonly safetyFlags: string[]; // e.g., ['destructive_operation', 'sensitive_data']
  readonly plan?: OrchestratorPlan | undefined; // present for complex tasks
  readonly selectedAgents: string[]; // agentIds to handle this
  readonly agentInstructions: Record<string, string>; // per-agent guidance
  readonly directResponse?: string | undefined; // orchestrator answers directly (no agents)
  readonly needsApproval: boolean; // true -> ask user before executing plan
}

/** A single agent's contribution to a multi-round task. */
export interface AgentContribution {
  readonly agentId: string;
  readonly agentName: string;
  readonly role: string;
  readonly action: string;
  readonly excerpt: string;
  readonly round: number;
}

/** Summary of a completed multi-round task, including all agent contributions. */
export interface TaskCompletionSummary {
  readonly executiveSummary: string;
  readonly contributions: AgentContribution[];
  readonly metadata: {
    readonly intent: string;
    readonly complexity: 'simple' | 'moderate' | 'complex';
    readonly totalRounds: number;
    readonly maxRounds: number;
    readonly planDescription?: string | undefined;
  };
}

/** Categories of permissions that MCP tools may require. */
export type PermissionKind = 'shell' | 'write' | 'mcp' | 'read' | 'url';

/** User's response to a tool approval request, with optional auto-approval budget. */
export interface ApprovalResponse {
  readonly approved: boolean;
  /** Number of additional auto-approvals: 1=once, -1=unlimited, N=count */
  readonly budget: number;
}

/**
 * Events emitted during orchestration streaming.
 * Discriminated union on the `type` field. Covers agent execution,
 * routing decisions, MCP tools, budget, orchestrator lifecycle, and approvals.
 */
export type OrchestrationStreamEvent =
  | { type: 'start'; agentId: string; traceId: string; guidance?: string | undefined }
  | { type: 'waiting'; agentId: string; traceId: string }
  | { type: 'token'; agentId: string; traceId: string; token: string }
  | { type: 'complete'; agentId: string; traceId: string; content: string; tokenUsage?: TokenUsage | undefined; estimatedCostUSD?: number | undefined }
  | { type: 'error'; agentId: string; traceId: string; error: StreamError }
  | { type: 'routing'; traceId: string; decision: RoutingDecision }
  | { type: 'mcp_tool'; traceId: string; invocation: MCPToolInvocation }
  | {
      type: 'approval_required';
      traceId: string;
      agentId: string;
      toolName: string;
      parameters: Record<string, unknown>;
      approvalId: string;
      permissionKind: PermissionKind;
    }
  | {
      type: 'approval_result';
      traceId: string;
      approvalId: string;
      approved: boolean;
    }
  | {
      type: 'budget_exceeded';
      traceId: string;
      agentId: string;
      budgetType: 'agent_tokens' | 'session_tokens' | 'rate_limit';
      current: number;
      limit: number;
    }
  | { type: 'session_end'; traceId: string; sessionId: string }
  | { type: 'orchestrator_analysis'; traceId: string; analysis: OrchestratorAnalysis }
  | {
      type: 'orchestrator_plan';
      traceId: string;
      plan: OrchestratorPlan;
      awaitingApproval: boolean;
    }
  | {
      type: 'orchestrator_round';
      traceId: string;
      round: number;
      maxRounds: number;
      nextAgent: string;
      reason: string;
    }
  | { type: 'orchestrator_direct'; traceId: string; content: string }
  | {
      type: 'orchestrator_complete';
      traceId: string;
      summary: string;
      taskSummary?: TaskCompletionSummary | undefined;
    }
  | {
      type: 'compaction_status';
      traceId: string;
      agentId: string;
      /** Display name of the agent (for UI notices) */
      agentName?: string | undefined;
      /** Who triggered compaction: 'sdk' (Copilot native), 'custom' (LangChain trimMessages), 'emergency' (context overflow retry) */
      source?: 'sdk' | 'custom' | 'emergency' | undefined;
      /** Total messages in history (before windowing) */
      totalMessages: number;
      /** Window size for this agent */
      windowSize: number;
      /** Number of messages that were compacted (summarized) */
      compactedMessages: number;
      /** Whether a summary was generated for overflow messages */
      summarized: boolean;
      /** Total estimated tokens across all history messages */
      totalTokens?: number | undefined;
      /** Token budget used for windowing (when in token mode) */
      tokenBudget?: number | undefined;
      /** Estimated tokens in the kept window */
      windowTokens?: number | undefined;
      /** How many new messages have overflowed since anchor was frozen */
      anchorAge?: number | undefined;
      /** Whether the cache anchor was reused from a previous turn */
      anchorReused?: boolean | undefined;
      /** Context window utilization as percentage (0-100) */
      contextUtilization?: number | undefined;
    }
  | {
      type: 'agent_activity';
      traceId: string;
      agentId: string;
      activity: string;
      toolName?: string | undefined;
      kind?: 'start' | 'progress' | 'complete' | undefined;
      result?: string | undefined;
    }
  | { type: 'reasoning_delta'; traceId: string; agentId: string; delta: string }
  | { type: 'reasoning_complete'; traceId: string; agentId: string; content: string }
  | { type: 'user_input_request'; traceId: string; agentId: string; requestId: string; prompt: string }
  | { type: 'orchestrator_phase'; traceId: string; phase: OrchestratorPhase; detail?: string | undefined }
  | {
      type: 'orchestrator_request';
      traceId: string;
      phase: OrchestratorPhase;
      target: string;
      summary: string;
      intent?: string | undefined;
      planStepIndex?: number | undefined;
    }
  | {
      type: 'orchestrator_step_result';
      traceId: string;
      stepIndex: number;
      status: 'done' | 'failed' | 'skipped';
      agentId: string;
      agentName: string;
      resultSummary: string;
      nextStepIndex?: number | undefined;
      nextStepSummary?: string | undefined;
    }
  | { type: 'orchestrator_reasoning'; traceId: string; delta: string; source: OrchestratorReasoningSource }
  | { type: 'orchestrator_error'; traceId: string; phase: OrchestratorPhase; message: string; recoverable: boolean }
  // Team Leader events
  | { type: 'tl_message'; content: string; phase: TlPhase; messageType: 'guidance' | 'status' | 'announcement' }
  | { type: 'tl_phase_change'; from: TlPhase | null; to: TlPhase; reason: string }
  | { type: 'tl_awaiting_input'; question: string; options?: string[] | undefined; inputType: 'choice' | 'freeform' }
  | { type: 'tl_summary'; proposals: Record<string, string>; differences: string[]; recommendation: string }
  | { type: 'tl_synthesis'; unified_output: string; contributors: string[] }
  | { type: 'tl_routing_plan'; assignments: Array<{ agentId: string; agentName: string; guidance: string }>; parallel: boolean }
  | { type: 'orchestrator_token_usage'; traceId: string; tokenUsage: TokenUsage }
  | { type: 'tl_thinking'; active: boolean }
  | { type: 'tl_warning'; message: string; severity: 'info' | 'warning' | 'error' }
  | { type: 'tl_metrics'; tlCycle: number; tokensIn: number; tokensOut: number; latencyMs: number; phase: TlPhase }
  | { type: 'tl_interrupt'; interruptType: string; target?: string | undefined; previousPhase: TlPhase | null };

/** An error that occurred during orchestration streaming. */
export interface StreamError {
  readonly code: string;
  readonly message: string;
  readonly agentId?: string;
  readonly recoverable: boolean;
}

/** A persisted session record with metadata for listing and resuming. */
export interface SessionRecord {
  readonly sessionId: string;
  readonly teamId: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly status: SessionStatus;
  readonly messageCount: number;
  readonly compactionSummaries: string[];
}

/** Result returned when starting or resuming an orchestration session. */
export interface SessionStartResult {
  readonly sessionId: string;
  readonly teamId: string;
  readonly agents: ReadonlyArray<{ id: string; name: string; role: string }>;
  readonly conversationMode: ConversationMode;
  readonly orchestrationMode: OrchestrationMode;
}

/** Options for compiling an orchestration graph (checkpointer, stream callback). */
export interface CompileOptions {
  readonly checkpointer?: unknown;
  readonly onStream?: (event: OrchestrationStreamEvent) => void;
}

/**
 * The public API for an orchestration graph instance.
 * Supports invoke/stream execution, session lifecycle, MCP health checks,
 * budget monitoring, and tool approval responses.
 */
export interface OrchestrationGraph {
  invoke(input: OrchestrationInput, options?: InvokeOptions): Promise<OrchestrationOutput>;

  stream(
    input: OrchestrationInput,
    options?: InvokeOptions
  ): AsyncIterable<OrchestrationStreamEvent>;

  startSession(): Promise<SessionStartResult>;

  endSession(sessionId: string): Promise<void>;

  resumeSession(sessionId: string): Promise<SessionStartResult>;

  getMCPHealth(): Promise<Record<string, CircuitBreakerState>>;

  getBudgetStatus(sessionId: string): Promise<BudgetStatus>;

  respondToApproval(approvalId: string, approved: boolean, budget?: number): Promise<void>;

  respondToInputRequest(requestId: string, answer: string): Promise<void>;

  /** Cancel a specific agent's in-flight execution. */
  cancelAgent(agentId: string): void;

  /** Cancel all in-flight agent executions. Returns the list of cancelled agent IDs. */
  cancelAll(): string[];

  /** Map of agentId -> participantId for consumer ID translation */
  readonly agentToParticipant: ReadonlyMap<string, string>;
}

/** An image to include in an orchestration input message. */
export interface ImageInput {
  readonly data: string;
  readonly mimeType: string;
}

/** A single entry in the conversation history for seeding graph state. */
export interface ConversationHistoryEntry {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** Agent/sender name for attribution (used for AIMessage.name) */
  readonly name?: string | undefined;
  /** Engine agent IDs this message was directed to (empty/absent = broadcast) */
  readonly directedTo?: readonly string[] | undefined;
}

/** Input to the orchestration graph for processing a user message. */
export interface OrchestrationInput {
  readonly message: string;
  readonly sessionId: string;
  readonly traceId?: string | undefined;
  readonly directedTo?: string[] | undefined;
  readonly images?: ImageInput[] | undefined;
  readonly fetchUrls?: boolean | undefined;
  /** Prior conversation history to seed the graph state (for resumed sessions) */
  readonly conversationHistory?: readonly ConversationHistoryEntry[] | undefined;
  /** Override thread_id for checkpointer (used for summary/none resume modes) */
  readonly threadId?: string | undefined;
  /** Pre-approved orchestrator analysis — skips analyzer LLM call, goes straight to execution */
  readonly approvedAnalysis?: OrchestratorAnalysis | undefined;
  /** File attachments to include with the message (e.g. images for vision models). */
  readonly attachments?: ReadonlyArray<Attachment> | undefined;
}

/** Options for invoke/stream calls (timeout, abort signal). */
export interface InvokeOptions {
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

/** The final output from an orchestration graph invocation. */
export interface OrchestrationOutput {
  readonly responses: AgentResponse[];
  readonly routingDecision: RoutingDecision;
  readonly traceId: string;
}

/** A single agent's response within an orchestration output. */
export interface AgentResponse {
  readonly agentId: string;
  readonly agentName: string;
  readonly content: string;
  readonly toolInvocations: MCPToolInvocation[];
  readonly tokenUsage?: TokenUsage;
  readonly estimatedCostUSD?: number | undefined;
}

/** Strategy interface for routing messages to agents. */
export interface RoutingStrategy {
  route(
    message: string,
    agents: ReadonlyArray<AgentProfile>,
    state: RoutingState
  ): Promise<RoutingResult>;
}

/** State passed to a routing strategy for making routing decisions. */
export interface RoutingState {
  readonly lastSpeakerIndex: number;
  readonly orchestrationMode: OrchestrationMode;
  readonly defaultAgentId?: string;
}

/** The result of a routing decision: which agents to target and why. */
export interface RoutingResult {
  readonly targetAgentIds: string[];
  readonly reason: string;
  readonly confidence?: number;
  readonly isHelpMessage?: boolean;
  readonly helpContent?: string;
}

/**
 * Interface for worker executors that run agent completions.
 * Handles message execution, MCP initialization, and resource cleanup.
 */
export interface WorkerExecutor {
  execute(
    agentProfile: AgentProfile,
    message: string,
    conversationHistory: ReadonlyArray<{
      role: string;
      content: string;
      name?: string | undefined;
    }>,
    context: ExecutionContext,
    onStream: (event: OrchestrationStreamEvent) => void,
    traceId: string
  ): Promise<AgentResponse>;

  initializeMCP(agentProfile: AgentProfile): Promise<MCPInitResult>;

  abort?(): Promise<void>;

  dispose(): Promise<void>;
}

/** Result of initializing an MCP server connection. */
export interface MCPInitResult {
  readonly serverId: string;
  readonly status: 'connected' | 'degraded' | 'failed';
  readonly toolCount: number;
  readonly error?: string;
}

/** Structured logging interface for orchestration events (routing, workers, MCP, budget, sessions). */
export interface OrchestrationLogger {
  routing(decision: RoutingDecision): void;
  workerStart(traceId: string, agentId: string): void;
  workerComplete(traceId: string, agentId: string, latencyMs: number): void;
  workerError(traceId: string, agentId: string, error: string): void;
  mcpInvoke(invocation: MCPToolInvocation): void;
  mcpCircuitBreaker(serverId: string, state: CircuitState, reason: string): void;
  sessionStart(sessionId: string, teamId: string): void;
  sessionEnd(sessionId: string): void;
  sessionCompact(sessionId: string, messagesBefore: number, messagesAfter: number): void;
  budgetCheck(traceId: string, agentId: string, allowed: boolean, reason?: string): void;
  budgetExceeded(
    traceId: string,
    agentId: string,
    budgetType: string,
    current: number,
    limit: number
  ): void;
  budgetWarning(
    traceId: string,
    agentId: string,
    budgetType: string,
    usage: number,
    limit: number
  ): void;
}

/** Categorized error codes for orchestration failures. */
export type OrchestrationErrorCode =
  | 'CONFIG_VALIDATION'
  | 'ROUTING_FAILURE'
  | 'WORKER_EXECUTION'
  | 'MCP_CONNECTION'
  | 'MCP_TIMEOUT'
  | 'MCP_CIRCUIT_OPEN'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'BUDGET_EXCEEDED'
  | 'RATE_LIMITED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'CONTEXT_OVERFLOW';

/** Error class for orchestration failures, with error code and trace ID. */
export class OrchestrationError extends Error {
  constructor(
    public readonly code: OrchestrationErrorCode,
    message: string,
    public readonly traceId?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'OrchestrationError';
  }
}
