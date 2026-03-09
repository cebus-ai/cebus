import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import { homedir } from 'os';
import { resolve, dirname, sep } from 'path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc';
import { protectedProcedure } from '../middleware';
import { findProjectRoot, isPricingStale, refreshPricing } from '@cebus/engine';
import { isWithinDir, isSameDrive } from '../../utils/paths';

/** Resolve the effective workspace working directory: DB override > findProjectRoot(). */
function getWorkspaceWorkingDir(db: import('better-sqlite3').Database): string {
  const row = db
    .prepare('SELECT default_working_dir FROM workspace LIMIT 1')
    .get() as { default_working_dir: string | null } | undefined;
  return row?.default_working_dir ?? findProjectRoot();
}

export const workspaceRouter = t.router({
  get: protectedProcedure.query(({ ctx }) => {
    const row = ctx.db
      .prepare('SELECT id, name, owner_id, default_context_window_size, default_include_system_prompt, default_include_project_context, default_include_mode_guidance, default_include_tier_guidance, default_include_rich_components, default_working_dir, created_at FROM workspace LIMIT 1')
      .get() as { id: string; name: string; owner_id: string; default_context_window_size: number; default_include_system_prompt: number; default_include_project_context: number; default_include_mode_guidance: number; default_include_tier_guidance: number; default_include_rich_components: number; default_working_dir: string | null; created_at: string } | undefined;

    if (!row) {
      return { id: '', name: 'Agentic OS', ownerId: '', defaultContextWindowSize: 10, defaultIncludeSystemPrompt: true, defaultIncludeProjectContext: true, defaultIncludeModeGuidance: true, defaultIncludeTierGuidance: true, defaultIncludeRichComponents: true, defaultWorkingDir: null as string | null, createdAt: new Date().toISOString() };
    }

    return {
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      defaultContextWindowSize: row.default_context_window_size ?? 10,
      defaultIncludeSystemPrompt: (row.default_include_system_prompt ?? 1) === 1,
      defaultIncludeProjectContext: (row.default_include_project_context ?? 1) === 1,
      defaultIncludeModeGuidance: (row.default_include_mode_guidance ?? 1) === 1,
      defaultIncludeTierGuidance: (row.default_include_tier_guidance ?? 1) === 1,
      defaultIncludeRichComponents: (row.default_include_rich_components ?? 1) === 1,
      defaultWorkingDir: row.default_working_dir,
      createdAt: row.created_at,
    };
  }),

  update: protectedProcedure
    .input(z.object({
      defaultContextWindowSize: z.number().int().min(1).max(100).optional(),
      defaultIncludeSystemPrompt: z.boolean().optional(),
      defaultIncludeProjectContext: z.boolean().optional(),
      defaultIncludeModeGuidance: z.boolean().optional(),
      defaultIncludeTierGuidance: z.boolean().optional(),
      defaultIncludeRichComponents: z.boolean().optional(),
      defaultWorkingDir: z.string().nullable().optional(),
    }))
    .mutation(({ ctx, input }) => {
      // Verify user owns the workspace
      const ws = ctx.db
        .prepare('SELECT owner_id FROM workspace LIMIT 1')
        .get() as { owner_id: string } | undefined;
      if (ws?.owner_id !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the workspace owner' });
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.defaultContextWindowSize !== undefined) { sets.push('default_context_window_size = ?'); params.push(input.defaultContextWindowSize); }
      if (input.defaultIncludeSystemPrompt !== undefined) { sets.push('default_include_system_prompt = ?'); params.push(input.defaultIncludeSystemPrompt ? 1 : 0); }
      if (input.defaultIncludeProjectContext !== undefined) { sets.push('default_include_project_context = ?'); params.push(input.defaultIncludeProjectContext ? 1 : 0); }
      if (input.defaultIncludeModeGuidance !== undefined) { sets.push('default_include_mode_guidance = ?'); params.push(input.defaultIncludeModeGuidance ? 1 : 0); }
      if (input.defaultIncludeTierGuidance !== undefined) { sets.push('default_include_tier_guidance = ?'); params.push(input.defaultIncludeTierGuidance ? 1 : 0); }
      if (input.defaultIncludeRichComponents !== undefined) { sets.push('default_include_rich_components = ?'); params.push(input.defaultIncludeRichComponents ? 1 : 0); }
      if (input.defaultWorkingDir !== undefined) { sets.push('default_working_dir = ?'); params.push(input.defaultWorkingDir); }
      if (sets.length > 0) {
        ctx.db.prepare(`UPDATE workspace SET ${sets.join(', ')}`).run(...params);
      }
      const row = ctx.db
        .prepare('SELECT id, name, owner_id, default_context_window_size, default_include_system_prompt, default_include_project_context, default_include_mode_guidance, default_include_tier_guidance, default_include_rich_components, default_working_dir, created_at FROM workspace LIMIT 1')
        .get() as { id: string; name: string; owner_id: string; default_context_window_size: number; default_include_system_prompt: number; default_include_project_context: number; default_include_mode_guidance: number; default_include_tier_guidance: number; default_include_rich_components: number; default_working_dir: string | null; created_at: string } | undefined;
      return {
        id: row?.id ?? '',
        name: row?.name ?? 'Agentic OS',
        ownerId: row?.owner_id ?? '',
        defaultContextWindowSize: row?.default_context_window_size ?? 10,
        defaultIncludeSystemPrompt: (row?.default_include_system_prompt ?? 1) === 1,
        defaultIncludeProjectContext: (row?.default_include_project_context ?? 1) === 1,
        defaultIncludeModeGuidance: (row?.default_include_mode_guidance ?? 1) === 1,
        defaultIncludeTierGuidance: (row?.default_include_tier_guidance ?? 1) === 1,
        defaultIncludeRichComponents: (row?.default_include_rich_components ?? 1) === 1,
        defaultWorkingDir: row?.default_working_dir ?? null,
        createdAt: row?.created_at ?? new Date().toISOString(),
      };
    }),

  getProjectRoot: protectedProcedure.query(({ ctx }) => {
    return { path: getWorkspaceWorkingDir(ctx.db) };
  }),

  pricingStatus: protectedProcedure.query(async () => {
    const stale = await isPricingStale();
    return { stale };
  }),

  refreshPricing: protectedProcedure.mutation(async () => {
    const result = await refreshPricing();
    return result;
  }),

  getChannelWorkingDir: protectedProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      const row = ctx.db
        .prepare('SELECT working_dir FROM channel WHERE id = ?')
        .get(input.channelId) as { working_dir: string | null } | undefined;
      return { path: row?.working_dir ?? getWorkspaceWorkingDir(ctx.db) };
    }),

  getGitInfo: protectedProcedure
    .input(z.object({ workingDir: z.string().optional() }).optional())
    .query(({ input }) => {
      const cwd = input?.workingDir ?? findProjectRoot();
      const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const branch = result.status === 0 ? result.stdout.trim() : null;
      return { branch };
    }),

  browseDirs: protectedProcedure
    .input(z.object({ path: z.string().optional() }))
    .query(({ ctx, input }) => {
      const home = resolve(homedir());
      const workspaceDir = resolve(getWorkspaceWorkingDir(ctx.db));
      const current = resolve(input?.path ?? workspaceDir);

      // Security: allow browsing the home tree, workspace tree, or anywhere on the
      // same drive as the workspace (so the user can freely pick sibling folders).
      // On Unix isSameDrive always returns true, so we fall back to home/workspace checks.
      const allowed =
        isWithinDir(current, home) ||
        isWithinDir(current, workspaceDir) ||
        isSameDrive(current, workspaceDir);
      if (!allowed) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot browse outside home or workspace directory' });
      }

      const parent = dirname(current);
      const dirs: string[] = [];
      try {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            dirs.push(entry.name);
          }
        }
      } catch {
        // Directory not readable — return empty list
      }
      dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      const parentAllowed = parent !== current &&
        (isWithinDir(parent, home) || isWithinDir(parent, workspaceDir) || isSameDrive(parent, workspaceDir));
      return {
        current,
        parent: parentAllowed ? parent : null,
        dirs,
        sep,
      };
    }),

  getMembers: protectedProcedure.query(({ ctx }) => {
    // Only return users who are members of at least one channel or own the workspace
    const rows = ctx.db
      .prepare(
        `SELECT DISTINCT u.id, u.name, u.createdAt FROM user u
         WHERE u.id IN (SELECT DISTINCT user_id FROM channel_member)
            OR u.id IN (SELECT owner_id FROM workspace)
         ORDER BY u.name ASC`,
      )
      .all() as { id: string; name: string; createdAt: string }[];

    return rows.map((r) => ({
      id: r.id,
      username: r.name,
      displayName: r.name,
      avatarColor: '#6366f1',
      createdAt: r.createdAt,
    }));
  }),
});
