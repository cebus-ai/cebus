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
} from '@cebus/engine';
import type { ContextMessage } from '@cebus/engine';

interface CustomRoleRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const roleRouter = t.router({
  list: protectedProcedure.query(({ ctx }) => {
    // Custom roles from DB
    const rows = ctx.db
      .prepare('SELECT * FROM custom_role ORDER BY name ASC')
      .all() as CustomRoleRow[];

    const customs = rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      instructions: r.instructions,
      source: 'custom' as const,
      createdAt: r.created_at,
    }));

    // Built-in roles from engine
    const builtins = getAvailableRoleTemplates(findProjectRoot()).map(r => ({
      id: r.id,
      name: r.label,
      description: r.description,
      instructions: r.instructions,
      source: 'builtin' as const,
      createdAt: null as string | null,
    }));

    return [...customs, ...builtins];
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(64),
        description: z.string().max(256).optional(),
        instructions: z.string().min(1).max(8000),
      })
    )
    .mutation(({ ctx, input }) => {
      const id = ulid();
      ctx.db
        .prepare(
          `INSERT INTO custom_role (id, name, description, instructions, created_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, input.name, input.description ?? '', input.instructions, ctx.user.id);

      const row = ctx.db.prepare('SELECT * FROM custom_role WHERE id = ?').get(id) as CustomRoleRow;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        instructions: row.instructions,
        source: 'custom' as const,
        createdAt: row.created_at,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        roleId: z.string().min(1),
        name: z.string().min(1).max(64).optional(),
        description: z.string().max(256).optional(),
        instructions: z.string().min(1).max(8000).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const existing = ctx.db
        .prepare('SELECT created_by FROM custom_role WHERE id = ?')
        .get(input.roleId) as { created_by: string } | undefined;
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      if (existing.created_by !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the role owner' });
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.name !== undefined) {
        sets.push('name = ?');
        params.push(input.name);
      }
      if (input.description !== undefined) {
        sets.push('description = ?');
        params.push(input.description);
      }
      if (input.instructions !== undefined) {
        sets.push('instructions = ?');
        params.push(input.instructions);
      }
      if (sets.length === 0) {
        const row = ctx.db
          .prepare('SELECT * FROM custom_role WHERE id = ?')
          .get(input.roleId) as CustomRoleRow;
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          instructions: row.instructions,
          source: 'custom' as const,
          createdAt: row.created_at,
        };
      }

      sets.push("updated_at = datetime('now')");
      params.push(input.roleId);
      ctx.db.prepare(`UPDATE custom_role SET ${sets.join(', ')} WHERE id = ?`).run(...params);

      // Also update role_instructions in channel_agent rows that reference this role
      if (input.instructions !== undefined) {
        ctx.db
          .prepare('UPDATE channel_agent SET role_instructions = ? WHERE role_template = ?')
          .run(input.instructions, input.roleId);
      }

      const row = ctx.db
        .prepare('SELECT * FROM custom_role WHERE id = ?')
        .get(input.roleId) as CustomRoleRow;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        instructions: row.instructions,
        source: 'custom' as const,
        createdAt: row.created_at,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ roleId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const existing = ctx.db
        .prepare('SELECT created_by FROM custom_role WHERE id = ?')
        .get(input.roleId) as { created_by: string } | undefined;
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      if (existing.created_by !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the role owner' });
      }

      const del = ctx.db.transaction(() => {
        // Clear role from agents that use it
        ctx.db
          .prepare(
            'UPDATE channel_agent SET role_template = NULL, role_instructions = NULL WHERE role_template = ?'
          )
          .run(input.roleId);
        ctx.db.prepare('DELETE FROM custom_role WHERE id = ?').run(input.roleId);
      });
      del();
    }),

  generateInstructions: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(64),
        description: z.string().max(256).optional(),
        provider: z.string().min(1),
        model: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      registerBuiltInProviders();
      await initializeProviders();
      const registry = getProviderRegistry();
      const adapter = registry.get(input.provider);

      if (!adapter)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Provider '${input.provider}' not found`,
        });

      const messages: ContextMessage[] = [
        {
          role: 'system',
          content: `You are an expert at writing system prompt instructions for AI agents in a multi-agent group chat.
Given a role name and optional description, generate clear, actionable instructions that define the agent's behavior, expertise, and communication style.
The instructions should be 5-10 lines, written in second person ("You are...").
Focus on: what the agent does, how it communicates, what it prioritizes, what it avoids.
Return ONLY the instructions text — no JSON, no markdown formatting, no explanation.`,
        },
        {
          role: 'user',
          content: `Role name: ${input.name}${input.description !== undefined && input.description.length > 0 ? `\nDescription: ${input.description}` : ''}`,
        },
      ];

      const result = await adapter.complete(input.model, messages);
      return { instructions: result.content };
    }),
});
