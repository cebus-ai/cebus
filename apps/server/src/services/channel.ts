import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { getAvailableRoleTemplates, findProjectRoot } from '@cebus/engine';
import { invalidateChannelGraph } from './orchestration';

interface AgentConfigRow {
  id: string;
  workspace_id: string;
  provider: string;
  model: string;
  display_name: string;
  avatar_letter: string;
  avatar_color: string;
}

interface ChannelRow {
  id: string;
  workspace_id: string;
  name: string;
  subject: string | null;
  instructions: string | null;
  chat_mode: string;
  orchestrator_enabled: number;
  orchestrator_model: string | null;
  response_length: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  context_start_at: string | null;
  context_level: string;
  context_window_size: number;
  include_system_prompt: number;
  include_project_context: number;
  include_mode_guidance: number;
  include_tier_guidance: number;
  include_rich_components: number;
  working_dir: string | null;
}

interface ChannelAgentRow {
  agent_id: string;
  role_template: string | null;
  role_instructions: string | null;
  custom_role_name: string | null;
  display_name_override: string | null;
  added_at: string;
  provider: string;
  model: string;
  display_name: string;
  avatar_letter: string;
  avatar_color: string;
}

interface ChannelMemberRow {
  user_id: string;
  role: string;
  joined_at: string;
  username: string;
  display_name: string;
}

export function toChannel(row: ChannelRow): {
  id: string;
  workspaceId: string;
  name: string;
  subject: string | null;
  instructions: string | null;
  chatMode: string;
  orchestratorEnabled: boolean;
  orchestratorModel: string | null;
  responseLength: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  contextStartAt: string | null;
  contextLevel: string;
  contextWindowSize: number;
  includeSystemPrompt: boolean;
  includeProjectContext: boolean;
  includeModeGuidance: boolean;
  includeTierGuidance: boolean;
  includeRichComponents: boolean;
  workingDir: string | null;
} {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    subject: row.subject,
    instructions: row.instructions,
    chatMode: row.chat_mode,
    orchestratorEnabled: row.orchestrator_enabled === 1,
    orchestratorModel: row.orchestrator_model,
    responseLength: row.response_length ?? 'free',
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    contextStartAt: row.context_start_at,
    contextLevel: row.context_level ?? 'none',
    contextWindowSize: row.context_window_size ?? 10,
    includeSystemPrompt: (row.include_system_prompt ?? 1) === 1,
    includeProjectContext: (row.include_project_context ?? 1) === 1,
    includeModeGuidance: (row.include_mode_guidance ?? 1) === 1,
    includeTierGuidance: (row.include_tier_guidance ?? 1) === 1,
    includeRichComponents: (row.include_rich_components ?? 1) === 1,
    workingDir: row.working_dir ?? null,
  };
}

export function listChannels(
  db: Database.Database,
  status: string = 'active'
): ReturnType<typeof toChannel>[] {
  const rows = db
    .prepare('SELECT * FROM channel WHERE status = ? ORDER BY sort_order ASC, updated_at DESC')
    .all(status) as ChannelRow[];
  return rows.map(toChannel);
}

export function getChannel(
  db: Database.Database,
  channelId: string
):
  | (ReturnType<typeof toChannel> & {
      agents: {
        agentId: string;
        roleTemplate: string | null;
        roleName: string | null;
        roleInstructions: string | null;
        displayNameOverride: string | null;
        addedAt: string;
        provider: string;
        model: string;
        displayName: string;
        originalDisplayName: string;
        avatarLetter: string;
        avatarColor: string;
      }[];
      members: {
        userId: string;
        role: string;
        joinedAt: string;
        username: string;
        displayName: string;
      }[];
    })
  | null {
  const row = db.prepare('SELECT * FROM channel WHERE id = ?').get(channelId) as
    | ChannelRow
    | undefined;
  if (!row) return null;

  const agents = db
    .prepare(
      `SELECT ca.agent_id, ca.role_template, ca.role_instructions, ca.added_at,
              ca.display_name_override,
              ac.provider, ac.model, ac.display_name, ac.avatar_letter, ac.avatar_color,
              cr.name AS custom_role_name
       FROM channel_agent ca
       JOIN agent_config ac ON ca.agent_id = ac.id
       LEFT JOIN custom_role cr ON ca.role_template = cr.id
       WHERE ca.channel_id = ?`
    )
    .all(channelId) as ChannelAgentRow[];

  // Resolve built-in role names for agents without a custom role match
  let builtinRoles: ReturnType<typeof getAvailableRoleTemplates> | null = null;
  function resolveRoleName(a: ChannelAgentRow): string | null {
    if (a.role_template === null) return null;
    if (a.custom_role_name !== null) return a.custom_role_name;

    if (!builtinRoles) builtinRoles = getAvailableRoleTemplates(findProjectRoot());
    const builtin = builtinRoles.find(r => r.id === a.role_template);
    return builtin?.label ?? a.role_template;
  }

  const members = db
    .prepare(
      `SELECT cm.user_id, cm.role, cm.joined_at, u.name AS username, u.name AS display_name
       FROM channel_member cm
       JOIN user u ON cm.user_id = u.id
       WHERE cm.channel_id = ?`
    )
    .all(channelId) as ChannelMemberRow[];

  return {
    ...toChannel(row),
    agents: agents.map(a => ({
      agentId: a.agent_id,
      roleTemplate: a.role_template,
      roleName: resolveRoleName(a),
      roleInstructions: a.role_instructions,
      displayNameOverride: a.display_name_override,
      addedAt: a.added_at,
      provider: a.provider,
      model: a.model,
      displayName: a.display_name_override ?? a.display_name,
      originalDisplayName: a.display_name,
      avatarLetter: a.avatar_letter,
      avatarColor: a.avatar_color,
    })),
    members: members.map(m => ({
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      username: m.username,
      displayName: m.display_name,
    })),
  };
}

