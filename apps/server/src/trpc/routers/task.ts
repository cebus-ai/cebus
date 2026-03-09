import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ulid } from 'ulid';
import { t } from '../trpc';
import { channelMemberProcedure } from '../middleware';

interface TaskRow {
  id: string;
  channel_id: string;
  assigned_by: string;
  assigned_to: string;
  description: string;
  status: string;
  detection_source: string;
  delegation_log: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function toTask(row: TaskRow): {
  id: string;
  channelId: string;
  assignedBy: string;
  assignedTo: string;
  description: string;
  status: string;
  detectionSource: string;
  delegationLog: unknown;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
} {
  return {
    id: row.id,
    channelId: row.channel_id,
    assignedBy: row.assigned_by,
    assignedTo: row.assigned_to,
    description: row.description,
    status: row.status,
    detectionSource: row.detection_source,
    delegationLog: row.delegation_log !== null ? (JSON.parse(row.delegation_log) as unknown) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export const taskRouter = t.router({
  create: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), agentId: z.string(), description: z.string() }))
    .mutation(({ ctx, input }) => {
      const id = ulid();
      ctx.db
        .prepare(
          'INSERT INTO task (id, channel_id, assigned_by, assigned_to, description) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, input.channelId, ctx.user.id, input.agentId, input.description);
      const row = ctx.db.prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow;
      return toTask(row);
    }),

  list: channelMemberProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        status: z.string().optional(),
        agentId: z.string().optional(),
      })
    )
    .query(({ ctx, input }) => {
      let query = 'SELECT * FROM task WHERE channel_id = ?';
      const params: unknown[] = [input.channelId];
      if (input.status !== undefined && input.status.length > 0) {
        query += ' AND status = ?';
        params.push(input.status);
      }
      if (input.agentId !== undefined && input.agentId.length > 0) {
        query += ' AND assigned_to = ?';
        params.push(input.agentId);
      }
      query += ' ORDER BY created_at DESC';
      return (ctx.db.prepare(query).all(...params) as TaskRow[]).map(toTask);
    }),

  get: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), taskId: z.string() }))
    .query(({ ctx, input }) => {
      const row = ctx.db
        .prepare('SELECT * FROM task WHERE id = ? AND channel_id = ?')
        .get(input.taskId, input.channelId) as TaskRow | undefined;
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return toTask(row);
    }),

  cancel: channelMemberProcedure
    .input(z.object({ channelId: z.string().min(1), taskId: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .prepare(
          "UPDATE task SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND channel_id = ? AND status IN ('pending','in_progress')"
        )
        .run(input.taskId, input.channelId);
      const row = ctx.db
        .prepare('SELECT * FROM task WHERE id = ? AND channel_id = ?')
        .get(input.taskId, input.channelId) as TaskRow;
      return toTask(row);
    }),
});
