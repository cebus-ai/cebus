// Core types
export type {
  ChatSession,
  SessionStatus,
  SessionStore,
  Participant,
  ParticipantType,
  ModelConfig,
  Message,
  MessageType,
  MessageStatus,
  CompletionMeta,
  CompletionError,
  TokenUsage,
  FinishReason,
  MentionType,
  MentionResult,
  ParsedMention,
  StreamEvent,
  StreamError,
  StreamErrorCode,
  ChatMode,
  ContextLevel,
  AgentMode,
  OrchestratorConfig,
  SessionId,
  ParticipantId,
  MessageId,
} from './core/types';

// Branded ID factories
export {
  createSessionId,
  createParticipantId,
  createMessageId,
} from './core/types';

// Provider types
export type {
  ProviderAdapter,
  ProviderRegistry,
  ProviderError,
  ProviderErrorCode,
  ModelInfo,
  ModelCapabilities,
  ContextMessage,
  CompletionResult,
  CompletionOptions,
} from './providers/types';

export { ProviderErrorImpl } from './providers/types';

// Session management
export {
  createSession,
  getSession,
  endSession,
  deleteSession,
  addUserParticipant,
  addModelParticipant,
  getParticipants,
  getParticipant,
  getModelParticipants,
  getUserParticipant,
  findParticipantByNickname,
  removeParticipant,
  renameParticipant,
  getDefaultNickname,
  validateNickname,
  isNicknameUnique,
  generateUniqueNickname,
  addOrchestratorParticipant,
  updateOrchestratorConfig,
  setReasoningEffort,
  getReasoningEffort,
  addMessage,
  getMessages,
  getMessagesBySender,
  updateMessage,
  clearMessages,
  getStore,
  clearStore,
} from './core/session';

// Message utilities
export {
  createMessage,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  markMessageSent,
  markMessageComplete,
  markMessageError,
  appendMessageContent,
  isModelMessage,
  isUserMessage,
  isDirectedMessage,
  isBroadcastMessage,
  isMessageForParticipant,
  formatTimestamp,
  getMessageAge,
} from './core/message';

// Mention parsing
export { parseMentions } from './core/mention-parser';

// Debug logging
export {
  isDebugEnabled,
  enableDebugLogging,
  log,
  debug,
  info,
  warn,
  error,
  logMessage,
  logRender,
  logStream,
  logSession,
  logProvider,
  logProviderRequest,
  logContext,
  startChatTranscript,
  resetChatTranscript,
  logChatMessage,
  runWithDebugScope,
  listDebugScopes,
  listDebugFiles,
  readDebugFile,
} from './core/debug-logger';

export type { LogLevel, ProviderRequestLog, DebugScope, DebugScopeInfo } from './core/debug-logger';

// Role templates
export type { RoleTemplate } from './core/role-templates';
export {
  ROLE_TEMPLATES,
  getRoleTemplate,
  loadProjectAgents,
  getAvailableRoleTemplates,
} from './core/role-templates';

// Model tiers
export type { CostTier, TieredModel } from './core/model-tiers';
export {
  getModelTier,
  getModelTierWithBilling,
  getModelPriority,
  getModelPrice,
  getDisplayGroup,
  categorizeModels,
  filterModelsByTier,
  getTierLabel,
  getTierEmoji,
  getTierHistoryWindow,
  getTierTokenBudget,
  estimateTokens,
} from './core/model-tiers';

// Model pricing
export type { ModelPricing, CostEstimate } from './core/model-pricing';
export {
  getModelPricing,
  calculateCost,
  getContextWindow,
  formatCostUSD,
  refreshPricingIfStale,
  isPricingStale,
  refreshPricing,
  registerModelPricing,
} from './core/model-pricing';

// Context configuration
export {
  DEFAULT_CONTEXT_CONFIG,
  getContextConfig,
  setContextLevel,
  setContextConfig,
  markContextStale,
  isContextStale,
  markContextFresh,
  getLastRefreshedAt,
  clearContextState,
  clearAllContextState,
} from './core/context-config';

// Session persistence
export type { PersistedSession } from './core/session-persistence';
export { saveSession, loadSession } from './core/session-persistence';

// Config persistence
export type { SavedConfig } from './core/config-persistence';
export { saveLastConfig, loadLastConfig } from './core/config-persistence';

// Orchestrator LLM options
export type { OrchestratorLLMOption } from './core/orchestrator-llm-options';
export { discoverOrchestratorLLMOptions } from './core/orchestrator-llm-options';

// Session summarization
export { summarizeSession } from './core/summarize-session';

// Project context
export type { ProjectContext } from './core/project-context';
export {
  readClaudeMd,
  getContextByLevel,
  formatContextByLevel,
  getContextPromptByLevel,
} from './core/project-context';

// Project root resolution
export { findProjectRoot, clearProjectRootCache } from './core/project-root';

// Web fetch
export { detectUrls } from './core/web-fetch';

// Terminal utilities
export { fileLink } from './core/utils/terminal-link';

// Orchestration
export {
  compile,
  loadTeamConfig,
  validateTeamConfig,
  getOrCompileGraph,
  invalidateGraph,
  clearGraphCache,
  clearThread,
  buildTeamConfig,
  buildSessionConfig,
  sanitizeAgentId,
  getDefaultSystemPrompt,
  OrchestrationError,
  createPlaceholder,
  appendToken,
  finalizeResponse,
  finalizeError,
} from './orchestration/index.js';

export type {
  TeamConfig,
  CompileOptions,
  OrchestrationGraph,
  OrchestrationInput,
  OrchestrationOutput,
  OrchestrationStreamEvent,
  AgentProfile,
  BuildTeamConfigParams,
  ParticipantInput,
  SessionConfigResult,
  ImageInput,
  PermissionKind,
  ApprovalResponse,
  OrchestratorPlan,
  TaskCompletionSummary,
  OrchestratorAnalysis,
  OrchestratorPhase,
  ConversationHistoryEntry,
  Attachment,
} from './orchestration/index.js';

// Provider registry
export { getProviderRegistry, resetProviderRegistry } from './providers/registry';

// Provider adapters
export {
  registerBuiltInProviders,
  initializeProviders,
  printProviderStatus,
  createOpenAIAdapter,
  createAnthropicAdapter,
  createCopilotAdapter,
  checkCopilotStatus,
  OpenAIAdapter,
  AnthropicAdapter,
  CopilotAdapter,
} from './providers';

export type { CopilotStatus, CopilotQuota, OpenRouterCredits } from './providers';
export { fetchOpenRouterCredits, fetchCopilotQuota } from './providers';

// Configuration
export { loadConfig, getConfig } from './config';
export type { AppConfig } from './config';
