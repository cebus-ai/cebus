import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ulid } from 'ulid';
import { t } from '../trpc';
import { protectedProcedure } from '../middleware';
import {
  getProviderRegistry,
  registerBuiltInProviders,
  initializeProviders,
  getAvailableRoleTemplates,
  findProjectRoot,
  getDisplayGroup,
  fetchOpenRouterCredits,
} from '@cebus/engine';

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#0f9d7d',
  anthropic: '#d77b5c',
  copilot: '#ca76cd',
  gemini: '#4285F4',
  google: '#4285F4',
  ollama: '#888888',
  openrouter: '#6366f1',
  'meta-llama': '#0467DF',
  'x-ai': '#EF4444',
  'z-ai': '#00B4D8',
  moonshotai: '#FF6B35',
  minimax: '#7C3AED',
};

function getProviderColor(provider: string, modelId?: string): string {
  if (provider === 'openrouter' && modelId !== undefined && modelId.length > 0) {
    const slashIdx = modelId.indexOf('/');
    if (slashIdx > 0) {
      const company = modelId.substring(0, slashIdx);
      // eslint-disable-next-line security/detect-object-injection -- key from parsed model ID
      if (PROVIDER_COLORS[company] !== undefined) return PROVIDER_COLORS[company];
    }
  }
  // eslint-disable-next-line security/detect-object-injection -- key from known provider string
  return PROVIDER_COLORS[provider] ?? '#8b5cf6';
}

interface AgentRow {
  id: string;
  workspace_id: string;
  provider: string;
  model: string;
  display_name: string;
  avatar_letter: string;
  avatar_color: string;
  is_favorite: number;
  is_channel_clone: number;
  created_at: string;
}

function toAgentConfig(row: AgentRow): {
  id: string;
  workspaceId: string;
  provider: string;
  model: string;
  displayName: string;
  avatarLetter: string;
  avatarColor: string;
  isFavorite: boolean;
  createdAt: string;
} {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    model: row.model,
    displayName: row.display_name,
    avatarLetter: row.avatar_letter,
    avatarColor: row.avatar_color,
    isFavorite: row.is_favorite === 1,
    createdAt: row.created_at,
  };
}

