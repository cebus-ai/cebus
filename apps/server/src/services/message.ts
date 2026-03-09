import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { z } from 'zod';
import { emitToChannel } from './stream-hub';
import { streamChannelMessage } from './orchestration';
import { RICH_UI_PROMPT } from './prompts.js';
import { getProviderRegistry, registerBuiltInProviders } from '@cebus/engine';
import type { ContextMessage } from '@cebus/engine';

const metadataSchema = z.record(z.string(), z.unknown()).catch({});

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    return metadataSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseMetadataOrEmpty(raw: string | null): Record<string, unknown> {
  return parseMetadata(raw) ?? {};
}

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

export function toMessage(row: MessageRow): {
  id: string;
  channelId: string;
  branchId: string | null;
  senderType: string;
  senderId: string;
  content: string;
  formatType: string;
  replyToId: string | null;
  isDm: boolean;
  isHidden: boolean;
  dmAgentId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
} {
  return {
    id: row.id,
    channelId: row.channel_id,
    branchId: row.branch_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    content: row.content,
    formatType: row.format_type,
    replyToId: row.reply_to_id,
    isDm: row.is_dm === 1,
    isHidden: row.is_hidden === 1,
    dmAgentId: row.dm_agent_id,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
  };
}

export function setMessageHidden(db: Database.Database, messageId: string, hidden: boolean): void {
  db.prepare('UPDATE message SET is_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, messageId);
}

export function toggleMessageContext(
  db: Database.Database,
  messageId: string
): { excludedFromContext: boolean } {
  const row = db.prepare('SELECT metadata FROM message WHERE id = ?').get(messageId) as
    | { metadata: string | null }
    | undefined;
  if (!row) return { excludedFromContext: false };

  const meta = parseMetadataOrEmpty(row.metadata);
  const wasExcluded = meta.excludedFromContext === true;
  if (wasExcluded) {
    delete meta.excludedFromContext;
  } else {
    meta.excludedFromContext = true;
  }
  const newMeta = Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
  db.prepare('UPDATE message SET metadata = ? WHERE id = ?').run(newMeta, messageId);
  return { excludedFromContext: !wasExcluded };
}

export function markMessagesSeen(
  db: Database.Database,
  messageIds: string[],
  agentIds: string[]
): void {
  if (messageIds.length === 0 || agentIds.length === 0) return;

  const getStmt = db.prepare('SELECT id, metadata FROM message WHERE id = ?');
  const updateStmt = db.prepare('UPDATE message SET metadata = ? WHERE id = ?');

  const txn = db.transaction(() => {
    for (const msgId of messageIds) {
      const row = getStmt.get(msgId) as { id: string; metadata: string | null } | undefined;
      if (!row) continue;

      const meta = parseMetadataOrEmpty(row.metadata);
      const existing = Array.isArray(meta.seenBy) ? (meta.seenBy as string[]) : [];
      const merged = [...new Set([...existing, ...agentIds])];

      if (merged.length === existing.length) continue;

      meta.seenBy = merged;
      updateStmt.run(JSON.stringify(meta), msgId);
    }
  });

  txn();
}

export function getChannelContextWindowSize(db: Database.Database, channelId: string): number {
  const row = db.prepare('SELECT context_window_size FROM channel WHERE id = ?').get(channelId) as
    | { context_window_size: number }
    | undefined;
  return row?.context_window_size ?? CONTEXT_WINDOW_SIZE;
}

export function listMessages(
  db: Database.Database,
  channelId: string,
  options: {
    branchId?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }
): {
  messages: ReturnType<typeof toMessage>[];
  nextCursor: string | null;
  contextWindowSize: number;
  totalMessages: number;
  contextStartAt: string | null;
} {
  const limit = Math.min(options.limit ?? 50, 100);
  const params: unknown[] = [channelId];
  let query = 'SELECT * FROM message WHERE channel_id = ? AND is_dm = 0 AND reply_to_id IS NULL';

  if (options.branchId != null) {
    query += ' AND branch_id = ?';
    params.push(options.branchId);
  } else {
    query += ' AND branch_id IS NULL';
  }

  if (options.cursor != null) {
    query += ' AND created_at < ?';
    params.push(options.cursor);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit + 1);

  const rows = db.prepare(query).all(...params) as MessageRow[];
  const hasMore = rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows).map(toMessage);
  const nextCursor = hasMore ? messages[messages.length - 1]!.createdAt : null;

  // Count total messages in channel to determine context boundary (exclude thread replies)
  const totalRow = db
    .prepare(
      'SELECT COUNT(*) as cnt FROM message WHERE channel_id = ? AND is_dm = 0 AND reply_to_id IS NULL' +
        (options.branchId != null ? ' AND branch_id = ?' : ' AND branch_id IS NULL')
    )
    .get(...(options.branchId != null ? [channelId, options.branchId] : [channelId])) as {
    cnt: number;
  };

  // Fetch the channel's context_start_at and context_window_size for client-side visual boundary
  const channelRow = db
    .prepare('SELECT context_start_at, context_window_size FROM channel WHERE id = ?')
    .get(channelId) as { context_start_at: string | null; context_window_size: number } | undefined;

  const effectiveWindowSize = channelRow?.context_window_size ?? CONTEXT_WINDOW_SIZE;

  return {
    messages: messages.reverse(),
    nextCursor,
    contextWindowSize: effectiveWindowSize,
    totalMessages: totalRow.cnt,
    contextStartAt: channelRow?.context_start_at ?? null,
  };
}

