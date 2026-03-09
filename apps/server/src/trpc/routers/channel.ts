import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc';
import { protectedProcedure, channelMemberProcedure, channelOwnerProcedure } from '../middleware';
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  archiveChannel,
  restoreChannel,
  clearChannelContext,
  deleteChannel,
  addAgentToChannel,
  updateAgentInChannel,
  removeAgentFromChannel,
  reorderChannels,
  getUnreadCounts,
  markChannelSeen,
} from '../../services/channel';
import { getAvailableRoleTemplates, findProjectRoot } from '@cebus/engine';

export const channelRouter = t.router({
  list: protectedProcedure
    .input(z.object({ status: z.enum(['active', 'archived']).optional() }).optional())
    .query(({ ctx, input }) => {
      return listChannels(ctx.db, input?.status ?? 'active');
    }),

  get: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      const channel = getChannel(ctx.db, input.channelId);
      if (!channel) throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      return channel;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(64),
        subject: z.string().max(256).optional(),
        instructions: z.string().optional(),
        chatMode: z.enum(['free_chat', 'sequential', 'tag_only', 'role_based', 'raw']).optional(),
        orchestratorEnabled: z.boolean().optional(),
        orchestratorModel: z.string().optional(),
        responseLength: z.enum(['free', 'short', 'medium', 'detailed']).optional(),
        includeSystemPrompt: z.boolean().optional(),
        includeProjectContext: z.boolean().optional(),
        includeModeGuidance: z.boolean().optional(),
        includeTierGuidance: z.boolean().optional(),
        includeRichComponents: z.boolean().optional(),
        workingDir: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      return createChannel(ctx.db, ctx.user.id, input);
    }),

  addAgent: channelOwnerProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        agentId: z.string().min(1),
        roleTemplate: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const channel = getChannel(ctx.db, input.channelId);
      if (!channel) throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });

      // Resolve role instructions from custom_role DB or built-in engine
      let roleInstructions: string | undefined;
      if (input.roleTemplate !== undefined && input.roleTemplate.length > 0) {
        const customRole = ctx.db
          .prepare('SELECT instructions FROM custom_role WHERE id = ?')
          .get(input.roleTemplate) as { instructions: string } | undefined;
        if (customRole) {
          roleInstructions = customRole.instructions;
        } else {
          const builtins = getAvailableRoleTemplates(findProjectRoot());
          const builtin = builtins.find(r => r.id === input.roleTemplate);

          if (builtin) {
            roleInstructions = builtin.instructions;
          }
        }
      }

      addAgentToChannel(
        ctx.db,
        input.channelId,
        input.agentId,
        input.roleTemplate,
        roleInstructions
      );
      return getChannel(ctx.db, input.channelId)!;
    }),

  updateAgent: channelOwnerProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        agentId: z.string().min(1),
        roleTemplate: z.string().nullable().optional(),
        displayNameOverride: z.string().max(64).nullable().optional(),
        customInstructions: z.string().max(8000).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      let roleInstructions: string | null | undefined;
      if (input.customInstructions !== undefined) {
        roleInstructions = input.customInstructions;
      } else if (input.roleTemplate !== undefined) {
        // Resolve instructions from role
        if (input.roleTemplate !== null && input.roleTemplate.length > 0) {
          const customRole = ctx.db
            .prepare('SELECT instructions FROM custom_role WHERE id = ?')
            .get(input.roleTemplate) as { instructions: string } | undefined;
          if (customRole) {
            roleInstructions = customRole.instructions;
          } else {
            const builtins = getAvailableRoleTemplates(findProjectRoot());
            const builtin = builtins.find(r => r.id === input.roleTemplate);
            roleInstructions = builtin?.instructions ?? null;
          }
        } else {
          roleInstructions = null;
        }
      }

      updateAgentInChannel(ctx.db, input.channelId, input.agentId, {
        roleTemplate: input.roleTemplate,
        roleInstructions,
        displayNameOverride: input.displayNameOverride,
      });
      return getChannel(ctx.db, input.channelId)!;
    }),

  removeAgent: channelOwnerProcedure
    .input(z.object({ channelId: z.string().min(1), agentId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      removeAgentFromChannel(ctx.db, input.channelId, input.agentId);
    }),

  update: channelOwnerProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        name: z.string().min(1).max(64).optional(),
        subject: z.string().max(256).optional(),
        instructions: z.string().optional(),
        chatMode: z.enum(['free_chat', 'sequential', 'tag_only', 'role_based', 'raw']).optional(),
        orchestratorEnabled: z.boolean().optional(),
        orchestratorModel: z.string().optional(),
        responseLength: z.enum(['free', 'short', 'medium', 'detailed']).optional(),
        contextLevel: z.enum(['none', 'minimal', 'full']).optional(),
        contextWindowSize: z.number().int().min(1).max(100).optional(),
        includeSystemPrompt: z.boolean().optional(),
        includeProjectContext: z.boolean().optional(),
        includeModeGuidance: z.boolean().optional(),
        includeTierGuidance: z.boolean().optional(),
        includeRichComponents: z.boolean().optional(),
        workingDir: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { channelId, ...data } = input;
      const channel = updateChannel(ctx.db, channelId, data);
      if (!channel) throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      return channel;
    }),

  archive: channelOwnerProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const channel = archiveChannel(ctx.db, input.channelId);
      if (!channel) throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      return channel;
    }),

  restore: channelOwnerProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const channel = restoreChannel(ctx.db, input.channelId);
      if (!channel) throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      return channel;
    }),

  clearContext: channelOwnerProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const channel = clearChannelContext(ctx.db, input.channelId);
      if (!channel) throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      return channel;
    }),

  delete: channelOwnerProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      deleteChannel(ctx.db, input.channelId);
    }),

  reorder: protectedProcedure
    .input(z.object({ orderedIds: z.array(z.string().min(1)) }))
    .mutation(({ ctx, input }) => {
      reorderChannels(ctx.db, input.orderedIds);
    }),

  unreadCounts: protectedProcedure.query(({ ctx }) => {
    return getUnreadCounts(ctx.db, ctx.user.id);
  }),

  markSeen: protectedProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      markChannelSeen(ctx.db, input.channelId, ctx.user.id);
    }),
});