export const agentRouter = t.router({
  list: protectedProcedure.query(({ ctx }) => {
    const workspace = ctx.db.prepare('SELECT id FROM workspace LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (!workspace) return [];

    const rows = ctx.db
      .prepare(
        'SELECT * FROM agent_config WHERE workspace_id = ? AND is_channel_clone = 0 ORDER BY sort_order ASC, is_favorite DESC, display_name ASC'
      )
      .all(workspace.id) as AgentRow[];

    return rows.map(toAgentConfig);
  }),

  create: protectedProcedure
    .input(
      z.object({
        provider: z.string().min(1),
        model: z.string().min(1),
        displayName: z.string().min(1).max(32),
        avatarLetter: z.string().length(1).optional(),
        avatarColor: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const workspace = ctx.db.prepare('SELECT id FROM workspace LIMIT 1').get() as
        | { id: string }
        | undefined;
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'No workspace found' });

      const id = ulid();
      const letter = input.avatarLetter ?? input.displayName.charAt(0).toUpperCase();
      const color = input.avatarColor ?? getProviderColor(input.provider, input.model);

      ctx.db
        .prepare(
          `INSERT INTO agent_config (id, workspace_id, provider, model, display_name, avatar_letter, avatar_color)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, workspace.id, input.provider, input.model, input.displayName, letter, color);

      const row = ctx.db.prepare('SELECT * FROM agent_config WHERE id = ?').get(id) as AgentRow;
      return toAgentConfig(row);
    }),

  listProviders: protectedProcedure.query(async () => {
    const registry = getProviderRegistry();
    registerBuiltInProviders();
    await initializeProviders();

    const groups = new Map<
      string,
      { provider: string; displayName: string; models: { id: string; name: string }[] }
    >();
    const adapters = registry.getAll();
    for (const adapter of adapters) {
      try {
        const available = await adapter.isAvailable();

        if (!available) continue;
        const models = await adapter.listModels();
        for (const m of models) {
          const { displayGroup, displayGroupName } = getDisplayGroup(adapter.id, m.id);
          let group = groups.get(displayGroup);
          if (!group) {
            group = {
              provider: adapter.id,

              displayName: displayGroupName || adapter.displayName || adapter.id,
              models: [],
            };
            groups.set(displayGroup, group);
          }
          group.models.push({ id: m.id, name: m.displayName ?? m.id });
        }
      } catch (err) {
        console.warn(`Provider '${adapter.id}' skipped:`, err instanceof Error ? err.message : err);
      }
    }
    return [...groups.entries()].map(([groupKey, g]) => ({
      groupKey,
      provider: g.provider,
      displayName: g.displayName,
      models: g.models,
    }));
  }),

  getCredits: protectedProcedure.query(async () => {
    const credits = await fetchOpenRouterCredits();

    if (!credits) return null;
    return {
      remaining: credits.remaining,
      limit: credits.limit,
      usage: credits.usage,
      isFreeTier: credits.isFreeTier,
    };
  }),

  getRoles: protectedProcedure.query(() => {
    return getAvailableRoleTemplates(findProjectRoot());
  }),

  update: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        displayName: z.string().min(1).max(32).optional(),
        isFavorite: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const existing = ctx.db
        .prepare('SELECT * FROM agent_config WHERE id = ?')
        .get(input.agentId) as AgentRow | undefined;
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });

      // Verify user owns the workspace that contains this agent
      const workspace = ctx.db
        .prepare('SELECT owner_id FROM workspace WHERE id = ?')
        .get(existing.workspace_id) as { owner_id: string } | undefined;
      if (workspace?.owner_id !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the workspace owner' });
      }

      if (input.displayName !== undefined) {
        ctx.db
          .prepare('UPDATE agent_config SET display_name = ? WHERE id = ?')
          .run(input.displayName, input.agentId);
      }
      if (input.isFavorite !== undefined) {
        ctx.db
          .prepare('UPDATE agent_config SET is_favorite = ? WHERE id = ?')
          .run(input.isFavorite ? 1 : 0, input.agentId);
      }
      const row = ctx.db
        .prepare('SELECT * FROM agent_config WHERE id = ?')
        .get(input.agentId) as AgentRow;
      return toAgentConfig(row);
    }),

  delete: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const existing = ctx.db
        .prepare('SELECT * FROM agent_config WHERE id = ?')
        .get(input.agentId) as AgentRow | undefined;
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });

      // Verify user owns the workspace that contains this agent
      const workspace = ctx.db
        .prepare('SELECT owner_id FROM workspace WHERE id = ?')
        .get(existing.workspace_id) as { owner_id: string } | undefined;
      if (workspace?.owner_id !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the workspace owner' });
      }

      const del = ctx.db.transaction(() => {
        ctx.db.prepare('DELETE FROM channel_agent WHERE agent_id = ?').run(input.agentId);
        ctx.db
          .prepare('UPDATE message SET dm_agent_id = NULL WHERE dm_agent_id = ?')
          .run(input.agentId);
        ctx.db.prepare('DELETE FROM task WHERE assigned_to = ?').run(input.agentId);
        ctx.db.prepare('DELETE FROM agent_config WHERE id = ?').run(input.agentId);
      });
      del();
    }),

  reorder: protectedProcedure
    .input(z.object({ orderedIds: z.array(z.string().min(1)) }))
    .mutation(({ ctx, input }) => {
      // Verify user owns the workspace
      const workspace = ctx.db
        .prepare('SELECT owner_id FROM workspace LIMIT 1')
        .get() as { owner_id: string } | undefined;
      if (workspace?.owner_id !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the workspace owner' });
      }

      const stmt = ctx.db.prepare('UPDATE agent_config SET sort_order = ? WHERE id = ?');
      const run = ctx.db.transaction(() => {
        for (let i = 0; i < input.orderedIds.length; i++) {
          stmt.run(i, input.orderedIds[i]);
        }
      });
      run();
    }),
});
