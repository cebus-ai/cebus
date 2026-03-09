import type {
  ContextLevel,
  ChatMode,
  ProviderSessionState,
  ProviderSessionStateUnion,
} from '../../core/types.js';
import {
  ORCHESTRATOR_AGENT_ID,
  type TeamConfig,
  type AgentProfile,
  type ProviderConfig,
  type ConversationMode,
  type OrchestratorMiddlewareConfig,
} from '../types.js';
import { getDefaultSystemPrompt, getModePrompt, getTierPrompt } from '../config/defaults.js';
import { getModelTier } from '../../core/model-tiers.js';
import { getSession, getParticipants, getModelParticipants } from '../../core/session.js';
import { getContextPromptByLevel } from '../../core/project-context.js';
import { getContextConfig, isContextStale, markContextFresh } from '../../core/context-config.js';
import { getRoleTemplate, loadProjectAgents } from '../../core/role-templates.js';
import { findProjectRoot } from '../../core/project-root.js';
import { debug } from '../../core/debug-logger.js';

export interface SessionConfigResult {
  readonly teamConfig: TeamConfig;
  readonly agentToParticipant: Map<string, string>;
}

/**
 * Lightweight participant description for building a TeamConfig
 * without depending on the in-memory SessionStore.
 */
export interface ParticipantInput {
  readonly id: string;
  readonly type: 'user' | 'model';
  readonly displayName: string;
  readonly nickname: string;
  readonly providerId?: string | undefined;
  readonly modelId?: string | undefined;
  /** Role template ID — used with getRoleTemplate() when roleInstructions is not set. */
  readonly role?: string | undefined;
  /** Direct role instructions — when set, bypasses getRoleTemplate() lookup. */
  readonly roleInstructions?: string | undefined;
  readonly providerSessionState?: ProviderSessionState | ProviderSessionStateUnion | undefined;
}

/**
 * Parameters for building a TeamConfig from explicit data.
 * Decoupled from the in-memory SessionStore — can be driven by any data source (CLI store, SQLite, etc.).
 */
export interface BuildTeamConfigParams {
  readonly sessionId: string;
  readonly chatMode?: ChatMode | undefined;
  readonly participants: readonly ParticipantInput[];
  readonly contextLevel?: ContextLevel | undefined;
  readonly orchestratorConfig?:
    | {
        readonly enabled: boolean;
        readonly providerId: string;
        readonly modelId: string;
        readonly maxRounds?: number | undefined;
        readonly participantId?: string | undefined;
      }
    | undefined;
  readonly workingDir?: string | undefined;
  readonly systemPrompt?: string | undefined;
  /** Extra instructions appended to every agent's prompt (e.g. rich UI components, response length). */
  readonly additionalInstructions?: string | undefined;
  /** Granular control over which prompt components are included. All default to true. */
  readonly promptSettings?:
    | {
        readonly includeSystemPrompt?: boolean | undefined;
        readonly includeProjectContext?: boolean | undefined;
        readonly includeModeGuidance?: boolean | undefined;
        readonly includeTierGuidance?: boolean | undefined;
      }
    | undefined;
  readonly reasoningEffort?: 'low' | 'medium' | 'high' | undefined;
}

/**
 * Sanitize user-provided text before interpolating into system prompts.
 * Strips markdown structure markers and control sequences that could
 * be used for prompt injection.
 */