export function insertUserMessage(
  db: Database.Database,
  channelId: string,
  userId: string,
  content: string,
  formatType: string = 'text',
  replyToId?: string | undefined,
  branchId?: string | undefined,
  attachmentsMeta?: Array<{ fileName: string; type: string }> | undefined
): ReturnType<typeof toMessage> {
  const id = ulid();
  const metadata = attachmentsMeta?.length
    ? JSON.stringify({ attachments: attachmentsMeta })
    : null;
  db.prepare(
    `INSERT INTO message (id, channel_id, branch_id, sender_type, sender_id, content, format_type, reply_to_id, metadata)
     VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?)`
  ).run(id, channelId, branchId ?? null, userId, content, formatType, replyToId ?? null, metadata);

  const row = db.prepare('SELECT * FROM message WHERE id = ?').get(id) as MessageRow;
  return toMessage(row);
}

export function listDMMessages(
  db: Database.Database,
  channelId: string,
  agentId: string,
  options: { cursor?: string | undefined; limit?: number | undefined }
): { messages: ReturnType<typeof toMessage>[]; nextCursor: string | null } {
  const limit = Math.min(options.limit ?? 50, 100);
  const params: unknown[] = [channelId, agentId];
  let query = 'SELECT * FROM message WHERE channel_id = ? AND is_dm = 1 AND dm_agent_id = ?';
  if (options.cursor != null) {
    query += ' AND created_at < ?';
    params.push(options.cursor);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit + 1);
  const rows = db.prepare(query).all(...params) as MessageRow[];
  const hasMore = rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows).map(toMessage);
  const nextCursor = hasMore ? messages[messages.length - 1]!.createdAt : null;
  return { messages: messages.reverse(), nextCursor };
}

export function insertDMMessage(
  db: Database.Database,
  channelId: string,
  userId: string,
  agentId: string,
  content: string
): ReturnType<typeof toMessage> {
  const id = ulid();
  db.prepare(
    `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, is_dm, dm_agent_id)
     VALUES (?, ?, 'user', ?, ?, 'text', 1, ?)`
  ).run(id, channelId, userId, content, agentId);
  const row = db.prepare('SELECT * FROM message WHERE id = ?').get(id) as MessageRow;
  return toMessage(row);
}

function insertDMAgentMessage(
  db: Database.Database,
  channelId: string,
  agentId: string,
  dmAgentId: string,
  content: string
): string {
  const id = ulid();
  db.prepare(
    `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, is_dm, dm_agent_id)
     VALUES (?, ?, 'agent', ?, ?, 'text', 1, ?)`
  ).run(id, channelId, agentId, content, dmAgentId);
  return id;
}

