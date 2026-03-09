import type { ProviderSessionState, ProviderSessionStateUnion } from '../providers/types.js';

export type { ProviderSessionState, ProviderSessionStateUnion } from '../providers/types.js';

// ---------------------------------------------------------------------------
// Branded types — prevent accidental ID mixing at compile time.
// Use the factory functions to create branded values from raw strings.
// ---------------------------------------------------------------------------

export type SessionId = string & { readonly __brand: 'SessionId' };
export type ParticipantId = string & { readonly __brand: 'ParticipantId' };
export type MessageId = string & { readonly __brand: 'MessageId' };

export function createSessionId(id: string): SessionId { return id as SessionId; }
export function createParticipantId(id: string): ParticipantId { return id as ParticipantId; }
export function createMessageId(id: string): MessageId { return id as MessageId; }

/** Copilot SDK-specific agent configuration (reasoning effort, infinite sessions). */
export interface CopilotAgentConfig {
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | undefined;
  infiniteSessions?:
    | {
        enabled?: boolean | undefined;
        backgroundCompactionThreshold?: number | undefined;
        bufferExhaustionThreshold?: number | undefined;
      }
    | undefined;
}

/** Whether a chat session is currently active or has ended. */
export type SessionStatus = 'active' | 'ended';

/**
 * The conversation mode selected during onboarding.
 * Controls how messages are routed to model participants.
 *
 * - `free_chat` - All models respond simultaneously (broadcast)
 * - `sequential` - Models take turns responding one by one
 * - `tag_only` - Models respond only when explicitly @mentioned
 * - `role_based` - Models are assigned roles and respond sequentially with role-specific instructions
 * - `raw` - Direct model access with no system prompts, context, or guidance
 */
export type ChatMode = 'free_chat' | 'sequential' | 'tag_only' | 'role_based' | 'raw';

/**
 * Configuration for the optional AI orchestrator middleware.
 * When enabled, the orchestrator analyzes messages and orchestrates multi-round agent discussions.
 */
export interface OrchestratorConfig {
  enabled: boolean;
  providerId: string; // 'ollama', 'openai', 'anthropic', 'gemini'
  modelId: string; // 'llama3.2', 'claude-haiku-4-5-20251001', etc.
  maxRounds?: number | undefined; // max discussion rounds (default: 5)
  participantId?: string | undefined; // participant ID for @Orchestrator mentions
}

/**
 * A chat session containing participants, messages, and configuration.
 * Created during onboarding and persisted across the conversation lifecycle.
 */
export interface ChatSession {
  id: string;
  createdAt: string;
  participantIds: string[];
  status: SessionStatus;
  title?: string | undefined;
  /** Context configuration for this session */
  contextConfig?: ContextConfig | undefined;
  /** When context was last sent to providers */
  contextInitializedAt?: string | undefined;
  /** Chat mode for this session */
  chatMode?: ChatMode | undefined;
  /** Orchestrator middleware configuration */
  orchestratorConfig?: OrchestratorConfig | undefined;
  /** Reasoning effort level for models that support extended thinking */
  reasoningEffort?: 'low' | 'medium' | 'high' | undefined;
}

/** Whether a participant is the human user or an AI model. */
export type ParticipantType = 'user' | 'model';

/** Per-model configuration overrides (temperature, max tokens, system prompt). */
export interface ModelConfig {
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  systemPrompt?: string | undefined;
}

/**
 * A participant in a chat session (either the user or an AI model).
 * Model participants track their provider, model ID, and optional role assignment.
 */
export interface Participant {
  id: string;
  sessionId: string;
  type: ParticipantType;
  displayName: string;
  nickname: string;
  providerId?: string | undefined;
  modelId?: string | undefined;
  config?: ModelConfig | undefined;
  /** Provider SDK session state for stateful conversations (Copilot, OpenAI Responses API, Anthropic caching, etc.) */
  providerSessionState?: ProviderSessionState | ProviderSessionStateUnion | undefined;
  /** Assigned role for role-based chat mode */
  role?: string | undefined;
}

/** The origin of a message in the conversation. */
export type MessageType = 'user' | 'assistant' | 'system';

/** Lifecycle status of a message from creation through completion. */
export type MessageStatus = 'sending' | 'sent' | 'streaming' | 'complete' | 'error' | 'partial';

/** Why a completion finished: normal stop, token limit, error, or cancellation. */
export type FinishReason = 'stop' | 'length' | 'error' | 'cancelled';

/** Token usage statistics for a completion, including optional cache metrics. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
  premiumRequests?: number | undefined;
}

/** Error details attached to a failed completion. */
export interface CompletionError {
  code: string;
  message: string;
}

/** Metadata about a completed response: timing, token usage, and finish reason. */
export interface CompletionMeta {
  finishReason: FinishReason;
  usage?: TokenUsage | undefined;
  timeToFirstToken?: number | undefined;
  totalTime?: number | undefined;
  error?: CompletionError | undefined;
  estimatedCostUSD?: number | undefined;
}

/**
 * A message in the conversation, sent by either the user or a model participant.
 * Includes content, metadata, and completion details.
 */
export interface Message {
  id: string;
  sessionId: string;
  senderId: string;
  content: string;
  timestamp: number;
  type: MessageType;
  status: MessageStatus;
  directedTo?: string[] | undefined;
  completionMeta?: CompletionMeta | undefined;
}

/**
 * How a mention was detected in a message.
 * - `explicit` - @Model syntax
 * - `natural` - Natural language reference ("Hey Claude...")
 * - `broadcast` - No specific mention, sent to all participants
 */
export type MentionType = 'explicit' | 'natural' | 'broadcast';

/** A single parsed @mention with its position in the original message. */
export interface ParsedMention {
  raw: string;
  participantId: string;
  startIndex: number;
  endIndex: number;
}

/** The result of parsing mentions from a user message. */
export interface MentionResult {
  type: MentionType;
  targetIds: string[];
  cleanedContent: string;
  mentions: ParsedMention[];
}

/** Categorized error codes for streaming failures. */
export type StreamErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'model_error'
  | 'unknown';

/** An error that occurred during streaming, with retry guidance. */
export interface StreamError {
  code: StreamErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * Events emitted during message streaming in the CLI layer.
 * Discriminated union on the `type` field.
 */
export type StreamEvent =
  | { type: 'start'; participantId: string }
  | { type: 'waiting'; participantId: string }
  | { type: 'token'; participantId: string; token: string }
  | { type: 'complete'; participantId: string; message: Message }
  | { type: 'error'; participantId: string; error: StreamError };

/** In-memory store holding all sessions, participants, messages, and nickname lookups. */
export interface SessionStore {
  sessions: Map<string, ChatSession>;
  participantsBySession: Map<string, Map<string, Participant>>;
  messagesBySession: Map<string, Message[]>;
  nicknameIndex: Map<string, Map<string, string>>;
}

/**
 * Level of project context to include in AI prompts.
 * - 'none': Only CLAUDE.md (AI instructions)
 * - 'minimal': CLAUDE.md + project name + git branch (default)
 * - 'full': CLAUDE.md + README + directory structure + git status + commits
 */
export type ContextLevel = 'none' | 'minimal' | 'full';

/** Agent execution mode: worker (can execute code) or advisor (chat only). */
export type AgentMode = 'worker' | 'advisor';

/**
 * User preferences for project context inclusion.
 */
export interface ContextConfig {
  /** Current context level setting */
  level: ContextLevel;
  /** Additional files to always include (relative paths) */
  customFiles?: string[] | undefined;
  /** Files to exclude even at "full" level (relative paths) */
  excludeFiles?: string[] | undefined;
}