function sanitizePromptInput(text: string): string {
  return text
    .replace(/[#]+\s/g, '') // Strip markdown headers
    .replace(/^---+$/gm, '') // Strip horizontal rules
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Strip control chars
    .trim()
    .substring(0, 100); // Limit length
}

/**
 * Sanitize a nickname to alphanumeric-hyphen format for AgentProfile IDs.
 */
export function sanitizeAgentId(nickname: string): string {
  return (
    nickname
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 32) || 'agent'
  );
}

/**
 * Resolve provider config from a participant's providerId.
 */
function resolveProvider(providerId: string): ProviderConfig {
  const type = (['openai', 'anthropic', 'gemini', 'ollama', 'copilot', 'openrouter', 'vscode-lm'] as const).find(
    t => providerId.startsWith(t)
  );

  return { type: type ?? 'openai' };
}

/**
 * Build system prompt with participant info and project context.
 */
function buildSystemPrompt(
  _sessionId: string,
  participants: readonly ParticipantInput[],
  agentNickname: string,
  contextLevel: ContextLevel,
  options?: { workingDir?: string | undefined; systemPrompt?: string | undefined }
): string {
  const systemPrompt = options?.systemPrompt ?? getDefaultSystemPrompt();

  // Participant info
  const participantInfo = participants
    .filter(p => p.type === 'model')
    .map(p => `- @${sanitizePromptInput(p.nickname)}: ${sanitizePromptInput(p.displayName)}`)
    .join('\n');

  // Folder access restrictions based on user consent
  let toolRestriction: string;
  if (contextLevel === 'none') {
    toolRestriction =
      "\n\n## Tool Restrictions\n- You are in CHAT-ONLY mode. The user declined folder access.\n- Do NOT use any file-system tools (view, edit, grep_search, list_dir, shell, etc.).\n- Do NOT read, list, browse, or access any files or directories on the user's machine.\n- If the user asks you to read files or run commands, politely explain that folder access was not granted and suggest they restart with folder access enabled.";
  } else {
    const workingDir = options?.workingDir ?? findProjectRoot();
    toolRestriction = `\n\n## Tool Restrictions\n- You may ONLY access files within the project folder and its subfolders: ${workingDir}\n- Do NOT access, read, list, or browse any files or directories OUTSIDE that folder.\n- If the user asks you to access paths outside the project folder, politely explain that access is restricted to the project directory only.`;
  }

  // Platform hint — helps SDK-native agents (Copilot) use the correct shell
  const platformHint =
    process.platform === 'win32'
      ? '\n\n## Platform\n- OS: Windows\n- Shell: Use `cmd.exe` or `powershell.exe` for shell commands. Do NOT use `pwsh` or `bash` — they may not be installed.'
      : '';

  // Project context is resolved once in buildTeamConfig and passed via sharedProjectContext
  return `${systemPrompt}\n\nParticipants in this chat:\n${participantInfo}\n\nYou are: @${sanitizePromptInput(agentNickname)}${toolRestriction}${platformHint}`;
}

/**
 * Map ChatMode to orchestration ConversationMode.
 * role_based uses sequential routing but adds role instructions to agents.
 */
function chatModeToConversationMode(chatMode: ChatMode | undefined): ConversationMode {
  switch (chatMode) {
    case 'free_chat':
      return 'free_chat';
    case 'raw':
      return 'free_chat';
    case 'tag_only':
      return 'tag_only';
    case 'role_based':
      return 'sequential';
    case 'sequential':
    default:
      return 'sequential';
  }
}

/**
 * Build a TeamConfig + identity map from explicit participant data.
 * Decoupled from the in-memory SessionStore — usable by CLI, server, or any consumer.
 */
export function buildTeamConfig(params: BuildTeamConfigParams): SessionConfigResult {
  const {
    sessionId,
    chatMode,
    participants,
    contextLevel = 'none',
    orchestratorConfig,
    workingDir,
    systemPrompt,
    additionalInstructions,
    promptSettings,
    reasoningEffort,
  } = params;

  const isRaw = chatMode === 'raw';
  const includeSystemPrompt = isRaw ? false : promptSettings?.includeSystemPrompt !== false;
  const includeProjectContext = isRaw ? false : promptSettings?.includeProjectContext !== false;
  const includeModeGuidance = isRaw ? false : promptSettings?.includeModeGuidance !== false;
  const includeTierGuidance = isRaw ? false : promptSettings?.includeTierGuidance !== false;

  const agentToParticipant = new Map<string, string>();
  const usedIds = new Set<string>();

  const resolvedWorkingDir = workingDir ?? findProjectRoot();

  // Determine orchestrator participant ID (if any) so we can exclude it from regular agents
  const orchestratorParticipantId = orchestratorConfig?.participantId;

  // Map orchestrator agent ID → participant ID so stream events resolve
  if (orchestratorParticipantId !== undefined && orchestratorParticipantId.length > 0) {
    agentToParticipant.set(ORCHESTRATOR_AGENT_ID, orchestratorParticipantId);
  }

  // Filter to model participants, excluding the orchestrator participant
  const modelParticipants = participants.filter(p => p.type === 'model');
  const agentParticipants =
    orchestratorParticipantId !== undefined && orchestratorParticipantId.length > 0
      ? modelParticipants.filter(p => p.id !== orchestratorParticipantId)
      : modelParticipants;

  // Resolve project context once for all agents (avoids stale-flag race where only
  // the first agent in the loop receives it).
  const effectiveContextLevel = includeProjectContext ? contextLevel : ('none' as ContextLevel);
  let sharedProjectContext = '';
  const stale = isContextStale(sessionId);
  debug('config-builder', 'project-context-resolution', {
    includeSystemPrompt, effectiveContextLevel, stale, resolvedWorkingDir,
  });
  if (includeSystemPrompt && effectiveContextLevel !== 'none' && stale) {
    try {
      sharedProjectContext = getContextPromptByLevel(resolvedWorkingDir, effectiveContextLevel);
      debug('config-builder', 'project-context-loaded', { length: sharedProjectContext.length });
      markContextFresh(sessionId);
    } catch {
      // Ignore errors getting project context
    }
  }

  const agents: AgentProfile[] = agentParticipants.map(p => {
    let agentId = sanitizeAgentId(p.nickname);

    // Ensure unique agent IDs
    if (usedIds.has(agentId)) {
      let counter = 2;
      while (usedIds.has(`${agentId}-${counter}`)) counter++;
      agentId = `${agentId}-${counter}`;
    }
    usedIds.add(agentId);

    // Map agentId → participantId
    agentToParticipant.set(agentId, p.id);

    // Build base instructions — skip entirely when system prompt is off, skip project context when that flag is off
    const baseInstructions = includeSystemPrompt
      ? buildSystemPrompt(sessionId, participants, p.nickname, effectiveContextLevel, {
          workingDir,
          systemPrompt,
        })
      : '';

    // Inject role instructions when available (any chat mode — always included, user assigned them)
    let roleInstructions = '';
    let roleSkills: string[] = [];
    let roleName = `AI assistant (${p.displayName})`;

    if (p.roleInstructions !== undefined && p.roleInstructions.length > 0) {
      // Direct instructions provided (e.g. from server DB) — sanitize before interpolation
      const roleLabel = p.role ?? 'Specialist';
      const sanitizedInstructions = p.roleInstructions
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Strip control chars
        .substring(0, 2000); // Limit length
      roleInstructions = `\n\n## Your Role: ${sanitizePromptInput(roleLabel)}\n${sanitizedInstructions}`;
      roleName = `${roleLabel} (${p.displayName})`;
    } else if (p.role !== undefined && p.role.length > 0) {
      // Look up role template by ID (CLI path)
      const template = getRoleTemplate(p.role);
      if (template) {
        roleInstructions = `\n\n## Your Role: ${template.label}\n${template.instructions}`;
        roleSkills = [...template.skills];
        roleName = `${template.label} (${p.displayName})`;
      }
    }

    // Mode-specific and tier-specific guidance — individually controllable
    const modeSection = includeModeGuidance
      ? ((): string => {
          const modePrompt = chatMode ? getModePrompt(chatMode) : '';
          return modePrompt ? `\n\n## Chat Mode\n${modePrompt}` : '';
        })()
      : '';

    const tierSection = includeTierGuidance
      ? ((): string => {
          const tier = getModelTier(p.modelId ?? '');
          const tierPrompt = getTierPrompt(tier);
          return tierPrompt ? `\n\n## Model Guidance\n${tierPrompt}` : '';
        })()
      : '';

    // Additional instructions (e.g. RICH_UI_PROMPT, response length, channel subject)
    const additionalSection =
      additionalInstructions !== undefined && additionalInstructions.length > 0
        ? `\n\n${additionalInstructions.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').substring(0, 5000)}`
        : '';

    // Folder access: none → no tools, no paths; otherwise → tools allowed, sandboxed to workingDir.
    // Copilot agents always get allowedPaths (used as CLI process cwd) even when tools are disabled.
    const isCopilotAgent = p.providerId === 'copilot';
    const folderAccess =
      contextLevel === 'none'
        ? isCopilotAgent
          ? { availableTools: [] as string[], allowedPaths: [resolvedWorkingDir] }
          : { availableTools: [] as string[], allowedPaths: [] as string[] }
        : { allowedPaths: [resolvedWorkingDir] };

    // Copilot session ID for zero-cost resume — skip if working dir changed (forces fresh session)
    const storedSessionState = p.providerSessionState;
    const copilotSessionId =
      storedSessionState?.sessionId !== undefined &&
      storedSessionState.sessionId.length > 0 &&
      (storedSessionState.workingDir === undefined || storedSessionState.workingDir === resolvedWorkingDir)
        ? storedSessionState.sessionId
        : undefined;

    const agentReasoningEffort = isCopilotAgent ? reasoningEffort : undefined;
    const customAgents = isCopilotAgent ? loadCopilotCustomAgents(resolvedWorkingDir) : undefined;

    // Path restriction notice for Copilot agents — tells the model about the
    // working directory restriction so it refuses cleanly instead of trying and
    // hitting a generic error. Skipped in raw mode (no system prompt modifications).
    const pathRestrictionSection =
      isCopilotAgent && !isRaw
        ? `\n\nIMPORTANT: You are restricted to operating within ${resolvedWorkingDir} and its subdirectories only. ` +
          `Do not attempt to access, create, modify, or delete files or directories outside this path. ` +
          `If asked to operate outside this directory, explain that you are restricted to ${resolvedWorkingDir}.`
        : '';

    return {
      id: agentId,
      name: p.displayName,
      role: roleName,
      instructions: ((): string[] => {
        const projectContextSection =
          sharedProjectContext.length > 0 ? `\n\n${sharedProjectContext}` : '';
        const combined = (
          baseInstructions +
          roleInstructions +
          modeSection +
          tierSection +
          additionalSection +
          pathRestrictionSection +
          projectContextSection
        ).trim();
        return combined.length > 0 ? [combined] : [];
      })(),
      ...(roleSkills.length > 0 ? { skills: roleSkills } : {}),
      ...(p.modelId !== undefined && p.modelId.length > 0 ? { model: p.modelId } : {}),
      ...(p.providerId !== undefined && p.providerId.length > 0
        ? { provider: resolveProvider(p.providerId) }
        : {}),
      ...folderAccess,
      ...(copilotSessionId !== undefined && copilotSessionId.length > 0
        ? { copilotSessionId }
        : {}),
      ...(p.providerSessionState ? { providerSessionState: p.providerSessionState } : {}),
      ...(agentReasoningEffort ? { reasoningEffort: agentReasoningEffort } : {}),
      ...(customAgents && customAgents.length > 0 ? { customAgents } : {}),
    };
  });

  // Build orchestrator middleware config when enabled and not tag_only
  let orchestrator: OrchestratorMiddlewareConfig | undefined;
  if (orchestratorConfig?.enabled === true && chatMode !== 'tag_only') {
    orchestrator = {
      model: orchestratorConfig.modelId,
      provider: resolveProvider(orchestratorConfig.providerId),
      maxRounds: orchestratorConfig.maxRounds ?? 3,
    };
  }

  // Build Team Leader config — enabled when orchestrator is enabled and 2+ agents
  const teamLeader = orchestrator !== undefined && agents.length >= 2
    ? {
        enabled: true,
        model: orchestratorConfig?.modelId,
        provider: orchestratorConfig?.providerId ? resolveProvider(orchestratorConfig.providerId) : undefined,
      }
    : undefined;

  const teamConfig: TeamConfig = {
    teamId: `session-${sessionId.substring(0, 8)}`,
    mission: 'Multi-model group chat',
    orchestrationMode: 'deterministic',
    conversationMode: chatModeToConversationMode(chatMode),
    agents,
    ...(orchestrator ? { orchestrator } : {}),
    ...(teamLeader ? { teamLeader } : {}),
    ...(sharedProjectContext.length > 0 ? { projectContext: sharedProjectContext } : {}),
  };

  return { teamConfig, agentToParticipant };
}

function loadCopilotCustomAgents(
  workingDir: string
): ReadonlyArray<{ name: string; displayName: string; description: string; prompt: string }> {
  try {
    const agents = loadProjectAgents(workingDir);
    return agents.map(a => ({
      name: a.id,
      displayName: a.label,
      description: a.description,
      prompt: a.instructions,
    }));
  } catch (err) {
    debug('config-builder', 'loadCopilotCustomAgents failed', {
      workingDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Build a TeamConfig + identity map from a session's participants.
 * Convenience wrapper that reads from the in-memory SessionStore
 * and delegates to {@link buildTeamConfig}.
 */
export function buildSessionConfig(
  sessionId: string,
  options?: { workingDir?: string; systemPrompt?: string }
): SessionConfigResult {
  const session = getSession(sessionId);
  const allParticipants = getParticipants(sessionId);
  const contextLevel = getContextConfig(sessionId).level;

  const participantInputs: ParticipantInput[] = allParticipants.map(p => ({
    id: p.id,
    type: p.type,
    displayName: p.displayName,
    nickname: p.nickname,
    providerId: p.providerId,
    modelId: p.modelId,
    role: p.role,
    providerSessionState: p.providerSessionState,
  }));

  return buildTeamConfig({
    sessionId,
    chatMode: session?.chatMode,
    participants: participantInputs,
    contextLevel,
    orchestratorConfig: session?.orchestratorConfig,
    workingDir: options?.workingDir,
    systemPrompt: options?.systemPrompt,
    reasoningEffort: session?.reasoningEffort,
  });
}

/**
 * Compute a hash of model participant IDs to detect changes.
 */
export function participantHash(sessionId: string): string {
  const session = getSession(sessionId);
  const models = getModelParticipants(sessionId);
  const contextLevel = getContextConfig(sessionId).level;
  const chatMode = session?.chatMode ?? 'sequential';
  const orchestratorSpec =
    session?.orchestratorConfig?.enabled === true
      ? `${session.orchestratorConfig.providerId}:${session.orchestratorConfig.modelId}:${session.orchestratorConfig.maxRounds ?? 3}`
      : 'none';
  return (
    models
      .map(p => `${p.id}:${p.providerId}:${p.modelId}:${p.role ?? ''}`)
      .sort()
      .join('|') + `|ctx:${contextLevel}|mode:${chatMode}|sv:${orchestratorSpec}`
  );
}