function buildDMHistory(
  db: Database.Database,
  channelId: string,
  agentId: string,
  limit: number = CONTEXT_WINDOW_SIZE
): ContextMessage[] {
  const rows = db
    .prepare(
      `SELECT sender_type, content FROM message
       WHERE channel_id = ? AND is_dm = 1 AND dm_agent_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(channelId, agentId, limit) as { sender_type: string; content: string }[];

  return rows.reverse().map(r => ({
    role: r.sender_type === 'user' ? ('user' as const) : ('assistant' as const),
    content: r.content,
  }));
}

export async function triggerDMResponse(
  db: Database.Database,
  channelId: string,
  agentId: string,
  userId: string
): Promise<void> {
  const agentRow = db
    .prepare(
      `SELECT ac.provider, ac.model, ac.display_name,
            ca.role_template, ca.role_instructions
     FROM agent_config ac
     LEFT JOIN channel_agent ca ON ca.agent_id = ac.id AND ca.channel_id = ?
     WHERE ac.id = ?`
    )
    .get(channelId, agentId) as
    | {
        provider: string;
        model: string;
        display_name: string;
        role_template: string | null;
        role_instructions: string | null;
      }
    | undefined;

  if (!agentRow) return;

  // Fetch channel prompt settings
  const channelSettings = db
    .prepare('SELECT include_system_prompt, include_project_context FROM channel WHERE id = ?')
    .get(channelId) as
    | { include_system_prompt: number | null; include_project_context: number | null }
    | undefined;
  const sysPromptEnabled = (channelSettings?.include_system_prompt ?? 1) === 1;

  await ensureProviders();
  const registry = getProviderRegistry();
  const adapter = registry.get(agentRow.provider);

  if (!adapter) {
    const errId = insertDMAgentMessage(
      db,
      channelId,
      agentId,
      agentId,
      `⚠️ The configured provider is not available. Please check your settings.`
    );
    const errRow = db.prepare('SELECT * FROM message WHERE id = ?').get(errId) as MessageRow;
    emitToChannel(channelId, { type: 'message_created', message: toMessage(errRow) });
    return;
  }

  const systemParts: string[] = [];
  if (sysPromptEnabled) {
    systemParts.push(
      `You are ${agentRow.display_name}, an AI assistant in a private conversation.`
    );
    systemParts.push('Keep responses concise and helpful. Address the user directly.');
  }
  if (agentRow.role_template !== null) systemParts.push(`Your role: ${agentRow.role_template}`);
  if (agentRow.role_instructions !== null)
    systemParts.push(`Role instructions: ${agentRow.role_instructions}`);

  const history = buildDMHistory(db, channelId, agentId);
  const messages: ContextMessage[] = [
    { role: 'system', content: systemParts.join('\n') + RICH_UI_PROMPT },
    ...history,
  ];

  const dmKey = `${channelId}:${agentId}`;
  const dmController = new AbortController();
  activeDMControllers.set(dmKey, dmController);

  emitToChannel(channelId, {
    type: 'agent_typing',
    agentId,
    isDm: true,
    status: 'thinking',
    displayName: agentRow.display_name,
  });

  try {
    emitToChannel(channelId, {
      type: 'agent_typing',
      agentId,
      isDm: true,
      status: 'generating',
      displayName: agentRow.display_name,
    });

    const result = await adapter.streamCompletion(agentRow.model, messages, token => {
      emitToChannel(channelId, { type: 'token', agentId, token, isDm: true });
    }, { signal: dmController.signal });
    activeDMControllers.delete(dmKey);
    emitToChannel(channelId, { type: 'agent_typing_stop', agentId, isDm: true });

    if (!result.content) return;

    const msgId = insertDMAgentMessage(db, channelId, agentId, agentId, result.content);
    const row = db.prepare('SELECT * FROM message WHERE id = ?').get(msgId) as MessageRow;
    emitToChannel(channelId, { type: 'message_created', message: toMessage(row), isDm: true });

    // Create inbox item for DM response
    const inboxId = ulid();
    const preview = result.content.slice(0, 120) + (result.content.length > 120 ? '...' : '');
    db.prepare(
      `INSERT INTO inbox_item (id, user_id, sender_type, sender_id, channel_id, content, content_preview, content_badges)
       VALUES (?, ?, 'agent', ?, ?, ?, ?, ?)`
    ).run(inboxId, userId, agentId, channelId, result.content, preview, JSON.stringify(['dm']));
  } catch (err) {
    activeDMControllers.delete(dmKey);
    emitToChannel(channelId, { type: 'agent_typing_stop', agentId, isDm: true });
    if (dmController.signal.aborted) return;
    console.error(`DM agent '${agentRow.display_name}' error:`, err);
    console.error('DM response error detail:', err instanceof Error ? err.message : err);
    const errId = insertDMAgentMessage(
      db,
      channelId,
      agentId,
      agentId,
      `⚠️ Failed to respond. Please try again.`
    );
    const errRow = db.prepare('SELECT * FROM message WHERE id = ?').get(errId) as MessageRow;
    emitToChannel(channelId, { type: 'message_created', message: toMessage(errRow), isDm: true });
  }
}

function insertAgentMessage(
  db: Database.Database,
  channelId: string,
  agentId: string,
  content: string
): string {
  const id = ulid();
  db.prepare(
    `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type)
     VALUES (?, ?, 'agent', ?, ?, 'text')`
  ).run(id, channelId, agentId, content);
  return id;
}

interface ChannelAgentInfo {
  agent_id: string;
  provider: string;
  model: string;
  display_name: string;
  role_template: string | null;
  role_instructions: string | null;
}

let providersReady = false;

async function ensureProviders(): Promise<void> {
  if (providersReady) return;
  registerBuiltInProviders();
  const registry = getProviderRegistry();
  for (const adapter of registry.getAll()) {
    try {
      const available = await adapter.isAvailable();

      if (available) {
        await adapter.initialize();
        console.warn(`Provider '${adapter.id}' initialized`);
      }
    } catch (err) {
      console.warn(
        `Provider '${adapter.id}' init failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  providersReady = true;
}

