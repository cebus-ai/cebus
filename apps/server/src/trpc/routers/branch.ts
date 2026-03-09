import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ulid } from 'ulid';
import { t } from '../trpc';
import { channelMemberProcedure } from '../middleware';

interface BranchRow {
  id: string;
  channel_id: string;
  origin_message_id: string;
  name: string | null;
  created_by: string;
  created_at: string;
}

function toBranch(row: BranchRow): {
  id: string;
  channelId: string;
  originMessageId: string;
  name: string | null;
  createdBy: string;
  createdAt: string;
} {
  return {
    id: row.id,
    channelId: row.channel_id,
    originMessageId: row.origin_message_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export const branchRouter = t.router({
  create: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        originMessageId: z.string(),
        name: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const id = ulid();
      ctx.db
        .prepare(
          'INSERT INTO branch (id, channel_id, origin_message_id, name, created_by) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, input.channelId, input.originMessageId, input.name ?? null, ctx.user.id);
      const row = ctx.db.prepare('SELECT * FROM branch WHERE id = ?').get(id) as BranchRow;
      return toBranch(row);
    }),

  list: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      const rows = ctx.db
        .prepare('SELECT * FROM branch WHERE channel_id = ? ORDER BY created_at DESC')
        .all(input.channelId) as BranchRow[];
      return rows.map(toBranch);
    }),

  get: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), branchId: z.string() }))
    .query(({ ctx, input }) => {
      const row = ctx.db
        .prepare('SELECT * FROM branch WHERE id = ? AND channel_id = ?')
        .get(input.branchId, input.channelId) as BranchRow | undefined;
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return toBranch(row);
    }),
});
