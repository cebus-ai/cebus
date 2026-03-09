/**
 * Server Orchestration Service
 *
 * Bridges the server's SQLite data model to the engine's LangGraph orchestration.
 * Builds TeamConfig from channel/agent DB rows, compiles/caches graphs,
 * and maps OrchestrationStreamEvent to SSE events + DB persistence.
 */

import type Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { extname, resolve } from 'path';
import { isWithinDir } from '../utils/paths';
import { ulid } from 'ulid';
import { buildTeamConfig, compile, findProjectRoot, logChatMessage, runWithDebugScope, isDebugEnabled, startChatTranscript } from '@cebus/engine';
import type {
  OrchestrationGraph,
  OrchestrationStreamEvent,
  OrchestratorAnalysis,
  BuildTeamConfigParams,
  ParticipantInput,
  ConversationHistoryEntry,
  ChatMode,
  ContextLevel,
} from '@cebus/engine';
import { emitToChannel } from './stream-hub';
import { toMessage, getChannelContextWindowSize, markMessagesSeen } from './message';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  channel_id: string;
  branch_id: string | null;
  sender_type: string;
  sender_id: string;
  content: string;
  format_type: string;
  reply_to_id: string | null;
  is_dm: number;
  is_hidden: number;
  dm_agent_id: string | null;
  metadata: string | null;
  created_at: string;
}

interface ChannelConfig {
  chat_mode: string;
  subject: string | null;
  instructions: string | null;
  orchestrator_enabled: number;
  orchestrator_model: string | null;
  response_length: string | null;
  context_start_at: string | null;
  context_level: string | null;
  include_system_prompt: number | null;
  include_project_context: number | null;
  include_mode_guidance: number | null;
  include_tier_guidance: number | null;
  include_rich_components: number | null;
  working_dir: string | null;
}

interface ChannelAgentRow {
  agent_id: string;
  provider: string;
  model: string;
  display_name: string;
  display_name_override: string | null;
  role_template: string | null;
  role_instructions: string | null;
  custom_role_name: string | null;
  custom_role_instructions: string | null;
}

// ---------------------------------------------------------------------------
// Graph Cache (per-channel)
// ---------------------------------------------------------------------------

interface CachedChannelGraph {
  graph: OrchestrationGraph;
  agentToParticipant: Map<string, string>;
  hash: string;
}

const channelGraphCache = new Map<string, CachedChannelGraph>();

/** Per-channel AbortController for the active streamChannelMessage run. */
const activeGenerationControllers = new Map<string, AbortController>();

/** Per-channel pending plan approvals awaiting user response. */
const pendingPlanApprovals = new Map<string, OrchestratorAnalysis>();

/** Tracks latest analysis per channel (for linking to pending plan approvals). */
const latestChannelAnalysis = new Map<string, OrchestratorAnalysis>();

/** Tracks pending user input requests per channel — survives page refresh. */
interface StoredUserInputRequest {
  requestId: string;
  agentId: string;
  displayName: string;
  prompt: string;
  options?: string[] | undefined;
}
const pendingChannelUserInputs = new Map<string, StoredUserInputRequest[]>();

export function getPendingUserInputs(channelId: string): StoredUserInputRequest[] {
  return pendingChannelUserInputs.get(channelId) ?? [];
}

export function clearPendingUserInput(channelId: string, requestId: string): void {
  const existing = pendingChannelUserInputs.get(channelId);
  if (!existing) return;
  const filtered = existing.filter(r => r.requestId !== requestId);
  if (filtered.length === 0) {
    pendingChannelUserInputs.delete(channelId);
  } else {
    pendingChannelUserInputs.set(channelId, filtered);
  }
}

export function getPendingPlanApproval(channelId: string): OrchestratorAnalysis | undefined {
  return pendingPlanApprovals.get(channelId);
}

export function clearPendingPlanApproval(channelId: string): void {
  pendingPlanApprovals.delete(channelId);
  latestChannelAnalysis.delete(channelId);
}

/** Invalidate the cached graph for a channel (call when agents/config change). */
export function invalidateChannelGraph(channelId: string): void {
  const cached = channelGraphCache.get(channelId);
  if (cached) {
    // Dispose old workers (stops Copilot CLI subprocesses, frees resources)
    cached.graph.endSession(channelId).catch(() => {});
    channelGraphCache.delete(channelId);
  }
}

/** Clear all cached channel graphs. */
export function clearChannelGraphCache(): void {
  for (const [channelId, cached] of channelGraphCache) {
    cached.graph.endSession(channelId).catch(() => {});
  }
  channelGraphCache.clear();
}

/** Get the cached graph for a channel (needed for respondToApproval). */
export function getChannelGraphFromCache(channelId: string): OrchestrationGraph | null {
  return channelGraphCache.get(channelId)?.graph ?? null;
}

import { RICH_UI_PROMPT } from './prompts.js';

// ---------------------------------------------------------------------------
// Response length instructions
// ---------------------------------------------------------------------------