/** Number of recent messages sent to AI models as context. */
export const CONTEXT_WINDOW_SIZE = 10;

/** Active DM generation controllers keyed by `${channelId}:${agentId}`. */
const activeDMControllers = new Map<string, AbortController>();

/** Cancel an in-flight DM generation for a specific agent. */
export function cancelDMGeneration(channelId: string, agentId: string): void {
  const key = `${channelId}:${agentId}`;
  const controller = activeDMControllers.get(key);
  if (controller) {
    controller.abort();
    activeDMControllers.delete(key);
  }
  emitToChannel(channelId, { type: 'agent_typing_stop', agentId, isDm: true });
}

function buildChatHistory(
  db: Database.Database,
  channelId: string,
  limit: number = CONTEXT_WINDOW_SIZE,
  contextStartAt?: string | null
): ContextMessage[] {
  let query = `SELECT sender_type, sender_id, content, metadata FROM message
       WHERE channel_id = ? AND is_dm = 0 AND is_hidden = 0 AND reply_to_id IS NULL`;
  const params: unknown[] = [channelId];

  // Only include messages after the context reset point
  if (contextStartAt !== null) {
    query += ' AND created_at > ?';
    params.push(contextStartAt);
  }

  // Fetch more rows than needed to account for excluded messages
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit * 2);

  const rows = db.prepare(query).all(...params) as {
    sender_type: string;
    sender_id: string;
    content: string;
    metadata: string | null;
  }[];

  // Filter out messages excluded from context, then take up to `limit`
  const filtered = rows
    .filter(r => {
      if (r.metadata === null) return true;
      try {
        const meta = parseMetadataOrEmpty(r.metadata);
        return meta.excludedFromContext !== true;
      } catch {
        return true;
      }
    })
    .slice(0, limit);

  return filtered.reverse().map(r => ({
    role: r.sender_type === 'user' ? ('user' as const) : ('assistant' as const),
    content: r.content,
  }));
}

export async function triggerOrchestration(
  db: Database.Database,
  channelId: string,
  _userMessageContent: string,
  _userId: string,
  contextSizeOverride?: number | undefined,
  directedTo?: string[] | undefined,
  attachments?: Array<{ type: string; path: string; displayName?: string | undefined }> | undefined,
  approvedAnalysis?: import('@cebus/engine').OrchestratorAnalysis | undefined,
): Promise<void> {
  await streamChannelMessage(
    db,
    channelId,
    _userMessageContent,
    _userId,
    contextSizeOverride,
    directedTo,
    attachments,
    approvedAnalysis,
  );
}

// ---------------------------------------------------------------------------
// Thread (reply) helpers
// ---------------------------------------------------------------------------