export function createChannel(
  db: Database.Database,
  userId: string,
  data: {
    name: string;
    subject?: string | undefined;
    instructions?: string | undefined;
    chatMode?: string | undefined;
    orchestratorEnabled?: boolean | undefined;
    orchestratorModel?: string | undefined;
    responseLength?: string | undefined;
    includeSystemPrompt?: boolean | undefined;
    includeProjectContext?: boolean | undefined;
    includeModeGuidance?: boolean | undefined;
    includeTierGuidance?: boolean | undefined;
    includeRichComponents?: boolean | undefined;
    workingDir?: string | null | undefined;
  }
): NonNullable<ReturnType<typeof getChannel>> {
  const workspace = db
    .prepare(
      'SELECT id, default_context_window_size, default_include_system_prompt, default_include_project_context, default_include_mode_guidance, default_include_tier_guidance, default_include_rich_components FROM workspace LIMIT 1'
    )
    .get() as
    | {
        id: string;
        default_context_window_size: number;
        default_include_system_prompt: number;
        default_include_project_context: number;
        default_include_mode_guidance: number;
        default_include_tier_guidance: number;
        default_include_rich_components: number;
      }
    | undefined;
  if (!workspace) throw new Error('No workspace found');

  const id = ulid();
  const chatMode = data.chatMode ?? 'free_chat';
  const ctxWindowSize = workspace.default_context_window_size ?? 10;

  // Resolve prompt settings: explicit value > raw-mode defaults > workspace defaults
  const isRaw = chatMode === 'raw';
  const wsSysPrompt = (workspace.default_include_system_prompt ?? 1) === 1;
  const wsProjCtx = (workspace.default_include_project_context ?? 1) === 1;
  const wsModeGd = (workspace.default_include_mode_guidance ?? 1) === 1;
  const wsTierGd = (workspace.default_include_tier_guidance ?? 1) === 1;
  const wsRichComp = (workspace.default_include_rich_components ?? 1) === 1;

  const includeSystemPrompt =
    data.includeSystemPrompt !== undefined
      ? data.includeSystemPrompt
        ? 1
        : 0
      : isRaw
        ? 0
        : wsSysPrompt
          ? 1
          : 0;
  const includeProjectContext =
    data.includeProjectContext !== undefined
      ? data.includeProjectContext
        ? 1
        : 0
      : isRaw
        ? 0
        : wsProjCtx
          ? 1
          : 0;
  const includeModeGuidance =
    data.includeModeGuidance !== undefined
      ? data.includeModeGuidance
        ? 1
        : 0
      : isRaw
        ? 0
        : wsModeGd
          ? 1
          : 0;
  const includeTierGuidance =
    data.includeTierGuidance !== undefined
      ? data.includeTierGuidance
        ? 1
        : 0
      : isRaw
        ? 0
        : wsTierGd
          ? 1
          : 0;
  const includeRichComponents =
    data.includeRichComponents !== undefined
      ? data.includeRichComponents
        ? 1
        : 0
      : isRaw
        ? 0
        : wsRichComp
          ? 1
          : 0;

  const contextLevel = data.workingDir ? 'minimal' : 'none';

  db.prepare(
    `INSERT INTO channel (id, workspace_id, name, subject, instructions, chat_mode, orchestrator_enabled, orchestrator_model, response_length, context_window_size, context_level, include_system_prompt, include_project_context, include_mode_guidance, include_tier_guidance, include_rich_components, working_dir, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    workspace.id,
    data.name,
    data.subject ?? null,
    data.instructions ?? null,
    chatMode,
    data.orchestratorEnabled === true ? 1 : 0,
    data.orchestratorModel ?? null,
    data.responseLength ?? 'free',
    ctxWindowSize,
    contextLevel,
    includeSystemPrompt,
    includeProjectContext,
    includeModeGuidance,
    includeTierGuidance,
    includeRichComponents,
    data.workingDir ?? null,
    userId
  );

  db.prepare('INSERT INTO channel_member (channel_id, user_id, role) VALUES (?, ?, ?)').run(
    id,
    userId,
    'owner'
  );

  return getChannel(db, id)!;
}

export function updateChannel(
  db: Database.Database,
  channelId: string,
  data: {
    name?: string | undefined;
    subject?: string | undefined;
    instructions?: string | undefined;
    chatMode?: string | undefined;
    orchestratorEnabled?: boolean | undefined;
    orchestratorModel?: string | undefined;
    responseLength?: string | undefined;
    contextLevel?: string | undefined;
    contextWindowSize?: number | undefined;
    includeSystemPrompt?: boolean | undefined;
    includeProjectContext?: boolean | undefined;
    includeModeGuidance?: boolean | undefined;
    includeTierGuidance?: boolean | undefined;
    includeRichComponents?: boolean | undefined;
    workingDir?: string | null | undefined;
  }
): ReturnType<typeof getChannel> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (data.name !== undefined) {
    sets.push('name = ?');
    params.push(data.name);
  }
  if (data.subject !== undefined) {
    sets.push('subject = ?');
    params.push(data.subject);
  }
  if (data.instructions !== undefined) {
    sets.push('instructions = ?');
    params.push(data.instructions);
  }
  if (data.chatMode !== undefined) {
    sets.push('chat_mode = ?');
    params.push(data.chatMode);
  }
  if (data.orchestratorEnabled !== undefined) {
    sets.push('orchestrator_enabled = ?');
    params.push(data.orchestratorEnabled ? 1 : 0);
  }
  if (data.orchestratorModel !== undefined) {
    sets.push('orchestrator_model = ?');
    params.push(data.orchestratorModel);
  }
  if (data.responseLength !== undefined) {
    sets.push('response_length = ?');
    params.push(data.responseLength);
  }
  if (data.contextLevel !== undefined) {
    sets.push('context_level = ?');
    params.push(data.contextLevel);
  }
  if (data.contextWindowSize !== undefined) {
    sets.push('context_window_size = ?');
    params.push(data.contextWindowSize);
  }
  if (data.includeSystemPrompt !== undefined) {
    sets.push('include_system_prompt = ?');
    params.push(data.includeSystemPrompt ? 1 : 0);
  }
  if (data.includeProjectContext !== undefined) {
    sets.push('include_project_context = ?');
    params.push(data.includeProjectContext ? 1 : 0);
  }
  if (data.includeModeGuidance !== undefined) {
    sets.push('include_mode_guidance = ?');
    params.push(data.includeModeGuidance ? 1 : 0);
  }
  if (data.includeTierGuidance !== undefined) {
    sets.push('include_tier_guidance = ?');
    params.push(data.includeTierGuidance ? 1 : 0);
  }
  if (data.includeRichComponents !== undefined) {
    sets.push('include_rich_components = ?');
    params.push(data.includeRichComponents ? 1 : 0);
  }
  if (data.workingDir !== undefined) {
    sets.push('working_dir = ?');
    params.push(data.workingDir);
  }
  if (sets.length === 0) return getChannel(db, channelId);
  sets.push("updated_at = datetime('now')");
  params.push(channelId);
  db.prepare(`UPDATE channel SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  invalidateChannelGraph(channelId);
  return getChannel(db, channelId);
}

export function archiveChannel(
  db: Database.Database,
  channelId: string
): ReturnType<typeof getChannel> {
  db.prepare(
    "UPDATE channel SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(channelId);
  return getChannel(db, channelId);
}

export function restoreChannel(
  db: Database.Database,
  channelId: string
): ReturnType<typeof getChannel> {
  db.prepare(
    "UPDATE channel SET status = 'active', archived_at = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(channelId);
  return getChannel(db, channelId);
}

export function clearChannelContext(
  db: Database.Database,
  channelId: string
): ReturnType<typeof getChannel> {
  db.prepare(
    "UPDATE channel SET context_start_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(channelId);
  return getChannel(db, channelId);
}

export function deleteChannel(db: Database.Database, channelId: string): void {
  invalidateChannelGraph(channelId);
  const del = db.transaction(() => {
    db.prepare('DELETE FROM pinned_message WHERE channel_id = ?').run(channelId);
    db.prepare(
      'DELETE FROM artifact WHERE message_id IN (SELECT id FROM message WHERE channel_id = ?)'
    ).run(channelId);
    db.prepare(
      'DELETE FROM inbox_item WHERE task_id IN (SELECT id FROM task WHERE channel_id = ?)'
    ).run(channelId);
    db.prepare('DELETE FROM task WHERE channel_id = ?').run(channelId);
    db.prepare('DELETE FROM branch WHERE channel_id = ?').run(channelId);
    db.prepare('DELETE FROM message WHERE channel_id = ?').run(channelId);
    db.prepare('DELETE FROM channel_agent WHERE channel_id = ?').run(channelId);
    db.prepare('DELETE FROM channel_member WHERE channel_id = ?').run(channelId);
    db.prepare('DELETE FROM channel WHERE id = ?').run(channelId);
  });
  del();
}

export function addAgentToChannel(
  db: Database.Database,
  channelId: string,
  agentId: string,
  roleTemplate?: string | undefined,
  roleInstructions?: string | undefined
): void {
  const existing = db
    .prepare('SELECT 1 FROM channel_agent WHERE channel_id = ? AND agent_id = ?')
    .get(channelId, agentId);

  if (existing !== undefined) {
    // Agent already in channel — clone agent_config with same name and add the clone
    // The role badge differentiates instances, no need for a number suffix
    const original = db.prepare('SELECT * FROM agent_config WHERE id = ?').get(agentId) as
      | AgentConfigRow
      | undefined;
    if (!original) return;

    const cloneId = ulid();

    db.prepare(
      `INSERT INTO agent_config (id, workspace_id, provider, model, display_name, avatar_letter, avatar_color, is_channel_clone)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      cloneId,
      original.workspace_id,
      original.provider,
      original.model,
      original.display_name,
      original.avatar_letter,
      original.avatar_color
    );

    db.prepare(
      'INSERT INTO channel_agent (channel_id, agent_id, role_template, role_instructions) VALUES (?, ?, ?, ?)'
    ).run(channelId, cloneId, roleTemplate ?? null, roleInstructions ?? null);
    invalidateChannelGraph(channelId);
    return;
  }

  db.prepare(
    'INSERT INTO channel_agent (channel_id, agent_id, role_template, role_instructions) VALUES (?, ?, ?, ?)'
  ).run(channelId, agentId, roleTemplate ?? null, roleInstructions ?? null);
  invalidateChannelGraph(channelId);
}

export function updateAgentInChannel(
  db: Database.Database,
  channelId: string,
  agentId: string,
  data: {
    roleTemplate?: string | null | undefined;
    roleInstructions?: string | null | undefined;
    displayNameOverride?: string | null | undefined;
  }
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (data.roleTemplate !== undefined) {
    sets.push('role_template = ?');
    params.push(data.roleTemplate);
  }
  if (data.roleInstructions !== undefined) {
    sets.push('role_instructions = ?');
    params.push(data.roleInstructions);
  }
  if (data.displayNameOverride !== undefined) {
    sets.push('display_name_override = ?');
    params.push(data.displayNameOverride);
  }
  if (sets.length === 0) return;
  params.push(channelId, agentId);
  db.prepare(
    `UPDATE channel_agent SET ${sets.join(', ')} WHERE channel_id = ? AND agent_id = ?`
  ).run(...params);
  invalidateChannelGraph(channelId);
}

export function removeAgentFromChannel(
  db: Database.Database,
  channelId: string,
  agentId: string
): void {
  db.prepare('DELETE FROM channel_agent WHERE channel_id = ? AND agent_id = ?').run(
    channelId,
    agentId
  );
  invalidateChannelGraph(channelId);
}

export function getUnreadCounts(
  db: Database.Database,
  userId: string
): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT cm.channel_id, COUNT(m.id) AS unread
       FROM channel_member cm
       JOIN message m ON m.channel_id = cm.channel_id
         AND m.created_at > COALESCE(cm.last_seen_at, '1970-01-01')
         AND m.sender_type = 'agent'
         AND m.is_dm = 0
       WHERE cm.user_id = ?
       GROUP BY cm.channel_id
       HAVING unread > 0`
    )
    .all(userId) as { channel_id: string; unread: number }[];
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.channel_id] = row.unread;
  }
  return result;
}

export function markChannelSeen(
  db: Database.Database,
  channelId: string,
  userId: string
): void {
  db.prepare(
    "UPDATE channel_member SET last_seen_at = datetime('now') WHERE channel_id = ? AND user_id = ?"
  ).run(channelId, userId);
}

export function reorderChannels(db: Database.Database, orderedIds: string[]): void {
  const stmt = db.prepare('UPDATE channel SET sort_order = ? WHERE id = ?');
  const run = db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, orderedIds[i]);
    }
  });
  run();
}