function getResponseLengthInstruction(rl: string): string {
  switch (rl) {
    case 'short':
      return 'IMPORTANT: Keep your responses very short — 1-3 lines maximum. Be direct and concise.';
    case 'medium':
      return 'Keep your responses at a moderate length — around 3-8 lines. Be clear but not verbose.';
    case 'detailed':
      return 'Provide detailed, thorough responses. Explain your reasoning and give comprehensive answers.';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Build TeamConfig from channel DB data
// ---------------------------------------------------------------------------

function buildChannelTeamConfig(
  db: Database.Database,
  channelId: string
): {
  teamConfig: ReturnType<typeof buildTeamConfig>['teamConfig'];
  agentToParticipant: Map<string, string>;
  hash: string;
} | null {
  const channel = db
    .prepare(
      'SELECT chat_mode, subject, instructions, orchestrator_enabled, orchestrator_model, response_length, context_start_at, context_level, include_system_prompt, include_project_context, include_mode_guidance, include_tier_guidance, include_rich_components, working_dir FROM channel WHERE id = ?'
    )
    .get(channelId) as ChannelConfig | undefined;

  if (!channel) return null;

  const agents = db
    .prepare(
      `SELECT ca.agent_id, ac.provider, ac.model, ac.display_name,
              ca.display_name_override, ca.role_template, ca.role_instructions,
              cr.name AS custom_role_name, cr.instructions AS custom_role_instructions
       FROM channel_agent ca
       JOIN agent_config ac ON ca.agent_id = ac.id
       LEFT JOIN custom_role cr ON ca.role_template = cr.id
       WHERE ca.channel_id = ?`
    )
    .all(channelId) as ChannelAgentRow[];

  if (agents.length === 0) return null;

  // Build additional instructions from channel config
  const richComponentsEnabled = (channel.include_rich_components ?? 1) === 1;
  const additionalParts: string[] = [];
  if (channel.subject !== null && channel.subject.length > 0)
    additionalParts.push(`Channel topic: ${channel.subject}`);
  if (channel.instructions !== null && channel.instructions.length > 0)
    additionalParts.push(`Channel instructions: ${channel.instructions}`);
  const rlInstr = getResponseLengthInstruction(channel.response_length ?? 'free');
  if (rlInstr) additionalParts.push(rlInstr);
  if (richComponentsEnabled) additionalParts.push(RICH_UI_PROMPT);
  const additionalInstructions = additionalParts.join('\n\n');

  const chatMode = channel.chat_mode as ChatMode;

  // Build participant inputs from DB agents
  const participants: ParticipantInput[] = [
    // User participant (minimal, needed for participant list in system prompt)
    { id: 'user', type: 'user', displayName: 'User', nickname: 'User' },
    // Agent participants
    ...agents.map((a): ParticipantInput => {
      // Resolve role instructions: explicit override > custom_role DB instructions > undefined (let engine look up built-in)
      const resolvedRoleInstructions =
        a.role_instructions ?? a.custom_role_instructions ?? undefined;
      const resolvedRoleName = a.custom_role_name ?? a.role_template ?? undefined;
      return {
        id: a.agent_id,
        type: 'model',
        displayName: a.display_name_override ?? a.display_name,
        nickname: a.display_name_override ?? a.display_name,
        providerId: a.provider,
        modelId: a.model,
        role: resolvedRoleName,
        roleInstructions: resolvedRoleInstructions,
      };
    }),
  ];

  // Build orchestrator config if enabled
  let orchestratorConfig: BuildTeamConfigParams['orchestratorConfig'];
  if (
    channel.orchestrator_enabled === 1 &&
    channel.orchestrator_model !== null &&
    channel.orchestrator_model.length > 0
  ) {
    const [orchProvider, ...orchModelParts] = channel.orchestrator_model.split('/');
    orchestratorConfig = {
      enabled: true,
      providerId: orchProvider!,
      modelId: orchModelParts.join('/'),
      maxRounds: 3,
    };
  }

  const promptSettings = {
    includeSystemPrompt: (channel.include_system_prompt ?? 1) === 1,
    includeProjectContext: (channel.include_project_context ?? 1) === 1,
    includeModeGuidance: (channel.include_mode_guidance ?? 1) === 1,
    includeTierGuidance: (channel.include_tier_guidance ?? 1) === 1,
  };

  const contextLevel = (channel.context_level ?? 'minimal') as ContextLevel;
  // Always resolve working directory — Copilot SDK needs it for the CLI process cwd
  // regardless of context level. context_level only controls prompt content, not cwd.
  let workingDir: string | undefined;
  if (channel.working_dir) {
    workingDir = channel.working_dir;
  } else {
    const wsRow = db
      .prepare('SELECT default_working_dir FROM workspace LIMIT 1')
      .get() as { default_working_dir: string | null } | undefined;
    workingDir = wsRow?.default_working_dir ?? findProjectRoot();
  }
  const { teamConfig, agentToParticipant } = buildTeamConfig({
    sessionId: channelId,
    chatMode,
    participants,
    contextLevel,
    orchestratorConfig,
    additionalInstructions,
    workingDir,
    promptSettings,
  });

  // Compute hash for cache invalidation
  const pHash = `sysp:${promptSettings.includeSystemPrompt ? 1 : 0}|pctx:${promptSettings.includeProjectContext ? 1 : 0}|mode_g:${promptSettings.includeModeGuidance ? 1 : 0}|tier_g:${promptSettings.includeTierGuidance ? 1 : 0}|rich:${richComponentsEnabled ? 1 : 0}`;
  const hash =
    agents
      .map(
        a =>
          `${a.agent_id}:${a.provider}:${a.model}:${a.role_template ?? ''}:${a.role_instructions ?? ''}:${a.display_name_override ?? ''}`
      )
      .sort()
      .join('|') +
    `|mode:${chatMode}|orch:${channel.orchestrator_enabled}:${channel.orchestrator_model ?? ''}|rl:${channel.response_length ?? ''}|subj:${channel.subject ?? ''}|ctx:${contextLevel}|wd:${channel.working_dir ?? ''}|${pHash}`;

  return { teamConfig, agentToParticipant, hash };
}

// ---------------------------------------------------------------------------
// Compile or retrieve cached graph
// ---------------------------------------------------------------------------

async function getOrCompileChannelGraph(
  db: Database.Database,
  channelId: string
): Promise<{ graph: OrchestrationGraph; agentToParticipant: Map<string, string> } | null> {
  const result = buildChannelTeamConfig(db, channelId);
  if (!result) return null;

  const cached = channelGraphCache.get(channelId);
  if (cached && cached.hash === result.hash) {
    return { graph: cached.graph, agentToParticipant: cached.agentToParticipant };
  }

  const graph = await compile(result.teamConfig, {
    agentToParticipant: result.agentToParticipant,
    // No checkpointer — server uses SQLite as source of truth
  });

  channelGraphCache.set(channelId, {
    graph,
    agentToParticipant: result.agentToParticipant,
    hash: result.hash,
  });

  return { graph, agentToParticipant: result.agentToParticipant };
}

// ---------------------------------------------------------------------------
// Resolve image file paths to inline base64 attachments
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Compute the uploads base directory (mirrors index.ts logic). Cached at module level. */
let _uploadsBaseDir: string | undefined;
function getUploadsBaseDir(): string {
  return (_uploadsBaseDir ??= resolve(resolve(process.env['DATABASE_URL'] ?? './data', '..'), 'uploads'));
}


function resolveAttachments(
  attachments: Array<{ type: string; path: string; displayName?: string | undefined }>
): Array<
  | { type: 'image'; data: string; mimeType: string; path: string; displayName?: string | undefined }
  | { type: 'file'; path: string; displayName?: string | undefined }
> {
  const uploadsBase = getUploadsBaseDir();
  return attachments.map(a => {
    const resolvedPath = resolve(a.path);

    // Security: reject paths outside the uploads directory
    if (!isWithinDir(resolvedPath, uploadsBase)) {
      throw new Error('Attachment path outside uploads directory');
    }

    const ext = extname(resolvedPath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated against uploads directory
      const buf = readFileSync(resolvedPath);
      return {
        type: 'image' as const,
        data: buf.toString('base64'),
        // eslint-disable-next-line security/detect-object-injection -- ext from known set
        mimeType: EXT_TO_MIME[ext] ?? 'image/png',
        path: resolvedPath,
        displayName: a.displayName,
      };
    }
    return { type: a.type as 'file', path: resolvedPath, displayName: a.displayName };
  });
}

// ---------------------------------------------------------------------------
// Stream a channel message through the engine's LangGraph
// ---------------------------------------------------------------------------

export async function streamChannelMessage(
  db: Database.Database,
  channelId: string,
  userMessageContent: string,
  userId: string,
  contextSizeOverride?: number | undefined,
  explicitDirectedTo?: string[] | undefined,
  attachments?: Array<{ type: string; path: string; displayName?: string | undefined }> | undefined,
  approvedAnalysis?: OrchestratorAnalysis | undefined,
): Promise<void> {
  // Wrap in debug scope so all log files go to per-channel directory
  if (isDebugEnabled()) {
    const channelRow = db.prepare('SELECT name FROM channel WHERE id = ?').get(channelId) as { name: string } | undefined;
    const label = channelRow?.name ?? channelId;
    return runWithDebugScope({ type: 'channel', id: channelId, label }, () =>
      streamChannelMessageInner(db, channelId, userMessageContent, userId, contextSizeOverride, explicitDirectedTo, attachments, approvedAnalysis),
    );
  }
  return streamChannelMessageInner(db, channelId, userMessageContent, userId, contextSizeOverride, explicitDirectedTo, attachments, approvedAnalysis);
}

async function streamChannelMessageInner(
  db: Database.Database,
  channelId: string,
  userMessageContent: string,
  userId: string,
  contextSizeOverride?: number | undefined,
  explicitDirectedTo?: string[] | undefined,
  attachments?: Array<{ type: string; path: string; displayName?: string | undefined }> | undefined,
  approvedAnalysis?: OrchestratorAnalysis | undefined,
): Promise<void> {
  // Abort any previous in-flight generation for this channel
  activeGenerationControllers.get(channelId)?.abort();
  const generationController = new AbortController();
  activeGenerationControllers.set(channelId, generationController);

  const compiled = await getOrCompileChannelGraph(db, channelId);
  if (!compiled) return;

  // Start scoped transcript for this channel (appends to existing if already started)
  if (isDebugEnabled()) {
    const channelRow = db.prepare('SELECT name FROM channel WHERE id = ?').get(channelId) as { name: string } | undefined;
    startChatTranscript(channelRow?.name ?? channelId);
  }

  const { graph, agentToParticipant } = compiled;

  // Build reverse map: engine agentId → DB agent_id
  const agentToDbId = new Map<string, string>();
  for (const [agentId, dbId] of agentToParticipant) {
    agentToDbId.set(agentId, dbId);
  }

  // Build reverse map: DB agent_id → engine agentId (for @mention routing)
  const dbIdToAgent = new Map<string, string>();
  for (const [agentId, dbId] of agentToParticipant) {
    dbIdToAgent.set(dbId, agentId);
  }

  // Fetch channel agents for display name lookup and @mention parsing
  const agents = db
    .prepare(
      `SELECT ca.agent_id, ac.display_name, ca.display_name_override
       FROM channel_agent ca
       JOIN agent_config ac ON ca.agent_id = ac.id
       WHERE ca.channel_id = ?`
    )
    .all(channelId) as {
    agent_id: string;
    display_name: string;
    display_name_override: string | null;
  }[];

  // Build display name lookup: DB agent_id → display name
  const agentDisplayNames = new Map<string, string>();
  for (const a of agents) {
    agentDisplayNames.set(a.agent_id, a.display_name_override ?? a.display_name);
  }

  // Resolve directed agent IDs: prefer explicit IDs from frontend, fall back to @mention parsing
  let directedTo: string[] | undefined;
  if (explicitDirectedTo !== undefined && explicitDirectedTo.length > 0) {
    // Frontend passed explicit DB agent IDs — map to engine agent IDs
    directedTo = explicitDirectedTo
      .map(dbId => dbIdToAgent.get(dbId))
      .filter((id): id is string => id !== undefined);
  } else {
    // Fallback: parse @mentions from message text
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded by input length
    const mentionPattern = /@([\w.+-]+(?:\s[\w.+-]+)*)/g;
    const mentions: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionPattern.exec(userMessageContent)) !== null) {
      mentions.push(match[1]!.toLowerCase());
    }

    if (mentions.length > 0) {
      const mentionedDbIds = agents
        .filter(a => {
          const name = (a.display_name_override ?? a.display_name).toLowerCase();
          return mentions.some(m => name.includes(m) || m.includes(name));
        })
        .map(a => a.agent_id);

      if (mentionedDbIds.length > 0) {
        directedTo = mentionedDbIds
          .map(dbId => dbIdToAgent.get(dbId))
          .filter((id): id is string => id !== undefined);
      }
    }
  }

  // Persist directedTo on the user message that was just inserted (last user message in channel)
  if (directedTo !== undefined && directedTo.length > 0) {
    const directedDbIds = directedTo
      .map(engineId => agentToDbId.get(engineId))
      .filter((id): id is string => id !== undefined);
    if (directedDbIds.length > 0) {
      const lastUserMsg = db
        .prepare(
          `SELECT id FROM message WHERE channel_id = ? AND sender_type = 'user' AND is_dm = 0 ORDER BY created_at DESC LIMIT 1`
        )
        .get(channelId) as { id: string } | undefined;
      if (lastUserMsg) {
        db.prepare('UPDATE message SET metadata = ? WHERE id = ?').run(
          JSON.stringify({ directedTo: directedDbIds }),
          lastUserMsg.id
        );
      }
    }
  }

  // Fetch channel config for context_start_at
  const channelRow = db
    .prepare('SELECT context_start_at FROM channel WHERE id = ?')
    .get(channelId) as { context_start_at: string | null } | undefined;

  // Determine effective context window size
  const effectiveContextSize = contextSizeOverride ?? getChannelContextWindowSize(db, channelId);

  // Build conversation history from DB
  let historyQuery = `SELECT id, sender_type, sender_id, content, metadata FROM message
       WHERE channel_id = ? AND is_dm = 0 AND is_hidden = 0 AND reply_to_id IS NULL`;
  const historyParams: unknown[] = [channelId];

  if (channelRow?.context_start_at !== undefined && channelRow.context_start_at !== null) {
    historyQuery += ' AND created_at > ?';
    historyParams.push(channelRow.context_start_at);
  }

  // Fetch extra rows to account for excluded messages
  historyQuery += ' ORDER BY created_at DESC LIMIT ?';
  historyParams.push(effectiveContextSize * 2);

  const allHistoryRows = db.prepare(historyQuery).all(...historyParams) as {
    id: string;
    sender_type: string;
    sender_id: string;
    content: string;
    metadata: string | null;
  }[];

  // Filter out messages excluded from context, then take up to the effective size
  const historyRows = allHistoryRows
    .filter(r => {
      if (r.metadata === null) return true;
      try {
        const meta = JSON.parse(r.metadata) as { excludedFromContext?: boolean };
        return meta.excludedFromContext !== true;
      } catch {
        return true;
      }
    })
    .slice(0, effectiveContextSize);

  // Collect DB message IDs that enter the context window (for seen-by tracking)
  const historyMessageIds = historyRows.map(r => r.id);

  // The most recent user message was just inserted — it's passed separately as `message`
  // to graph.stream(). Exclude it from history to avoid sending it twice.
  const historyForGraph =
    historyRows[0]?.sender_type === 'user' ? historyRows.slice(1) : historyRows;

  const conversationHistory: ConversationHistoryEntry[] = historyForGraph.reverse().map(r => {
    const agentEngineId = r.sender_type === 'agent' ? dbIdToAgent.get(r.sender_id) : undefined;

    // Parse directedTo from metadata (DB agent IDs → engine agent IDs)
    let entryDirectedTo: string[] | undefined;
    if (r.metadata !== null) {
      try {
        const meta = JSON.parse(r.metadata) as { directedTo?: string[]; respondingTo?: string[] };
        if (
          r.sender_type === 'user' &&
          meta.directedTo !== undefined &&
          meta.directedTo.length > 0
        ) {
          entryDirectedTo = meta.directedTo
            .map(dbId => dbIdToAgent.get(dbId))
            .filter((id): id is string => id !== undefined);
        }
      } catch {
        // ignore malformed metadata
      }
    }

    return {
      role: r.sender_type === 'user' ? ('user' as const) : ('assistant' as const),
      content: r.content,
      ...(agentEngineId !== undefined ? { name: agentEngineId } : {}),
      ...(entryDirectedTo !== undefined && entryDirectedTo.length > 0
        ? { directedTo: entryDirectedTo }
        : {}),
    };
  });

  // Log user message to transcript (with routing target names if tagged)
  const directedDisplayNames =
    directedTo !== undefined && directedTo.length > 0
      ? directedTo
          .map(engineId => {
            const dbId = agentToDbId.get(engineId);
            return dbId !== undefined ? agentDisplayNames.get(dbId) : undefined;
          })
          .filter((n): n is string => n !== undefined)
      : undefined;
  logChatMessage('User', userMessageContent, true, directedDisplayNames);

  // Track which agents responded and in what order (for seen-by tracking)
  const respondingAgentDbIds = new Set<string>();
  // Track response messages in order: [{msgId, agentDbId}]
  const responseMessages: { msgId: string; agentDbId: string }[] = [];

  // Stream through the engine and handle events
  try {
    for await (const event of graph.stream({
      message: userMessageContent,
      sessionId: channelId,
      directedTo,
      conversationHistory,
      ...(attachments !== undefined && attachments.length > 0
        ? { attachments: resolveAttachments(attachments) }
        : {}),
      ...(approvedAnalysis !== undefined ? { approvedAnalysis } : {}),
    })) {
      // Stop processing if this generation was cancelled
      if (generationController.signal.aborted) break;

      // Track agents that produced complete events and their message IDs
      if (event.type === 'complete' && event.content !== undefined && event.content.length > 0) {
        const dbId = agentToDbId.get(event.agentId);
        if (dbId !== undefined) {
          respondingAgentDbIds.add(dbId);
          // The message ID will be the next ULID created by handleStreamEvent
          // We need to peek at the latest agent message after handling
          const beforeCount = db
            .prepare(
              `SELECT id FROM message WHERE channel_id = ? AND sender_type = 'agent' AND sender_id = ? ORDER BY created_at DESC LIMIT 1`
            )
            .get(channelId, dbId) as { id: string } | undefined;
          handleStreamEvent(
            db,
            channelId,
            userId,
            event,
            agentToDbId,
            agentDisplayNames,
            directedTo
          );
          const afterMsg = db
            .prepare(
              `SELECT id FROM message WHERE channel_id = ? AND sender_type = 'agent' AND sender_id = ? ORDER BY created_at DESC LIMIT 1`
            )
            .get(channelId, dbId) as { id: string } | undefined;
          if (afterMsg && afterMsg.id !== beforeCount?.id) {
            responseMessages.push({ msgId: afterMsg.id, agentDbId: dbId });
          }
          continue;
        }
      }
      handleStreamEvent(db, channelId, userId, event, agentToDbId, agentDisplayNames, directedTo);
    }
  } catch (err) {
    if (!generationController.signal.aborted) {
      console.error('Engine orchestration error:', err);
    }
  } finally {
    activeGenerationControllers.delete(channelId);
  }

  // Mark history messages as seen by responding agents
  const allSeenMessageIds = [...historyMessageIds];
  if (historyMessageIds.length > 0 && respondingAgentDbIds.size > 0) {
    const agentIds = [...respondingAgentDbIds];
    markMessagesSeen(db, historyMessageIds, agentIds);
  }

  // Mark each agent's response as seen by agents that responded AFTER it
  for (let i = 0; i < responseMessages.length; i++) {
    const laterAgentIds = responseMessages.slice(i + 1).map(r => r.agentDbId);
    if (laterAgentIds.length > 0) {
      // eslint-disable-next-line security/detect-object-injection -- index from loop counter
      markMessagesSeen(db, [responseMessages[i]!.msgId], laterAgentIds);
      // eslint-disable-next-line security/detect-object-injection -- index from loop counter
      allSeenMessageIds.push(responseMessages[i]!.msgId);
    }
  }

  // Emit a single seen event for all affected messages
  if (allSeenMessageIds.length > 0 && respondingAgentDbIds.size > 0) {
    emitToChannel(channelId, {
      type: 'messages_seen',
      messageIds: allSeenMessageIds,
      agentIds: [...respondingAgentDbIds],
    });
  }

  // Signal orchestration complete so the client refetches persisted messages
  emitToChannel(channelId, { type: 'message_complete' });
}