export function listThreadMessages(
  db: Database.Database,
  parentMessageId: string
): {
  parentMessage: ReturnType<typeof toMessage> | null;
  replies: ReturnType<typeof toMessage>[];
} {
  // Get the parent message first
  const parent = db.prepare('SELECT * FROM message WHERE id = ?').get(parentMessageId) as
    | MessageRow
    | undefined;
  if (!parent) return { parentMessage: null, replies: [] };

  const rows = db
    .prepare('SELECT * FROM message WHERE reply_to_id = ? ORDER BY created_at ASC')
    .all(parentMessageId) as MessageRow[];

  return {
    parentMessage: toMessage(parent),
    replies: rows.map(toMessage),
  };
}

export function insertThreadReply(
  db: Database.Database,
  channelId: string,
  parentMessageId: string,
  userId: string,
  content: string
): ReturnType<typeof toMessage> {
  const id = ulid();
  db.prepare(
    `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, reply_to_id)
     VALUES (?, ?, 'user', ?, ?, 'text', ?)`
  ).run(id, channelId, userId, content, parentMessageId);
  const row = db.prepare('SELECT * FROM message WHERE id = ?').get(id) as MessageRow;
  return toMessage(row);
}

function insertThreadAgentReply(
  db: Database.Database,
  channelId: string,
  agentId: string,
  parentMessageId: string,
  content: string
): string {
  const id = ulid();
  db.prepare(
    `INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type, reply_to_id)
     VALUES (?, ?, 'agent', ?, ?, 'text', ?)`
  ).run(id, channelId, agentId, content, parentMessageId);
  return id;
}

