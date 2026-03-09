import { z } from 'zod';
import { t } from '../trpc';
import { channelMemberProcedure, channelOwnerProcedure, messageMemberProcedure } from '../middleware';
import { TRPCError } from '@trpc/server';
import {
  listMessages,
  listDMMessages,
  insertUserMessage,
  insertDMMessage,
  toMessage,
  triggerOrchestration,
  triggerDMResponse,
  cancelDMGeneration,
  listThreadMessages,
  insertThreadReply,
  triggerThreadOrchestration,
  getThreadReplyCounts,
  setMessageHidden,
  toggleMessageContext,
  regenerateAgentMessage,
  retriggerUserMessage,
  updateUserMessage,
} from '../../services/message';
import {
  getChannelGraphFromCache,
  cancelChannelGeneration,
  getPendingPlanApproval,
  clearPendingPlanApproval,
  getPendingUserInputs,
  clearPendingUserInput,
} from '../../services/orchestration';

/** Sanitize FTS5 query input by removing special operators */
function sanitizeFts5Query(query: string): string {
  return query.replace(/[*"(){}[\]^~\\|:!&]/g, ' ').trim();
}

export const messageRouter = t.router({
  list: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        branchId: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
    )
    .query(({ ctx, input }) => {
      const result = listMessages(ctx.db, input.channelId, {
        branchId: input.branchId,
        cursor: input.cursor,
        limit: input.limit,
      });

      // Attach reply counts for all returned messages
      const ids = result.messages.map(m => m.id);
      const replyCounts = getThreadReplyCounts(ctx.db, ids);

      return {
        ...result,
        replyCounts,
      };
    }),

  send: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        content: z.string().min(1),
        formatType: z.enum(['text', 'code', 'mermaid', 'table']).optional(),
        replyToId: z.string().optional(),
        branchId: z.string().optional(),
        contextSize: z.number().int().min(1).max(100).optional(),
        directedTo: z.array(z.string()).optional(),
        attachments: z.array(z.object({
          type: z.enum(['file', 'directory', 'selection']),
          path: z.string(),
          displayName: z.string().optional(),
        })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const attachmentsMeta = input.attachments?.map(a => ({
        fileName: a.displayName ?? a.path.split(/[\\/]/).pop() ?? 'file',
        type: a.type,
      }));
      const userMsg = insertUserMessage(
        ctx.db,
        input.channelId,
        ctx.user.id,
        input.content,
        input.formatType ?? 'text',
        input.replyToId,
        input.branchId,
        attachmentsMeta
      );

      triggerOrchestration(
        ctx.db,
        input.channelId,
        input.content,
        ctx.user.id,
        input.contextSize,
        input.directedTo,
        input.attachments
      ).catch(err => {
        console.error('Background orchestration failed:', err);
      });

      return userMsg;
    }),

  // Thread endpoints
  threadList: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), parentMessageId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return listThreadMessages(ctx.db, input.parentMessageId);
    }),

  threadSend: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        parentMessageId: z.string().min(1),
        content: z.string().min(1),
        targetAgentIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userMsg = insertThreadReply(
        ctx.db,
        input.channelId,
        input.parentMessageId,
        ctx.user.id,
        input.content
      );

      triggerThreadOrchestration(
        ctx.db,
        input.channelId,
        input.parentMessageId,
        input.content,
        ctx.user.id,
        input.targetAgentIds
      ).catch(err => {
        console.error('Background thread orchestration failed:', err);
      });

      return userMsg;
    }),

  listDM: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        agentId: z.string().min(1),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
    )
    .query(({ ctx, input }) => {
      return listDMMessages(ctx.db, input.channelId, input.agentId, {
        cursor: input.cursor,
        limit: input.limit,
      });
    }),

  sendDM: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        agentId: z.string().min(1),
        content: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const msg = insertDMMessage(
        ctx.db,
        input.channelId,
        ctx.user.id,
        input.agentId,
        input.content
      );

      triggerDMResponse(ctx.db, input.channelId, input.agentId, ctx.user.id).catch(err => {
        console.error('Background DM response failed:', err);
      });

      return msg;
    }),

  search: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().optional(),
      })
    )
    .query(({ ctx, input }) => {
      const limit = Math.min(input.limit ?? 20, 50);
      const sanitized = sanitizeFts5Query(input.query);
      if (!sanitized) return [];
      const params: unknown[] = [sanitized + '*', input.channelId];
      const query = `SELECT m.* FROM message m JOIN message_fts ON m.rowid = message_fts.rowid WHERE message_fts MATCH ? AND m.channel_id = ? ORDER BY m.created_at DESC LIMIT ?`;
      params.push(limit);
      try {
        const rows = ctx.db.prepare(query).all(...params) as unknown as Parameters<
          typeof toMessage
        >[0][];
        return rows.map(r => toMessage(r));
      } catch (err) {
        console.error('[search] FTS5 query failed:', err instanceof Error ? err.message : err);
        return [];
      }
    }),

  clear: channelOwnerProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      ctx.db.prepare('DELETE FROM pinned_message WHERE channel_id = ?').run(input.channelId);
      ctx.db.prepare('DELETE FROM message WHERE channel_id = ? AND is_dm = 0').run(input.channelId);
    }),

  pin: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), messageId: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .prepare(
          'INSERT OR IGNORE INTO pinned_message (channel_id, message_id, pinned_by) VALUES (?, ?, ?)'
        )
        .run(input.channelId, input.messageId, ctx.user.id);
    }),

  unpin: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), messageId: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .prepare('DELETE FROM pinned_message WHERE channel_id = ? AND message_id = ?')
        .run(input.channelId, input.messageId);
    }),

  listPinned: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      const rows = ctx.db
        .prepare(
          `SELECT m.* FROM message m JOIN pinned_message pm ON m.id = pm.message_id WHERE pm.channel_id = ? ORDER BY pm.pinned_at DESC`
        )
        .all(input.channelId) as unknown as Parameters<typeof toMessage>[0][];
      return rows.map(r => toMessage(r));
    }),

  toggleContext: messageMemberProcedure
    .input(z.object({ messageId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      return toggleMessageContext(ctx.db, input.messageId);
    }),

  archive: messageMemberProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(({ ctx, input }) => {
      setMessageHidden(ctx.db, input.messageId, true);
    }),

  restore: messageMemberProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(({ ctx, input }) => {
      setMessageHidden(ctx.db, input.messageId, false);
    }),

  regenerate: messageMemberProcedure
    .input(z.object({ messageId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      regenerateAgentMessage(ctx.db, input.messageId).catch(err => {
        console.error('Background regeneration failed:', err);
      });
    }),

  retrigger: messageMemberProcedure
    .input(z.object({ messageId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      retriggerUserMessage(ctx.db, input.messageId, ctx.user.id).catch(err => {
        console.error('Background retrigger failed:', err);
      });
    }),

  editAndResend: messageMemberProcedure
    .input(z.object({ messageId: z.string().min(1), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      updateUserMessage(ctx.db, input.messageId, input.content, ctx.user.id).catch(err => {
        console.error('Background edit-and-resend failed:', err);
      });
    }),

  cancelGeneration: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .mutation(({ input }) => {
      cancelChannelGeneration(input.channelId);
    }),

  cancelDM: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), agentId: z.string().min(1) }))
    .mutation(({ input }) => {
      cancelDMGeneration(input.channelId, input.agentId);
    }),

  respondToUserInput: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        requestId: z.string().min(1),
        answer: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const graph = getChannelGraphFromCache(input.channelId);
      if (!graph) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No active graph for this channel' });
      }
      clearPendingUserInput(input.channelId, input.requestId);
      await graph.respondToInputRequest(input.requestId, input.answer);
    }),

  getPendingUserInputs: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .query(({ input }) => getPendingUserInputs(input.channelId)),

  respondToApproval: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        approvalId: z.string().min(1),
        approved: z.boolean(),
        budget: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const graph = getChannelGraphFromCache(input.channelId);

      if (!graph) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No active graph for this channel' });
      }
      await graph.respondToApproval(
        input.approvalId,
        input.approved,
        input.budget ?? (input.approved ? 1 : 0)
      );
    }),

  respondToPlanApproval: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), approved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const analysis = getPendingPlanApproval(input.channelId);
      if (!analysis) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No pending plan approval for this channel' });
      }
      clearPendingPlanApproval(input.channelId);
      if (!input.approved) {
        return { ok: true };
      }
      await triggerOrchestration(
        ctx.db, input.channelId, '', ctx.user.id,
        undefined, undefined, undefined, analysis,
      );
      return { ok: true };
    }),
});