// ---------------------------------------------------------------------------
// Map engine stream events to SSE + DB operations
// ---------------------------------------------------------------------------

function handleStreamEvent(
  db: Database.Database,
  channelId: string,
  _userId: string,
  event: OrchestrationStreamEvent,
  agentToDbId: Map<string, string>,
  agentDisplayNames: Map<string, string>,
  directedTo?: string[] | undefined
): void {
  switch (event.type) {
    case 'start': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;
      const displayName = agentDisplayNames.get(dbAgentId) ?? event.agentId;
      emitToChannel(channelId, {
        type: 'agent_typing',
        agentId: dbAgentId,
        status: 'generating',
        displayName,
      });
      break;
    }

    case 'waiting': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;
      const displayName = agentDisplayNames.get(dbAgentId) ?? event.agentId;
      emitToChannel(channelId, {
        type: 'agent_typing',
        agentId: dbAgentId,
        status: 'thinking',
        displayName,
      });
      break;
    }

    case 'token': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;
      emitToChannel(channelId, { type: 'token', agentId: dbAgentId, token: event.token });
      break;
    }

    case 'complete': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;

      emitToChannel(channelId, { type: 'agent_typing_stop', agentId: dbAgentId });

      if (event.content === undefined || event.content.trim().length === 0) break;

      // Insert agent message into DB (with respondingTo + token usage metadata)
      const msgId = ulid();
      const respondingToDbIds =
        directedTo !== undefined && directedTo.length > 0
          ? directedTo
              .map(engineId => agentToDbId.get(engineId))
              .filter((id): id is string => id !== undefined)
          : undefined;
      const agentMsgMeta: Record<string, unknown> = {};
      if (respondingToDbIds !== undefined && respondingToDbIds.length > 0)
        agentMsgMeta.respondingTo = respondingToDbIds;
      if (event.tokenUsage !== undefined) agentMsgMeta.tokenUsage = event.tokenUsage;
      if (event.estimatedCostUSD !== undefined)
        agentMsgMeta.estimatedCostUSD = event.estimatedCostUSD;
      const agentMsgMetaStr =
        Object.keys(agentMsgMeta).length > 0 ? JSON.stringify(agentMsgMeta) : null;
      db.prepare(
        `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, metadata)
         VALUES (?, ?, 'agent', ?, ?, 'text', ?)`
      ).run(msgId, channelId, dbAgentId, event.content, agentMsgMetaStr);

      const row = db.prepare('SELECT * FROM message WHERE id = ?').get(msgId) as MessageRow;
      emitToChannel(channelId, { type: 'message_created', message: toMessage(row) });

      // Log agent response to transcript
      const displayName = agentDisplayNames.get(dbAgentId) ?? event.agentId;
      logChatMessage(displayName, event.content);
      break;
    }

    case 'error': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;

      emitToChannel(channelId, { type: 'agent_typing_stop', agentId: dbAgentId });

      const errContent = '⚠️ Failed to respond. Please try again.';
      const errId = ulid();
      db.prepare(
        `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type)
         VALUES (?, ?, 'agent', ?, ?, 'text')`
      ).run(errId, channelId, dbAgentId, errContent);

      const errRow = db.prepare('SELECT * FROM message WHERE id = ?').get(errId) as MessageRow;
      emitToChannel(channelId, { type: 'message_created', message: toMessage(errRow) });
      break;
    }

    case 'orchestrator_analysis': {
      latestChannelAnalysis.set(channelId, event.analysis);
      const selectedNames = event.analysis.selectedAgents
        .map(agentId => {
          const dbId = agentToDbId.get(agentId);
          return dbId !== undefined ? (agentDisplayNames.get(dbId) ?? agentId) : agentId;
        })
        .join(', ');
      const reason =
        event.analysis.intent !== undefined && event.analysis.intent.length > 0
          ? `\n${event.analysis.intent}`
          : '';
      const orchContent = `🎯 ${selectedNames}${reason}`;

      const orchMsgId = ulid();
      db.prepare(
        `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type)
         VALUES (?, ?, 'agent', '__orchestrator__', ?, 'text')`
      ).run(orchMsgId, channelId, orchContent);

      const orchRow = db.prepare('SELECT * FROM message WHERE id = ?').get(orchMsgId) as MessageRow;
      emitToChannel(channelId, { type: 'message_created', message: toMessage(orchRow) });
      break;
    }

    case 'orchestrator_direct': {
      const orchMsgId = ulid();
      db.prepare(
        `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type)
         VALUES (?, ?, 'agent', '__orchestrator__', ?, 'text')`
      ).run(orchMsgId, channelId, event.content);

      const orchRow = db.prepare('SELECT * FROM message WHERE id = ?').get(orchMsgId) as MessageRow;
      emitToChannel(channelId, { type: 'message_created', message: toMessage(orchRow) });
      break;
    }

    case 'orchestrator_round': {
      const nextDbId = agentToDbId.get(event.nextAgent);
      const nextName =
        nextDbId !== undefined
          ? (agentDisplayNames.get(nextDbId) ?? event.nextAgent)
          : event.nextAgent;
      emitToChannel(channelId, {
        type: 'agent_typing',
        agentId: '__orchestrator__',
        status: 'thinking',
        displayName: `Team Leader → Round ${event.round}/${event.maxRounds}: ${nextName}`,
      });
      break;
    }

    case 'orchestrator_complete': {
      emitToChannel(channelId, { type: 'agent_typing_stop', agentId: '__orchestrator__' });

      if (event.summary !== undefined && event.summary.length > 0) {
        const summaryMsgId = ulid();
        db.prepare(
          `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type)
           VALUES (?, ?, 'agent', '__orchestrator__', ?, 'text')`
        ).run(summaryMsgId, channelId, `✅ ${event.summary}`);

        const summaryRow = db
          .prepare('SELECT * FROM message WHERE id = ?')
          .get(summaryMsgId) as MessageRow;
        emitToChannel(channelId, { type: 'message_created', message: toMessage(summaryRow) });
      }
      break;
    }

    case 'approval_required': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;
      const displayName = agentDisplayNames.get(dbAgentId) ?? event.agentId;
      emitToChannel(channelId, {
        type: 'tool_approval_required',
        approvalId: event.approvalId,
        agentId: dbAgentId,
        displayName,
        toolName: event.toolName,
        parameters: event.parameters,
        permissionKind: event.permissionKind,
      });
      break;
    }

    case 'orchestrator_plan': {
      if (event.awaitingApproval) {
        const analysis = latestChannelAnalysis.get(channelId);
        if (analysis) pendingPlanApprovals.set(channelId, analysis);
      }
      const planMsgId = ulid();
      const planContent = `📋 **Plan:** ${event.plan.description}\n${event.plan.steps.map((s, i) => `${i + 1}. **${s.agentId}**: ${s.action}`).join('\n')}\n\n*Estimated: ${event.plan.estimatedRounds} rounds, ${event.plan.estimatedCost} cost*`;
      const planMetaObj = {
        orchestratorEvent: 'plan',
        plan: event.plan,
        awaitingApproval: event.awaitingApproval,
      };
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, metadata, created_at)
         VALUES (?, ?, 'agent', '__orchestrator__', ?, 'text', ?, ?)`
      ).run(planMsgId, channelId, planContent, JSON.stringify(planMetaObj), now);

      emitToChannel(channelId, {
        type: 'message_created',
        message: {
          id: planMsgId,
          channelId,
          branchId: null,
          senderType: 'agent',
          senderId: '__orchestrator__',
          content: planContent,
          formatType: 'text',
          replyToId: null,
          isDm: false,
          isHidden: false,
          dmAgentId: null,
          metadata: planMetaObj,
          createdAt: now,
        },
      });
      emitToChannel(channelId, {
        type: 'orchestrator_plan',
        plan: event.plan,
        awaitingApproval: event.awaitingApproval,
      });
      break;
    }

    case 'orchestrator_phase': {
      emitToChannel(channelId, {
        type: 'orchestrator_phase',
        phase: event.phase,
        detail: event.detail,
      });
      break;
    }

    case 'orchestrator_request': {
      emitToChannel(channelId, {
        type: 'orchestrator_request',
        phase: event.phase,
        target: event.target,
        summary: event.summary,
        intent: event.intent,
        planStepIndex: event.planStepIndex,
      });
      break;
    }

    case 'orchestrator_step_result': {
      emitToChannel(channelId, {
        type: 'orchestrator_step_result',
        stepIndex: event.stepIndex,
        status: event.status,
        agentId: agentToDbId.get(event.agentId) ?? event.agentId,
        agentName: event.agentName,
        resultSummary: event.resultSummary,
        nextStepIndex: event.nextStepIndex,
        nextStepSummary: event.nextStepSummary,
      });
      break;
    }

    case 'orchestrator_reasoning': {
      emitToChannel(channelId, {
        type: 'orchestrator_reasoning',
        delta: event.delta,
        source: event.source,
      });
      break;
    }

    case 'orchestrator_error': {
      emitToChannel(channelId, {
        type: 'orchestrator_error',
        phase: event.phase,
        message: event.message,
        recoverable: event.recoverable,
      });
      break;
    }

    case 'approval_result': {
      // After user approves/denies, re-emit typing indicator so the UI shows progress
      const approvalPermIdx = event.approvalId.lastIndexOf('-perm-');
      if (approvalPermIdx !== -1) {
        const engineAgentId = event.approvalId.slice(0, approvalPermIdx);
        const dbAgentId = agentToDbId.get(engineAgentId);
        if (dbAgentId !== undefined) {
          const displayName = agentDisplayNames.get(dbAgentId) ?? engineAgentId;
          emitToChannel(channelId, {
            type: 'agent_typing',
            agentId: dbAgentId,
            status: 'thinking',
            displayName,
          });
        }
      }
      break;
    }

    case 'session_end':
    case 'routing':
    case 'compaction_status':
    case 'budget_exceeded':
      // No-op for server — these are internal engine events
      break;

    case 'agent_activity': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;
      const displayName = agentDisplayNames.get(dbAgentId) ?? event.agentId;
      emitToChannel(channelId, {
        type: 'agent_activity',
        agentId: dbAgentId,
        displayName,
        activity: event.activity,
        kind: event.kind,
        toolName: event.toolName,
        result: event.result,
      });
      break;
    }

    case 'reasoning_delta': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;
      emitToChannel(channelId, {
        type: 'reasoning_delta',
        agentId: dbAgentId,
        delta: event.delta,
      });
      break;
    }

    case 'reasoning_complete':
      break;

    case 'user_input_request': {
      const dbAgentId = agentToDbId.get(event.agentId);
      if (dbAgentId === undefined) break;
      const displayName = agentDisplayNames.get(dbAgentId) ?? event.agentId;
      const inputReq: StoredUserInputRequest = {
        requestId: event.requestId,
        agentId: dbAgentId,
        displayName,
        prompt: event.prompt,
      };
      const existing = pendingChannelUserInputs.get(channelId) ?? [];
      pendingChannelUserInputs.set(channelId, [...existing.filter(r => r.requestId !== event.requestId), inputReq]);
      emitToChannel(channelId, {
        type: 'user_input_request',
        agentId: dbAgentId,
        displayName,
        requestId: event.requestId,
        prompt: event.prompt,
      });
      break;
    }

    case 'tl_message': {
      const tlMsgId = ulid();
      db.prepare(
        `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, metadata)
         VALUES (?, ?, 'agent', '__orchestrator__', ?, 'text', ?)`
      ).run(tlMsgId, channelId, event.content, JSON.stringify({ orchestratorEvent: 'tl_message', phase: event.phase }));

      const tlMsgRow = db.prepare('SELECT * FROM message WHERE id = ?').get(tlMsgId) as MessageRow;
      emitToChannel(channelId, { type: 'message_created', message: toMessage(tlMsgRow) });
      break;
    }

    case 'tl_synthesis': {
      const synMsgId = ulid();
      db.prepare(
        `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, metadata)
         VALUES (?, ?, 'agent', '__orchestrator__', ?, 'text', ?)`
      ).run(synMsgId, channelId, event.unified_output, JSON.stringify({ orchestratorEvent: 'synthesis' }));

      const synRow = db.prepare('SELECT * FROM message WHERE id = ?').get(synMsgId) as MessageRow;
      emitToChannel(channelId, { type: 'message_created', message: toMessage(synRow) });
      break;
    }

    case 'tl_routing_plan': {
      const rpAssignments = event.assignments.map((a: { agentId: string; agentName: string; guidance: string }) => ({
        agentId: agentToDbId.get(a.agentId) ?? a.agentId,
        agentName: a.agentName,
        guidance: a.guidance,
      }));
      const summaryText = rpAssignments
        .map(a => `- **${a.agentName}**: ${a.guidance.length > 150 ? a.guidance.slice(0, 147) + '...' : a.guidance}`)
        .join('\n');
      const rpMsgId = ulid();
      db.prepare(
        `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, metadata)
         VALUES (?, ?, 'agent', '__orchestrator__', ?, 'text', ?)`
      ).run(rpMsgId, channelId, summaryText, JSON.stringify({
        orchestratorEvent: 'routing_plan',
        assignments: rpAssignments,
        parallel: event.parallel,
      }));

      const rpRow = db.prepare('SELECT * FROM message WHERE id = ?').get(rpMsgId) as MessageRow;
      emitToChannel(channelId, { type: 'message_created', message: toMessage(rpRow) });

      // Immediately show all assigned agents as "thinking" so the user
      // sees activity before the workers actually connect and start streaming.
      for (const a of rpAssignments) {
        const displayName = agentDisplayNames.get(a.agentId) ?? a.agentName;
        emitToChannel(channelId, {
          type: 'agent_typing',
          agentId: a.agentId,
          status: 'thinking',
          displayName,
        });
      }
      break;
    }

    case 'tl_awaiting_input': {
      const tlRequestId = `tl-input-${Date.now()}`;
      const tlInputReq: StoredUserInputRequest = {
        requestId: tlRequestId,
        agentId: '__orchestrator__',
        displayName: 'Team Leader',
        prompt: event.question,
        ...(event.options ? { options: event.options } : {}),
      };
      const existingTl = pendingChannelUserInputs.get(channelId) ?? [];
      pendingChannelUserInputs.set(channelId, [...existingTl, tlInputReq]);
      emitToChannel(channelId, {
        type: 'user_input_request',
        agentId: '__orchestrator__',
        displayName: 'Team Leader',
        requestId: tlRequestId,
        prompt: event.question,
        options: event.options,
      });
      break;
    }

    case 'tl_thinking': {
      if (event.active) {
        emitToChannel(channelId, {
          type: 'agent_typing',
          agentId: '__orchestrator__',
          displayName: 'Team Leader',
          status: 'thinking',
        });
      } else {
        emitToChannel(channelId, {
          type: 'agent_typing_stop',
          agentId: '__orchestrator__',
        });
      }
      break;
    }

    case 'tl_summary': {
      emitToChannel(channelId, {
        type: 'tl_summary',
        recommendation: event.recommendation,
        phase: 'summary',
      });
      break;
    }

    case 'tl_phase_change': {
      emitToChannel(channelId, {
        type: 'tl_phase_change',
        from: event.from ?? null,
        to: event.to,
        reason: event.reason ?? '',
      });
      break;
    }

    case 'tl_warning': {
      emitToChannel(channelId, {
        type: 'tl_warning',
        message: event.message,
        severity: event.severity,
      });
      break;
    }

    case 'tl_interrupt': {
      emitToChannel(channelId, {
        type: 'tl_interrupt',
        interruptType: event.interruptType,
        target: event.target,
      });
      break;
    }

    case 'tl_metrics':
    case 'orchestrator_token_usage':
      // Internal — no user-visible action needed
      break;

    default:
      // Future event types — ignore silently
      break;
  }
}

// ---------------------------------------------------------------------------
// Cancel in-flight generation for a channel
// ---------------------------------------------------------------------------

export function cancelChannelGeneration(channelId: string): void {
  // Abort the streamChannelMessage loop so no more events are processed
  const genController = activeGenerationControllers.get(channelId);
  if (genController) {
    genController.abort();
    activeGenerationControllers.delete(channelId);
  }

  const cached = channelGraphCache.get(channelId);
  if (cached) {
    const cancelledAgentIds = cached.graph.cancelAll();
    for (const engineId of cancelledAgentIds) {
      const dbAgentId = cached.agentToParticipant.get(engineId);
      if (dbAgentId !== undefined) {
        emitToChannel(channelId, { type: 'agent_typing_stop', agentId: dbAgentId });
      }
    }
  }

  // Clear pending user inputs on cancel
  pendingChannelUserInputs.delete(channelId);

  // Signal completion so clients refetch and clear UI state
  emitToChannel(channelId, { type: 'message_complete' });
}