export async function triggerThreadOrchestration(
  db: Database.Database,
  channelId: string,
  parentMessageId: string,
  userContent: string,
  _userId: string,
  targetAgentIds?: string[] | undefined
): Promise<void> {
  const channel = db
    .prepare(
      'SELECT chat_mode, subject, instructions, response_length, include_system_prompt, include_project_context, include_mode_guidance, include_tier_guidance FROM channel WHERE id = ?'
    )
    .get(channelId) as
    | {
        chat_mode: string;
        subject: string | null;
        instructions: string | null;
        response_length: string | null;
        include_system_prompt: number | null;
        include_project_context: number | null;
        include_mode_guidance: number | null;
        include_tier_guidance: number | null;
      }
    | undefined;
  if (!channel) return;

  const threadSysPromptEnabled = (channel.include_system_prompt ?? 1) === 1;

  // Get all channel agents
  const allAgents = db
    .prepare(
      `SELECT ca.agent_id, ac.provider, ac.model, ac.display_name,
              ca.role_template, ca.role_instructions
       FROM channel_agent ca
       JOIN agent_config ac ON ca.agent_id = ac.id
       WHERE ca.channel_id = ?`
    )
    .all(channelId) as ChannelAgentInfo[];

  if (allAgents.length === 0) return;

  // If specific agents are targeted, filter to them
  // Parse @mentions from content
  const mentionPattern = /@([a-zA-Z0-9._+\- ]+)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(userContent)) !== null) {
    mentions.push(match[1]!.toLowerCase().trim());
  }

  let agents: ChannelAgentInfo[];
  if (targetAgentIds && targetAgentIds.length > 0) {
    agents = allAgents.filter(a => targetAgentIds.includes(a.agent_id));
  } else if (mentions.length > 0) {
    const mentioned = allAgents.filter(a =>
      mentions.some(
        m => a.display_name.toLowerCase().includes(m) || m.includes(a.display_name.toLowerCase())
      )
    );
    agents = mentioned.length > 0 ? mentioned : allAgents;
  } else {
    // If parent message was from an agent, default to that agent
    const parentMsg = db
      .prepare('SELECT sender_type, sender_id FROM message WHERE id = ?')
      .get(parentMessageId) as { sender_type: string; sender_id: string } | undefined;
    if (parentMsg && parentMsg.sender_type === 'agent') {
      const parentAgent = allAgents.find(a => a.agent_id === parentMsg.sender_id);
      agents = parentAgent ? [parentAgent] : allAgents;
    } else {
      agents = allAgents;
    }
  }

  if (agents.length === 0) return;

  await ensureProviders();
  const registry = getProviderRegistry();

  // Build main channel context so the model understands the conversation
  const mainHistory = buildChatHistory(db, channelId, 10);

  // Build thread context: parent message + all thread replies
  const parentRow = db.prepare('SELECT * FROM message WHERE id = ?').get(parentMessageId) as
    | MessageRow
    | undefined;
  const threadRows = db
    .prepare(
      'SELECT sender_type, sender_id, content FROM message WHERE reply_to_id = ? ORDER BY created_at ASC'
    )
    .all(parentMessageId) as { sender_type: string; sender_id: string; content: string }[];

  const threadHistory: ContextMessage[] = [];
  // Add parent message
  if (parentRow) {
    threadHistory.push({
      role: parentRow.sender_type === 'user' ? ('user' as const) : ('assistant' as const),
      content: parentRow.content,
    });
  }
  // Add all thread replies
  for (const r of threadRows) {
    threadHistory.push({
      role: r.sender_type === 'user' ? ('user' as const) : ('assistant' as const),
      content: r.content,
    });
  }

  const callAgent = async (agent: ChannelAgentInfo): Promise<void> => {
    const adapter = registry.get(agent.provider);

    if (!adapter) {
      const errId = insertThreadAgentReply(
        db,
        channelId,
        agent.agent_id,
        parentMessageId,
        `⚠️ The configured provider is not available. Please check your settings.`
      );
      const errRow = db.prepare('SELECT * FROM message WHERE id = ?').get(errId) as MessageRow;
      emitToChannel(channelId, { type: 'message_created', message: toMessage(errRow) });
      return;
    }

    const systemParts: string[] = [];
    if (threadSysPromptEnabled) {
      systemParts.push(`You are ${agent.display_name}, an AI assistant replying in a thread.`);
      systemParts.push(
        'You are responding to a specific message thread. Focus on the thread context but use the main conversation for background understanding.'
      );
    }
    if (channel.subject !== null) systemParts.push(`Channel topic: ${channel.subject}`);
    if (channel.instructions !== null)
      systemParts.push(`Channel instructions: ${channel.instructions}`);
    if (agent.role_template !== null) systemParts.push(`Your role: ${agent.role_template}`);
    if (agent.role_instructions !== null)
      systemParts.push(`Role instructions: ${agent.role_instructions}`);

    // Include recent main channel conversation as context
    if (threadSysPromptEnabled && mainHistory.length > 0) {
      const contextSummary = mainHistory
        .map(
          m =>
            `[${m.role === 'user' ? 'User' : 'Agent'}]: ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''}`
        )
        .join('\n');
      systemParts.push(`\n## Recent main conversation (for context):\n${contextSummary}\n`);
      systemParts.push(
        'Use the above main conversation as background context. Focus your reply on the specific thread below.'
      );
    }

    const rl = channel.response_length ?? 'free';
    if (rl === 'short') {
      systemParts.push('IMPORTANT: Keep your responses very short — 1-3 lines maximum.');
    } else if (rl === 'medium') {
      systemParts.push('Keep your responses at a moderate length — around 3-8 lines.');
    } else if (rl === 'detailed') {
      systemParts.push('Provide detailed, thorough responses.');
    } else if (threadSysPromptEnabled) {
      systemParts.push('Keep responses concise and helpful.');
    }

    const systemContent = systemParts.join('\n') + RICH_UI_PROMPT;

    const messages: ContextMessage[] = [
      { role: 'system', content: systemContent },
      ...threadHistory,
    ];

    emitToChannel(channelId, {
      type: 'agent_typing',
      agentId: agent.agent_id,
      isThread: true,
      status: 'thinking',
      displayName: agent.display_name,
    });

    try {
      emitToChannel(channelId, {
        type: 'agent_typing',
        agentId: agent.agent_id,
        isThread: true,
        status: 'generating',
        displayName: agent.display_name,
      });
      const result = await adapter.streamCompletion(agent.model, messages, token => {
        emitToChannel(channelId, { type: 'token', agentId: agent.agent_id, token, isThread: true });
      });

      if (!result.content) {
        emitToChannel(channelId, {
          type: 'agent_typing_stop',
          agentId: agent.agent_id,
          isThread: true,
        });
        return;
      }

      const dbMessageId = insertThreadAgentReply(
        db,
        channelId,
        agent.agent_id,
        parentMessageId,
        result.content
      );
      const row = db.prepare('SELECT * FROM message WHERE id = ?').get(dbMessageId) as MessageRow;
      emitToChannel(channelId, {
        type: 'agent_typing_stop',
        agentId: agent.agent_id,
        isThread: true,
      });
      emitToChannel(channelId, {
        type: 'message_created',
        message: toMessage(row),
        isThread: true,
      });
    } catch (err) {
      emitToChannel(channelId, {
        type: 'agent_typing_stop',
        agentId: agent.agent_id,
        isThread: true,
      });
      console.error(`Thread agent '${agent.display_name}' error:`, err);
      console.error('Thread agent error detail:', err instanceof Error ? err.message : err);
      const errId = insertThreadAgentReply(
        db,
        channelId,
        agent.agent_id,
        parentMessageId,
        `⚠️ Failed to respond. Please try again.`
      );
      const errRow = db.prepare('SELECT * FROM message WHERE id = ?').get(errId) as MessageRow;
      emitToChannel(channelId, {
        type: 'message_created',
        message: toMessage(errRow),
        isThread: true,
      });
    }
  };

  // Run targeted agents in parallel
  await Promise.all(agents.map(callAgent));
}

