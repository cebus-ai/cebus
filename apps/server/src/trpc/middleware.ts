import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { t } from './trpc';

export const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthed);

const channelIdInput = z.object({ channelId: z.string().min(1) });
const messageIdInput = z.object({ messageId: z.string().min(1) });

/**
 * Middleware that verifies the authenticated user is a member of the target channel.
 * Procedures using this must include `channelId: z.string()` in their input schema.
 */
const isChannelMember = t.middleware(async ({ ctx, getRawInput, next }) => {
  const rawInput = await getRawInput();
  const parsed = channelIdInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'channelId is required' });
  }
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  const membership = ctx.db
    .prepare('SELECT 1 FROM channel_member WHERE channel_id = ? AND user_id = ?')
    .get(parsed.data.channelId, ctx.user.id);
  if (membership === undefined) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this channel' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Middleware that verifies the authenticated user created (owns) the target channel.
 */
const isChannelOwner = t.middleware(async ({ ctx, getRawInput, next }) => {
  const rawInput = await getRawInput();
  const parsed = channelIdInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'channelId is required' });
  }
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  const channel = ctx.db
    .prepare('SELECT created_by FROM channel WHERE id = ?')
    .get(parsed.data.channelId) as { created_by: string } | undefined;
  if (!channel) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
  }
  if (channel.created_by !== ctx.user.id) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the channel owner' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Requires authentication + channel membership */
export const channelMemberProcedure = t.procedure.use(isAuthed).use(isChannelMember);

/** Requires authentication + channel ownership */
export const channelOwnerProcedure = t.procedure.use(isAuthed).use(isChannelOwner);

/**
 * Middleware that resolves a message's channel and verifies the authenticated
 * user is a member.  Procedures using this must include `messageId: z.string()`
 * in their input schema.
 */
const isMessageChannelMember = t.middleware(async ({ ctx, getRawInput, next }) => {
  const rawInput = await getRawInput();
  const parsed = messageIdInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'messageId is required' });
  }
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  const row = ctx.db
    .prepare(
      `SELECT 1 FROM message m
       JOIN channel_member cm ON cm.channel_id = m.channel_id
       WHERE m.id = ? AND cm.user_id = ?`
    )
    .get(parsed.data.messageId, ctx.user.id);
  if (row === undefined) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Message not found or not a channel member' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Requires authentication + membership in the channel that owns the message */
export const messageMemberProcedure = t.procedure.use(isAuthed).use(isMessageChannelMember);
