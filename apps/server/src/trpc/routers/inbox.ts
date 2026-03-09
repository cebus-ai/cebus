import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ulid } from 'ulid';
import { t } from '../trpc';
import { protectedProcedure } from '../middleware';

interface InboxRow {
  id: string;
  user_id: string;
  sender_type: string;
  sender_id: string;
  task_id: string | null;
  channel_id: string | null;
  parent_message_id: string | null;
  content: string;
  content_preview: string;
  content_badges: string;
  is_read: number;
  created_at: string;
}

function toInboxItem(row: InboxRow): {
  id: string;
  userId: string;
  senderType: string;
  senderId: string;
  taskId: string | null;
  channelId: string | null;
  parentMessageId: string | null;
  content: string;
  contentPreview: string;
  contentBadges: string[];
  isRead: boolean;
  createdAt: string;
} {
  return {
    id: row.id,
    userId: row.user_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    taskId: row.task_id,
    channelId: row.channel_id,
    parentMessageId: row.parent_message_id,
    content: row.content,
    contentPreview: row.content_preview,
    contentBadges: JSON.parse(row.content_badges) as string[],
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

export const inboxRouter = t.router({
  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().optional(),
          unreadOnly: z.boolean().optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => {
      const limit = Math.min(input?.limit ?? 50, 100);
      const params: unknown[] = [ctx.user.id];
      let query = 'SELECT * FROM inbox_item WHERE user_id = ?';
      if (input?.unreadOnly === true) {
        query += ' AND is_read = 0';
      }
      if (input?.cursor !== undefined && input.cursor.length > 0) {
        query += ' AND created_at < ?';
        params.push(input.cursor);
      }
      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit + 1);
      const rows = ctx.db.prepare(query).all(...params) as InboxRow[];
      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map(toInboxItem);
      const nextCursor = hasMore ? items[items.length - 1]!.createdAt : null;
      const unreadCount = (
        ctx.db
          .prepare('SELECT COUNT(*) as c FROM inbox_item WHERE user_id = ? AND is_read = 0')
          .get(ctx.user.id) as { c: number }
      ).c;
      return { items, nextCursor, unreadCount };
    }),

  get: protectedProcedure.input(z.object({ itemId: z.string() })).query(({ ctx, input }) => {
    ctx.db
      .prepare('UPDATE inbox_item SET is_read = 1 WHERE id = ? AND user_id = ?')
      .run(input.itemId, ctx.user.id);
    const row = ctx.db
      .prepare('SELECT * FROM inbox_item WHERE id = ? AND user_id = ?')
      .get(input.itemId, ctx.user.id) as InboxRow | undefined;
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    return toInboxItem(row);
  }),

  markRead: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .prepare('UPDATE inbox_item SET is_read = 1 WHERE id = ? AND user_id = ?')
        .run(input.itemId, ctx.user.id);
    }),

  clearAll: protectedProcedure.mutation(({ ctx }) => {
    ctx.db.prepare('DELETE FROM inbox_item WHERE user_id = ?').run(ctx.user.id);
  }),

  delete: protectedProcedure.input(z.object({ itemId: z.string() })).mutation(({ ctx, input }) => {
    ctx.db
      .prepare('DELETE FROM inbox_item WHERE id = ? AND user_id = ?')
      .run(input.itemId, ctx.user.id);
  }),

  conversations: protectedProcedure.query(({ ctx }) => {
    const rows = ctx.db
      .prepare(
        `SELECT
           i.sender_id,
           ac.display_name,
           ac.avatar_letter,
           ac.avatar_color,
           ac.provider,
           ac.model,
           MAX(i.created_at) AS last_message_at,
           SUM(CASE WHEN i.is_read = 0 THEN 1 ELSE 0 END) AS unread_count
         FROM inbox_item i
         JOIN agent_config ac ON ac.id = i.sender_id
         WHERE i.user_id = ? AND i.sender_type = 'agent'
         GROUP BY i.sender_id
         ORDER BY last_message_at DESC`
      )
      .all(ctx.user.id) as {
      sender_id: string;
      display_name: string;
      avatar_letter: string;
      avatar_color: string;
      provider: string;
      model: string;
      last_message_at: string;
      unread_count: number;
    }[];

    const conversations = rows.map(r => {
      const latest = ctx.db
        .prepare(
          `SELECT content_preview, channel_id FROM inbox_item
           WHERE user_id = ? AND sender_id = ?
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(ctx.user.id, r.sender_id) as
        | { content_preview: string; channel_id: string | null }
        | undefined;

      return {
        agentId: r.sender_id,
        displayName: r.display_name,
        avatarLetter: r.avatar_letter,
        avatarColor: r.avatar_color,
        provider: r.provider,
        model: r.model,
        lastPreview: latest?.content_preview ?? '',
        lastMessageAt: r.last_message_at,
        lastChannelId: latest?.channel_id ?? null,
        unreadCount: r.unread_count,
      };
    });

    const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);
    return { conversations, totalUnread };
  }),

  markReadForAgent: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .prepare('UPDATE inbox_item SET is_read = 1 WHERE user_id = ? AND sender_id = ?')
        .run(ctx.user.id, input.agentId);
    }),

  deleteForAgent: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .prepare('DELETE FROM inbox_item WHERE user_id = ? AND sender_id = ?')
        .run(ctx.user.id, input.agentId);
    }),

  shareToChannel: protectedProcedure
    .input(z.object({ itemId: z.string(), channelId: z.string() }))
    .mutation(({ ctx, input }) => {
      const item = ctx.db
        .prepare('SELECT * FROM inbox_item WHERE id = ? AND user_id = ?')
        .get(input.itemId, ctx.user.id) as InboxRow | undefined;
      if (!item) throw new TRPCError({ code: 'NOT_FOUND' });

      // Verify user is a member of the target channel
      const membership = ctx.db
        .prepare('SELECT 1 FROM channel_member WHERE channel_id = ? AND user_id = ?')
        .get(input.channelId, ctx.user.id);
      if (membership === undefined)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of target channel' });
      const msgId = ulid();
      ctx.db
        .prepare(
          "INSERT INTO message (id, channel_id, sender_type, sender_id, content, format_type) VALUES (?, ?, 'user', ?, ?, 'text')"
        )
        .run(msgId, input.channelId, ctx.user.id, `[Shared from Inbox] ${item.content}`);
      const row = ctx.db.prepare('SELECT * FROM message WHERE id = ?').get(msgId);
      return row;
    }),
});