export function getThreadReplyCounts(
  db: Database.Database,
  messageIds: string[]
): Record<string, number> {
  if (messageIds.length === 0) return {};
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT reply_to_id, COUNT(*) as cnt FROM message WHERE reply_to_id IN (${placeholders}) GROUP BY reply_to_id`
    )
    .all(...messageIds) as { reply_to_id: string; cnt: number }[];
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.reply_to_id] = r.cnt;
  }
  return counts;
}

/**
 * Update a user message's content and re-trigger orchestration.
 */
export async function updateUserMessage(
  db: Database.Database,
  messageId: string,
  newContent: string,
  userId: string
): Promise<void> {
  const msg = db.prepare('SELECT * FROM message WHERE id = ?').get(messageId) as
    | MessageRow
    | undefined;
  if (!msg || msg.sender_type !== 'user' || msg.sender_id !== userId) {
    console.warn('updateUserMessage: message not found, not a user message, or not owned by caller', messageId);
    return;
  }

  // Update the content
  db.prepare('UPDATE message SET content = ? WHERE id = ?').run(newContent, messageId);

  // Emit an update event so clients refresh
  const row = db.prepare('SELECT * FROM message WHERE id = ?').get(messageId) as MessageRow;
  emitToChannel(msg.channel_id, { type: 'message_updated', message: toMessage(row) });

  // Re-trigger orchestration with the new content
  await triggerOrchestration(db, msg.channel_id, newContent, userId);
}

/**
 * Re-trigger orchestration for a user message: all agents respond again.
 */
export async function retriggerUserMessage(
  db: Database.Database,
  messageId: string,
  userId: string
): Promise<void> {
  const msg = db.prepare('SELECT * FROM message WHERE id = ?').get(messageId) as
    | MessageRow
    | undefined;
  if (!msg || msg.sender_type !== 'user') {
    console.warn('retriggerUserMessage: message not found or not a user message', messageId);
    return;
  }

  await triggerOrchestration(db, msg.channel_id, msg.content, userId);
}

/**
 * Regenerate an agent message: delete the old one, re-run the agent with current context.
 */
export async function regenerateAgentMessage(
  db: Database.Database,
  messageId: string
): Promise<void> {
  const msg = db.prepare('SELECT * FROM message WHERE id = ?').get(messageId) as
    | MessageRow
    | undefined;
  if (!msg || msg.sender_type !== 'agent') {
    console.warn('regenerateAgentMessage: message not found or not an agent message', messageId);
    return;
  }

  const channelId = msg.channel_id;
  const agentId = msg.sender_id;
  const replyToId = msg.reply_to_id;

  // Look up agent config
  const agent = db
    .prepare(
      `SELECT ac.provider, ac.model, ac.display_name,
            ca.role_template, ca.role_instructions
     FROM agent_config ac
     LEFT JOIN channel_agent ca ON ca.agent_id = ac.id AND ca.channel_id = ?
     WHERE ac.id = ?`
    )
    .get(channelId, agentId) as ChannelAgentInfo | undefined;

  if (!agent) {
    console.warn('regenerateAgentMessage: agent config not found', { agentId, channelId });
    return;
  }

  // Delete the old message
  db.prepare('DELETE FROM message WHERE id = ?').run(messageId);
  emitToChannel(channelId, { type: 'message_deleted', messageId });

  // Set up provider
  await ensureProviders();
  const registry = getProviderRegistry();
  const adapter = registry.get(agent.provider);

  if (!adapter) {
    console.warn('regenerateAgentMessage: provider not found', agent.provider);
    return;
  }

  const channel = db.prepare('SELECT * FROM channel WHERE id = ?').get(channelId) as
    | {
        subject: string | null;
        instructions: string | null;
        response_length: string | null;
        context_start_at: string | null;
      }
    | undefined;

  // Build system prompt
  const systemParts: string[] = [];
  systemParts.push(`You are ${agent.display_name}, an AI assistant in a group chat.`);
  if (channel !== undefined && channel.subject !== null)
    systemParts.push(`The channel topic is: ${channel.subject}`);
  if (channel !== undefined && channel.instructions !== null)
    systemParts.push(`Channel instructions: ${channel.instructions}`);
  if (agent.role_template !== null) systemParts.push(`Your role: ${agent.role_template}`);
  if (agent.role_instructions !== null)
    systemParts.push(`Role instructions: ${agent.role_instructions}`);

  const rl = channel?.response_length ?? 'free';
  if (rl === 'short') {
    systemParts.push('IMPORTANT: Keep your responses very short — 1-3 lines maximum.');
  } else if (rl === 'medium') {
    systemParts.push('Keep your responses at a moderate length — around 3-8 lines.');
  } else if (rl === 'detailed') {
    systemParts.push('Provide detailed, thorough responses.');
  } else {
    systemParts.push('Keep responses concise and helpful.');
  }

  const systemContent = systemParts.join('\n') + RICH_UI_PROMPT;

  // Build history (the old message is already deleted, so won't appear)
  let history: ContextMessage[];
  if (replyToId !== null) {
    // Thread regeneration
    const threadRows = db
      .prepare(
        'SELECT sender_type, content FROM message WHERE reply_to_id = ? ORDER BY created_at ASC'
      )
      .all(replyToId) as { sender_type: string; content: string }[];
    const parentRow = db.prepare('SELECT content FROM message WHERE id = ?').get(replyToId) as
      | { content: string }
      | undefined;
    history = [];
    if (parentRow !== undefined) {
      history.push({ role: 'user', content: parentRow.content });
    }
    for (const r of threadRows) {
      history.push({ role: r.sender_type === 'user' ? 'user' : 'assistant', content: r.content });
    }
  } else {
    history = buildChatHistory(db, channelId, CONTEXT_WINDOW_SIZE, channel?.context_start_at);
  }

  const messages: ContextMessage[] = [{ role: 'system', content: systemContent }, ...history];

  emitToChannel(channelId, {
    type: 'agent_typing',
    agentId,
    status: 'thinking',
    displayName: agent.display_name,
  });

  try {
    emitToChannel(channelId, {
      type: 'agent_typing',
      agentId,
      status: 'generating',
      displayName: agent.display_name,
    });
    const result = await adapter.streamCompletion(agent.model, messages, token => {
      emitToChannel(channelId, { type: 'token', agentId, token });
    });
    if (result.content === null || result.content === undefined) {
      emitToChannel(channelId, { type: 'agent_typing_stop', agentId });
      return;
    }

    let newMsgId: string;
    if (replyToId !== null) {
      newMsgId = insertThreadAgentReply(db, channelId, agentId, replyToId, result.content);
    } else {
      newMsgId = insertAgentMessage(db, channelId, agentId, result.content);
    }
    const row = db.prepare('SELECT * FROM message WHERE id = ?').get(newMsgId) as MessageRow;
    emitToChannel(channelId, { type: 'agent_typing_stop', agentId });
    emitToChannel(channelId, { type: 'message_created', message: toMessage(row) });
  } catch (err) {
    emitToChannel(channelId, { type: 'agent_typing_stop', agentId });
    console.error(`Regenerate agent '${agent.display_name}' error:`, err);
    console.error('Regenerate error detail:', err instanceof Error ? err.message : err);
    const errId =
      replyToId !== null
        ? insertThreadAgentReply(
            db,
            channelId,
            agentId,
            replyToId,
            `⚠️ Failed to regenerate. Please try again.`
          )
        : insertAgentMessage(db, channelId, agentId, `⚠️ Failed to regenerate. Please try again.`);
    const errRow = db.prepare('SELECT * FROM message WHERE id = ?').get(errId) as MessageRow;
    emitToChannel(channelId, { type: 'message_created', message: toMessage(errRow) });
  }
}
